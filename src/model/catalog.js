export const NODE_KINDS = {
  trigger: {
    label: 'Trigger',
    color: '#e6b84a',
    description: 'Starts a flow manually or restarts it when an incoming event activates it.',
    inputType: 'event',
    outputType: 'event',
    config: {
      payload: 'Begin the prototype run.',
      continueState: false,
    },
  },
  agent: {
    label: 'Luna Agent',
    color: '#4fb6c2',
    description: 'Uses an LLM to reason over its event and allowed context.',
    inputType: 'event',
    outputType: 'message',
    config: {
      systemPrompt: 'You are a focused prototype agent. Return only your useful output.',
      reasoningEffort: 'low',
      maxOutputTokens: 700,
      requireToolCall: false,
      outputMode: 'text',
    },
  },
  user: {
    label: 'User Input',
    color: '#e58aa5',
    description: 'Waits for human prose or simulates the user with an LLM.',
    inputType: 'event',
    outputType: 'message',
    config: {
      mode: 'manual',
      systemPrompt:
        'Act as the human participant in this simulation. Respond naturally in prose and do not output JSON, code, or structured data.',
      reasoningEffort: 'low',
      maxOutputTokens: 700,
    },
  },
  logic: {
    label: 'Router',
    color: '#ef7d57',
    description: 'Routes or transforms events with deterministic rules.',
    inputType: 'event',
    outputType: 'event',
    config: {
      operation: 'route',
      routerPrompt: '',
      generatedCode: '',
      generatedSummary: '',
      generatedAt: '',
      generatedJobId: '',
      generatedAssumptions: [],
      generatedTests: [],
      generatedVersions: [],
      rules: 'urgent => Review Output\n* => Archive Output',
      template: '{{input}}',
    },
  },
  governor: {
    label: 'Governor',
    color: '#d3a94f',
    description: 'Stops a path after a configured activation limit or matching stop phrase.',
    inputType: 'event',
    outputType: 'event',
    config: {
      maxActivations: 25,
      stopPhrase: '',
    },
  },
  tool: {
    label: 'Tool',
    color: '#72b878',
    description: 'Returns fixed test data or asks Luna to simulate a capability.',
    inputType: 'tool_request',
    outputType: 'tool_result',
    config: {
      mode: 'mock',
      mockResponse: 'Tool completed successfully.',
      behaviorPrompt: 'Return realistic fictional test data for this tool request.',
      functionName: 'prototype_tool',
      functionDescription: 'Execute the connected prototype capability.',
      parametersSchema: JSON.stringify(
        {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
          additionalProperties: false,
        },
        null,
        2,
      ),
    },
  },
  search: {
    label: 'API Search',
    color: '#5aa9ff',
    description: 'Searches the live web or a configured public data API when called by Luna.',
    inputType: 'tool_request',
    outputType: 'tool_result',
    config: {
      provider: 'web',
      searchMode: 'assisted',
      functionName: 'search_information',
      functionDescription:
        'Search for current or external information when the answer is not already available in the event or connected memory.',
      usageInstructions:
        'Use specific search queries. Base factual claims on the returned evidence and preserve useful source citations in the final response.',
      maxResults: 5,
      searchContextSize: 'low',
      allowedDomains: '',
      blockedDomains: '',
      customEndpoint: 'https://api.example.com/search?q={{query}}&limit={{limit}}',
      localIndexPath: '',
    },
  },
  memory: {
    label: 'Memory',
    color: '#a78bd4',
    description: 'Stores isolated state through explicit read and write edges.',
    inputType: 'memory_write',
    outputType: 'memory_read',
    config: { operation: 'append', initialValue: '' },
  },
  output: {
    label: 'Output',
    color: '#d7dce0',
    description: 'Captures the final event for inspection.',
    inputType: 'event',
    outputType: 'none',
    config: {},
  },
};

export function createNode(kind, position, id = crypto.randomUUID()) {
  const template = NODE_KINDS[kind] || NODE_KINDS.agent;
  return {
    id,
    type: 'synapseNode',
    position,
    data: {
      kind,
      label: template.label,
      description: template.description,
      inputType: template.inputType,
      outputType: template.outputType,
      config: structuredClone(template.config),
      status: 'idle',
      lastOutput: '',
      ...(['agent', 'user'].includes(kind) ? { outputHistory: [] } : {}),
    },
  };
}

export function acceptsReadContext(node) {
  return ['agent', 'user', 'tool', 'search'].includes(node?.data?.kind);
}

export function inferChannel(sourceNode, targetNode, connection = {}) {
  if (targetNode?.data.kind === 'memory') return 'write';
  if (targetNode?.data.kind === 'trigger') return 'trigger';
  if (
    sourceNode?.data.kind === 'agent' &&
    ['tool', 'search'].includes(targetNode?.data.kind)
  ) {
    return 'tool';
  }
  if (
    targetNode?.data.kind === 'user' &&
    connection.targetHandle === 'read'
  ) {
    return 'read';
  }
  if (sourceNode?.data.kind === 'memory') {
    return acceptsReadContext(targetNode) ? 'read' : 'data';
  }
  if (sourceNode?.data.kind === 'trigger') return 'trigger';
  return 'data';
}

export const CHANNEL_COLORS = {
  data: '#7e8a91',
  trigger: '#e6b84a',
  read: '#a78bd4',
  write: '#8d70bd',
  tool: '#72b878',
};
