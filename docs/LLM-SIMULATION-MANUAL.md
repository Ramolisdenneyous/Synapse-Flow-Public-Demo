# Synapse Flow LLM Simulation Manual

Version: Synapse Flow MVP 0.3

Audience: an LLM or coding agent designing, building, running, debugging, or
exporting a simulation in Synapse Flow.

## 1. What Synapse Flow Is

Synapse Flow is a visual laboratory for rapidly prototyping agent harnesses.
A harness is an executable directed graph made from nine widget types:

1. Trigger
2. Luna Agent
3. User Input
4. Router
5. Governor
6. Tool
7. API Search
8. Memory
9. Output

The graph is not only a diagram. It executes event payloads, calls language
models, applies deterministic logic, maintains explicit state, records traces,
and exports a Markdown implementation plan.

Use Synapse Flow to answer questions such as:

- Does this multi-agent control flow work?
- Which information should each agent receive?
- Where should deterministic rules replace model judgment?
- Does a loop terminate correctly?
- Can a complex interaction be observed and reproduced?
- Is the harness clear enough to implement in a larger application?

Synapse Flow is an MVP prototyping environment. Treat its exported plan as an
implementation specification, not as production infrastructure.

## 2. The Core Mental Model

Every run starts with one or more Trigger events. A node receives an event
envelope, processes its payload, and may schedule new events on outgoing
connections.

An event envelope has this conceptual shape:

```json
{
  "id": "event-uuid",
  "type": "event-type",
  "payload": "Any JSON-safe value",
  "sourceNodeId": "source-node-id",
  "createdAt": 1785380000000
}
```

The payload is the part each widget normally reads and transforms.

Each run has:

- A unique session ID.
- An immutable snapshot of the graph.
- A session-scoped event queue.
- Isolated Memory state by Memory node ID.
- Isolated Router state by Router node ID.
- Isolated Governor counters by Governor node ID.
- A 200-event safety limit.
- A persistent trace under `logs/`.

Configuration changes made after a run starts do not alter that active run.
Stop and start a new run to test graph changes.

Router and Memory state normally reset for every run. A Trigger may explicitly
opt into continuation so a later manual fire carries state from the immediately
prior run of the same unchanged graph into a new session.

Governor counters always reset for a new session. They protect one execution,
not long-lived application state.

## 3. The Most Important Rule: Execution Versus Context

Synapse Flow has five connection channels:

| Channel | Color | Schedules the target? | Meaning |
| --- | --- | --- | --- |
| `data` | Gray | Yes | Pass the source output to another executable node. |
| `trigger` | Gold | Yes | Activate or reactivate a Trigger-driven path. |
| `write` | Purple | Yes | Execute a Memory node and store the payload. |
| `read` | Lavender | No | Supply explicit context without activating the target. |
| `tool` | Green | No | Grant a Luna Agent permission to call a connected Tool or API Search inside its model turn. |

`data`, `trigger`, and `write` are execution edges.

`read` is a context edge. `tool` is a capability edge. Neither activates its
target or creates an item in the session queue.

This distinction prevents hidden information flow. If an Agent needs memory:

1. Add a Memory node.
2. Connect a producer to Memory to create a `write` edge.
3. Connect Memory to the Agent to create a `read` edge.
4. Ensure some separate execution edge activates the Agent.

Do not expect `Memory -> Agent (read)` to run the Agent.

A User Input node also has a top observation handle. Connecting any node to that
handle creates a `read` edge. It exposes the source node's latest output to the
User Input node without activating it. The normal left input handle remains the
execution path that asks the user to respond.

### Automatic channel inference

When a connection is drawn in the UI, its channel is inferred:

- Any node -> Memory becomes `write`.
- Any node -> Trigger becomes `trigger`.
- Memory -> Agent or User Input becomes `read`.
- Memory -> Tool becomes `read`.
- Any node -> the top User Input observation handle becomes `read`.
- Luna Agent -> Tool or API Search becomes `tool`.
- Memory -> another kind becomes `data`.
- Trigger -> any node becomes `trigger`.
- All other connections become `data`.

## 4. Shared Widget Fields

Selecting any widget opens its Inspector.

All widgets have:

- **Name**: Human-readable label used in the canvas, traces, and simple Router
  rules. Names should be unique.
- **Connections**: Current incoming and outgoing edges, their channels, and
  controls to select or delete them.
- **Purpose**: A concise description of the widget's responsibility.
- **Input type**: A documented input contract.
- **Output type**: A documented output contract.

Input and output type fields currently document intent and appear in exports.
The MVP does not enforce them as runtime JSON schemas. A simulation must still
validate important payload fields in Router logic and prompts.

To delete a connection:

- Select the line and press Delete or Backspace.
- Right-click the line and choose Delete.
- Select either connected widget and delete the edge in Connections.

## 5. Trigger Widget

### Purpose

Starts a harness manually or restarts part of a harness when an incoming event
activates it.

### Configuration

- **Start payload**: The value emitted whenever the Trigger executes.
- **Fire Trigger**: Starts a new run containing only this selected Trigger.
- **Continue prior run state**: When enabled, a manual Fire Trigger carries
  Router and Memory state from the prior run if the graph contract is unchanged.

### Runtime behavior

- `Run All` automatically queues every Trigger in the graph.
- `Run All` always resets Router and Memory state.
- `Fire Trigger` queues only the selected Trigger.
- An opted-in Fire Trigger continues prior state in a new session.
- An incoming connection may activate a Trigger.
- When reactivated, the Trigger emits its configured Start payload again. It
  does not normally forward the incoming payload.

Continuation is rejected and clean state is used when the harness Name, widget
contracts/configuration, or connections changed. Moving widgets does not
invalidate continuation. New and Load clear continuation state.

### Use Trigger for

- Starting a simulation.
- Starting one scenario among several.
- Explicitly restarting a cycle.
- Converting feedback into a known, stable start message.

### Avoid

- Adding a second manual click after `Run All`. Run All already fires Triggers.
- Using a Trigger when the incoming payload must be preserved. Use a pass-through
  Router instead.
- Connecting several Triggers without realizing Run All starts all of them.

## 6. Luna Agent Widget

### Purpose

Calls the configured OpenAI model to make a language-based judgment, produce
content, classify input, or choose among options.

### Configuration

- **System prompt**: The Agent's role, constraints, input interpretation, and
  required output format.
- **Reasoning**: `none`, `low`, `medium`, `high`, `xhigh`, or `max`.
- **Max output**: 100 to 4000 tokens.

### Prompt contents

The runtime sends the Agent:

1. Its configured System prompt.
2. The incoming event payload.
3. Values from explicitly connected Memory read edges.
4. A fresh variation token for the invocation.
5. An instruction to produce the node output.

The Agent does not automatically receive:

- Other Agents' output histories.
- The Run Trace.
- Unconnected Memory.
- The entire graph.
- Private Router state.

### Agent outputs

The **Node output** setting controls what downstream execution edges receive:

- **Final agent text** is the default. Downstream nodes receive the model's final
  visible response after all native Tool calls finish.
- **Tool call envelope** emits a JSON-safe `agent_tool_call_envelope` containing
  `finalText` and every correlated Tool call's `callId`, function `name`, parsed
  `arguments`, and Tool `result`. Use this when the Tool call itself is the
  Agent's proposal and an authoritative Router must validate it. The Tool result
  remains advisory unless the Tool explicitly represents an authoritative
  application service.

