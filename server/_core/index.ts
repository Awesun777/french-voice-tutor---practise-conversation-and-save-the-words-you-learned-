import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ─── B1-level French tutor system prompt ──────────────────────────────────────
const VOICE_SYSTEM_PROMPT = `You are a friendly French language tutor helping a student at early B1 level. Your name is Romain.

Language rules:
- Speak MOSTLY in French. Use simple B1-level vocabulary and short sentences.
- Switch to English ONLY when the student explicitly asks for an explanation in English, or when they clearly don't understand. Even then, mix French when mentioning the French words being explained.
- Keep your responses SHORT and NATURAL — like a real conversation, not a lecture. 1-3 sentences max unless the student asks for more detail.
- Correct mistakes gently and briefly. Don't over-explain.
- IMPORTANT: The student is learning French and may speak slowly or pause while forming sentences. NEVER interrupt them. Always wait for them to finish their full thought before responding, even if there is a long silence.

Save-to-dictionary feature:
- When the student says anything like "save that", "save this", "ajoute ça", "add to dictionary", or similar — call the save_vocab function with the most recently discussed French word or phrase.
- After saving, confirm briefly: e.g. "D'accord, j'ai sauvegardé 'se promener'."

Tone: warm, encouraging, patient. Like a native French friend helping you learn.`;

const VOICE_TOOLS = [
  {
    type: "function",
    name: "save_vocab",
    description: "Save a French word or phrase to the student's dictionary when they ask to save it.",
    parameters: {
      type: "object",
      properties: {
        term: { type: "string", description: "The French word or phrase" },
        translation: { type: "string", description: "The English translation" },
        kind: { type: "string", enum: ["word", "phrase"], description: "Whether it is a single word or a phrase/sentence" },
      },
      required: ["term", "translation", "kind"],
    },
  },
];

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ── OpenAI Realtime ephemeral token — POST /api/voice/session ──────────────
  // The browser calls this to get a short-lived token, then connects directly
  // to OpenAI Realtime via WebRTC (low-latency, no audio goes through our server).
  app.post("/api/voice/session", async (req, res) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: "OpenAI API key not configured" });
        return;
      }
      const sessionConfig = JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-2",
          audio: { output: { voice: "marin" } },
          instructions: VOICE_SYSTEM_PROMPT,
          tools: VOICE_TOOLS,
          tool_choice: "auto",
        },
      });
      const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: sessionConfig,
      });
      if (!response.ok) {
        const err = await response.text();
        res.status(response.status).json({ error: err });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? "Unknown error" });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
