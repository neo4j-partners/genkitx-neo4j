import express from "express";
import cors from "cors";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root project
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
app.use(cors());
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// In-memory chat history per session
const chatHistory: Record<
  string,
  { role: "user" | "assistant"; content: string }[]
> = {};

// POST /api/chat — streaming SSE endpoint
app.post("/api/chat", async (req, res) => {
  const { message, sessionId = "default" } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Init session history
  if (!chatHistory[sessionId]) {
    chatHistory[sessionId] = [];
  }

  // Add user message
  chatHistory[sessionId].push({ role: "user", content: message });

  try {
    // Build messages array with system prompt + history (last 10)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `You are a helpful Neo4j and graph database AI assistant.
You help users with:
- Neo4j Cypher queries and graph data modelling
- Genkit AI framework integrations
- Graph database best practices
- General questions

Always respond clearly and concisely using markdown where appropriate.`,
      },
      ...chatHistory[sessionId].slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    let fullResponse = "";

    // Stream from OpenAI
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    // Signal done
    res.write("data: [DONE]\n\n");
    res.end();

    // Save assistant response to history
    chatHistory[sessionId].push({ role: "assistant", content: fullResponse });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    console.error("OpenAI error:", errMsg);
    res.write(
      `data: ${JSON.stringify({ text: `\n\n⚠️ Server error: ${errMsg}` })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// DELETE /api/chat/:sessionId — clear session history
app.delete("/api/chat/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  delete chatHistory[sessionId];
  res.json({ success: true, message: `Session ${sessionId} cleared.` });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: "gpt-4o-mini",
    neo4jUri: process.env.NEO4J_URI ?? "not set",
  });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Chat Server running at http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Chat:   POST http://localhost:${PORT}/api/chat\n`);
});