Tool call envelope mode requires at least one completed Tool call. A downstream
Router should enforce the expected call count, function name, correlation token,
offered values, and stale-input policy before committing state.

The Inspector shows a newest-first output history for the active run, including
time, model, and token usage when available.

This history is observability only:

- It is cleared at the beginning of a new run.
- It is not saved in project files.
- It is never fed back to the Agent.
- It is capped by the run's 200-event limit.

Use Memory when prior output must influence later Agent calls.

### Prompt-writing pattern

A strong Agent System prompt states:

```text
ROLE
You are [specific role].

INPUT
You receive [exact payload shape and relevant fields].

TASK
Perform [one bounded judgment].

CONSTRAINTS
- Do not invent authoritative state.
- Choose only from [provided legal options].
- Copy correlation tokens exactly.

OUTPUT
Return exactly [JSON schema or concise text format].
Do not include Markdown or additional commentary.
```

### Use Luna Agent for

- Semantic classification.
- Natural-language generation.
- Strategy or choice within explicit legal options.
- Simulating a non-user agent participant.
- Evaluating ambiguous content.

### Avoid

- Making an Agent the authority for counters, HP, money, permissions, or other
  exact state when a Router can own it.
- Asking one Agent to perform several unrelated responsibilities.
- Relying on prose output when downstream logic expects structured data.
- Assuming an Agent will remember previous calls without a Memory read edge.

## 7. User Input Widget

### Purpose

Represents the human participant as a first-class point in the executable
harness. User Input always emits natural-language prose. It must not emit JSON,
code, Markdown fences, or structured data.

### Manual mode

Manual mode creates a real runtime suspension:

1. An execution edge activates User Input.
2. The node holds that active event unresolved and displays its incoming payload
   in the Inspector.
3. The session, graph snapshot, state, event lineage, and remaining queue are
   preserved.
4. The user enters prose directly in the selected node and submits it.
5. That prose completes the held event and is routed through the node's outgoing
   execution edges.

In Sequential mode, no later event executes while User Input is waiting. In
Parallel mode, other nodes already running in the same wave may finish, but the
wave cannot complete until the manual response is submitted. Stopping or
superseding the run cancels the held input request.

An empty queue does not mean the run is complete while a Manual User Input event
is unresolved. Exported implementations must preserve this distinction.

### Auto mode

Auto mode replaces the human with an LLM call through the same server-side model
adapter used by Luna Agents. Configure:

- **Simulated user system prompt**: the user persona, goals, knowledge, and
  behavioral constraints.
- **Reasoning**: `none`, `low`, `medium`, `high`, `xhigh`, or `max`.
- **Max output**: 100 to 4000 tokens.

The model receives the incoming event and only the outputs supplied through
explicit User Input `read` edges. The runtime reinforces the prose-only contract,
retries once when the model returns structured data, and stops the node with an
error if the second response is still JSON or code.

### Observation context

User Input has two target handles:

- The left input handle activates the node with a `data` or `trigger` event.
- The top observation handle creates a non-activating `read` edge.

For a Memory source, the observed value is the current isolated Memory value.
For another source kind, it is that node's latest output in the active run. If a
source has not completed yet, its observed value is empty. Read edges never
schedule User Input and never create hidden execution branches.

Manual mode displays observed outputs beside the incoming event so the human can
read them before responding. Auto mode places the same values in the model
prompt. User response history is observability only and is not saved in project
files or fed back automatically. Submitted Manual prose is recorded in the
session trace under the active session ID. Auto mode also records its model
request and response through the standard server-side LLM trace.

### Use User Input for

- Human-directed agent conversations.
- Approval, correction, adjudication, and creative intervention points.
- Testing the same harness manually and with an automated simulated user.
- Modeling application workflows that must pause for external input.

### Avoid

- Asking User Input to return machine contracts. Place structured translation in
  a downstream Luna Agent or deterministic Router.
- Using an observation edge when the source output should activate the user.
- Assuming Auto mode can see the graph, trace, or unconnected outputs.
- Treating a waiting Manual node as a completed or terminal event.

## 8. Router Widget

### Purpose

Routes, filters, transforms, validates, or governs events with explicit logic.
A Router is the preferred authority for exact simulation state and rules.

### Built-in operations

#### Pass through

Returns the incoming payload unchanged and schedules every outgoing execution
edge.

#### Route by keyword

Rules use:

```text
urgent => Human Review
approved => Publish
* => Archive
```

Behavior:

- Matching is case-insensitive substring matching against the stringified input.
- The first matching non-wildcard rule wins.
- Otherwise the wildcard rule is used.
- The target is an exact, case-insensitive widget Name.
- Only connected outgoing targets can receive the event.

Always include a wildcard rule. In the current MVP, no matching rule produces
an empty target-label filter, which falls through to all outgoing targets.

#### Filter

Filter rules also use `match => value` lines. The right side is required by the
parser but is not used for routing.

```text
approved => pass
ready => pass
```

If any match text appears in the input, the event passes to every outgoing
execution edge. Otherwise the event is blocked. Do not add `* => pass` unless
the Filter should always pass.

#### Template

Replaces every `{{input}}` token in the configured template with the stringified
input, then sends the result to every outgoing execution edge.

#### Generated code

Use generated code for state machines, exact validation, selective routing,
randomness, game rules, retries, counters, or stopping conditions.

### Generated Router workflow

1. Add and uniquely name all destination widgets.
2. Draw all incoming and outgoing Router connections.
3. Write the Router's softer logic in **Routing intent**.
4. Include state ownership, input shapes, legal transitions, exact outputs,
   routing destinations, invalid-input behavior, randomness, and termination.
5. Click **Build with Codex**.
6. Wait for generation and validation to complete.
7. Review the summary.
8. Use **View current code** when code inspection is needed.
9. Confirm Operation is **Generated code**.
10. Regenerate after changing the Router's connected topology or intent.

Connectivity must be finalized before generation because generated code selects
targets by stable node ID.

### Writing a coding-agent-ready Routing intent

Treat Routing intent as an implementation contract, not a feature summary. The
coding agent receives the Router's compact topology:

- Node IDs, kinds, Names, Purposes, and input/output types.
- Incoming and outgoing edge IDs and channels.

The compact topology does **not** currently include connected widget
configuration. It omits Trigger Start payloads, Agent System prompts and output
schemas, Memory write behavior and Initial values, Tool responses, and prior
Router code. Repeat every omitted value that affects Router behavior in the
Routing intent.

#### Required prompt information

1. **Literal incoming representation**

   State whether each input is a primitive string, JSON object, or model-produced
   text containing JSON. Write the exact value or schema. `"DEAL_ROUND"` and
   `{"type":"DEAL_ROUND"}` are different inputs.

2. **One contract per incoming source**

   Name each producer by stable node ID and define exactly what it emits. Agent
   output arrives at a Router as raw model text. If an Agent is instructed to
   return JSON, tell the Router coding agent to extract and parse the JSON object
   from that string. Include required identity, action, and correlation-token
   fields. State whether extra fields are allowed or ignored.

3. **Authoritative state schema**

   List every persistent field, its type, initial value, and owner. Describe what
   survives a manual continuation, what resets on Run All, and the exact
   condition that starts a new logical session, deck, match, or episode.

