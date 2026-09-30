import { describe, expect, it, vi } from 'vitest';
import {
  connectedToolsFor,
  connectedSearchInstructions,
  executeNode,
  isProseResponse,
  nextTargets,
  readableContextFor,
  routerContextFor,
} from '../src/engine/executor.js';

function node(id, kind, label, config = {}) {
  return {
    id,
    data: { kind, label, config, inputType: 'event', outputType: 'event' },
  };
}

describe('executor', () => {
  it('reactivates a trigger from an incoming event and emits its configured payload', async () => {
    const trigger = node('trigger', 'trigger', 'Loop Trigger', {
      payload: 'Prompt Agent 1 again.',
    });

    const result = await executeNode(
      trigger,
      { payload: 'Agent 4 completed.' },
      { memory: {}, readableMemory: {} },
    );

    expect(result.payload).toBe('Prompt Agent 1 again.');
  });

  it('routes to the matching label with a fallback rule', async () => {
    const router = node('router', 'logic', 'Router', {
      operation: 'route',
      rules: 'urgent => Review\n* => Archive',
    });
    const review = node('review', 'output', 'Review');
    const archive = node('archive', 'output', 'Archive');
    const edges = [
      { id: 'a', source: 'router', target: 'review', data: { channel: 'data' } },
      { id: 'b', source: 'router', target: 'archive', data: { channel: 'data' } },
    ];
    const result = await executeNode(
      router,
      { payload: 'This is urgent' },
      { memory: {}, readableMemory: {}, callLLM: vi.fn() },
    );

    expect(nextTargets(router, result, [router, review, archive], edges).map((entry) => entry.node.id))
      .toEqual(['review']);
  });

  it('keeps memory isolated by node id', async () => {
    const first = node('memory-a', 'memory', 'A', { operation: 'append', initialValue: '' });
    const second = node('memory-b', 'memory', 'B', { operation: 'append', initialValue: '' });
    const context = { memory: {}, readableMemory: {}, callLLM: vi.fn() };

    await executeNode(first, { payload: 'alpha' }, context);
    await executeNode(second, { payload: 'beta' }, context);

    expect(context.memory['memory-a']).toEqual(['alpha']);
    expect(context.memory['memory-b']).toEqual(['beta']);
  });

  it('injects only explicitly readable memory into an agent prompt', async () => {
    const callLLM = vi.fn().mockResolvedValue({ text: 'ok', model: 'test' });
    const agent = node('agent', 'agent', 'Agent', {
      systemPrompt: 'Work.',
      reasoningEffort: 'low',
      maxOutputTokens: 300,
    });

    await executeNode(agent, { payload: 'request' }, {
      memory: {},
      readableMemory: { 'Private Notes': ['one'] },
      sampleNonce: 'nonce-123',
      callLLM,
    });

    expect(callLLM.mock.calls[0][0].prompt).toContain('Private Notes');
    expect(callLLM.mock.calls[0][0].prompt).toContain('one');
    expect(callLLM.mock.calls[0][0].prompt).toContain('nonce-123');
  });

  it('executes a connected native Tool call before returning Agent narration', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValueOnce({
        text: '',
        responseId: 'response-one',
        model: 'test',
        toolCalls: [
          {
            callId: 'call-one',
            name: 'take_story_action',
            arguments: '{"action":"strike","target":"raider"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Jannet lunged at the raider, but her blade glanced off its shield.',
        responseId: 'response-two',
        model: 'test',
        usage: { total_tokens: 90 },
        toolCalls: [],
      });
    const executeTool = vi.fn().mockResolvedValue({
      success: false,
      result: 'The attack missed.',
    });
    const agent = node('agent', 'agent', 'Jannet', {
      systemPrompt: 'Act and narrate.',
      reasoningEffort: 'low',
      maxOutputTokens: 300,
      requireToolCall: true,
    });
    const tool = node('tool', 'tool', 'Story Action', {
      functionName: 'take_story_action',
      functionDescription: 'Resolve one character action.',
      parametersSchema: JSON.stringify({
        type: 'object',
        properties: {
          action: { type: 'string' },
          target: { type: 'string' },
        },
        required: ['action', 'target'],
        additionalProperties: false,
      }),
    });
    const edges = [
      { id: 'capability', source: 'agent', target: 'tool', data: { channel: 'tool' } },
    ];
    const connectedTools = connectedToolsFor(agent, [agent, tool], edges);

    const result = await executeNode(agent, { payload: 'A raider charges.' }, {
      callLLM,
      executeTool,
      connectedTools,
      readableMemory: {},
      sampleNonce: 'tool-nonce',
    });

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(callLLM.mock.calls[0][0].tools[0].name).toBe('take_story_action');
    expect(callLLM.mock.calls[1][0]).toMatchObject({
      previousResponseId: 'response-one',
      toolOutputs: [{ callId: 'call-one' }],
    });
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: { action: 'strike', target: 'raider' },
      }),
    );
    expect(result.payload).toContain('blade glanced');
    expect(result.meta.toolExecutions).toHaveLength(1);
  });

  it('can expose native Tool calls as a structured downstream envelope', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValueOnce({
        text: '',
        responseId: 'response-one',
        model: 'test',
        toolCalls: [
          {
            callId: 'call-one',
            name: 'select_tactical_option',
            arguments: '{"activation_id":"activation-7","option_id":"option-b","fallback_policy":"hold","reason":"Best cover."}',
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Selection submitted.',
        responseId: 'response-two',
        model: 'test',
        toolCalls: [],
      });
    const executeTool = vi.fn().mockResolvedValue({ acceptedForValidation: true });
    const agent = node('agent', 'agent', 'Unit Agent', {
      systemPrompt: 'Select one option.',
      requireToolCall: true,
      outputMode: 'tool_call',
    });
    const tool = node('tool', 'tool', 'Tactical Selection', {
      functionName: 'select_tactical_option',
      parametersSchema: JSON.stringify({ type: 'object', properties: {} }),
    });
    const edges = [
      { id: 'capability', source: 'agent', target: 'tool', data: { channel: 'tool' } },
    ];

    const result = await executeNode(agent, { payload: 'Choose.' }, {
      callLLM,
      executeTool,
      connectedTools: connectedToolsFor(agent, [agent, tool], edges),
      readableMemory: {},
      sampleNonce: 'tool-envelope-nonce',
    });

    expect(result.payload).toEqual({
      type: 'agent_tool_call_envelope',
      finalText: 'Selection submitted.',
      toolCalls: [
        {
          callId: 'call-one',
          name: 'select_tactical_option',
          arguments: {
            activation_id: 'activation-7',
            option_id: 'option-b',
            fallback_policy: 'hold',
            reason: 'Best cover.',
          },
          result: { acceptedForValidation: true },
        },
      ],
    });
  });

  it('adds connected Search instructions without mutating the authored Agent prompt', async () => {
    const callLLM = vi.fn().mockResolvedValue({ text: 'Current answer.', model: 'test', toolCalls: [] });
    const agent = node('agent', 'agent', 'Researcher', {
      systemPrompt: 'Answer carefully.',
      maxOutputTokens: 300,
    });
    const search = node('search', 'search', 'Current Web', {
      provider: 'web',
      functionName: 'search_current_web',
      functionDescription: 'Search for current facts.',
      maxResults: 4,
    });
    const edges = [
      { id: 'search-edge', source: 'agent', target: 'search', data: { channel: 'tool' } },
    ];
    const connectedTools = connectedToolsFor(agent, [agent, search], edges);

    await executeNode(agent, { payload: 'What changed?' }, {
      callLLM,
      connectedTools,
      executeTool: vi.fn(),
      readableMemory: {},
      sampleNonce: 'search-nonce',
    });

    expect(connectedTools[0].definition.parameters.required).toEqual(['query', 'limit']);
    expect(connectedSearchInstructions(connectedTools)).toContain('untrusted external data');
    expect(connectedSearchInstructions(connectedTools)).toContain('Current date for search queries:');
    expect(callLLM.mock.calls[0][0].systemPrompt).toContain('Answer carefully.');
    expect(callLLM.mock.calls[0][0].systemPrompt).toContain('search_current_web');
    expect(agent.data.config.systemPrompt).toBe('Answer carefully.');
  });

  it('executes an API Search node through its server capability', async () => {
    const searchAPI = vi.fn().mockResolvedValue({
      provider: 'Wikipedia',
      query: 'Ada Lovelace',
      results: [{ title: 'Ada Lovelace', url: 'https://en.wikipedia.org/wiki/Ada_Lovelace' }],
    });
    const search = node('search', 'search', 'Encyclopedia Search', {
      provider: 'wikipedia',
      maxResults: 5,
    });

    const result = await executeNode(search, { payload: { query: 'Ada Lovelace', limit: 3 } }, {
      searchAPI,
    });

    expect(searchAPI).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'wikipedia',
      searchMode: 'assisted',
      query: 'Ada Lovelace',
      limit: 3,
    }));
    expect(result.meta.search.resultCount).toBe(1);
  });

  it('gives Local RAG filename and PDF-page citation rules instead of URL requests', () => {
    const agent = node('agent', 'agent', 'Rules Researcher');
    const search = node('search', 'search', 'Rules RAG', {
      provider: 'localrag',
      functionName: 'search_rules',
      usageInstructions: 'Preserve useful source URLs in the final response.',
      maxResults: 5,
    });
    const edges = [{ id: 'rag-edge', source: 'agent', target: 'search', data: { channel: 'tool' } }];
    const connectedTools = connectedToolsFor(agent, [agent, search], edges);
    const instructions = connectedSearchInstructions(connectedTools);

    expect(connectedTools[0].definition.description).toContain('not web URLs');
    expect(connectedTools[0].definition.description).toContain('PDF-page citations');
    expect(instructions).toContain('do not request or invent web URLs');
    expect(instructions).toContain('document filename and PDF page number');
  });

  it('does not schedule Tool capability edges after an Agent completes', () => {
    const agent = node('agent', 'agent', 'Agent');
    const tool = node('tool', 'tool', 'Tool');
    const output = node('output', 'output', 'Output');
    const edges = [
      { id: 'tool', source: 'agent', target: 'tool', data: { channel: 'tool' } },
      { id: 'output', source: 'agent', target: 'output', data: { channel: 'data' } },
    ];

    expect(nextTargets(agent, { payload: 'done' }, [agent, tool, output], edges)
      .map((entry) => entry.node.id)).toEqual(['output']);
  });

  it('suspends a Manual User until prose is supplied', async () => {
    const requestUserInput = vi.fn().mockResolvedValue('I would inspect the door first.');
    const user = node('user', 'user', 'Human Player', { mode: 'manual' });

    const result = await executeNode(user, { payload: 'What do you do?' }, {
      requestUserInput,
      readableContext: { 'Scout Output': 'The hinges look trapped.' },
    });

    expect(requestUserInput).toHaveBeenCalledWith({
      input: 'What do you do?',
      readableContext: { 'Scout Output': 'The hinges look trapped.' },
    });
    expect(result).toMatchObject({
      payload: 'I would inspect the door first.',
      meta: { userMode: 'manual' },
    });
  });

  it('gives Auto User explicit observations and enforces prose output', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"choice":"left"}', model: 'test' })
      .mockResolvedValueOnce({
        text: 'I would take the left path because the scout found fresh tracks there.',
        model: 'test',
        usage: { total_tokens: 42 },
      });
    const user = node('user', 'user', 'Simulated Player', {
      mode: 'auto',
      systemPrompt: 'Play a cautious explorer.',
      reasoningEffort: 'low',
      maxOutputTokens: 300,
    });

    const result = await executeNode(user, { payload: 'Choose a path.' }, {
      callLLM,
      readableContext: { 'Scout Output': 'Fresh tracks lead left.' },
    });

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(callLLM.mock.calls[0][0].prompt).toContain('Fresh tracks lead left.');
    expect(callLLM.mock.calls[0][0].systemPrompt).toContain('Never output JSON');
    expect(result.payload).toContain('left path');
    expect(result.meta.userMode).toBe('auto');
  });

  it('collects only outputs connected to a User Input read handle', () => {
    const observer = node('observer', 'output', 'Observed Result');
    const ignored = node('ignored', 'output', 'Ignored Result');
    const user = node('user', 'user', 'User Input');
    const memory = node('memory', 'memory', 'Known Facts', { initialValue: '' });
    const edges = [
      { source: 'observer', target: 'user', data: { channel: 'read' } },
      { source: 'ignored', target: 'user', data: { channel: 'data' } },
      { source: 'memory', target: 'user', data: { channel: 'read' } },
    ];

    expect(
      readableContextFor(
        user,
        [observer, ignored, user, memory],
        edges,
        { memory: ['Remember this.'] },
        { observer: 'Visible output.', ignored: 'Hidden output.' },
      ),
    ).toEqual({
      'Observed Result': 'Visible output.',
      'Known Facts': ['Remember this.'],
    });
  });

  it('recognizes prose while rejecting structured output', () => {
    expect(isProseResponse('I choose to wait and listen.')).toBe(true);
    expect(isProseResponse('{"choice":"wait"}')).toBe(false);
    expect(isProseResponse('```json\n{}\n```')).toBe(false);
    expect(isProseResponse('')).toBe(false);
  });

  it('executes generated routers and selects stable target ids', async () => {
    const runRouter = vi.fn().mockResolvedValue({
      payload: 'rewritten',
      targetIds: ['archive'],
      drop: false,
      state: { visits: 1 },
    });
    const router = node('router', 'logic', 'Router', {
      operation: 'generated',
      generatedCode: 'function route() {}',
    });
    const review = node('review', 'output', 'Review');
    const archive = node('archive', 'output', 'Archive');
    const edges = [
      { id: 'a', source: 'router', target: 'review', data: { channel: 'data' } },
      { id: 'b', source: 'router', target: 'archive', data: { channel: 'data' } },
    ];
    const routerState = {};
    const result = await executeNode(router, { payload: 'input' }, {
      memory: {},
      readableMemory: {},
      routerState,
      routerContext: routerContextFor(router, [router, review, archive], edges),
      runRouter,
      callLLM: vi.fn(),
    });

    expect(result.targetIds).toEqual(['archive']);
    expect(result.payload).toBe('rewritten');
    expect(routerState.router).toEqual({ visits: 1 });
    expect(nextTargets(router, result, [router, review, archive], edges).map((entry) => entry.node.id))
      .toEqual(['archive']);
  });

  it('treats an empty generated target list as no route', () => {
    const router = node('router', 'logic', 'Router');
    const output = node('output', 'output', 'Output');
    const edges = [
      { id: 'edge', source: 'router', target: 'output', data: { channel: 'data' } },
    ];

    expect(nextTargets(router, { payload: 'x', targetIds: [] }, [router, output], edges))
      .toEqual([]);
  });

  it('allows a governor path until its activation limit is reached', async () => {
    const governor = node('governor', 'governor', 'Loop Governor', {
      maxActivations: 3,
      stopPhrase: '',
    });
    const context = { governorState: {} };

    const first = await executeNode(governor, { payload: 'again' }, context);
    const second = await executeNode(governor, { payload: 'again' }, context);
    const third = await executeNode(governor, { payload: 'again' }, context);

    expect(first.blocked).toBe(false);
    expect(second.blocked).toBe(false);
    expect(third.blocked).toBe(true);
    expect(third.meta.governor).toMatchObject({
      activations: 3,
      reason: 'activation_limit',
      remaining: 0,
    });
  });

  it('lets a governor stop immediately when its phrase appears', async () => {
    const governor = node('governor', 'governor', 'Loop Governor', {
      maxActivations: 50,
      stopPhrase: 'task complete',
    });
    const result = await executeNode(
      governor,
      { payload: 'The task complete signal arrived.' },
      { governorState: {} },
    );

    expect(result.blocked).toBe(true);
    expect(result.meta.governor.reason).toBe('stop_phrase');
  });
});
