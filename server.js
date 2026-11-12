import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { DOC_TYPES, SYSTEM_PROMPT, ValidationError, buildUserMessage } from "./src/prompt.js";
import { textToDocx } from "./src/docx.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// Read settings from the .env file next to this script, if there is one.
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const MODEL = "claude-opus-5-5";
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const MAX_EXPORT_CHARS = 200_000;

const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// Created on first use so the app can start, and show setup help, before a key exists.
let client;
const getClient = () => (client ??= new Anthropic());

/** Turns an API failure into a sentence the person at the keyboard can act on. */
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The Claude API key was not accepted. Check ANTHROPIC_API_KEY in the .env file, then restart the app.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This API key is not allowed to use the Claude model. Check the key's permissions in the Claude Console.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Too many requests just now. Wait a minute and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Claude could not process this request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach Claude. Check the internet connection (and the office proxy or firewall), then try again.";
  }
  if (err instanceof Anthropic.APIError && err.status >= 500) {
    return "The Claude service is busy or having trouble. Please try again in a moment.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude returned an error (${err.status ?? "unknown"}): ${err.message}`;
  }
  if (!hasKey()) {
    return "No Claude API key is set. Add ANTHROPIC_API_KEY to the .env file, then restart the app.";
  }
  return "Something went wrong while writing the draft. Please try again.";
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "public")));

app.get("/api/config", (req, res) => {
  res.json({
    hasKey: hasKey(),
    docTypes: Object.entries(DOC_TYPES).map(([id, { label, hint }]) => ({ id, label, hint })),
  });
});

// Streams a draft (or a revision of one) back to the browser as server-sent events.
app.post("/api/draft", async (req, res) => {
  let userMessage;
  try {
    userMessage = buildUserMessage(req.body);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: "medium" },
      // If the model declines a request, let the API retry it on its recommended
      // fallback model instead of returning nothing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // Stop paying for output nobody will read if the browser goes away or the user presses Stop.
    res.on("close", () => stream.abort());
    stream.on("text", (text) => send({ type: "delta", text }));

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      send({ type: "error", message: "Claude declined to write this document. Try rewording the request." });
    } else {
      send({ type: "done", truncated: message.stop_reason === "max_tokens" });
    }
  } catch (err) {
    if (!(err instanceof Anthropic.APIUserAbortError)) {
      console.error("Draft request failed:", err instanceof Anthropic.AnthropicError ? err.message : err);
      send({ type: "error", message: describeError(err) });
    }
  }
  res.end();
});

// Converts the draft text to a Word file for download.
app.post("/api/export/docx", async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "There is no draft to download yet." });
  }
  if (text.length > MAX_EXPORT_CHARS) {
    return res.status(400).json({ error: "The draft is too long to export." });
  }
  const buffer = await textToDocx(text);
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": 'attachment; filename="draft.docx"',
  });
  res.send(buffer);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "That is too much text to send at once. Please shorten it." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request could not be read." });
  }
  console.error(err);
  res.status(500).json({ error: "The app hit an unexpected problem. Please try again." });
});

app.listen(PORT, HOST, () => {
  console.log(`Office Draft Assistant is running. Open http://localhost:${PORT} in your browser.`);
  if (!hasKey()) {
    console.log("No ANTHROPIC_API_KEY found yet. Copy .env.example to .env, add your key, and restart.");
  }
});