4. **State transitions**

   Define every phase, legal transition, retry, skip, and terminal condition.
   State what must remain unchanged after invalid or stale input.

5. **Exact outgoing routes**

   Use stable node IDs, not only display Names. For every branch, list the full
   `targetIds` set. Include observers such as Output and Memory nodes. State
   whether a Memory write must be queued before its Agent.

6. **Exact emitted payloads**

   Define fields, types, enum values, hidden/redacted values, and correlation
   tokens for Agent turns, retries, observer updates, and terminal results.
   These payloads must agree with the receiving Agent prompts.

7. **Visibility boundaries**

   Identify public, private, hidden, and delayed information. Explain exactly
   when hidden information becomes public and which payloads or Memories receive
   it.

8. **Deterministic mechanics and randomness**

   Specify calculations, ordering, tie handling, limits, and random mapping.
   Require `context.runtime.randomValue` for fresh entropy. For a deterministic
   seeded shuffle, specify the deck contents, card encoding, and shuffle
   algorithm rather than merely saying "shuffle the deck."

9. **Invalid-input behavior**

   Define parsing failures, stale tokens, illegal actions, unknown identities,
   empty resources, and duplicate events. Name the retry target and say whether
   state advances.

10. **Generation-test representation**

    The current generated-test schema supplies `tests[].input` directly to
    `route` as a literal string and initializes Router state as `{}`. Do not put
    a wrapper such as `{"input":...,"state":...}` inside that field. A Trigger
    test for a string payload should use:

    ```json
    {
      "input": "DEAL_ROUND",
      "expectedTargetIds": ["memory-id", "agent-id", "output-id"]
    }
    ```

    Generated validation currently covers fresh-state routes. Put stateful
    acceptance scenarios in project tests or the manual test plan.

#### Prompt quality test

Before clicking **Build with Codex**, ask:

- Could an engineer who cannot inspect any widget configuration implement this
  Router from the Routing intent and compact topology alone?
- Does every producer's output exactly match a documented Router input?
- Does every Router payload exactly match the receiving Agent's documented
  input?
- Is every route expressed as exact stable target IDs?
- Could the coding agent distinguish a string containing JSON from an object?
- Are hidden information and continuation boundaries unambiguous?

If any answer is no, the Routing intent is incomplete.

### Generated Router contract

Generated code defines exactly:

```js
function route(input, context, state) {
  return {
    targetIds: [],
    payload: input,
    state: {}
  };
}
```

Inputs:

- `input`: The JSON-safe incoming payload.
- `context.router`: This Router's compact contract.
- `context.incoming`: Connected incoming topology.
- `context.targets`: Allowed outgoing execution destinations.
- `context.runtime.randomValue`: Fresh uniform number in `[0, 1)`.
- `context.runtime.invocationId`: Unique invocation ID.
- `state`: Private JSON-safe state for this Router in this run.

Return fields:

- `targetIds?: string[]`: Send only to these connected targets.
- `broadcast?: boolean`: Send to all connected execution targets.
- `drop?: boolean`: Stop this event.
- `payload?: any`: Output payload; defaults to original input.
- `state?: object`: New private Router state.

Important semantics:

- Omitting `targetIds` broadcasts to all outgoing execution targets.
- `targetIds: []` schedules no targets.
- `drop: true` stops the event.
- Router state resets at the beginning of a normal run.
- An opted-in manual continuation Trigger can carry Router state from the prior
  run of the unchanged graph.
- A Router can select only currently connected target IDs.
- Random behavior must use `context.runtime.randomValue`.
- Map randomness directly and uniformly across outcomes. Do not simulate rerolls.

### Router sandbox

Generated Router code:

- Is synchronous.
- Runs in capability-free QuickJS.
- Cannot import, require, browse, use the network, read files, access environment
  variables, or call host APIs.
- Cannot use `eval` or `Function`.
- Has an 8 MB memory limit.
- Has a 75 ms execution deadline.
- Has a 24,000-character code limit.
- Must return JSON-serializable data.
- Must pass generated target-routing tests before acceptance.

### Routing intent pattern

```text
AUTHORITY
This Router owns [authoritative state].

INPUTS
- Trigger [id] emits the literal string "[payload]".
- Agent [id] emits raw text containing exactly [JSON schema].
- Parse [string/object behavior]. Allow or reject [extra fields].

STATE
- Keep [field: type and initial value] in private Router state.
- Manual continuation preserves [fields].
- A normal run resets [fields].

PHASES AND RULES
- In [phase], accept [input] and transition to [phase].
- Apply [exact calculations, ordering, limits, and tie behavior].
- Use context.runtime.randomValue for [specified random mapping].

ROUTING
- On [condition], return targetIds ["stable-memory-id", "stable-agent-id",
  "stable-output-id"] in that order.
- On invalid input, retry ["specific-agent-id"] without advancing [fields].

PAYLOADS
- Agent turn payload is exactly [schema].
- Retry payload is exactly [schema].
- Final payload is exactly [schema].

VISIBILITY
- Keep [information] hidden until [transition].
- Publish [information] only to [targets].

TERMINATION
When [condition], send [final payload] to ["exact-target-ids"] and schedule no
continuation Agent or Trigger.

GENERATION TESTS
- tests[].input is the literal string passed to route with empty state.
- Do not wrap input or invent state inside tests[].input.
- Include a fresh-start test with exact expected target IDs.
```

## 9. Governor Widget

### Purpose

Places a deterministic stopping boundary in an execution path. A Governor
preserves the incoming payload while it allows the path to continue, then
blocks the event without forwarding it when a configured stop condition is met.

### Configuration

- **Stop on activation**: Stop on this numbered visit. A value of `25` allows
  activations 1 through 24 to continue and blocks activation 25.
- **Optional stop phrase**: Case-insensitive text that immediately stops the
  path when it appears anywhere in the JSON-safe incoming payload.

### Runtime behavior

- The activation counter is private to this Governor node and session.
- The counter increments once for every received event.
- A stopped event is not sent across any outgoing connection.
- The Run Trace records the count, remaining allowance, and stop reason.
- Governor state resets on Run All, Fire Trigger, Stop followed by a new run,
  New, and Load.

Use a Governor as a safety boundary around experimental loops. Use a generated
Router when stopping depends on richer authoritative state, structured model
output, several conditions, or different terminal routes.

## 10. Tool Widget

### Purpose

Represents a callable prototype capability without integrating a production
service. A Tool can still run as an ordinary graph node, but its most faithful
use is as a native function available to a Luna Agent.

### Function contract

Configure every Tool with:

- **Function name**: A unique API-safe name containing letters, digits,
  underscores, or hyphens. Use a verb phrase such as `take_story_action`.
- **Function description**: State when the Agent should call the Tool, what
  authority the Tool owns, and what its result means.
- **Argument schema**: A JSON Schema object defining exact call arguments. Use
  `required` and `additionalProperties: false` for strict calls.
- **Mode**: Fixed mock or Luna simulation.

Draw `Luna Agent -> Tool`. Synapse Flow infers a green `tool` capability edge.
This edge does not schedule the Tool after the Agent completes. Instead:

1. The Tool definition is supplied to that Agent's model request.
2. The model may issue a native function call with schema-checked arguments.
3. Synapse Flow executes only the specifically connected Tool.
4. The Tool result is returned to the same model response chain.
5. The Agent may call another connected Tool or finish its visible response.
6. Calls and results are correlated by call ID in the session trace.

