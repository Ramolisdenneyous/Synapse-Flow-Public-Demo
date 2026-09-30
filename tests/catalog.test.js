import { describe, expect, it } from 'vitest';
import {
  acceptsReadContext,
  createNode,
  inferChannel,
} from '../src/model/catalog.js';

describe('node catalog', () => {
  it('creates triggers with both incoming and outgoing event contracts', () => {
    const trigger = createNode('trigger', { x: 0, y: 0 }, 'trigger');

    expect(trigger.data.inputType).toBe('event');
    expect(trigger.data.outputType).toBe('event');
  });

  it('labels incoming trigger connections as activation channels', () => {
    const agent = createNode('agent', { x: 0, y: 0 }, 'agent');
    const trigger = createNode('trigger', { x: 0, y: 0 }, 'trigger');

    expect(inferChannel(agent, trigger)).toBe('trigger');
  });

  it('creates a governor with a deterministic default boundary', () => {
    const governor = createNode('governor', { x: 0, y: 0 }, 'governor');

    expect(governor.data.config).toEqual({
      maxActivations: 25,
      stopPhrase: '',
    });
    expect(governor.data.inputType).toBe('event');
    expect(governor.data.outputType).toBe('event');
  });

  it('creates a manual User Input node with prose output contracts', () => {
    const user = createNode('user', { x: 0, y: 0 }, 'user');

    expect(user.data.inputType).toBe('event');
    expect(user.data.outputType).toBe('message');
    expect(user.data.config.mode).toBe('manual');
    expect(user.data.outputHistory).toEqual([]);
  });

  it('uses the User Input observation handle for non-activating reads', () => {
    const source = createNode('agent', { x: 0, y: 0 }, 'agent');
    const user = createNode('user', { x: 0, y: 0 }, 'user');

    expect(inferChannel(source, user, { targetHandle: 'read' })).toBe('read');
    expect(inferChannel(source, user, { targetHandle: 'input' })).toBe('data');
  });

  it('uses Agent-to-Tool connections as non-scheduling capabilities', () => {
    const agent = createNode('agent', { x: 0, y: 0 }, 'agent');
    const tool = createNode('tool', { x: 0, y: 0 }, 'tool');
    const memory = createNode('memory', { x: 0, y: 0 }, 'memory');

    expect(inferChannel(agent, tool)).toBe('tool');
    expect(inferChannel(memory, tool)).toBe('read');
    expect(acceptsReadContext(tool)).toBe(true);
    expect(tool.data.config.functionName).toBe('prototype_tool');
  });

  it('creates API Search as an Agent capability with a live-web default', () => {
    const agent = createNode('agent', { x: 0, y: 0 }, 'agent');
    const search = createNode('search', { x: 0, y: 0 }, 'search');

    expect(inferChannel(agent, search)).toBe('tool');
    expect(search.data.config.provider).toBe('web');
    expect(search.data.config.searchMode).toBe('assisted');
    expect(search.data.config.localIndexPath).toBe('');
    expect(search.data.config.functionName).toBe('search_information');
    expect(search.data.inputType).toBe('tool_request');
    expect(search.data.outputType).toBe('tool_result');
  });
});
