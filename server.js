/* =============================================
   TASTE OF MALAYSIA — server.js
   Express backend + Amazon Bedrock /api/chat
   ============================================= */

import express from 'express';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ── */
app.use(express.json({ limit: '16kb' }));   // reject oversized bodies
app.use(express.static('.'));               // serve index.html, style.css, script.js

/* ── Amazon Bedrock client (exact config from lecturer) ── */
const bedrockClient = new BedrockRuntimeClient({
  region: 'ap-southeast-5',

  /*
   * Bearer-token auth via the environment variable.
   * The token is NEVER written in code — it is read at runtime only.
   * Set it in your terminal before starting the server:
   *   $env:AWS_BEARER_TOKEN_BEDROCK = "your-token-here"   (PowerShell)
   *   set AWS_BEARER_TOKEN_BEDROCK=your-token-here         (CMD)
   */
  token: {
    token: process.env.AWS_BEARER_TOKEN_BEDROCK ?? ''
  }
});

/* ── System prompt ── */
const SYSTEM_PROMPT =
  'You are Foodie AI Assistant, a friendly assistant specialising in Malaysian cuisine. ' +
  'Help users explore Malaysian dishes, ingredients, cooking methods and food culture. ' +
  'Provide clear and concise answers. ' +
  'If a question is unrelated to Malaysian cuisine, politely guide the conversation back to Malaysian food. ' +
  'Do not invent facts when uncertain.';

/* ── Input validation helpers ── */
const MAX_MESSAGE_LENGTH = 1000;   // characters per single message
const MAX_HISTORY_TURNS  = 10;     // keep last N pairs to limit token usage

function isValidMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every(
    (m) =>
      typeof m === 'object' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0 &&
      // Cap length for user messages only — assistant replies can be long
      (m.role === 'assistant' || m.content.length <= MAX_MESSAGE_LENGTH)
  );
}

/* ─────────────────────────────────────────────
   POST /api/chat
   Body: { messages: [{ role, content }, ...] }
   Returns: { reply: "..." }
   ───────────────────────────────────────────── */
app.post('/api/chat', async (req, res) => {
  /* 1. Validate request body */
  const { messages } = req.body ?? {};

  if (!isValidMessages(messages)) {
    return res.status(400).json({
      error: 'Invalid request. Provide a non-empty messages array with role and content fields.'
    });
  }

  /* 2. Trim history to avoid bloated payloads */
  const trimmedMessages = messages.slice(-MAX_HISTORY_TURNS * 2);

  /* 3. Check bearer token is present (fail fast with a clear message) */
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK) {
    console.error('[server] AWS_BEARER_TOKEN_BEDROCK is not set.');
    return res.status(500).json({
      error: 'Server configuration error: AWS bearer token is not set. Please set AWS_BEARER_TOKEN_BEDROCK before starting the server.'
    });
  }

  /* 4. Call Amazon Bedrock (exact SDK usage from lecturer) */
  try {
    const command = new InvokeModelCommand({
      modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: trimmedMessages
      })
    });

    const response = await bedrockClient.send(command);

    /* Decode response — same pattern as lecturer's sample */
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const reply  = result?.content?.[0]?.text ?? '';

    if (!reply) {
      return res.status(502).json({ error: 'Empty response from Bedrock.' });
    }

    return res.json({ reply });

  } catch (err) {
    /* Log full error on server; send only a safe summary to client */
    console.error('[Bedrock error]', err);

    const status  = err?.$metadata?.httpStatusCode ?? 500;
    const message =
      err?.name === 'ValidationException'   ? 'Bedrock rejected the request (ValidationException).' :
      err?.name === 'ThrottlingException'   ? 'Too many requests. Please try again in a moment.'    :
      err?.name === 'AccessDeniedException' ? 'Access denied. Check your bearer token and model permissions.' :
      'An error occurred while contacting the AI service.';

    return res.status(status).json({ error: message });
  }
});

/* ── Start server ── */
app.listen(PORT, () => {
  console.log(`\n🌿 Taste of Malaysia server running at http://localhost:${PORT}`);
  console.log(`   Static site  → http://localhost:${PORT}/`);
  console.log(`   Chat API     → http://localhost:${PORT}/api/chat  (POST)\n`);

  if (!process.env.AWS_BEARER_TOKEN_BEDROCK) {
    console.warn('⚠️  WARNING: AWS_BEARER_TOKEN_BEDROCK is not set. Chat will return errors until you set it.\n');
  }
});
