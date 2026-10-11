
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "Lazarus AI Backend",
    status: "online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    supabaseConfigured: Boolean(supabase),
    groqConfigured: Boolean(groqApiKey)
  });
});

// Verify the signed-in user's Supabase access token.
async function requireUser(req, res, next) {
  if (!supabase) {
    return res.status(500).json({
      error: "Supabase is not configured on the server."
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Please sign in to use Lazarus."
    });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        error: "Your session is invalid or expired. Please sign in again."
      });
    }

    req.user = data.user;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    return res.status(401).json({
      error: "Could not verify your session."
    });
  }
}

app.post("/api/chat", requireUser, async (req, res) => {
  try {
    if (!groqApiKey) {
      return res.status(500).json({
        error: "The server's Groq API key is not configured."
      });
    }

    const { message, history = [] } = req.body;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Please provide a message."
      });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({
        error: "Chat history must be a list."
      });
    }

    const messages = [
      {
        role: "system",
        content:
          "You are Lazarus, a helpful, friendly AI assistant. Give clear and useful answers."
      },
      ...history
        .filter(
          (item) =>
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
        )
        .slice(-20),
      {
        role: "user",
        content: message.trim()
      }
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages,
          temperature: 0.7,
          max_tokens: 1500
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq API error:", data);
      return res.status(502).json({
        error: "Groq could not complete the request. Check the server logs."
      });
    }

    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      return res.status(502).json({
        error: "Groq returned an empty response."
      });
    }

    return res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({
      error: "Something went wrong while processing your message."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lazarus backend listening on port ${PORT}`);
});
