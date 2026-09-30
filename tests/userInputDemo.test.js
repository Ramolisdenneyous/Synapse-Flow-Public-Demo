import { describe, expect, it } from 'vitest';
import { createUserInputDemo } from '../scripts/build-user-input-demo.mjs';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';

describe('User Input demonstration harness', () => {
  it('contains separate execution and observation connections', () => {
    const harness = createUserInputDemo();
    const user = harness.nodes.find(
      (node) => node.id === 'user-demo-participant',
    );
    const execution = harness.edges.find(
      (edge) => edge.id === 'user-demo-edge-scene-participant',
    );
    const observation = harness.edges.find(
      (edge) => edge.id === 'user-demo-edge-observer-read',
    );

    expect(user.data.config.mode).toBe('manual');
    expect(execution).toMatchObject({
      channel: 'data',
      targetHandle: 'input',
    });
    expect(observation).toMatchObject({
      channel: 'read',
      targetHandle: 'read',
    });
    expect(
      diagnoseGraph(
        harness.nodes,
        harness.edges.map((edge) => ({
          ...edge,
          data: { channel: edge.channel },
        })),
      ).some((diagnostic) => diagnostic.severity === 'error'),
    ).toBe(false);
  });
});