Enable **Require a Tool call** on an Agent when completing without a call would
make the test invalid. A six-round limit prevents an Agent from calling Tools
forever inside one node activation.

### Correct native Tool wiring

Use exactly these connections when a Luna Agent should call a Tool:

```text
Execution event -> Luna Agent -> next execution node
                      |
                      +--tool--> Tool
Memory ------------------read--> Tool
Memory ------------------read--> Luna Agent
```

- `Luna Agent -> Tool` must be channel `tool`, never `data`.
- `Memory -> Tool` must be channel `read`, never `data` or `write`.
- The Agent still requires a separate incoming execution edge.
- The Agent's ordinary outgoing execution edges receive its configured Node
  output after all Tool calls finish: final visible text by default, or the
  structured Tool call envelope when explicitly selected.
- Native Tool execution does not follow the Tool node's outgoing graph edges.
  Connect downstream execution from the calling Agent.
- Do not add a normal execution edge into the same Tool unless the harness also
  intentionally invokes that Tool as an independent queued node.

After loading a saved harness, inspect both lines in Connections. A green
`tool` line grants the capability. A lavender `read` line grants Memory context.
Changing either to gray `data` changes execution and can create extra model
calls.

### Expected trace

For one successful Luna-simulated Tool call, expect:

1. An Agent `LLM_REQUEST` and `LLM_RESPONSE` containing one function call.
2. One correlated `tool_call` client event.
3. One Tool `LLM_REQUEST` and `LLM_RESPONSE` in Luna simulation mode, or no
   additional model request in Fixed mock mode.
4. One correlated `tool_result` client event with the same call ID.
5. A continuation Agent `LLM_REQUEST` and final prose `LLM_RESPONSE`.
6. One Agent completion followed by its normal outgoing routes.

A Memory write must not create a standalone Tool `start` event. If Tool model
calls outnumber correlated `tool_call` events in a native-only design, inspect
the Memory-to-Tool edge for accidental `data` routing.

## 10A. API Search Widget

### Purpose

API Search is a specialized native Tool that gives a Luna Agent explicit,
observable access to external information. Use it when the answer depends on
current facts, a supported public catalog, or a configured JSON service. Do
not add it when the harness only needs information already present in the
incoming event or an explicitly connected Memory node.

API Search is a capability, not a scheduled workflow step. The Search node
runs only when a connected Luna Agent makes its native function call.

### Required graph pattern

```text
Trigger -> Research Agent -> Output
              |
              +--tool--> API Search
```

Draw `Luna Agent -> API Search`. Synapse Flow infers a green `tool` capability
edge. Do not draw `API Search -> Luna Agent`; Synapse Flow returns the result
privately inside the same Agent model turn and animates that return over the
existing capability edge. The Search node is not added to the scheduler queue.

If the research must survive beyond the current Agent turn, route the Agent's
final answer to Memory. The Search result itself is not persistent Agent
memory, and the Search trace is never fed back to the Agent automatically.

### Provider modes

API Search supports four provider modes:

- **General web search** uses OpenAI hosted `web_search`. Its Raw Search mode
  returns source records directly, while Assisted Search returns a concise
  evidence summary with cited source URLs.
- **Wikipedia** returns normalized encyclopedia search records without an
  additional API key.
- **Open Library** returns normalized book and author records without an
  additional API key.
- **Custom JSON API** performs one bounded GET request against a public HTTPS
  endpoint template containing `{{query}}` and optionally `{{limit}}`.
- **Local RAG index** embeds the Agent query and retrieves semantically similar
  passages from a disk-backed Synapse Flow SQLite index built from local PDFs.

Raw Search and Assisted Search apply to General web search. Wikipedia, Open
Library, and Custom JSON API already return structured provider records and do
not add an assisted synthesis pass.

### Local RAG indexes

Local RAG keeps extracted passages, source metadata, and embedding vectors in a
`.synapse-rag.sqlite` file on the backend machine. The browser receives only
bounded retrieval results. Source PDFs are not loaded into browser memory.

Build an index from a directory containing PDFs:

```text
npm run rag:index -- --input "C:\path\to\pdfs" --output "C:\path\to\rules.synapse-rag.sqlite" --name "Rules Library"
```

The builder extracts selectable PDF text page by page, skips empty pages,
creates overlapping page-aware chunks, sends those chunks to the configured
OpenAI embedding model in bounded batches, and writes the final index plus a
manifest. It writes to a `.partial` file during construction and publishes the
final index only after every chunk has an embedding.

In the Search Inspector, select `Local RAG index`, choose Raw Retrieval or
Assisted Retrieval, and set Local RAG index file to the absolute SQLite path.
Then connect `Luna Agent -> API Search` with a `tool` edge.

- **Raw Retrieval** returns the nearest passages with document names, PDF page
  numbers, chunk numbers, and similarity scores. The calling Agent performs all
  interpretation.
- **Assisted Retrieval** retrieves the same passages, then uses a separate
  model pass to produce a grounded answer with `[filename, PDF page N]`
  citations before the calling Agent continues.

Tell the Agent to search with precise game terms, compare passages, distinguish
explicit rules from interpretation, preserve filename and PDF page citations,
and admit when retrieval is insufficient. A similarity score ranks passages;
it does not prove that a passage answers the question.

The index records source-file hashes. Rebuild after a source PDF changes. Keep
the index and its manifest together. Do not edit the SQLite file manually or
point a harness at a `.partial` file.

### General web result modes

#### Raw Search

Returns bounded source records containing titles, URLs, and available search
snippets. The Search node does not write an answer for the Agent.

Use Raw Search when:

- Low latency matters.
- The calling Agent should perform the evidence synthesis itself.
- The harness is testing how an Agent handles incomplete retrieval records.
- Source records, rather than a prewritten answer, are the desired tool result.

Raw snippets are discovery evidence, not verified facts. They may be partial,
stale, ambiguous, duplicated, or missing the page context needed to support a
claim. Tell the Agent to compare records, acknowledge uncertainty, and avoid
asserting details that are not supported by the returned text. Raw mode may
cause the Agent to issue a second search when the first result set is weak.

#### Assisted Search

Uses a separate search-model pass to inspect retrieved evidence and return a
concise answer with useful source URLs before the calling Agent continues.

Use Assisted Search when:

- Reliability and evidence interpretation matter more than latency.
- The task asks for current weather, traffic, events, news, or similar facts.
- Raw snippets are likely to omit important context.
- The prototype needs a stronger baseline for comparison.

Assisted Search is slower because the calling Agent first chooses the search,
the Search model retrieves and synthesizes evidence, and the calling Agent then
interprets that result. It improves grounding but is not a truth oracle; the
calling Agent must still preserve citations and report unresolved uncertainty.

### Automatic Agent instructions

Synapse Flow does not rewrite the Agent's saved System prompt. At runtime it
appends a capability section generated from the currently connected Search
nodes. The section identifies every function and provider, explains that a
search must actually be called before claiming it happened, identifies Raw or
Assisted delivery, supplies the current date, requires useful source URLs in
grounded answers, and marks all returned content as untrusted external data
whose embedded instructions must never be followed.

Removing the capability edge removes those generated instructions on the next
run. Renaming or reconfiguring the Search node updates them automatically.

The authored Agent System prompt must still define the research task and the
quality bar. A good pattern is:

