import { describe, expect, it } from 'vitest';
import { executeRouterCode } from '../server/routerSandbox.js';
import {
  DRONE_COMMANDER_ENGINE_CODE,
  POST_COMMIT_ROUTER_CODE,
  createDroneCommanderHarness,
} from '../scripts/build-drone-commander-harness.mjs';
import { connectedToolsFor, routerContextFor } from '../src/engine/executor.js';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';

function setup() {
  const harness = createDroneCommanderHarness();
  const engine = harness.nodes.find((node) => node.id === 'dc-engine');
  const postCommit = harness.nodes.find((node) => node.id === 'dc-post-commit-router');
  return {
    harness,
    engineContext: routerContextFor(engine, harness.nodes, harness.edges),
    postContext: routerContextFor(postCommit, harness.nodes, harness.edges),
  };
}

async function routeEngine(input, state = {}, invocationId = 'dc-test') {
  const { engineContext } = setup();
  return executeRouterCode({
    code: DRONE_COMMANDER_ENGINE_CODE,
    input,
    context: {
      ...engineContext,
      runtime: { invocationId, randomValue: 0.314159 },
    },
    state,
  });
}

describe('Drone Commander authoritative Agent harness', () => {
  it('starts with the human Commander and keeps direct mechanics outside the Agent harness', async () => {
    const result = await routeEngine({ type: 'deploy_vs', point_cap: 15 });

    expect(result.targetIds).toEqual([
      'dc-commander-user',
      'dc-event-ledger',
      'dc-live-output',
    ]);
    expect(result.payload).toMatchObject({
      type: 'commander_activation_brief',
      round: 1,
      state_version: 1,
    });
    expect(result.payload.direct_control_boundary).toContain('outside this agent harness');
  });

  it('locks Commander prose and offers one persistent unit only backend-generated options', async () => {
    const opened = await routeEngine({ type: 'deploy_vs' });
    const result = await routeEngine(
      'Protect the Commander and seize Uplink Alpha.',
      opened.state,
      'commander-directive',
    );

    expect(result.payload.type).toBe('tactical_activation_request');
    expect(result.payload.directive_locked).toBe(
      'Protect the Commander and seize Uplink Alpha.',
    );
    expect(result.payload.legal_options.length).toBeGreaterThanOrEqual(3);
    expect(result.targetIds.filter((id) => id.endsWith('-agent'))).toHaveLength(1);
    expect(result.payload.contract).toContain('Do not invent coordinates');
  });

  it('commits an exact native Tool selection and returns an atomic event to post-commit fanout', async () => {
    const opened = await routeEngine({ type: 'deploy_vs' });
    const activation = await routeEngine('Advance carefully.', opened.state, 'directive');
    const selected = activation.payload.legal_options[0];
    const result = await routeEngine(
      {
        type: 'agent_tool_call_envelope',
        finalText: 'Selection submitted.',
        toolCalls: [
          {
            callId: 'call-1',
            name: 'select_tactical_option',
            arguments: {
              activation_id: activation.payload.activation_id,
              option_id: selected.option_id,
              fallback_policy: 'continue_objective',
              reason: 'This best supports the current mission intent.',
            },
            result: { acceptedForValidation: true, authoritative: false },
          },
        ],
      },
      activation.state,
      'agent-choice',
    );

    expect(result.targetIds).toEqual(['dc-post-commit-router']);
    expect(result.payload.type).toBe('activation_committed');
    expect(result.payload.fallback_used).toBe(false);
    expect(result.payload.committed_option.option_id).toBe(selected.option_id);
    expect(result.payload.state_version).toBe(activation.payload.state_version + 1);
    expect(result.payload.mechanical_events.length).toBeGreaterThan(0);
  });

  it('retries one invalid selection without advancing, then applies deterministic fallback', async () => {
    const opened = await routeEngine({ type: 'deploy_vs' });
    const activation = await routeEngine('Contest the objective.', opened.state, 'directive');
    const invalid = {
      type: 'agent_tool_call_envelope',
      finalText: '',
      toolCalls: [{
        callId: 'bad-call',
        name: 'select_tactical_option',
        arguments: {
          activation_id: 'stale-activation',
          option_id: 'invented-option',
          fallback_policy: 'nearest_cover',
          reason: 'Bad fixture.',
        },
        result: { acceptedForValidation: true },
      }],
    };

    const retry = await routeEngine(invalid, activation.state, 'invalid-one');
    expect(retry.payload).toMatchObject({
      type: 'tactical_selection_retry',
      state_version: activation.payload.state_version,
    });
    expect(retry.payload.retry_reason).toContain('activation_id');

    const fallback = await routeEngine(invalid, retry.state, 'invalid-two');
    expect(fallback.targetIds).toEqual(['dc-post-commit-router']);
    expect(fallback.payload.fallback_used).toBe(true);
    expect(fallback.payload.committed_option.tactical_intent).toBe('nearest_cover');
  });

  it('exposes the strict native decision Tool and structured Agent output mode', () => {
    const { harness } = setup();
    const agents = harness.nodes.filter((node) =>
      ['dc-falcon-agent', 'dc-pike-agent', 'dc-red-cell-agent', 'dc-bastion-agent']
        .includes(node.id));

    for (const agent of agents) {
      const tools = connectedToolsFor(agent, harness.nodes, harness.edges);
      expect(agent.data.config).toMatchObject({
        requireToolCall: true,
        outputMode: 'tool_call',
      });
      expect(tools).toHaveLength(1);
      expect(tools[0].definition).toMatchObject({
        name: 'select_tactical_option',
        strict: true,
      });
      expect(tools[0].definition.parameters.required).toEqual([
        'activation_id',
        'option_id',
        'fallback_policy',
        'reason',
      ]);
    }
  });

  it('keeps radio separate and opposition silent in post-commit routing', async () => {
    const { postContext } = setup();
    const friendly = await executeRouterCode({
      code: POST_COMMIT_ROUTER_CODE,
      input: { type: 'activation_committed', actor: { side: 'friendly' } },
      context: { ...postContext, runtime: { invocationId: 'friendly', randomValue: 0.5 } },
      state: {},
    });
    const opposition = await executeRouterCode({
      code: POST_COMMIT_ROUTER_CODE,
      input: { type: 'activation_committed', actor: { side: 'opposition' } },
      context: { ...postContext, runtime: { invocationId: 'opposition', randomValue: 0.5 } },
      state: {},
    });

    expect(friendly.targetIds).toContain('dc-radio-agent');
    expect(friendly.targetIds).not.toContain('dc-communications');
    expect(opposition.targetIds).toContain('dc-communications');
    expect(opposition.targetIds).not.toContain('dc-radio-agent');
  });

  it('has no structural errors and protects every continuation with the Governor', () => {
    const { harness } = setup();
    const diagnostics = diagnoseGraph(harness.nodes, harness.edges);

    expect(diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(diagnostics.some((item) =>
      item.code === 'execution-cycle' && item.message.includes('Governed loop detected')))
      .toBe(true);
  });
});
