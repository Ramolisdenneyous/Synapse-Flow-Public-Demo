# Synapse Flow Engineering Guide

## Product intent

Synapse Flow is a visual rapid-prototyping lab for agent harnesses. Its primary
output is a clear, buildable Markdown specification. Preserve spatial clarity,
explicit information boundaries, and inspectable execution behavior.

## Simulation authoring

Before designing, generating, or modifying a Synapse Flow simulation, read
`docs/LLM-SIMULATION-MANUAL.md`. Treat it as the canonical guide to widget
semantics, connection channels, Router generation, save-file construction,
execution, debugging, and simulation acceptance criteria.

## Core contracts

- Every runtime item is an event envelope with an id, type, payload, source node,
  and creation time.
- Every connection is one-way and has one channel: data, trigger, read, write, or tool.
- Read edges grant context access but never trigger execution.
- Tool edges grant one Agent a callable Tool but never schedule the Tool.
- Write edges update only the connected memory node.
- Node state is isolated by node id. Do not introduce hidden shared state.
- Run All resets state. An opted-in manual Trigger continuation may carry
  Router and Memory state only across sessions of the same unchanged graph.
- Governor counters reset every session and stop a path without forwarding the
  boundary event.
- Sequential mode drains the queue one event at a time with a visible pause.
  Parallel mode executes independent events in parallel waves.
- Pause completes in-flight work and preserves the current session queue;
  Resume continues that same session.
- Keep a hard event and depth limit so loops stop predictably.
- Scope every queue and scheduler loop to one immutable session ID. A superseded
  session must not enqueue work or finish a newer session.
- Persist graph snapshots, event lineage, routes, state checkpoints, correlated
  model calls, controls, errors, final state, and completion reasons as session
  traces under `logs/`.

## Security boundaries

- Keep API keys in the server environment. Never expose them through Vite variables
  or browser code.
- Never execute generated JavaScript with host `eval`, `Function`, `vm`, or in
  the browser/server process.
- Generated Router logic must conform to the documented route contract, provide
  tests, pass target validation, and execute only in the capability-free QuickJS
  runtime with CPU and memory limits.
- Router generation runs through the server-side Codex SDK in a read-only,
  network-disabled thread. Keep Codex job IDs and thread IDs in JSONL traces.

## Provider boundary

All model calls go through the local `/api/llm` adapter. Keep canvas and engine code
provider-neutral. The default provider model is configured with `OPENAI_MODEL`.

## Commands

- `npm run dev` starts the UI and local API.
- `npm test` runs engine and exporter tests.
- `npm run build` verifies the production client build.

Run tests and the production build after behavior changes.