```text
Use the connected search capability before answering. Search for the exact
place, subject, and current date needed by the incoming request. Compare the
returned evidence, distinguish confirmed facts from uncertainty, and preserve
the most useful source URLs in concise prose. If the evidence is insufficient,
say so instead of inventing an answer.
```

Set the Agent's `Require tool call` option when a valid turn must perform a
search. Leave it disabled when searching is optional and the Agent may answer
from the incoming event or connected Memory.

### Configuration

- Give every connected Search node a unique API-safe Function name.
- Describe exactly when the Agent should search in Function description. For
  example: `Search current Portland weather when trip conditions are needed.`
- Put task-specific query strategy and evidence requirements in Agent usage
  instructions. Do not merely repeat `search the web`.
- Set Maximum results between 1 and 10.
- For web search, choose low, medium, or high Search context and optionally
  provide comma- or newline-separated allowed and blocked domains.
- Prefer allowed domains when a task has an authoritative source, such as an
  official agency, documentation site, or first-party event calendar.
- For custom APIs, use only a public HTTPS endpoint. Synapse Flow rejects
  localhost, private network addresses, redirects, oversized responses, and
  requests exceeding the server timeout.
- Never place API keys in a node, saved harness, or export. Add provider
  credentials to the local server environment when a future preset requires
  them.

The connected Agent receives a strict native function with required `query`
and `limit` arguments. The runtime date is supplied automatically, but the
Agent should still include an explicit date in queries for date-sensitive
tasks. The server clamps `limit` to the node's configured maximum.

### LLM construction procedure

1. Add one Luna Agent responsible for interpreting the external evidence.
2. Add one API Search node and select its provider.
3. For General web search, deliberately choose Raw or Assisted mode.
4. Give the Search function a unique name and narrow description.
5. Write Agent usage instructions that define query scope, preferred sources,
   uncertainty handling, and citation expectations.
6. Connect `Agent -> API Search` with a `tool` edge.
7. Enable `Require tool call` when every activation must search.
8. Connect the Agent's normal output to downstream nodes, Memory, or Output.
9. Run a small test and inspect both the Agent output and session trace.
10. Check for stale dates, repeated searches, weak sources, unsupported claims,
    excessive latency, and missing URLs before expanding the harness.

### Runtime and trace

The ordinary `tool_call` and `tool_result` events still correlate the Agent and
Search node. The server additionally records `SEARCH_REQUEST`,
`SEARCH_RESPONSE`, or `SEARCH_ERROR` under the same session ID. The Search
Inspector shows the latest result and renders returned source URLs as clickable
links. Search results are not remembered by the Agent unless the graph writes
the Agent's final output into an explicit Memory node.

Expected trace order for one successful search:

1. Calling Agent `LLM_REQUEST`.
2. Calling Agent `LLM_RESPONSE` containing one native function call.
3. Correlated `tool_call` client event and `SEARCH_REQUEST`.
4. `SEARCH_RESPONSE` followed by a `tool_result` client event.
5. Continuation Agent `LLM_REQUEST` with the function result.
6. Final prose `LLM_RESPONSE` and Agent completion.

One Agent may legitimately search more than once. Treat repeated searches as a
quality signal to inspect, not automatically as an error. A `SEARCH_ERROR`, an
uncorrelated call ID, a result returned after its session was stopped, or an
unfinished queue is a runtime problem.

### Export requirements

An exported implementation specification must preserve the provider, result
mode, function name and description, result limit, context size, domain
filters, usage instructions, tool edge, citation policy, untrusted-content
boundary, and whether the Agent requires a tool call. Do not collapse Raw and
Assisted Search into a generic `web search` capability; they have different
latency, quality, and Agent-responsibility contracts.

## 10B. Tool Modes and Narrative Pattern

### Fixed mock

Returns the configured Mock response. Every `{{input}}` token is replaced with
the stringified incoming payload.

Use this for:

- Stable fixtures.
- Predictable success or failure responses.
- Testing downstream behavior without model variability.

### Luna simulation

Calls the model using the Capability description and incoming tool request.

Use this for:

- Realistic fictional search results.
- Simulated service responses.
- Variable tool-like data during early prototyping.

The Luna simulation is not a real external integration. Its result must be
treated as fictional model output.

An explicitly connected Memory `read` edge supplies context to a Luna-simulated
Tool. It does not expose other Memory or the complete graph.

### Narrative action pattern

For an Agent that should speak naturally while using authoritative mechanics:

```text
GM -> Character Agent -> GM
       |
       +--tool--> Action Tool
Memory --read--> Character Agent
Memory --read--> Action Tool
```

The Character Agent calls the Tool with structured arguments, receives the
mechanical result privately inside the model turn, and then returns narrative
prose as its node output. Do not ask the Agent to print the function-call JSON
as prose. Downstream nodes receive only the final narration.

Use a Fixed mock when exact repeatability matters. Use Luna simulation when the
prototype needs varied fictional adjudication. An exported production design
must replace either mode with a real capability or deterministic application
service while preserving the function schema and authority boundary.

## 11. Memory Widget

### Purpose

Stores explicit run-scoped state that can be inspected or supplied to Agents.
Each Memory widget is isolated by node ID.

### Write behavior

#### Append entries

- Appends each incoming payload.
- Preserves up to the latest 50 entries.
- A non-empty Initial value becomes the first existing value.

#### Replace value

- Replaces the stored value with the latest incoming payload.

### Initial value

The value present at the beginning of every new run.

### Runtime behavior

- A `write` edge schedules Memory and updates it.
- A `read` edge does not schedule anything.
- Memory read context is supplied to Luna Agents, User Input nodes, and
  Luna-simulated Tools with an explicit read connection.
- Stored entries are visible and scrollable in the Inspector.
- Runtime Memory contents are cleared from saved project files.
- Every normal run resets Memory to its Initial value.
- An opted-in manual continuation Trigger can carry Memory into the next
  session for the unchanged graph.

### Use Memory for

- Conversation or event history that an Agent should read.
- Shared public observations.
- Latest replaceable context.
- Inspectable simulation records.

### Avoid

- Using Memory as an invisible global variable.
- Connecting Memory to an Agent and expecting the read edge to activate it.
- Storing authoritative state in prose when a generated Router needs to validate
  and mutate exact fields.
- Sending simultaneous writes to the same Memory in Parallel mode when order
  matters.

## 12. Output Widget

### Purpose

Captures and displays the latest payload for inspection.

### Runtime behavior

- Output records its incoming payload as Last output.
- Output is terminal for that event branch.
- Output does not stop other queued branches.
- Output does not stop an entire loop elsewhere in the graph.

Use Output for:

- Final simulation results.
- Public status snapshots.
- Debug probes.
- Comparing alternate branches.

To end a governed loop, either let a Governor block the continuation event or
make the controlling Router schedule only Output and other terminal observers.

## 13. Execution Modes

### Sequential

- Processes one queued event at a time.
- Adds a short visible pause between events.
- Makes animation and trace order easier to follow.
- Is the preferred mode for first tests and debugging.

### Parallel

- Processes the current queue as a concurrent wave.
- Enqueues the resulting next wave afterward.
- Better approximates independent concurrent branches.
- Can expose ordering assumptions.

Do not use Parallel mode when multiple branches mutate the same logical state
unless the simulation explicitly tolerates nondeterministic ordering.

### Run controls

