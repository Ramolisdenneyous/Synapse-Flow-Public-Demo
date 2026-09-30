import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGraphMarkdown } from '../src/model/exportMarkdown.js';

const SIDES = ['friendly', 'opposition'];
const SLOT_NUMBERS = Array.from({ length: 10 }, (_, index) => index + 1);

export function slotNodeId(side, number) {
  return `dc-cap-${side}-${String(number).padStart(2, '0')}`;
}

export const CAPACITY_ENGINE_CODE = `function route(input, context, state) {
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function boundedCount(value) {
    var number = Number(value);
    if (!Number.isInteger(number)) return 2;
    return Math.max(2, Math.min(10, number));
  }
  function slotId(side, number) {
    var suffix = number < 10 ? '0' + number : String(number);
    return 'dc-cap-' + side + '-' + suffix;
  }
  function roleFor(number) {
    var roles = ['infantry', 'direct_attack', 'support', 'flanker', 'blocker'];
    return roles[(number - 1) % roles.length];
  }
  function doctrineFor(side, number) {
    var friendly = ['protect_commander', 'continue_objective', 'preserve_signal'];
    var opposition = ['balanced', 'aggressive', 'defensive'];
    var list = side === 'friendly' ? friendly : opposition;
    return list[(number - 1) % list.length];
  }
  function buildRoster(friendlyCount, oppositionCount) {
    var units = [];
    var counts = { friendly: friendlyCount, opposition: oppositionCount };
    ['friendly', 'opposition'].forEach(function (side) {
      for (var number = 1; number <= counts[side]; number += 1) {
        var padded = number < 10 ? '0' + number : String(number);
        units.push({
          agent_id: 'battle-agent-' + side + '-' + padded,
          unit_id: side + '-unit-' + padded,
          slot_node_id: slotId(side, number),
          side: side,
          display_name: (side === 'friendly' ? 'Coalition Unit ' : 'Opposition Unit ') + padded,
          role: roleFor(number),
          doctrine: doctrineFor(side, number),
          alive: true,
          active: true,
          prompt_version: 'dc-tactical-v1'
        });
      }
    });
    return units;
  }
  function registrySnapshot(s) {
    return {
      type: 'battle_agent_registry',
      battle_id: s.battleId,
      capacity: { maximum_identities: 20, maximum_per_side: 10, maximum_provider_requests_in_flight: 5 },
      deployed_counts: clone(s.deployedCounts),
      active_identity_count: s.roster.length,
      identities: clone(s.roster),
      production_contract: 'Persist a dynamic collection of unit identities. Synapse slots visualize capacity and must not become fixed production classes, columns, processes, or deployment rows.'
    };
  }
  function commanderBrief(s) {
    return {
      type: 'capacity_drill_commander_brief',
      battle_id: s.battleId,
      deployed_counts: clone(s.deployedCounts),
      active_identity_count: s.roster.length,
      maximum_identity_count: 20,
      request: 'Give one concise global directive in prose. The drill will activate every deployed non-Commander identity exactly once.'
    };
  }
  function makeOptions(s, actor, activationId) {
    var enemy = s.roster.filter(function (unit) { return unit.side !== actor.side && unit.alive; })[0];
    var options = [
      { option_id: activationId + ':objective', tactical_intent: 'continue_objective', label: 'Advance the mission objective', execution_plan_id: 'plan-objective-' + actor.unit_id },
      { option_id: activationId + ':cover', tactical_intent: 'nearest_cover', label: 'Move to the nearest legal cover', execution_plan_id: 'plan-cover-' + actor.unit_id },
      { option_id: activationId + ':hold', tactical_intent: 'hold', label: 'Hold position and preserve readiness', execution_plan_id: 'plan-hold-' + actor.unit_id }
    ];
    if (enemy) options.unshift({ option_id: activationId + ':engage:' + enemy.unit_id, tactical_intent: 'next_best_target', label: 'Engage an offered visible target', execution_plan_id: 'plan-engage-' + actor.unit_id, target_id: enemy.unit_id });
    return options;
  }
  function activationRequest(s, retryReason) {
    var actor = s.roster[s.activationIndex];
    if (!retryReason) {
      s.activationSerial += 1;
      s.currentActor = clone(actor);
      s.currentActivationId = 'capacity-act-' + s.activationSerial + '-' + actor.unit_id;
      s.currentOptions = makeOptions(s, actor, s.currentActivationId);
      s.retryCount = 0;
      s.phase = 'awaiting_selection';
    }
    return {
      type: retryReason ? 'capacity_selection_retry' : 'capacity_activation_request',
      battle_id: s.battleId,
      activation_id: s.currentActivationId,
      activation_number: s.activationIndex + 1,
      activation_total: s.roster.length,
      actor: clone(s.currentActor),
      directive: s.currentActor.side === 'friendly' ? s.directive : null,
      legal_options: clone(s.currentOptions),
      retry_reason: retryReason || null,
      concurrency_contract: { persistent_identity_count: s.roster.length, maximum_provider_requests_in_flight: 5, commit_mode: 'authoritative_initiative_order' },
      instruction: 'Call select_tactical_option exactly once using this activation_id and one offered option_id. Do not invent mechanics or state.'
    };
  }
  function fallbackOption(options, policy) {
    var intent = { next_best_target: 'next_best_target', nearest_cover: 'nearest_cover', continue_objective: 'continue_objective', return_to_signal: 'nearest_cover', hold: 'hold' }[policy] || 'hold';
    return options.filter(function (option) { return option.tactical_intent === intent; })[0] || options[0];
  }

  var s = state && typeof state === 'object' && !Array.isArray(state) ? clone(state) : {};
  if (s.phase === 'complete') return { targetIds: [], drop: true, state: s };

  if (!s.initialized) {
    var config = input && typeof input === 'object' ? input : {};
    if (typeof input === 'string') {
      var friendlyMatch = input.match(/friendly\\s*=\\s*(\\d+)/i);
      var oppositionMatch = input.match(/opposition\\s*=\\s*(\\d+)/i);
      config = {
        friendlyUnitCount: friendlyMatch ? Number(friendlyMatch[1]) : 2,
        oppositionUnitCount: oppositionMatch ? Number(oppositionMatch[1]) : 2
      };
    }
    var friendlyCount = boundedCount(config.friendlyUnitCount);
    var oppositionCount = boundedCount(config.oppositionUnitCount);
    s.initialized = true;
    s.battleId = 'dc-capacity-' + String(context.runtime && context.runtime.invocationId || 'drill');
    s.deployedCounts = { friendly: friendlyCount, opposition: oppositionCount };
    s.roster = buildRoster(friendlyCount, oppositionCount);
    s.directive = 'Protect the Commander, preserve signal, and contest the mission objective.';
    s.activationIndex = 0;
    s.activationSerial = 0;
    s.committed = [];
    s.phase = 'awaiting_commander';
    var brief = commanderBrief(s);
    brief.registry = registrySnapshot(s);
    return { targetIds: ['dc-cap-commander', 'dc-cap-registry', 'dc-cap-live'], payload: brief, state: s };
  }

  if (s.phase === 'awaiting_commander') {
    if (typeof input !== 'string' || !input.trim()) {
      return { targetIds: ['dc-cap-commander'], payload: commanderBrief(s), state: s };
    }
    s.directive = input.trim();
    return { targetIds: ['dc-cap-context-builder'], payload: activationRequest(s, null), state: s };
  }

  if (s.phase === 'awaiting_selection') {
    var calls = input && input.type === 'agent_tool_call_envelope' && Array.isArray(input.toolCalls) ? input.toolCalls : [];
    var call = calls.length === 1 ? calls[0] : null;
    var args = call && call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
    var option = s.currentOptions.filter(function (item) { return item.option_id === args.option_id; })[0];
    var valid = Boolean(call && call.name === 'select_tactical_option' && args.activation_id === s.currentActivationId && option);
    if (!valid && s.retryCount < 1) {
      s.retryCount += 1;
      return { targetIds: ['dc-cap-context-builder'], payload: activationRequest(s, 'Selection was missing, stale, malformed, or not offered. Retry once.'), state: s };
    }
    var selected = valid ? option : fallbackOption(s.currentOptions, args.fallback_policy || 'hold');
    var committed = {
      type: 'capacity_activation_committed',
      battle_id: s.battleId,
      event_sequence: s.committed.length + 1,
      activation_id: s.currentActivationId,
      actor: clone(s.currentActor),
      selected_option: clone(selected),
      fallback_used: !valid,
      diagnostic_reason: valid ? String(args.reason || '') : 'Deterministic fallback committed after one failed retry.',
      production_note: 'This capacity drill commits an offered execution-plan ID. The production backend must revalidate and execute the full legal plan atomically.'
    };
    s.committed.push(clone(committed));
    s.phase = 'awaiting_commit_fanout';
    return { targetIds: ['dc-cap-post-commit'], payload: committed, state: s };
  }

  if (s.phase === 'awaiting_commit_fanout' && input && input.type === 'capacity_activation_committed') {
    s.activationIndex += 1;
    if (s.activationIndex >= s.roster.length) {
      s.phase = 'complete';
      return {
        targetIds: ['dc-cap-post-commit'],
        payload: {
          type: 'CAPACITY_DRILL_COMPLETE',
          battle_id: s.battleId,
          deployed_counts: clone(s.deployedCounts),
          active_identity_count: s.roster.length,
          committed_activation_count: s.committed.length,
          unique_agent_ids: s.committed.map(function (event) { return event.actor.agent_id; }),
          maximum_provider_requests_in_flight: 5,
          result: 'Every deployed identity completed exactly one governed activation.',
          production_contract: 'Create identities dynamically from deployed units. Do not encode the twenty Synapse slots as fixed production workers.'
        },
        state: s
      };
    }
    return { targetIds: ['dc-cap-context-builder'], payload: activationRequest(s, null), state: s };
  }

  return { targetIds: [], drop: true, state: s };
}`;

