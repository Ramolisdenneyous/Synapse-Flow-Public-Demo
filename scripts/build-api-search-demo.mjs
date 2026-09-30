import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function node(id, kind, label, description, position, inputType, outputType, config) {
  return {
    id,
    type: 'synapseNode',
    position,
    data: { kind, label, description, inputType, outputType, config },
  };
}

export function createApiSearchDemo() {
  return {
    format: 'synapse-flow/harness',
    version: 2,
    name: 'API Search - Live Web Demo',
    nodes: [
      node(
        'search-demo-start',
        'trigger',
        'Ask Current Question',
        'Starts one live web research turn.',
        { x: 80, y: 250 },
        'event',
        'event',
        {
          payload:
            'Find one recent positive development in robotics, explain it briefly, and include the most useful source URL.',
          continueState: false,
        },
      ),
      node(
        'search-demo-researcher',
        'agent',
        'Current Events Researcher',
        'Uses the connected API Search capability before answering.',
        { x: 390, y: 250 },
        'event',
        'message',
        {
          systemPrompt:
            'Answer the incoming research question concisely. Use the connected search capability and ground the answer in its returned evidence.',
          reasoningEffort: 'low',
          maxOutputTokens: 700,
          requireToolCall: true,
          outputMode: 'text',
        },
      ),
      node(
        'search-demo-web',
        'search',
        'Live Web Search',
        'Searches the live internet and returns cited evidence to the calling Agent.',
        { x: 390, y: 500 },
        'tool_request',
        'tool_result',
        {
          provider: 'web',
          searchMode: 'assisted',
          functionName: 'search_current_web',
          functionDescription:
            'Search the live web for current factual information needed to answer the incoming question.',
          usageInstructions:
            'Use a focused query, compare the returned evidence, and preserve the most useful source URL in the final answer.',
          maxResults: 5,
          searchContextSize: 'low',
          allowedDomains: '',
          blockedDomains: '',
          customEndpoint: 'https://api.example.com/search?q={{query}}&limit={{limit}}',
        },
      ),
      node(
        'search-demo-output',
        'output',
        'Research Answer',
        'Captures the cited final answer.',
        { x: 740, y: 250 },
        'event',
        'none',
        {},
      ),
    ],
    edges: [
      {
        id: 'search-demo-start-agent',
        source: 'search-demo-start',
        target: 'search-demo-researcher',
        channel: 'trigger',
      },
      {
        id: 'search-demo-agent-search',
        source: 'search-demo-researcher',
        target: 'search-demo-web',
        channel: 'tool',
      },
      {
        id: 'search-demo-agent-output',
        source: 'search-demo-researcher',
        target: 'search-demo-output',
        channel: 'data',
      },
    ],
  };
}

export async function writeApiSearchDemo(outputPath) {
  const harness = createApiSearchDemo();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(harness, null, 2), 'utf8');
  return harness;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  const outputPath = path.resolve('examples/api-search-live-web-demo.synapse.json');
  await writeApiSearchDemo(outputPath);
  console.log(`Wrote ${outputPath}`);
}
