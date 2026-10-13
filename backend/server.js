import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

app.get("/", (req, res) => {
  res.json({ name: "Lazarus AI Backend", status: "online" });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    supabaseConfigured: Boolean(supabase),
    groqConfigured: Boolean(groqApiKey)
  });
});

async function requireUser(req, res, next) {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase is not configured." });
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Please sign in first." });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: "Your session expired. Please sign in again."
      });
    }

    req.user = data.user;
    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ error: "Could not verify your session." });
  }
}

app.post("/api/chat", requireUser, async (req, res) => {
  if (!groqApiKey) {
    return res.status(500).json({ error: "Groq is not configured." });
  }

  const incoming = req.body?.messages;

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "Please provide chat messages." });
  }

  // Keep only supported roles and valid message content.
  const messages = incoming
    .filter(m =>
      m &&
      ["system", "user", "assistant"].includes(m.role) &&
      (
        typeof m.content === "string" ||
        (
          Array.isArray(m.content) &&
          m.content.every(part =>
            part &&
            (
              (part.type === "text" && typeof part.text === "string") ||
              (
                part.type === "image_url" &&
                typeof part.image_url?.url === "string" &&
                /^data:image\/(jpeg|png|webp|gif);base64,/i.test(
                  part.image_url.url
                )
              )
            )
          )
        )
      )
    )
    .slice(-32);

  if (!messages.length) {
    return res.status(400).json({ error: "No valid messages were provided." });
  }

  const hasImages = messages.some(m =>
    Array.isArray(m.content) &&
    m.content.some(part => part.type === "image_url")
  );

  // GPT-OSS for text; a vision-capable model when images are attached.
  const model = hasImages
    ? "qwen/qwen3.8-27b"
    : "openai/gpt-oss-120b";

  // Code Mode asks for a longer reply (max_tokens). Default 1500, never above 4000.
  const requestedTokens = Number(req.body?.max_tokens);
  const maxTokens = Number.isFinite(requestedTokens) && requestedTokens > 0
    ? Math.min(Math.floor(requestedTokens), 4000)
    : 1500;

  const controller = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_completion_tokens: maxTokens,
          stream: true
        })
      }
    );

    if (!upstream.ok) {
      const details = await upstream.json().catch(() => ({}));
      console.error("Groq error:", details);

      return res.status(502).json({
        error: "Groq could not complete the request. Check Render logs."
      });
    }

    if (!upstream.body) {
      return res.status(502).json({ error: "Groq returned no response stream." });
    }

    // Forward Groq's SSE stream to the frontend.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    for await (const chunk of upstream.body) {
      if (res.destroyed) break;
      if (!res.write(chunk)) {
        await new Promise(resolve => res.once("drain", resolve));
      }
    }

    if (!res.destroyed) res.end();
  } catch (error) {
    if (error.name === "AbortError") return;

    console.error("Chat error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Something went wrong while processing your message."
      });
    } else if (!res.destroyed) {
      res.end();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lazarus backend listening on port ${PORT}`);
});