- **Run All**: Starts a new session and queues every Trigger.
- **Run All** always starts with clean Router and Memory state.
- **Fire Trigger**: Starts a new session with only the selected Trigger. If that
  Trigger enables continuation and the graph is unchanged, prior Router and
  Memory state are retained.
- **Pause**: Lets the currently executing node finish, preserves newly queued
  events, and holds before the next Sequential event. In Parallel mode, the
  current in-flight wave finishes before the queue holds.
- **Resume**: Continues the same session, queue, event count, Router state,
  Memory state, and Governor counters.
- **Stop**: Aborts the active model request, clears queued events, and records a
  stopped finish reason.
- **Queue count**: Shows currently queued events.

Intentional loops are supported. They continue until:

- A Router schedules no continuation.
- A Router returns `drop: true`.
- A Governor reaches its activation limit or matches its stop phrase.
- The user presses Stop.
- The run reaches the 200-event safety limit.

## 14. Observability and Debugging

### Run Trace

The Run Trace records:

- Session start.
- Preflight warnings.
- Node receipt/start.
- Node completion.
- Routes and channels.
- Pause and resume controls.
- Governor decisions.
- Errors.
- Runtime completion reason.

Trace events include the current session ID. Use the trace to determine what
actually executed instead of inferring behavior only from node animation.

### Persistent logs

- Latest session ID: `logs/latest-session.txt`
- Session trace: `logs/session-<session-id>.jsonl`
- Router job trace: `logs/router-jobs/job-<job-id>.jsonl`

Persistent traces include graph snapshots, complete event lineage, queue
positions, node durations, state checkpoints, correlated model requests and
responses, Router and Governor activity, pause/resume controls, errors, final
isolated state, and finish records.

Never expose `.env`, API keys, Codex authentication data, or secret prompt data
in chat, exports, test fixtures, or committed files.

### Preflight diagnostics

Current diagnostics report:

- Duplicate or missing widget IDs, connection IDs, and Names.
- Dangling connections and unknown channels.
- Invalid `read` and `write` directions.
- Generated Routers configured without generated source.
- Agents with undocumented system prompts.
- Triggers with no executable outgoing path.
- Terminal Output nodes with outgoing executable connections.
- Widgets unreachable from every Trigger.
- Execution cycles, including whether a Governor protects the cycle.

Structural errors block execution. Warnings and informational findings remain
visible but do not block. Intentional cycles are allowed.

### Deterministic replay

Deterministic replay has two useful forms:

1. **Trace playback** moves backward and forward through recorded events and
   displays the exact queue, node output, and state checkpoint that existed
   then. It does not call an LLM or execute Router code.
2. **Deterministic re-execution** starts from the recorded graph and Trigger
   events, substitutes the recorded LLM responses and Router random values, and
   verifies that routes, outputs, and state fingerprints match the original.

The current trace format records the event lineage, state checkpoints, model
responses, and runtime metadata needed for this feature. A playback/scrubbing
interface is not implemented yet.

### Debugging procedure

1. Run in Sequential mode.
2. Confirm the intended Trigger was queued.
3. Find the first unexpected route or missing node start.
4. Inspect the source widget's Last output.
5. Inspect Agent output history or Memory stored entries.
6. Check whether the edge is execution (`data`, `trigger`, `write`) or context
   only (`read`).
7. Check Router target IDs, exact node Names, input shape, and private state.
8. Read the session JSONL when the UI trace is insufficient.
9. Fix the graph or configuration; do not silently compensate for a mistaken
   test map in runtime code.
10. Start a new run and compare session IDs.

## 15. Building a Simulation in the UI

Use this order:

1. Click **New** and confirm the blank harness.
2. Give the harness a specific Name.
3. Define the authoritative state and stopping condition before adding widgets.
4. Add widgets from the Node Library.
5. Give every widget a unique Name and one clear Purpose.
6. Arrange the graph left to right or top to bottom by execution phase.
7. Draw execution connections.
8. Add Memory write and read connections deliberately.
9. Configure Trigger payloads.
10. Configure Agent prompts and strict output formats.
11. Configure simple Routers, Tools, and Memory.
12. Add Governors to loops that need a simple deterministic safety boundary.
13. Finish generated Router topology and then Build with Codex.
14. Run in Sequential mode.
15. Pause and resume once to verify that queued work is retained.
16. Inspect every branch and correct the first divergence.
17. Test stopping, invalid input, and error paths.
18. Test Parallel mode only if concurrency matters.
19. Save the harness.
20. Export Markdown when the prototype is ready for implementation.

## 16. Building a Simulation as a Project File

An IDE coding agent may generate a `.synapse.json` file and load it with the
folder button in the toolbar. For complex or reproducible examples, prefer a
builder script like `scripts/build-pvp-harness.mjs`.

Minimum project shape:

```json
{
  "format": "synapse-flow/harness",
  "version": 2,
  "name": "Example Harness",
  "nodes": [
    {
      "id": "start",
      "type": "synapseNode",
      "position": { "x": 100, "y": 100 },
      "data": {
        "kind": "trigger",
        "label": "Start",
        "description": "Starts the example.",
        "inputType": "event",
        "outputType": "event",
        "config": {
          "payload": "BEGIN",
          "continueState": false
        }
      }
    }
  ],
  "edges": []
}
```

Minimum edge shape:

```json
{
  "id": "edge-start-worker",
  "source": "start",
  "target": "worker",
  "channel": "trigger"
}
```

Project-file rules:

- Use stable, unique, readable node and edge IDs.
- Use `type: "synapseNode"` for every widget.
- Use only these `data.kind` values: `trigger`, `agent`, `user`, `logic`,
  `governor`, `tool`, `memory`, `output`.
- Use only these channels: `data`, `trigger`, `read`, `write`.
- Keep labels unique.
- Keep all config values JSON-safe.
- Do not include secrets.
- Do not include runtime output history or stored Memory contents.
- Use the current example file as the canonical full-format reference:
  `examples/2v2-pvp-arena.synapse.json`.

Load normalizes the portable version 2 shape into canvas edges. Preflight then
checks IDs, references, channels, generated Router readiness, and reachability
before execution.

For generated Routers, the safest workflow is:

1. Generate the graph file with Router topology and Routing intent.
2. Load it in Synapse Flow.
3. Select the Router.
4. Click Build with Codex.
5. Save the validated result.

Do not place unvalidated arbitrary JavaScript into `generatedCode`.

## 17. Recommended Simulation Architecture

### Put authority in one place

Choose one generated Router to own exact state transitions when the simulation
has rules, turns, counters, legal actions, retries, or termination.

Agents should propose decisions. The authoritative Router should:

- Validate the acting Agent.
- Validate correlation or turn tokens.
- Validate legal choices.
- Apply deterministic rules.
- Update private state.
- Emit a public state.
- Select the next actor.
- End the loop.

### Separate public history from authority

Use:

- Router private state for exact authoritative state.
- Memory for inspectable history or Agent-readable context.
- Output for current public state and final results.

### Use correlation tokens

For turn-based or asynchronous simulations:

1. Router emits a unique turn or request token.
2. Agent must copy it exactly.
3. Router rejects stale or mismatched responses.
4. Invalid responses retry without advancing state.

### Minimize Agent freedom

Supply legal options in the incoming payload. Ask the Agent to choose among
them rather than inventing arbitrary actions that deterministic code must
interpret.

## 18. Common Graph Patterns

### Linear pipeline

