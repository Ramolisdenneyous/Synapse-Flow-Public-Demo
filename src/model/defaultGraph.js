import { MarkerType } from '@xyflow/react';
import { CHANNEL_COLORS, createNode } from './catalog.js';

function edge(id, source, target, channel = 'data') {
  return {
    id,
    source,
    target,
    type: 'default',
    label: channel,
    data: { channel },
    markerEnd: { type: MarkerType.ArrowClosed, color: CHANNEL_COLORS[channel] },
    style: { stroke: CHANNEL_COLORS[channel], strokeWidth: 2 },
  };
}

export function createStarterGraph() {
  const trigger = createNode('trigger', { x: 70, y: 230 }, 'starter-trigger');
  trigger.data.label = 'Start Brief';
  trigger.data.config.payload = 'Draft a concise launch checklist for a prototype agent harness.';

  const agent = createNode('agent', { x: 350, y: 180 }, 'starter-agent');
  agent.data.label = 'Planner';
  agent.data.config.systemPrompt =
    'Turn the request into a concise, ordered checklist. Return only the checklist.';

  const memory = createNode('memory', { x: 350, y: 390 }, 'starter-memory');
  memory.data.label = 'Run Notes';

  const logic = createNode('logic', { x: 650, y: 180 }, 'starter-logic');
  logic.data.label = 'Pass Through';
  logic.data.config.operation = 'passthrough';
  logic.data.config.rules = '* => Review Output';

  const output = createNode('output', { x: 940, y: 180 }, 'starter-output');
  output.data.label = 'Review Output';

  return {
    name: 'Untitled Harness',
    nodes: [trigger, agent, memory, logic, output],
    edges: [
      edge('edge-start-agent', trigger.id, agent.id, 'trigger'),
      edge('edge-agent-memory', agent.id, memory.id, 'write'),
      edge('edge-memory-agent', memory.id, agent.id, 'read'),
      edge('edge-agent-logic', agent.id, logic.id, 'data'),
      edge('edge-logic-output', logic.id, output.id, 'data'),
    ],
  };
}
