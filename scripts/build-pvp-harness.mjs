import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COMBAT_ROUTER_CODE = `function route(input, context, state) {
  const agents = [
    { name: "Lumen", team: "Azure", id: "pvp-agent-lumen" },
    { name: "Spark", team: "Azure", id: "pvp-agent-spark" },
    { name: "Bolt", team: "Crimson", id: "pvp-agent-bolt" },
    { name: "Chip", team: "Crimson", id: "pvp-agent-chip" }
  ];
  const memoryId = "pvp-battle-chronicle";
  const outputId = "pvp-arena-feed";

  function permutationCount(available, slots) {
    let total = 1;
    for (let index = 0; index < slots; index += 1) total *= available - index;
    return total;
  }

  function rollInitiative(randomValue) {
    const pool = Array.from({ length: 20 }, (_, index) => index + 1);
    const totalOutcomes = permutationCount(20, agents.length);
    let outcome = Math.min(totalOutcomes - 1, Math.floor(randomValue * totalOutcomes));
    const rolls = {};

    for (let slot = 0; slot < agents.length; slot += 1) {
      const remainingSlots = agents.length - slot - 1;
      const blockSize = permutationCount(pool.length - 1, remainingSlots);
      const choice = Math.floor(outcome / blockSize);
      outcome %= blockSize;
      rolls[agents[slot].name] = pool.splice(choice, 1)[0];
    }

    const order = agents
      .map((agent) => agent.name)
      .sort((left, right) => rolls[right] - rolls[left]);
    return { rolls, order };
  }

  function canonicalName(value) {
    const match = agents.find(
      (agent) => agent.name.toLowerCase() === String(value || "").trim().toLowerCase()
    );
    return match ? match.name : "";
  }

  function parseDecision(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    const text = String(value || "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  function agentByName(name) {
    return agents.find((agent) => agent.name === name);
  }

  function livingEnemies(actor, hp) {
    const team = agentByName(actor).team;
    return agents
      .filter((agent) => agent.team !== team && hp[agent.name] > 0)
      .map((agent) => agent.name);
  }

  function livingTeams(hp) {
    return ["Azure", "Crimson"].filter((team) =>
      agents.some((agent) => agent.team === team && hp[agent.name] > 0)
    );
  }

  function nextLivingIndex(order, hp, currentIndex) {
    for (let offset = 1; offset <= order.length; offset += 1) {
      const index = (currentIndex + offset) % order.length;
      if (hp[order[index]] > 0) return index;
    }
    return currentIndex;
  }

  function publicTurn(matchState, event) {
    const actor = matchState.initiative[matchState.turnIndex];
    return {
      type: "turn",
      status: "active",
      round: matchState.round,
      turn: matchState.turn,
      actor,
      actorTeam: agentByName(actor).team,
      turnToken: matchState.turnToken,
      teams: {
        Azure: ["Lumen", "Spark"],
        Crimson: ["Bolt", "Chip"]
      },
      hp: matchState.hp,
      initiative: matchState.initiative,
      initiativeRolls: matchState.initiativeRolls,
      legalTargets: livingEnemies(actor, matchState.hp),
      lastEvent: event,
      instruction: "Return one JSON attack decision for the current actor."
    };
  }

  const startRequested =
    String(input || "").trim().toUpperCase() === "START_MATCH" ||
    (input && typeof input === "object" && input.type === "start_match");

  if (!state.initialized || startRequested) {
    const initiative = rollInitiative(context.runtime.randomValue);
    const firstActor = initiative.order[0];
    const nextState = {
      initialized: true,
      status: "active",
      hp: { Lumen: 10, Spark: 10, Bolt: 10, Chip: 10 },
      initiative: initiative.order,
      initiativeRolls: initiative.rolls,
      turnIndex: 0,
      round: 1,
      turn: 1,
      turnToken: "turn-1-" + firstActor + "-" + context.runtime.invocationId.slice(0, 8)
    };
    const event = {
      kind: "match_started",
      message: "Initiative is set. " + firstActor + " acts first."
    };
    return {
      targetIds: [agentByName(firstActor).id, memoryId, outputId],
      payload: publicTurn(nextState, event),
      state: nextState
    };
  }

  if (state.status !== "active") {
    return { drop: true, payload: input, state };
  }

  const actor = state.initiative[state.turnIndex];
  const decision = parseDecision(input);
  const claimedActor = canonicalName(decision && decision.actor);
  const target = canonicalName(decision && decision.target);
  const legalTargets = livingEnemies(actor, state.hp);
  const valid =
    decision &&
    claimedActor === actor &&
    decision.action === "attack" &&
    decision.turnToken === state.turnToken &&
    legalTargets.includes(target);

  if (!valid) {
    return {
      targetIds: [agentByName(actor).id],
      payload: {
        ...publicTurn(state, {
          kind: "invalid_decision",
          message: "The decision was invalid. Use the exact actor, token, action, and a living enemy."
        }),
        type: "retry"
      },
      state
    };
  }

  const outcome = Math.min(159, Math.floor(context.runtime.randomValue * 160));
  const attackRoll = Math.floor(outcome / 8) + 1;
  const damageRoll = (outcome % 8) + 1;
  const hit = attackRoll >= 11;
  const hp = { ...state.hp };
  const damage = hit ? damageRoll : 0;
  if (hit) hp[target] = Math.max(0, hp[target] - damage);

  const defeated = hit && hp[target] === 0;
  const event = {
    kind: "attack",
    actor,
    target,
    attackRoll,
    hit,
    damage,
    defeated,
    message: hit
      ? actor + " hit " + target + " for " + damage + " damage."
      : actor + " missed " + target + "."
  };
  const teamsAlive = livingTeams(hp);

  if (teamsAlive.length === 1) {
    const finishedState = {
      ...state,
      status: "finished",
      hp,
      turn: state.turn + 1,
      winner: teamsAlive[0],
      lastEvent: event
    };
    return {
      targetIds: [memoryId, outputId],
      payload: {
        type: "match_complete",
        status: "finished",
        winner: teamsAlive[0],
        hp,
        initiative: state.initiative,
        finalEvent: event,
        message: "Team " + teamsAlive[0] + " wins."
      },
      state: finishedState
    };
  }

  const nextIndex = nextLivingIndex(state.initiative, hp, state.turnIndex);
  const nextActor = state.initiative[nextIndex];
  const wrapped = nextIndex <= state.turnIndex;
  const nextState = {
    ...state,
    hp,
    turnIndex: nextIndex,
    round: state.round + (wrapped ? 1 : 0),
    turn: state.turn + 1,
    turnToken:
      "turn-" +
      (state.turn + 1) +
      "-" +
      nextActor +
      "-" +
      context.runtime.invocationId.slice(0, 8),
    lastEvent: event
  };

  return {
    targetIds: [agentByName(nextActor).id, memoryId, outputId],
    payload: publicTurn(nextState, event),
    state: nextState
  };
}`;