```text
Trigger -> Tool -> Output
```

Use when the Tool itself is an ordinary queued transformation.

### Agent with a native Tool

```text
Trigger -> Agent -> Output
           |
           +--tool--> Tool
```

The Tool edge is a callable capability, not an execution route. The Agent calls
it during the model turn and emits its final response to Output.

### Manual human turn

```text
Agent -> User Input (left execution handle) -> Router
Output -> User Input (top read handle)
```

The Agent output activates the Manual User Input node. The simulation waits
until the human submits prose. The Output read connection contributes additional
visible context but does not activate the user.

### Automated user turn

```text
Router -> User Input (Auto) -> Agent -> Router
Memory -> User Input (read)
```

The Auto User receives the Router request and explicitly connected Memory, then
responds in prose. A downstream Agent or Router may interpret that prose into a
structured internal decision.

### GM between every Agent

```text
Trigger -> Turn Router -> User Input (GM) -> Governor -> Turn Router -> selected Agent
             ^                                                     |          |
             +-----------------------------------------------------+          +--tool--> Action Tool
```

On initialization and after every Agent narration, the Turn Router sends User
Input a turn brief naming the next actor. The GM describes or adjudicates the
next beat for that actor only. The Router then sends the GM direction to exactly
the actor it announced. That Agent calls its connected Action Tool, narrates the
result, and returns through the Router so the next GM brief arrives before any
new response is accepted. Put a Governor on the GM-to-Router continuation when
the chapter needs a hard turn boundary.

When fixed initiative matters, do not ask the GM model to infer the next actor
from prose or remember the order. Put `nextActor` explicitly in every turn brief
and tell the GM not to redirect the turn. If the GM should choose initiative
instead, give the Router an explicit actor-selection contract and validate the
choice before routing.

Do not fan one GM response to several Agents unless independent simultaneous
branches are intentional. If two Agents each return to the same Auto User and
the Auto User addresses both again, the queue can double repeatedly and Memory
will combine divergent versions of the scene.

### Lessons from Manual and Auto User tests

- Direct incoming data is always visible to User Input. Additional node output
  is visible only through explicit `read` edges.
- In Sequential mode, a Manual User Input suspends later queued sibling events.
  An Output queued behind it may appear one turn late even though Memory has
  already stored the preceding event.
- Auto mode preserves the same graph topology as Manual mode; it does not make
  fan-out safer or merge parallel responses.
- Stop discards the result of an in-flight Auto User call if it arrives after
  the session ends. The model request may still have consumed tokens.
- For one coherent conversation, route exactly one participant back to one User
  turn unless a deterministic merge step joins parallel branches first.

### Agent with explicit memory

```text
Trigger -> Agent -> Memory (write)
Memory -> Agent (read, context only)
Agent -> Output
```

The Agent still needs an execution edge on every invocation.

### Governed Agent loop

```text
Trigger -> Router -> selected Agent -> Router
Router -> Memory
Router -> Output
```

The Router owns state, validates Agent output, selects the next Agent, and
eventually routes only to terminal observers.

For a simple hard visit limit:

```text
Trigger -> Agent -> Governor -> Agent
                     |
                     +-- blocks at its configured boundary
```

Place the Governor on every route that continues the loop. A branch that bypasses
the Governor is not protected by it.

### Router fan-out with observers

```text
Router -> active worker
Router -> Memory
Router -> Output
```

The Router can send one payload to a worker and observers in the same step by
returning all corresponding target IDs.

### Trigger feedback loop

```text
Trigger -> Agent -> Trigger
```

The returning Agent event activates Trigger, which emits the original configured
Start payload again. Use this only when that reset behavior is intended.

## 19. Common Failure Modes

### "The Agent never ran"

- Its only incoming edge may be a Memory `read` edge.
- A Router may not have selected its target ID.
- A prior node may have blocked or terminated the branch.
- The run may have reached 200 events.

### "The Router sent everywhere"

- Generated code may have omitted `targetIds`.
- A keyword Router may lack a matching wildcard rule.
- Pass through and Template intentionally use all outgoing execution edges.

### "Memory contains data but the Agent does not know it"

- Memory may not have a `read` edge to that Agent.
- The Agent may have run before Memory was written.
- Parallel mode may have exposed an ordering assumption.

### "The Tool ran more times than the Agent called it"

- Confirm `Luna Agent -> Tool` is a green `tool` capability edge.
- Confirm `Memory -> Tool` is a lavender `read` edge.
- Search the trace for Tool `start` events. Native calls use correlated
  `tool_call` and `tool_result` events instead.
- Compare Tool `LLM_REQUEST` count with `tool_call` count. In Luna simulation
  mode they should match unless the Tool is also intentionally executed as a
  standalone graph node.

### "The Tool contradicted established context"

- Confirm the relevant Memory has a `read` edge to the Tool itself; an Agent
  Memory edge does not automatically grant the same context to its Tools.
- Confirm the Memory write completed before the Agent invocation in Sequential
  mode.
- Treat Luna simulation as fictional model output. Use a Fixed mock or exported
  deterministic application service when exact mechanics are required.

### "Output appeared but the loop continued"

Output ends only its own event branch. The controlling Router or another branch
continued scheduling work.

### "The Governor stopped one event but another branch continued"

A Governor controls only events that pass through it. Move the Governor to the
shared continuation path or add a Governor to each independent loop branch.

### "The generated Router cannot select a new widget"

The widget was probably connected after code generation. Finalize topology and
regenerate.

### "A random Router repeats or is biased"

The code must use `context.runtime.randomValue` and map it directly across all
valid outcomes. Regenerate older random Router code when the UI warns that it
predates runtime randomness.

### "The Agent returned plausible but invalid data"

Strengthen the prompt, provide legal values, require strict JSON, add a
correlation token, and validate in a Router.

### "The run stopped at User Input"

- In Manual mode this is intentional suspension, not failure.
- Select the waiting User Input node, review its incoming event and observed
  outputs, enter prose, and submit the response.
- Confirm the node has a normal outgoing execution edge.
- If no input form appears, verify the node was activated through its left input
  handle rather than connected only through its top read handle.

## 20. Verification Checklist for an LLM

Before declaring a simulation complete:

- [ ] The harness has a specific Name.
- [ ] Every widget has a unique Name and one clear Purpose.
- [ ] Every Trigger has an intentional Start payload.
- [ ] Trigger continuation is enabled only when cross-session state is intended.
- [ ] `read` edges are used only for explicit Agent or User Input context.
- [ ] Every Agent has a separate execution path.
- [ ] Agent prompts describe input, constraints, and exact output.
- [ ] Every Agent Tool capability uses a `tool` edge, unique function name,
      explicit description, and strict argument schema.
- [ ] Agents that must act through Tools enable Require a Tool call.
- [ ] Tool results return to the calling Agent before its visible output routes.
- [ ] Memory-to-Tool context uses `read` and produces no standalone Tool event.
- [ ] Native-only traces have one correlated Tool result per Tool call and no
      unexplained Tool model requests.
- [ ] Exact state is owned by deterministic Router logic.
- [ ] Generated Router topology was finalized before generation.
- [ ] Random Router code uses `context.runtime.randomValue`.
- [ ] Every intentional loop has a stopping condition or an explicitly accepted
      safety-limit ending.
