import { describe, expect, it, vi } from 'vitest';
import { drainParallel, drainSequential } from '../src/engine/scheduler.js';

describe('session scheduler', () => {
  it('drains branched events sequentially without stranding queued nodes', async () => {
    const queue = [{ id: 'trigger', depth: 0 }];
    const visited = [];
    const children = {
      trigger: [{ id: 'agent', depth: 1 }],
      agent: [{ id: 'memory', depth: 2 }, { id: 'router', depth: 2 }],
      memory: [],
      router: [{ id: 'output', depth: 3 }],
      output: [],
    };

    const result = await drainSequential({
      sessionId: 'session-a',
      isActive: (id) => id === 'session-a',
      queue,
      processEvent: async (event) => {
        visited.push(event.id);
        return children[event.id];
      },
      wait: vi.fn().mockResolvedValue(),
    });

    expect(result.reason).toBe('complete');
    expect(queue).toEqual([]);
    expect(visited).toEqual(['trigger', 'agent', 'memory', 'router', 'output']);
  });

  it('prevents a superseded session from enqueueing into the new run', async () => {
    const queue = [{ id: 'old-trigger' }];
    let activeSession = 'old-session';

    const result = await drainSequential({
      sessionId: 'old-session',
      isActive: (id) => id === activeSession,
      queue,
      processEvent: async () => {
        activeSession = 'new-session';
        return [{ id: 'must-not-be-enqueued' }];
      },
    });

    expect(result.reason).toBe('superseded');
    expect(queue).toEqual([]);
  });

  it('runs one parallel wave together', async () => {
    const queue = [{ id: 'memory' }, { id: 'router' }];
    const visited = [];

    const result = await drainParallel({
      sessionId: 'parallel-session',
      isActive: () => true,
      queue,
      processEvent: async (event) => {
        visited.push(event.id);
        return [];
      },
    });

    expect(result.reason).toBe('complete');
    expect(visited.sort()).toEqual(['memory', 'router']);
    expect(queue).toEqual([]);
  });

  it('allows an intentional loop to continue until the run safety limit', async () => {
    const queue = [{ id: 'trigger' }];
    const visited = [];

    const result = await drainSequential({
      sessionId: 'loop-session',
      isActive: () => true,
      queue,
      processEvent: async (event) => {
        visited.push(event.id);
        return [{ id: event.id === 'trigger' ? 'agent' : 'trigger' }];
      },
      maxEvents: 12,
    });

    expect(result.reason).toBe('limit');
    expect(visited).toHaveLength(12);
    expect(queue).toHaveLength(1);
  });

  it('preserves the queue while paused and resumes the same session', async () => {
    const queue = [{ id: 'first' }, { id: 'second' }];
    const visited = [];
    let paused = true;
    const waitForResume = vi.fn(async () => {
      expect(queue.map((event) => event.id)).toEqual(['first', 'second']);
      paused = false;
    });

    const result = await drainSequential({
      sessionId: 'pause-session',
      isActive: () => true,
      isPaused: () => paused,
      waitForResume,
      queue,
      processEvent: async (event) => {
        visited.push(event.id);
        return [];
      },
    });

    expect(waitForResume).toHaveBeenCalledOnce();
    expect(visited).toEqual(['first', 'second']);
    expect(result.reason).toBe('complete');
  });

  it('keeps a Manual User event unresolved until its response arrives', async () => {
    const queue = [{ id: 'user' }];
    const visited = [];
    let releaseUser;
    let settled = false;

    const draining = drainSequential({
      sessionId: 'manual-user-session',
      isActive: () => true,
      queue,
      wait: vi.fn().mockResolvedValue(),
      processEvent: async (event) => {
        visited.push(event.id);
        if (event.id !== 'user') return [];
        return new Promise((resolve) => {
          releaseUser = () => resolve([{ id: 'after-user' }]);
        });
      },
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(queue).toEqual([]);
    expect(visited).toEqual(['user']);
    expect(settled).toBe(false);

    releaseUser();
    const result = await draining;
    expect(visited).toEqual(['user', 'after-user']);
    expect(result.reason).toBe('complete');
  });
});
