import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DemoBudget, resolveDemoClientId } from './demoBudget.js';
import { buildAssistantResponse } from './assistant.js';
import { executeRouterCode, withRouterRuntime } from './routerSandbox.js';
import { runSearch } from './searchProviders.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8080);
const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const assistantModel = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5.6-terra';
const apiKey = process.env.OPENAI_API_KEY;
const client = apiKey ? new OpenAI({ apiKey }) : null;
const budget = new DemoBudget({
  directory: path.resolve(process.env.OPENAI_DEMO_DATA_DIR || 'data'),
  limitUsd: Math.max(0.01, Number(process.env.OPENAI_DEMO_BUDGET_USD) || 1),
});
const requestWindow = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((request, response, next) => {
  const { clientId } = resolveDemoClientId(request.get('X-Demo-Client-Id'));
  request.demoClientId = clientId;
  response.setHeader('X-Demo-Client-Id', clientId);
  next();
});

function rateLimit(limit) {
  return (request, response, next) => {
    const key = `${request.path}:${request.ip || 'unknown'}`;
    const now = Date.now();
    const attempts = (requestWindow.get(key) || []).filter((time) => now - time < 60_000);
    if (attempts.length >= limit) return response.status(429).json({ error: 'This demo endpoint is temporarily busy. Please wait a minute.' });
    attempts.push(now);
    requestWindow.set(key, attempts);
    return next();
  };
}

function boundedText(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

async function reserveModelCall(clientId, text, maxOutputTokens) {
  // Terra prices are intentionally used as a conservative ceiling for every
  // model call, including lower-cost Luna simulation calls.
  const estimate = budget.estimate({ inputTokens: Math.ceil(text.length / 4), maxOutputTokens });
  return budget.reserve(clientId, estimate);
}

app.get('/api/health', async (request, response) => {
  await budget.load();
  response.json({ ok: true, provider: 'OpenAI', model, assistantModel, configured: Boolean(apiKey), publicDemo: true, budget: budget.snapshot(request.demoClientId) });
});

app.get('/api/budget', async (request, response) => {
  await budget.load();
  response.json(budget.snapshot(request.demoClientId));
});

app.post('/api/demo/reset', async (request, response) => {
  const snapshot = await budget.reset(request.demoClientId);
  response.json({ ok: true, budget: snapshot });
});

app.post('/api/assistant', rateLimit(12), async (request, response) => {
  if (!client) return response.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  const body = request.body || {};
  const serialized = JSON.stringify(body);
  if (serialized.length > 120_000) return response.status(413).json({ error: 'Assistant context is too large.' });
  const maxOutputTokens = body.action === 'generate_router' ? 2600 : 900;
  let reservation;
  try {
    reservation = await reserveModelCall(request.demoClientId, serialized, maxOutputTokens);
    const result = await buildAssistantResponse({ client, model: assistantModel, request: body });
    const snapshot = await budget.settle(request.demoClientId, reservation, result.response.usage);
    return response.json({ message: result.message, action: result.action, router: result.router || null, usage: result.response.usage || null, budget: snapshot });
  } catch (error) {
    if (reservation) await budget.release(request.demoClientId, reservation);
    return response.status(error?.status || 422).json({ error: error?.message || 'The assistant request failed.', budget: budget.snapshot(request.demoClientId) });
  }
});

app.post('/api/router/execute', async (request, response) => {
  const { code, input, context, state } = request.body || {};
  try {
    const runtimeContext = withRouterRuntime(context);
    const result = await executeRouterCode({ code, input, context: runtimeContext, state });
    return response.json({ ...result, runtime: runtimeContext.runtime });
  } catch (error) {
    return response.status(422).json({ error: error?.message || 'Router execution failed.' });
  }
});

app.post('/api/llm', rateLimit(50), async (request, response) => {
  if (!client) return response.status(503).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
  const body = request.body || {};
  const prompt = boundedText(body.prompt, 16_000);
  const systemPrompt = boundedText(body.systemPrompt, 16_000);
  const maxOutputTokens = Math.max(100, Math.min(Number(body.maxOutputTokens) || 700, 1400));
  const effort = new Set(['none', 'low', 'medium']).has(body.reasoningEffort) ? body.reasoningEffort : 'low';
  if (!prompt.trim() && !(Array.isArray(body.toolOutputs) && body.toolOutputs.length)) return response.status(400).json({ error: 'A non-empty prompt or Tool result is required.' });
  const tools = Array.isArray(body.tools) ? body.tools.slice(0, 8).map((tool) => ({ type: 'function', name: boundedText(tool?.name, 64), description: boundedText(tool?.description, 1200), parameters: tool?.parameters && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {}, additionalProperties: false }, strict: tool?.strict !== false })) : [];
  const toolOutputs = Array.isArray(body.toolOutputs) ? body.toolOutputs.slice(0, 8).map((item) => ({ type: 'function_call_output', call_id: boundedText(item?.callId, 120), output: boundedText(item?.output, 12_000) })) : [];
  let reservation;
  try {
    reservation = await reserveModelCall(request.demoClientId, JSON.stringify({ prompt, systemPrompt, tools, toolOutputs }), maxOutputTokens);
    const result = await client.responses.create({ model, instructions: systemPrompt || 'Return only the requested simulation output.', input: toolOutputs.length ? toolOutputs : prompt, reasoning: { effort }, text: { verbosity: 'low' }, max_output_tokens: maxOutputTokens, ...(tools.length ? { tools, tool_choice: 'auto', parallel_tool_calls: false } : {}), ...(body.previousResponseId ? { previous_response_id: boundedText(body.previousResponseId, 200) } : {}) });
    const snapshot = await budget.settle(request.demoClientId, reservation, result.usage);
    const toolCalls = (result.output || []).filter((item) => item.type === 'function_call').map((item) => ({ id: item.id || null, callId: item.call_id, name: item.name, arguments: item.arguments }));
    return response.json({ text: result.output_text || '', responseId: result.id, model: result.model || model, usage: result.usage || null, toolCalls, budget: snapshot });
  } catch (error) {
    if (reservation) await budget.release(request.demoClientId, reservation);
    return response.status(error?.status || 422).json({ error: error?.message || 'The OpenAI request failed.', budget: budget.snapshot(request.demoClientId) });
  }
});

app.post('/api/search', rateLimit(12), async (request, response) => {
  const provider = request.body?.provider || 'web';
  if (['localrag', 'web', 'custom'].includes(provider)) return response.status(403).json({ error: provider === 'localrag' ? 'RAG is disabled in the Public Demo.' : 'This paid or user-supplied search provider is disabled in the Public Demo.' });
  try {
    return response.json(await runSearch({ ...request.body, provider }, { client: null }));
  } catch (error) {
    return response.status(422).json({ error: error?.message || 'Search failed.' });
  }
});

// The client keeps run traces locally for this portfolio demo. These compatible
// no-op endpoints deliberately avoid storing one visitor's graph data for another.
app.post('/api/sessions/start', (_request, response) => response.json({ ok: true, sessionId: randomUUID() }));
app.post('/api/sessions/:sessionId/events', (_request, response) => response.json({ ok: true }));
app.post('/api/sessions/:sessionId/finish', (_request, response) => response.json({ ok: true }));

app.use(express.static(path.join(here, '..', 'dist'), { index: false, maxAge: '1h' }));
app.get('*splat', (_request, response) => response.sendFile(path.join(here, '..', 'dist', 'index.html')));

app.listen(port, '0.0.0.0', () => console.log(`Synapse Flow Public listening on ${port}`));
