import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function node(id, kind, label, description, position, config) {
  const contracts = {
    trigger: ['event', 'event'],
    user: ['event', 'message'],
    tool: ['tool_request', 'tool_result'],
    output: ['event', 'none'],
  };
  const [inputType, outputType] = contracts[kind];
  return {
    id,
    type: 'synapseNode',
    position,
    data: {
      kind,
      label,
      description,
      inputType,
      outputType,
      config,
    },
  };
}

function edge(id, source, target, channel, targetHandle = undefined) {
  return {
    id,
    source,
    target,
    ...(targetHandle ? { targetHandle } : {}),
    channel,
  };
}

export function createUserInputDemo() {
  return {
    format: 'synapse-flow/harness',
    version: 2,
    name: 'User Input - Manual and Auto Demo',
    nodes: [
      node(
        'user-demo-start',
        'trigger',
        'Present Situation',
        'Begins a single participant-response test.',
        { x: 80, y: 250 },
        { payload: 'The prototype asks how you want to proceed.', continueState: false },
      ),
      node(
        'user-demo-scene',
        'tool',
        'Situation Report',
        'Provides fixed observable context before the user turn.',
        { x: 370, y: 250 },
        {
          mode: 'mock',
          mockResponse:
            'The status panel shows one safe option and one experimental option. Which approach should the prototype take?',
          behaviorPrompt: '',
        },
      ),
      node(
        'user-demo-observer',
        'output',
        'Visible Situation',
        'Captures the situation so User Input can observe it through a read edge.',
        { x: 680, y: 90 },
        {},
      ),
      node(
        'user-demo-participant',
        'user',
        'Participant Response',
        'Waits for human prose in Manual mode or simulates the participant in Auto mode.',
        { x: 680, y: 330 },
        {
          mode: 'manual',
          systemPrompt:
            'You are a thoughtful prototype tester. Explain which approach you would choose and why in two or three natural prose sentences.',
          reasoningEffort: 'low',
          maxOutputTokens: 400,
        },
      ),
      node(
        'user-demo-result',
        'output',
        'Recorded Response',
        'Captures the completed manual or automated prose response.',
        { x: 1000, y: 330 },
        {},
      ),
    ],
    edges: [
      edge('user-demo-edge-start-scene', 'user-demo-start', 'user-demo-scene', 'trigger'),
      edge('user-demo-edge-scene-observer', 'user-demo-scene', 'user-demo-observer', 'data'),
      edge(
        'user-demo-edge-scene-participant',
        'user-demo-scene',
        'user-demo-participant',
        'data',
        'input',
      ),
      edge(
        'user-demo-edge-observer-read',
        'user-demo-observer',
        'user-demo-participant',
        'read',
        'read',
      ),
      edge(
        'user-demo-edge-participant-result',
        'user-demo-participant',
        'user-demo-result',
        'data',
      ),
    ],
  };
}

export async function writeUserInputDemo(outputPath) {
  const harness = createUserInputDemo();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(harness, null, 2), 'utf8');
  return harness;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  const outputPath = path.resolve('examples/user-input-manual-auto-demo.synapse.json');
  await writeUserInputDemo(outputPath);
  console.log(`Wrote ${outputPath}`);
}
