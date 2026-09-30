import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  CAPACITY_CONTEXT_CODE,
  CAPACITY_ENGINE_CODE,
  CAPACITY_POST_COMMIT_CODE,
  createDroneCommanderCapacityHarness,
  slotNodeId,
} from '../scripts/build-drone-commander-capacity-harness.mjs';
import { connectedToolsFor, routerContextFor } from '../src/engine/executor.js';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';

function setup() {
  const harness = createDroneCommanderCapacityHarness();
  const engine = harness.nodes.find((node) => node.id === 'dc-cap-engine');
  const contextBuilder = harness.nodes.find((node) => node.id === 'dc-cap-context-builder');
  return {
    harness,
    engineContext: routerContextFor(engine, harness.nodes, harness.edges),
    builderContext: routerContextFor(contextBuilder, harness.nodes, harness.edges),
  };
}

async function routeEngine(input, state = {}, invocationId = 'capacity-test') {
  const { engineContext } = setup();
  return executeRouterCode({
    code: CAPACITY_ENGINE_CODE,
    input,
    context: {
      ...engineContext,
      runtime: { invocationId, randomValue: 0.42 },
    },
    state,
  });
}

async function runCapacityDrill(friendlyUnitCount, oppositionUnitCount) {
  let result = await routeEngine({
    type: 'configure_capacity_drill',
    friendlyUnitCount,
    oppositionUnitCount,
  });
  const registry = result.payload.registry;
  result = await routeEngine('Protect the Commander and continue the objective.', result.state, 'directive');
  const activatedSlots = [];
  const committedAgents = [];

  while (result.payload.type !== 'CAPACITY_DRILL_COMPLETE') {
    expect(result.payload.type).toBe('capacity_activation_request');
    activatedSlots.push(result.payload.actor.slot_node_id);
    const option = result.payload.legal_options[0];
    const selection = await routeEngine({
      type: 'agent_tool_call_envelope',
      finalText: 'Selection submitted.',
      toolCalls: [{
        callId: `call-${result.payload.activation_id}`,
        name: 'select_tactical_option',
        arguments: {
          activation_id: result.payload.activation_id,
          option_id: option.option_id,
          fallback_policy: 'continue_objective',
          reason: 'Best offered option for the active identity.',
        },
        result: { acceptedForValidation: true },
      }],
    }, result.state, result.payload.activation_id);
    expect(selection.payload.type).toBe('capacity_activation_committed');
    committedAgents.push(selection.payload.actor.agent_id);
    result = await routeEngine(selection.payload, selection.state, `commit-${committedAgents.length}`);
  }

  return { registry, completion: result.payload, activatedSlots, committedAgents };
}

describe('Drone Commander 4-20 Agent capacity harness', () => {
  it('defaults to a visible 2v2 deployment while retaining twenty capacity slots', async () => {
    const { harness } = setup();
    const opened = await routeEngine({ type: 'configure_capacity_drill' });
    const slots = harness.nodes.filter((node) =>
      node.id.startsWith('dc-cap-friendly-') || node.id.startsWith('dc-cap-opposition-'));

    expect(slots).toHaveLength(20);
    expect(opened.payload.registry).toMatchObject({
      active_identity_count: 4,
      deployed_counts: { friendly: 2, opposition: 2 },
      capacity: {
        maximum_identities: 20,
        maximum_provider_requests_in_flight: 5,
      },
    });
  });

  it('accepts the Trigger Inspector friendly=N opposition=N text contract', async () => {
    const opened = await routeEngine('CAPACITY_DRILL friendly=10 opposition=10');

    expect(opened.payload.registry).toMatchObject({
      active_identity_count: 20,
      deployed_counts: { friendly: 10, opposition: 10 },
    });
  });

  it.each([
    { friendly: 2, opposition: 2, total: 4 },
    { friendly: 3, opposition: 7, total: 10 },
    { friendly: 10, opposition: 10, total: 20 },
  ])('activates every identity exactly once for $friendly vs $opposition', async ({ friendly, opposition, total }) => {
    const result = await runCapacityDrill(friendly, opposition);

    expect(result.registry.active_identity_count).toBe(total);
    expect(result.activatedSlots).toHaveLength(total);
    expect(new Set(result.activatedSlots).size).toBe(total);
    expect(result.committedAgents).toHaveLength(total);
    expect(new Set(result.committedAgents).size).toBe(total);
    expect(result.completion).toMatchObject({
      type: 'CAPACITY_DRILL_COMPLETE',
      active_identity_count: total,
      committed_activation_count: total,
      maximum_provider_requests_in_flight: 5,
    });
  });

  it('routes a dynamic identity only to its assigned connected capacity slot', async () => {
    const { builderContext } = setup();
    const target = slotNodeId('opposition', 10);
    const input = {
      type: 'capacity_activation_request',
      actor: { slot_node_id: target },
    };
    const result = await executeRouterCode({
      code: CAPACITY_CONTEXT_CODE,
      input,
      context: {
        ...builderContext,
        runtime: { invocationId: 'context-test', randomValue: 0.5 },
      },
      state: {},
    });

    expect(result.targetIds).toEqual([target]);
    expect(result.payload).toEqual(input);
  });

  it('samples radio once while preserving event headroom for a full-capacity run', async () => {
    const { harness } = setup();
    const post = harness.nodes.find((node) => node.id === 'dc-cap-post-commit');
    const postContext = routerContextFor(post, harness.nodes, harness.edges);
    const routePost = (event_sequence) => executeRouterCode({
      code: CAPACITY_POST_COMMIT_CODE,
      input: {
        type: 'capacity_activation_committed',
        event_sequence,
        actor: { side: 'friendly' },
      },
      context: {
        ...postContext,
        runtime: { invocationId: `post-${event_sequence}`, randomValue: 0.5 },
      },
      state: {},
    });

    expect((await routePost(1)).targetIds).toContain('dc-cap-radio');
    expect((await routePost(2)).targetIds).not.toContain('dc-cap-radio');
  });

  it('gives all twenty generic slots the same strict provisional Tool boundary', () => {
    const { harness } = setup();
    const slots = harness.nodes.filter((node) =>
      node.id.startsWith('dc-cap-friendly-') || node.id.startsWith('dc-cap-opposition-'));

    for (const slot of slots) {
      const tools = connectedToolsFor(slot, harness.nodes, harness.edges);
      expect(slot.data.config).toMatchObject({
        requireToolCall: true,
        outputMode: 'tool_call',
      });
      expect(slot.data.config.systemPrompt).toContain('dynamic battle data');
      expect(tools).toHaveLength(1);
      expect(tools[0].definition.name).toBe('select_tactical_option');
    }
  });

  it('contains no structural errors and governs the full activation cycle', () => {
    const { harness } = setup();
    const diagnostics = diagnoseGraph(harness.nodes, harness.edges);

    expect(diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(diagnostics.some((item) =>
      item.code === 'execution-cycle' && item.message.includes('Governed loop detected')))
      .toBe(true);
  });
});