export const CAPACITY_CONTEXT_CODE = `function route(input, context, state) {
  if (!input || (input.type !== 'capacity_activation_request' && input.type !== 'capacity_selection_retry')) {
    return { targetIds: [], drop: true, state: state || {} };
  }
  var target = input.actor && input.actor.slot_node_id;
  var allowed = context.targets.filter(function (edge) { return edge.node && edge.node.id === target; });
  if (allowed.length !== 1) return { targetIds: [], drop: true, state: state || {} };
  return { targetIds: [target], payload: input, state: state || {} };
}`;

export const CAPACITY_POST_COMMIT_CODE = `function route(input, context, state) {
  if (!input || (input.type !== 'capacity_activation_committed' && input.type !== 'CAPACITY_DRILL_COMPLETE')) {
    return { targetIds: [], drop: true, state: state || {} };
  }
  var targets = ['dc-cap-ledger', 'dc-cap-governor'];
  if (input.type === 'capacity_activation_committed' && input.event_sequence === 1 && input.actor && input.actor.side === 'friendly') targets.push('dc-cap-radio');
  if (input.type === 'CAPACITY_DRILL_COMPLETE') targets.push('dc-cap-final');
  return { targetIds: targets, payload: input, state: state || {} };
}`;

const TOOL_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    activation_id: { type: 'string' },
    option_id: { type: 'string' },
    fallback_policy: { type: 'string', enum: ['next_best_target', 'nearest_cover', 'continue_objective', 'return_to_signal', 'hold'] },
    reason: { type: 'string' },
  },
  required: ['activation_id', 'option_id', 'fallback_policy', 'reason'],
  additionalProperties: false,
}, null, 2);