- [ ] Every simple bounded loop passes through a Governor on every continuation.
- [ ] Output is not mistaken for a global stop command.
- [ ] Sequential execution follows the intended route.
- [ ] Pause and Resume preserve the same queue and session.
- [ ] Invalid Agent output is handled.
- [ ] Memory writes and reads occur in the intended order.
- [ ] Every User Input node has an execution edge in addition to any read edges.
- [ ] Manual User Input is represented as suspended runtime state, not completion.
- [ ] Auto User Input has a specific persona prompt and emits prose only.
- [ ] User Input can observe only explicitly connected sources.
- [ ] Parallel mode was tested if concurrency is part of the design.
- [ ] The final run has no unexplained errors or queued events.
- [ ] The relevant session ID and outcome were recorded.
- [ ] The `.synapse.json` project was saved.
- [ ] Markdown was exported for downstream implementation when appropriate.

## 21. Save, Load, and Export

### Save

The Save button:

- Stores the project in browser local storage.
- Downloads `<harness-name>.synapse.json`.
- Uses portable format `synapse-flow/harness` version 2.
- Preserves stable IDs, positions, contracts, prompts, generated Router evidence,
  and complete configuration.
- Removes runtime status, Last output, Agent and User response history, pending
  manual input, and Memory entries.

### Load

The folder button loads `.json` or `.synapse.json` project files and fits the
graph to the canvas.

### New

New creates a blank harness after confirmation and clears the locally stored
project.

### Export Markdown

Export downloads `<harness-name>-implementation.md` containing:

- Versioned manifest and deterministic graph fingerprint.
- Runtime, pause/resume, continuation, logging, and sandbox contracts.
- Mermaid flow and exact stable-ID connection table.
- Every widget's contracts, prompts, configuration, and canvas position.
- Generated Router intent, source, summary, assumptions, tests, and prior
  versions when recorded.
- Preflight diagnostics.
- An IDE reconstruction procedure and implementation acceptance criteria.
- An authoritative machine-readable version 2 graph appendix.

The export is the principal handoff from rapid prototype to a larger
application.

## 22. Reference Examples

### Drone Commander 4-20 Agent Capacity Harness

- Project: `examples/drone-commander-4-20-agent-capacity.synapse.json`
- Builder: `scripts/build-drone-commander-capacity-harness.mjs`
- Command: `npm run build:drone-commander-capacity`
- Tests: `tests/droneCommanderCapacityHarness.test.js`

This graph makes a dynamic capacity range visible with twenty generic Agent
slots while defaulting to an inexpensive two-versus-two drill. Edit the Trigger
payload using `CAPACITY_DRILL friendly=N opposition=N` to deploy 2-10 identities
per side. The Orchestrator creates only the
configured identities and the Context Builder activates only their assigned
slots. The full ten-versus-ten test proves all twenty identities can commit once.

The slots are test fixtures, not a production class diagram. Exported
implementations must store a dynamic identity collection, dispatch through
shared orchestration/provider services, cap provider concurrency separately,
and preserve authoritative initiative and commit order. The one-round drill
samples friendly radio once to retain retry headroom under the 200-event limit.

### User Input Manual and Auto Demo

File: `examples/user-input-manual-auto-demo.synapse.json`

Demonstrates a fixed situation feeding a Manual User Input execution edge, an
Output feeding the User Input observation handle, suspended manual submission,
and the same node's configurable Auto mode.

### Three-player Go Fish Governor test

- Project: `examples/three-player-go-fish-governor.synapse.json`
- Builder: `scripts/build-go-fish-harness.mjs`
- Command: `npm run build:go-fish`

This is the canonical phrase-stopped Governor example. Three Luna Agents choose
only a legal opponent and a rank in their own private hand. The Game Engine owns
the standard 52-card deck, seven-card deal, transfers, draws, books, legal
validation, turns, and victory.

Agent responses pass through Game Governor before returning to the Engine. On
the first fourth book, the Engine sends the same `GAME_OVER` final state to the
completed-game Memory, Final Table, and Governor. The Memory and Output branches
complete normally while the Governor matches `GAME_OVER` and blocks its own
continuation edge back to the Engine.

Use the 2v2 PVP harness as the primary complex example:

- Project: `examples/2v2-pvp-arena.synapse.json`
- Reproducible builder: `scripts/build-pvp-harness.mjs`
- Tests: `tests/pvpHarness.test.js`

It demonstrates:

- A single authoritative generated Router.
- Four Agents with strict JSON decisions.
- Private Router state.
- Fresh runtime randomness.
- Selective target routing.
- Agent retry on invalid output.
- A governed execution loop.
- Memory as public chronology.
- Output as live and final display.
- A deterministic stopping condition.

The PVP example is a pattern reference, not a mandatory architecture. Keep each
new simulation as small as its actual question permits.

Use the three-player blackjack harness as the continuation-state example:

- Project: `examples/three-player-blackjack.synapse.json`
- Reproducible builder: `scripts/build-blackjack-harness.mjs`
- Tests: `tests/blackjackHarness.test.js`

It demonstrates:

- One authoritative Dealer Router.
- Three Luna players constrained to hit or stand.
- A single shuffled deck retained in private Router state.
- One completed round per session.
- A Trigger with Continue prior run state enabled.
- Round two consuming the exact remaining cards from round one.
- Memory retaining a multi-round ledger across continuation sessions.
- Run All as an explicit fresh-table reset.

Use the four-agent edition when the Dealer must also be model-controlled:

- Project: `examples/four-agent-blackjack.synapse.json`
- Reproducible builder: `scripts/build-four-agent-blackjack-harness.mjs`
- Tests: `tests/fourAgentBlackjackHarness.test.js`

This version separates the Table Engine Router from a fourth Luna Agent named
Dealer Agent. The Table Engine owns cards, totals, legal-action enforcement,
tokens, and scoring, but it never chooses a Dealer hit or stand. It sends each
Dealer turn to Dealer Agent and waits for that Agent's strict JSON response.

Use the counting edition when all four Agents need persistent public shoe
knowledge:

- Project: `examples/four-agent-counting-blackjack.synapse.json`
- Reproducible builder: `scripts/build-counting-blackjack-harness.mjs`
- Tests: `tests/countingBlackjackHarness.test.js`

This version adds one isolated replace-mode Count Memory per Agent. Before each
Agent decision, the Table Engine writes the latest complete public shoe snapshot
to that Agent's Memory, then synchronizes all four Memories when the round ends.
Each snapshot contains the revealed-card sequence, Hi-Lo
running and true counts, rank frequencies, unseen rank inventory, penetration,
cards dealt and remaining, and the current public table. Dealer hole cards are
excluded until Dealer play begins. Each Memory has a read edge only to its owner.
Use Sequential mode to guarantee the write is displayed before Agent execution;
the incoming event also carries the current snapshot so Parallel mode cannot
make the decision payload stale. Continuation Trigger fires retain the four
Memories and cumulative count until the Table Engine starts a fresh shoe.

Use the blank-code generation-test edition to evaluate whether the Router coding
agent can build that system from Routing intent alone:

- Project:
  `examples/four-agent-counting-blackjack-coding-agent-test.synapse.json`
- Reproducible builder:
  `scripts/build-counting-blackjack-coding-agent-test.mjs`

Its Table Engine has an empty `generatedCode` field. Load the project, select
Table Engine, and click **Build with Codex**. Do not copy code from the completed
counting example into this test edition; the purpose is to evaluate the prompt.
