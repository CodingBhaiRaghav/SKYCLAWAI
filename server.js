/**
 * ============================================================
 *  SKYCLAW AI — Backend Server
 *  Unified API proxy for OpenRouter, Google Gemini, and Groq
 *  Streams responses to frontend via Server-Sent Events (SSE)
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Keys ────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ─── Available Models (verified working as of May 2026) ──────
const MODELS = {
  openrouter: [
    { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B (Free)', provider: 'OpenRouter' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'Nemotron 3 Super 120B (Free)', provider: 'OpenRouter' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', provider: 'OpenRouter' },
    { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 405B (Free)', provider: 'OpenRouter' },
    { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder 480B (Free)', provider: 'OpenRouter' },
    { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B (Free)', provider: 'OpenRouter' },
    { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (Free)', provider: 'OpenRouter' },
    { id: 'minimax/minimax-m2.5:free', name: 'MiniMax M2.5 (Free)', provider: 'OpenRouter' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Gemini' },
    { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'Gemini' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', provider: 'Gemini' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Fast)', provider: 'Groq' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (Instant)', provider: 'Groq' },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B', provider: 'Groq' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', provider: 'Groq' },
    { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', provider: 'Groq' },
  ],
};

// ─── GET /api/models ─────────────────────────────────────────
app.get('/api/models', (req, res) => {
  res.json(MODELS);
});

// ─── POST /api/chat — Unified chat endpoint ─────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, model, provider, systemPrompt } = req.body;

  if (!messages || !model || !provider) {
    return res.status(400).json({ error: 'Missing required fields: messages, model, provider' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    switch (provider) {
      case 'openrouter':
        await streamOpenRouter(res, messages, model, systemPrompt);
        break;
      case 'gemini':
        await streamGemini(res, messages, model, systemPrompt);
        break;
      case 'groq':
        await streamGroq(res, messages, model, systemPrompt);
        break;
      default:
        res.write(`data: ${JSON.stringify({ error: 'Unknown provider' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
  } catch (err) {
    console.error(`[${provider}] Error:`, err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ═══════════════════════════════════════════════════════════════
//  PROVIDER IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

async function streamOpenRouter(res, messages, model, systemPrompt) {
  const body = {
    model,
    stream: true,
    messages: buildOpenAIMessages(messages, systemPrompt),
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Skyclaw AI',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errText}`);
  }

  await processSSEStream(response, res);
}

async function streamGroq(res, messages, model, systemPrompt) {
  const body = {
    model,
    stream: true,
    messages: buildOpenAIMessages(messages, systemPrompt),
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  await processSSEStream(response, res);
}

async function streamGemini(res, messages, model, systemPrompt) {
  const geminiMessages = buildGeminiMessages(messages);
  const body = { contents: geminiMessages };

  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  await processGeminiStream(response, res);
}

// ═══════════════════════════════════════════════════════════════
//  STREAM PROCESSORS
// ═══════════════════════════════════════════════════════════════

async function processSSEStream(apiResponse, clientRes) {
  const reader = apiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          clientRes.write('data: [DONE]\n\n');
          clientRes.end();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            clientRes.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error('Stream processing error:', err.message);
  }

  clientRes.write('data: [DONE]\n\n');
  clientRes.end();
}

async function processGeminiStream(apiResponse, clientRes) {
  const reader = apiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            clientRes.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error('Gemini stream error:', err.message);
  }

  clientRes.write('data: [DONE]\n\n');
  clientRes.end();
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGE FORMAT CONVERTERS
// ═══════════════════════════════════════════════════════════════

function buildOpenAIMessages(messages, systemPrompt) {
  const result = [];
  if (systemPrompt) result.push({ role: 'system', content: systemPrompt });
  for (const msg of messages) result.push({ role: msg.role, content: msg.content });
  return result;
}

function buildGeminiMessages(messages) {
  return messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));
}

// ─── Fallback: serve index.html ──────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ⚡ Skyclaw AI is running at http://localhost:${PORT}\n`);
  console.log(`  Providers:`);
  console.log(`    • OpenRouter: ${OPENROUTER_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`    • Gemini:     ${GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`    • Groq:       ${GROQ_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log();
});