function node(id, kind, label, description, position, config, inputType = 'event', outputType = 'event') {
  return { id, type: 'synapseNode', position, data: { kind, label, description, inputType, outputType, config } };
}

function edge(id, source, target, channel = 'data', targetHandle) {
  return { id, source, target, ...(targetHandle ? { targetHandle } : {}), type: 'smoothstep', label: channel, data: { channel } };
}

function agentSlot(side, number, x, y) {
  const padded = String(number).padStart(2, '0');
  const label = `${side === 'friendly' ? 'Friendly' : 'Opposition'} Agent Slot ${padded}`;
  return node(
    slotNodeId(side, number),
    'agent',
    label,
    `Capacity-test execution slot ${padded} for one dynamically assigned ${side} identity. This widget is not a fixed production Agent class.`,
    { x, y },
    {
      systemPrompt: `ROLE\nYou execute one tactical decision for the persistent unit identity supplied in the incoming actor object. The identity, side, role, doctrine, and agent_id are dynamic battle data. Do not assume this canvas slot has a permanent unit persona.\n\nTASK\nChoose exactly one option from legal_options for the active identity. Friendly identities follow the quoted Commander directive when legal. Opposition identities follow their supplied doctrine.\n\nBOUNDARIES\n- Copy activation_id and one offered option_id exactly.\n- Never invent paths, coordinates, targets, dice, damage, state, identities, or tools.\n- Do not act for another slot or identity.\n- The Tool call is provisional until backend validation and commit.\n\nOUTPUT\nCall select_tactical_option exactly once with a short diagnostic reason. After acknowledgement, return a short sentence; downstream receives the structured Tool-call envelope.`,
      reasoningEffort: 'low',
      maxOutputTokens: 350,
      requireToolCall: true,
      outputMode: 'tool_call',
    },
    'capacity_activation_request',
    'agent_tool_call_envelope',
  );
}

