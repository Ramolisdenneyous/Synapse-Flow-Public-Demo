export const ROUTER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    summary: { type: 'string' },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
    },
    tests: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          input: { type: 'string' },
          randomValue: {
            type: 'number',
            minimum: 0,
            maximum: 0.9999999999999999,
          },
          expectedTargetIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['name', 'input', 'randomValue', 'expectedTargetIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['code', 'summary', 'assumptions', 'tests'],
  additionalProperties: false,
};

function compactNode(node) {
  return {
    id: node.id,
    kind: node.data?.kind,
    label: node.data?.label,
    description: node.data?.description,
    inputType: node.data?.inputType,
    outputType: node.data?.outputType,
  };
}

export function routerTopology(router, nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = edges
    .filter((edge) => edge.target === router.id)
    .map((edge) => ({
      edgeId: edge.id,
      channel: edge.data?.channel || 'data',
      node: compactNode(nodeById.get(edge.source) || { id: edge.source, data: {} }),
    }));
  const targets = edges
    .filter((edge) => edge.source === router.id && edge.data?.channel !== 'read')
    .map((edge) => ({
      edgeId: edge.id,
      channel: edge.data?.channel || 'data',
      node: compactNode(nodeById.get(edge.target) || { id: edge.target, data: {} }),
    }));

  return {
    router: compactNode(router),
    incoming,
    targets,
  };
}

export function buildRouterPrompt(userPrompt, topology) {
  return `SYSTEM INSTRUCTIONS
You are the coding agent for Synapse Flow, a visual laboratory for prototyping agent harnesses.
Generate the complete deterministic implementation for one Router node from the user's softer intent.
Do not inspect files, call tools, browse, or change the repository. Use only the contract and topology below.
Return JSON matching the supplied response schema. The code field must contain plain JavaScript without Markdown fences.

RUNTIME CONTRACT
- Define exactly one synchronous function named route with this signature:
  function route(input, context, state) { ... }
- input is the JSON-safe payload arriving at the router.
- context is JSON-safe and has:
  { router, incoming, targets, runtime }
- context.targets contains the only destinations the router may select. Select destinations by stable node id.
- context.runtime.randomValue is a fresh, server-generated uniform number from 0 inclusive to 1 exclusive for every invocation.
- context.runtime.invocationId uniquely identifies this invocation.
- state is private JSON-safe state for this router and this run. Return a new state value to persist it.
- Return a plain object using:
  {
    targetIds?: string[],
    broadcast?: boolean,
    drop?: boolean,
    payload?: any,
    state?: object
  }
- targetIds routes only to those connected targets. An omitted targetIds field sends to every connected target.
- broadcast: true also sends to every connected target.
- drop: true stops this event.
- payload defaults to the original input when omitted.
- Do not use async code, promises, imports, require, eval, Function, network, filesystem, process, or environment variables.
- When the user's intent asks for randomness, dice, chance, sampling, or shuffling, use context.runtime.randomValue directly. Never derive pseudo-randomness from the payload or persistent state.
- Map randomValue directly and uniformly across the valid outcomes instead of simulating rerolls.
- Keep the implementation small, explicit, and readable.
- Include focused test cases. Each test supplies its context.runtime.randomValue through the randomValue field. Every expectedTargetIds entry must be an id from context.targets.

ROUTER TOPOLOGY
${JSON.stringify(topology, null, 2)}

USER'S ROUTING INTENT
${userPrompt.trim()}
`;
}

export function validateRouterRequest(body) {
  const node = body?.node;
  const nodes = body?.nodes;
  const edges = body?.edges;
  const prompt = node?.data?.config?.routerPrompt;

  if (!node?.id || node.data?.kind !== 'logic') {
    throw new Error('A valid Router node is required.');
  }
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new Error('The current graph is required.');
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Describe how the router should work before generating code.');
  }
  if (prompt.length > 12000) {
    throw new Error('The router prompt is too long.');
  }

  return {
    node,
    nodes,
    edges,
    prompt,
    topology: routerTopology(node, nodes, edges),
  };
}
