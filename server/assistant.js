import { validateGeneratedRouter } from './routerSandbox.js';
import { routerTopology, ROUTER_OUTPUT_SCHEMA } from './routerContract.js';

export const ASSISTANT_SYSTEM_PROMPT = `You are the Coding Agent, the built-in coding assistant for Synapse Flow Public Demo.
Help people understand and construct safe visual agent harnesses. The canvas executes events in the browser; router code is the only generated code and runs in a capability-free QuickJS sandbox.
Never claim you ran code, changed files, inspected a server, or accessed a user's computer. Use only the supplied graph, run log, and request. Keep help concise and practical.
Router code must define exactly one synchronous function route(input, context, state), return JSON-safe data, and must not use imports, require, eval, Function, network, filesystem, process, or environment variables.`;

export function compactGraph(nodes = [], edges = []) {
  return {
    nodes: nodes.slice(0, 80).map((node) => ({
      id: node.id,
      kind: node.data?.kind,
      label: node.data?.label,
      config: node.data?.config,
    })),
    edges: edges.slice(0, 160).map((edge) => ({
      source: edge.source,
      target: edge.target,
      channel: edge.data?.channel || 'data',
    })),
  };
}

export function assistantInput({ message, nodes, edges, selectedNode, logs, action }) {
  return [
    `Mode: ${action === 'generate_router' ? 'generate a Router implementation' : 'chat and harness assistance'}.`,
    `User request: ${String(message || '').slice(0, 6000)}`,
    `Selected node: ${JSON.stringify(selectedNode ? { id: selectedNode.id, data: selectedNode.data } : null)}`,
    `Current graph: ${JSON.stringify(compactGraph(nodes, edges))}`,
    `Recent test/run log: ${JSON.stringify(Array.isArray(logs) ? logs.slice(-30) : [])}`,
  ].join('\n\n');
}

export async function buildAssistantResponse({ client, model, request }) {
  const action = request.action === 'generate_router' ? 'generate_router' : 'chat';
  const input = assistantInput({ ...request, action });
  if (action === 'generate_router') {
    const node = request.selectedNode;
    if (!node || node.data?.kind !== 'logic') throw new Error('Select a Router before asking the assistant to generate code.');
    const topology = routerTopology(node, request.nodes || [], request.edges || []);
    const response = await client.responses.create({
      model,
      instructions: `${ASSISTANT_SYSTEM_PROMPT}\nReturn only JSON matching the provided schema. Generate focused tests using connected target ids only.`,
      input: `${input}\n\nRouter topology: ${JSON.stringify(topology)}\n\nUse this routing intent: ${node.data?.config?.routerPrompt || request.message || ''}`,
      reasoning: { effort: 'medium' },
      max_output_tokens: 2600,
      text: { format: { type: 'json_schema', name: 'router_implementation', strict: true, schema: ROUTER_OUTPUT_SCHEMA } },
    });
    const router = JSON.parse(response.output_text || '{}');
    await validateGeneratedRouter(router, topology, node.data?.config?.routerPrompt || request.message || '');
    return { response, action, message: router.summary, router: { ...router, topology } };
  }
  const response = await client.responses.create({
    model,
    instructions: ASSISTANT_SYSTEM_PROMPT,
    input,
    reasoning: { effort: 'low' },
    max_output_tokens: 900,
  });
  return { response, action, message: response.output_text || 'I could not produce a response.' };
}