export function createDroneCommanderCapacityHarness(options = {}) {
  const defaultFriendly = Number.isInteger(options.friendlyUnitCount) ? options.friendlyUnitCount : 2;
  const defaultOpposition = Number.isInteger(options.oppositionUnitCount) ? options.oppositionUnitCount : 2;
  const agentNodes = SIDES.flatMap((side, sideIndex) => SLOT_NUMBERS.map((number) =>
    agentSlot(side, number, 1280 + sideIndex * 420, 40 + (number - 1) * 150)));

  const nodes = [
    node('dc-cap-start', 'trigger', 'Configure 4-20 Agent Drill', 'Starts a one-round capacity drill with 2-10 deployed unit identities per side.', { x: 30, y: 360 }, {
      payload: `CAPACITY_DRILL friendly=${defaultFriendly} opposition=${defaultOpposition}`,
      continueState: false,
    }),
    node('dc-cap-engine', 'logic', 'Dynamic Battle Orchestrator', 'Creates 4-20 persistent identities from deployment data and owns activation, validation, fallback, commit order, and drill completion.', { x: 330, y: 360 }, {
      operation: 'generated',
      routerPrompt: `Build a one-round Drone Commander capacity drill. Input from dc-cap-start is the editable string "CAPACITY_DRILL friendly=N opposition=N"; parse each integer and clamp it to 2-10. Also accept an equivalent object fixture in automated tests. Create a dynamic roster of 4-20 persistent identity records; never create fixed production classes from the canvas slots. Send a Commander brief and registry snapshot, then accept one prose directive. Activate every deployed identity exactly once in authoritative order by sending a capacity_activation_request to dc-cap-context-builder. Accept agent_tool_call_envelope responses only through dc-cap-governor. Validate exactly one select_tactical_option call, current activation_id, and offered option_id. Retry once without advancing, then commit a deterministic fallback. Send each committed event to dc-cap-post-commit and wait for its governed return before advancing. After all active identities commit, emit CAPACITY_DRILL_COMPLETE exactly once. The production architecture supports up to 20 identities but at most five provider requests in flight; this serial drill is the correctness baseline. Stable routes are dc-cap-commander, dc-cap-registry, dc-cap-live, dc-cap-context-builder, and dc-cap-post-commit.`,
      generatedCode: CAPACITY_ENGINE_CODE,
      generatedSummary: 'Dynamic 4-20 identity registry and one-round serial capacity drill with strict selection validation and deterministic fallback.',
      generatedAt: '2026-08-01T00:00:00.000Z',
      generatedJobId: 'codex-drone-commander-capacity-v1',
      generatedAssumptions: [
        'Twenty canvas Agent slots visualize maximum capacity; production creates identities dynamically from deployed units.',
        'One round is sufficient to prove every configured identity can activate within Synapse Flow event limits.',
        'Serial execution is the correctness baseline; production prefetch is a later optimization capped at five requests.',
      ],
      generatedTests: [
        { name: 'minimum 2v2 creates four identities', activeIdentityCount: 4 },
        { name: 'uneven 3v7 creates ten identities', activeIdentityCount: 10 },
        { name: 'maximum 10v10 creates twenty identities', activeIdentityCount: 20 },
      ],
      generatedVersions: [], rules: '', template: '{{input}}',
    }),
    node('dc-cap-commander', 'user', 'Capacity Drill Commander', 'Supplies one natural-language directive before the deployed identity set activates.', { x: 650, y: 50 }, {
      mode: 'manual',
      systemPrompt: 'Act as the human Drone Commander. Give one concise intent-level directive in prose. Do not output JSON, code, coordinates, dice, or mechanical outcomes.',
      reasoningEffort: 'low', maxOutputTokens: 250,
    }, 'capacity_drill_commander_brief', 'message'),
    node('dc-cap-registry', 'memory', 'Dynamic Battle Agent Registry', 'Displays the deployed 4-20 identity records and the explicit dynamic-production contract.', { x: 650, y: 220 }, {
      operation: 'replace', initialValue: 'No deployment has been created.',
    }, 'memory_write', 'memory_read'),
    node('dc-cap-directive', 'memory', 'Locked Capacity Directive', 'Stores the exact Commander prose for inspectability; active friendly context also carries it directly.', { x: 650, y: 390 }, {
      operation: 'replace', initialValue: 'Protect the Commander and continue the objective.',
    }, 'memory_write', 'memory_read'),
    node('dc-cap-governor', 'governor', 'Capacity Execution Governor', 'Bounds every response and committed-event continuation and blocks the completion event.', { x: 650, y: 560 }, {
      maxActivations: 50, stopPhrase: 'CAPACITY_DRILL_COMPLETE',
    }),
    node('dc-cap-context-builder', 'logic', 'Dynamic Context Builder', 'Routes the trusted activation package to the one slot assigned to the active identity.', { x: 970, y: 360 }, {
      operation: 'generated',
      routerPrompt: 'Accept only capacity_activation_request or capacity_selection_retry objects. Read actor.slot_node_id and route to exactly that connected slot. Reject any missing, unknown, or multiply matched slot. Preserve the payload. Canvas slots are capacity fixtures, not fixed production identities.',
      generatedCode: CAPACITY_CONTEXT_CODE,
      generatedSummary: 'Exact dynamic identity-to-capacity-slot dispatcher.',
      generatedAt: '2026-08-01T00:00:00.000Z', generatedJobId: 'codex-capacity-context-v1',
      generatedAssumptions: ['The Orchestrator assigns only connected slot IDs from the validated deployment registry.'],
      generatedTests: [{ name: 'routes one active identity to one exact slot' }],
      generatedVersions: [], rules: '', template: '{{input}}',
    }),
    ...agentNodes,
    node('dc-cap-selection-tool', 'tool', 'Select Capacity Tactical Option', 'Records one provisional opaque option selection; it does not resolve mechanics.', { x: 2130, y: 360 }, {
      mode: 'mock', mockResponse: '{"acceptedForValidation":true,"authoritative":false}', behaviorPrompt: '',
      functionName: 'select_tactical_option',
      functionDescription: 'Select exactly one offered tactical option for the supplied dynamic unit identity. The backend must validate before commit.',
      parametersSchema: TOOL_SCHEMA,
    }, 'tool_request', 'tool_result'),
    node('dc-cap-post-commit', 'logic', 'Capacity Post-Commit Bus', 'Records committed events, samples the radio path once, and returns through the Governor before the next identity.', { x: 2400, y: 360 }, {
      operation: 'generated',
      routerPrompt: 'Accept capacity_activation_committed or CAPACITY_DRILL_COMPLETE. Always preserve and route to dc-cap-ledger and dc-cap-governor. To keep a 10v10 drill below the 200-event safety limit while proving the branch, route only the first committed friendly event (event_sequence 1) to dc-cap-radio. Production creates radio independently after every eligible friendly commit. Completion also routes to dc-cap-final. Never alter mechanics.',
      generatedCode: CAPACITY_POST_COMMIT_CODE,
      generatedSummary: 'Bounded post-commit projection and continuation bus.',
      generatedAt: '2026-08-01T00:00:00.000Z', generatedJobId: 'codex-capacity-post-v1',
      generatedAssumptions: ['Opposition actions are represented by system events in the ledger and do not generate radio.', 'The capacity drill samples friendly radio once; the production harness composes it after every eligible friendly commit without blocking mechanics.'],
      generatedTests: [{ name: 'friendly gets radio' }, { name: 'completion reaches final and Governor' }],
      generatedVersions: [], rules: '', template: '{{input}}',
    }),
    node('dc-cap-radio', 'agent', 'Capacity Friendly Radio Sample', 'Proves the separate post-commit radio branch once without consuming full-capacity event headroom.', { x: 2700, y: 80 }, {
      systemPrompt: 'Write one friendly post-resolution radio sentence under 20 words using only the committed event. No JSON, hidden information, or invented outcome.',
      reasoningEffort: 'low', maxOutputTokens: 100, requireToolCall: false, outputMode: 'text',
    }, 'capacity_activation_committed', 'message'),
    node('dc-cap-communications', 'memory', 'Capacity Communications', 'Stores friendly radio without feeding it into tactical authority.', { x: 3000, y: 80 }, {
      operation: 'append', initialValue: 'Capacity drill communications opened.',
    }, 'memory_write', 'memory_read'),
    node('dc-cap-ledger', 'memory', 'Capacity Commit Ledger', 'Stores each authoritative committed activation and the completion event.', { x: 2700, y: 360 }, {
      operation: 'append', initialValue: 'No capacity activations committed.',
    }, 'memory_write', 'memory_read'),
    node('dc-cap-live', 'output', 'Capacity Configuration', 'Displays the configured deployment and dynamic registry at drill start.', { x: 970, y: 90 }, {}, 'event', 'none'),
    node('dc-cap-final', 'output', '4-20 Agent Capacity Result', 'Displays configured counts, unique identities, and exact committed activation count.', { x: 3000, y: 360 }, {}, 'CAPACITY_DRILL_COMPLETE', 'none'),
  ];

  const edges = [
    edge('dc-cap-edge-start-engine', 'dc-cap-start', 'dc-cap-engine', 'trigger'),
    edge('dc-cap-edge-engine-commander', 'dc-cap-engine', 'dc-cap-commander'),
    edge('dc-cap-edge-engine-registry', 'dc-cap-engine', 'dc-cap-registry', 'write'),
    edge('dc-cap-edge-engine-live', 'dc-cap-engine', 'dc-cap-live'),
    edge('dc-cap-edge-commander-directive', 'dc-cap-commander', 'dc-cap-directive', 'write'),
    edge('dc-cap-edge-commander-governor', 'dc-cap-commander', 'dc-cap-governor'),
    edge('dc-cap-edge-governor-engine', 'dc-cap-governor', 'dc-cap-engine'),
    edge('dc-cap-edge-engine-context', 'dc-cap-engine', 'dc-cap-context-builder'),
    ...agentNodes.map((agent) => edge(`dc-cap-edge-context-${agent.id}`, 'dc-cap-context-builder', agent.id)),
    ...agentNodes.map((agent) => edge(`dc-cap-edge-${agent.id}-governor`, agent.id, 'dc-cap-governor')),
    ...agentNodes.map((agent) => edge(`dc-cap-edge-${agent.id}-tool`, agent.id, 'dc-cap-selection-tool', 'tool')),
    edge('dc-cap-edge-engine-post', 'dc-cap-engine', 'dc-cap-post-commit'),
    edge('dc-cap-edge-post-ledger', 'dc-cap-post-commit', 'dc-cap-ledger', 'write'),
    edge('dc-cap-edge-post-governor', 'dc-cap-post-commit', 'dc-cap-governor'),
    edge('dc-cap-edge-post-radio', 'dc-cap-post-commit', 'dc-cap-radio'),
    edge('dc-cap-edge-post-final', 'dc-cap-post-commit', 'dc-cap-final'),
    edge('dc-cap-edge-radio-communications', 'dc-cap-radio', 'dc-cap-communications', 'write'),
  ];

  return { format: 'synapse-flow/harness', version: 2, name: 'Drone Commander - Dynamic 4-20 Agent Capacity Harness', nodes, edges };
}

export async function writeDroneCommanderCapacityHarness(projectPath, exportPath) {
  const harness = createDroneCommanderCapacityHarness();
  await mkdir(path.dirname(projectPath), { recursive: true });
  await writeFile(projectPath, JSON.stringify(harness, null, 2), 'utf8');
  const warning = `# Capacity Interpretation Warning\n\nThe twenty Luna Agent widgets in this Synapse graph are test slots that make the supported 4-20 identity range visible and executable. They are not a production class diagram. The implementation must create one persistent identity record per deployed non-Commander unit in a dynamic collection, dispatch the active identity through shared orchestration and provider services, cap provider concurrency at five, and preserve backend-controlled initiative and commit order. Do not create twenty fixed worker classes, database columns, queues, or mandatory deployment records.\n\n`;
  await writeFile(exportPath, warning + exportGraphMarkdown(harness), 'utf8');
  return harness;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  const projectPath = path.resolve('examples/drone-commander-4-20-agent-capacity.synapse.json');
  const exportPath = path.resolve('examples/drone-commander-4-20-agent-capacity-implementation.md');
  await writeDroneCommanderCapacityHarness(projectPath, exportPath);
  console.log(`Wrote ${projectPath}`);
  console.log(`Wrote ${exportPath}`);
}