const ROUTER_PROMPT = `Run a complete two-versus-two arena match.

Combatants:
- Team Azure: Lumen and Spark.
- Team Crimson: Bolt and Chip.
- Every combatant starts with 10 HP.

On START_MATCH, create a uniformly random tie-free d20 initiative order and send
the first public turn state only to the active combatant, Battle Chronicle, and
Arena Feed. Each combatant returns strict JSON containing actor, action "attack",
target, and the supplied turnToken.

Validate that the response belongs to the current living actor and targets a
living opponent. Invalid decisions retry the same actor without advancing.
For valid attacks, uniformly map fresh runtime randomness across all d20 attack
and d8 damage pairs. Rolls of 11 or higher hit. Apply damage, remove defeated
combatants from future turns, and advance through the initiative order.

Every valid turn sends one public state snapshot to the next active combatant,
Battle Chronicle, and Arena Feed. When one team has no living combatants, send
the final result only to Battle Chronicle and Arena Feed so the queue ends.`;

function node(id, kind, label, description, position, config) {
  const contracts = {
    trigger: ['event', 'event'],
    agent: ['event', 'message'],
    logic: ['event', 'event'],
    memory: ['memory_write', 'memory_read'],
    output: ['event', 'none'],
  };
  const [inputType, outputType] = contracts[kind];
  return {
    id,
    type: 'synapseNode',
    position,
    data: {
      kind,
      label,
      description,
      inputType,
      outputType,
      config,
      status: 'idle',
      activity: '',
      lastOutput: '',
      outputHistory: [],
      memoryEntries: [],
    },
  };
}

function edge(id, source, target, channel) {
  const colors = {
    data: '#7e8a91',
    trigger: '#e6b84a',
    read: '#a78bd4',
    write: '#8d70bd',
  };
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    label: channel,
    data: { channel },
    markerEnd: { type: 'arrowclosed', color: colors[channel] },
    style: { stroke: colors[channel], strokeWidth: 2 },
    animated: false,
    selected: false,
  };
}

