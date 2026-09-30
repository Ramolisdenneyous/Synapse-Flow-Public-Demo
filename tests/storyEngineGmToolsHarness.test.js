import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  GM_STORY_TURN_ROUTER_CODE,
  createGmToolStoryEngineHarness,
} from '../scripts/build-story-engine-gm-tools-harness.mjs';
import { connectedToolsFor, routerContextFor } from '../src/engine/executor.js';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';

function setup() {
  const harness = createGmToolStoryEngineHarness();
  const router = harness.nodes.find((node) => node.id === 'gm-story-turn-router');
  return {
    harness,
    context: routerContextFor(router, harness.nodes, harness.edges),
  };
}

async function route(input, state = {}, invocationId = 'gm-test') {
  const { context } = setup();
  return executeRouterCode({
    code: GM_STORY_TURN_ROUTER_CODE,
    input,
    context: {
      ...context,
      runtime: { invocationId, randomValue: 0.42 },
    },
    state,
  });
}

describe('GM-mediated Tool-using Story Engine harness', () => {
  it('places the Router-mediated manual GM between every action Agent', () => {
    const { harness } = setup();
    const gm = harness.nodes.find((node) => node.id === 'gm-story-user');
    const actionAgents = harness.nodes.filter(
      (node) =>
        node.data.kind === 'agent' &&
        node.id !== 'gm-story-final-narrator',
    );

    expect(gm.data.config.mode).toBe('manual');
    expect(actionAgents).toHaveLength(5);
    expect(harness.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'gm-story-turn-router',
          target: 'gm-story-user',
          data: { channel: 'data' },
        }),
      ]),
    );
    for (const agent of actionAgents) {
      expect(harness.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: agent.id,
            target: 'gm-story-turn-router',
            data: { channel: 'data' },
          }),
        ]),
      );
    }
  });

  it('gives every action Agent the same strict native Tool capability', () => {
    const { harness } = setup();
    const actionAgents = harness.nodes.filter(
      (node) =>
        node.data.kind === 'agent' &&
        node.id !== 'gm-story-final-narrator',
    );

    for (const agent of actionAgents) {
      const tools = connectedToolsFor(agent, harness.nodes, harness.edges);
      expect(agent.data.config.requireToolCall).toBe(true);
      expect(agent.data.config.systemPrompt).toContain('narrative paragraph');
      expect(agent.data.config.systemPrompt).toContain('Do not output JSON');
      expect(tools).toHaveLength(1);
      expect(tools[0].definition).toMatchObject({
        name: 'resolve_story_action',
        strict: true,
      });
      expect(tools[0].definition.parameters.required).toEqual([
        'actor',
        'action',
        'target',
        'intent',
      ]);
    }
  });

  it('briefs the GM before routing exactly one actor in strict order', async () => {
    const expected = [
      'gm-story-jannet',
      'gm-story-annie',
      'gm-story-beau',
      'gm-story-joe',
      'gm-story-opposition',
      'gm-story-jannet',
    ];
    let result = await route(
      { type: 'begin_gm_chapter', openingSituation: 'The storm begins.' },
      {},
      'opening',
    );
    expect(result.targetIds).toEqual(['gm-story-user']);
    expect(result.payload).toMatchObject({
      type: 'gm_turn_brief',
      nextActor: 'Jannet',
      upcomingTurn: 1,
    });
    let state = result.state;
    for (let index = 0; index < expected.length; index += 1) {
      result = await route(`GM direction ${index + 1}.`, state, `gm-${index}`);
      expect(result.targetIds).toEqual([expected[index]]);
      expect(result.payload).toMatchObject({
        type: 'gm_directed_turn',
        turnNumber: index + 1,
      });
      state = result.state;
      result = await route(`Actor narration ${index + 1}.`, state, `actor-${index}`);
      expect(result.targetIds).toEqual(['gm-story-user']);
      expect(result.payload).toMatchObject({
        type: 'gm_turn_brief',
        previousActorNarration: `Actor narration ${index + 1}.`,
        upcomingTurn: index + 2,
      });
      state = result.state;
    }
  });

  it('hands END CHAPTER only to final narration and permanently closes actor routing', async () => {
    const opened = await route('BEGIN_CHAPTER', {});
    const ended = await route('END CHAPTER. The beacon burns.', opened.state);
    const stale = await route('Continue anyway.', ended.state, 'after-end');

    expect(ended.targetIds).toEqual(['gm-story-final-narrator']);
    expect(ended.payload).toContain('GM ended the chapter');
    expect(stale.drop).toBe(true);
    expect(stale.targetIds).toEqual([]);
  });

  it('has no structural errors and protects its execution cycle with a Governor', () => {
    const { harness } = setup();
    const diagnostics = diagnoseGraph(harness.nodes, harness.edges);

    expect(diagnostics.some((item) => item.severity === 'error')).toBe(false);
    expect(
      diagnostics.some(
        (item) =>
          item.code === 'execution-cycle' &&
          item.message.includes('Governed loop detected'),
      ),
    ).toBe(true);
  });
});
