import { describe, expect, it } from 'vitest';
import { createNode } from '../src/model/catalog.js';
import {
  continuationGraphKey,
  initializeRunState,
} from '../src/engine/continuation.js';

describe('run continuation state', () => {
  it('preserves only current graph Memory and Router state when requested', () => {
    const memory = createNode('memory', { x: 0, y: 0 }, 'memory');
    const router = createNode('logic', { x: 0, y: 0 }, 'router');
    const state = initializeRunState([memory, router], {
      preserve: true,
      previousMemory: {
        memory: ['round one'],
        removed: ['must not leak'],
      },
      previousRouterState: {
        router: { deck: ['AS', 'KH'] },
        removed: { secret: true },
      },
    });

    expect(state.memory).toEqual({ memory: ['round one'] });
    expect(state.routerState).toEqual({ router: { deck: ['AS', 'KH'] } });
  });

  it('resets state when continuation is not allowed', () => {
    const memory = createNode('memory', { x: 0, y: 0 }, 'memory');
    memory.data.config.initialValue = 'fresh';
    const router = createNode('logic', { x: 0, y: 0 }, 'router');

    expect(initializeRunState([memory, router], {
      preserve: false,
      previousMemory: { memory: ['old'] },
      previousRouterState: { router: { round: 4 } },
    })).toEqual({
      memory: { memory: 'fresh' },
      routerState: {},
    });
  });

  it('invalidates continuation when graph contracts change but ignores layout', () => {
    const trigger = createNode('trigger', { x: 0, y: 0 }, 'trigger');
    const first = continuationGraphKey('Game', [trigger], []);
    const moved = continuationGraphKey(
      'Game',
      [{ ...trigger, position: { x: 900, y: 500 } }],
      [],
    );
    const edited = structuredClone(trigger);
    edited.data.config.payload = 'NEW ROUND';

    expect(moved).toBe(first);
    expect(continuationGraphKey('Game', [edited], [])).not.toBe(first);
  });
});