function combatant(id, name, team, ally, opponents, position) {
  return node(
    id,
    'agent',
    name,
    `Team ${team} combatant. Chooses one legal opponent on each assigned turn.`,
    position,
    {
      systemPrompt: `You are ${name}, a tactical combatant on Team ${team}. Your teammate is ${ally}. Your opponents are ${opponents.join(' and ')}.

You receive the authoritative public state from the Combat Engine. When type is "turn" or "retry" and actor is "${name}", choose exactly one name from legalTargets.

Return exactly one JSON object with no Markdown and no extra text:
{"actor":"${name}","action":"attack","target":"LEGAL_TARGET","turnToken":"TOKEN_FROM_INPUT"}

Copy turnToken exactly. Never invent dice rolls, damage, HP, targets, or actions. The Combat Engine resolves all rules.`,
      reasoningEffort: 'low',
      maxOutputTokens: 180,
    },
  );
}

export function createPvpHarness() {
  const nodes = [
    node(
      'pvp-start-trigger',
      'trigger',
      'Start Match',
      'Starts or resets the two-versus-two arena match.',
      { x: 40, y: 350 },
      { payload: 'START_MATCH' },
    ),
    node(
      'pvp-combat-engine',
      'logic',
      'Combat Engine',
      'Owns initiative, turn order, HP, attacks, eliminations, and victory.',
      { x: 350, y: 350 },
      {
        operation: 'generated',
        routerPrompt: ROUTER_PROMPT,
        generatedCode: COMBAT_ROUTER_CODE,
        generatedSummary:
          'Runs a validated 2v2 match with uniform initiative and attack outcomes.',
        generatedAt: '2026-07-30T00:00:00.000Z',
        generatedJobId: 'pvp-bootstrap',
        rules: '',
        template: '{{input}}',
      },
    ),
    combatant(
      'pvp-agent-lumen',
      'Lumen',
      'Azure',
      'Spark',
      ['Bolt', 'Chip'],
      { x: 720, y: 80 },
    ),
    combatant(
      'pvp-agent-spark',
      'Spark',
      'Azure',
      'Lumen',
      ['Bolt', 'Chip'],
      { x: 720, y: 260 },
    ),
    combatant(
      'pvp-agent-bolt',
      'Bolt',
      'Crimson',
      'Chip',
      ['Lumen', 'Spark'],
      { x: 720, y: 500 },
    ),
    combatant(
      'pvp-agent-chip',
      'Chip',
      'Crimson',
      'Bolt',
      ['Lumen', 'Spark'],
      { x: 720, y: 680 },
    ),
    node(
      'pvp-battle-chronicle',
      'memory',
      'Battle Chronicle',
      'Stores each authoritative public turn and the final match result.',
      { x: 1100, y: 250 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'pvp-arena-feed',
      'output',
      'Arena Feed',
      'Displays the latest public turn or final victory result.',
      { x: 1100, y: 520 },
      {},
    ),
  ];

  const edges = [
    edge('pvp-edge-start-engine', 'pvp-start-trigger', 'pvp-combat-engine', 'trigger'),
    edge('pvp-edge-engine-lumen', 'pvp-combat-engine', 'pvp-agent-lumen', 'data'),
    edge('pvp-edge-engine-spark', 'pvp-combat-engine', 'pvp-agent-spark', 'data'),
    edge('pvp-edge-engine-bolt', 'pvp-combat-engine', 'pvp-agent-bolt', 'data'),
    edge('pvp-edge-engine-chip', 'pvp-combat-engine', 'pvp-agent-chip', 'data'),
    edge('pvp-edge-lumen-engine', 'pvp-agent-lumen', 'pvp-combat-engine', 'data'),
    edge('pvp-edge-spark-engine', 'pvp-agent-spark', 'pvp-combat-engine', 'data'),
    edge('pvp-edge-bolt-engine', 'pvp-agent-bolt', 'pvp-combat-engine', 'data'),
    edge('pvp-edge-chip-engine', 'pvp-agent-chip', 'pvp-combat-engine', 'data'),
    edge('pvp-edge-engine-memory', 'pvp-combat-engine', 'pvp-battle-chronicle', 'write'),
    edge('pvp-edge-engine-output', 'pvp-combat-engine', 'pvp-arena-feed', 'data'),
  ];

  return {
    version: 1,
    name: 'Two Versus Two PVP Arena',
    nodes,
    edges,
  };
}

export async function writePvpHarness(outputPath) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(createPvpHarness(), null, 2)}\n`, 'utf8');
  return resolved;
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const output = path.resolve(here, '..', 'examples', '2v2-pvp-arena.synapse.json');
  await writePvpHarness(output);
  console.log(output);
}
