
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Check whether the server is running
app.get("/", (req, res) => {
  res.json({
    name: "Lazarus AI Backend",
    status: "online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Send a message to Groq
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please provide a message."
      });
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "The server's Groq API key is not configured yet."
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
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
        )
        .slice(-20),
      {
        role: "user",
        content: message
      }
    ];

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Something went wrong while processing your message."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lazarus backend listening on port ${PORT}`);
});
