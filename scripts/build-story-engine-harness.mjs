import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORY_ENGINE_ROUTER_CODE = `function route(input, context, state) {
  const ids = {
    jannet: "story-player-jannet",
    annie: "story-player-annie",
    beau: "story-player-beau",
    joe: "story-player-joe",
    opposition: "story-opposition",
    summary: "story-summary",
    narrative: "story-narrative",
    memory: "story-structured-memory",
    archive: "story-run-archive"
  };
  const order = ["Jannet", "Annie", "Beau", "Joe", "Opposition"];
  const agentIds = {
    Jannet: ids.jannet,
    Annie: ids.annie,
    Beau: ids.beau,
    Joe: ids.joe,
    Opposition: ids.opposition
  };
  const s = state && typeof state === "object" && !Array.isArray(state)
    ? JSON.parse(JSON.stringify(state))
    : {};

  const clone = value => JSON.parse(JSON.stringify(value));
  const aliveEnemies = () => s.enemies.filter(enemy => enemy.hp > 0);
  const alivePlayers = () => Object.entries(s.party)
    .filter(([, player]) => player.hp > 0)
    .map(([name]) => name);
  const token = actor => {
    s.tokenCounter += 1;
    return "story:" + String(s.round) + ":" + actor + ":" +
      String(s.tokenCounter) + ":" + String(context.runtime.invocationId);
  };
  const appendEvent = event => {
    s.events.push({ sequence: s.events.length + 1, round: s.round, ...event });
    s.events = s.events.slice(-120);
  };
  const publicState = () => ({
    chapter: s.chapter,
    objective: s.objective,
    round: s.round,
    maxRounds: s.maxRounds,
    party: Object.fromEntries(
      Object.entries(s.party).map(([name, player]) => [
        name,
        {
          className: player.className,
          hp: player.hp,
          maxHp: player.maxHp,
          defending: Boolean(player.defending)
        }
      ])
    ),
    enemies: s.enemies.map(enemy => ({
      id: enemy.id,
      name: enemy.name,
      hp: enemy.hp,
      maxHp: enemy.maxHp
    })),
    recentEvents: s.events.slice(-10),
    durableSummaries: s.summaries.slice()
  });
  const parseObject = value => {
    if (value && typeof value === "object" && !Array.isArray(value)) return { value };
    if (typeof value !== "string") return { error: "Response must contain one JSON object." };
    let start = -1;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (start < 0) {
        if (character === "{") {
          start = index;
          depth = 1;
        }
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\\\") escaped = true;
        else if (character === "\\"") quoted = false;
      } else if (character === "\\"") {
        quoted = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return { value: JSON.parse(value.slice(start, index + 1)) };
          } catch {
            return { error: "The first complete JSON object is malformed." };
          }
        }
      }
    }
    return { error: "No complete JSON object was found." };
  };
  const random = () => {
    s.seed = (Math.imul(1664525, s.seed) + 1013904223) >>> 0;
    return s.seed / 4294967296;
  };
  const d20 = () => 1 + Math.floor(random() * 20);
  const d8 = () => 1 + Math.floor(random() * 8);
  const d6 = () => 1 + Math.floor(random() * 6);
  const currentActor = () => order[s.turnIndex];
  const nextLivingTurn = () => {
    let checked = 0;
    while (checked < order.length) {
      const actor = currentActor();
      if (actor === "Opposition") {
        if (aliveEnemies().length) return actor;
      } else if (s.party[actor].hp > 0) {
        return actor;
      }
      s.turnIndex += 1;
      if (s.turnIndex >= order.length) {
        s.turnIndex = 0;
        s.round += 1;
      }
      checked += 1;
    }
    return null;
  };
  const playerActions = actor => {
    const actions = aliveEnemies().map(enemy => ({
      action: "ATTACK",
      target: enemy.id,
      label: "Attack " + enemy.name
    }));
    if (actor === "Joe") {
      for (const [name, player] of Object.entries(s.party)) {
        if (player.hp > 0 && player.hp < player.maxHp) {
          actions.push({ action: "HEAL", target: name, label: "Heal " + name });
        }
      }
    }
    actions.push({ action: "DEFEND", target: actor, label: "Defend" });
    return actions;
  };
  const actorPayload = actor => {
    s.expectedActor = actor;
    s.turnToken = token(actor);
    if (actor === "Opposition") {
      return {
        type: "opposition_turn",
        actor,
        turnToken: s.turnToken,
        monsterActors: aliveEnemies().map(enemy => ({
          id: enemy.id,
          name: enemy.name,
          hp: enemy.hp
        })),
        legalTargets: alivePlayers(),
        publicState: publicState(),
        instruction:
          "Choose one living monster and one living player target. Return strict JSON only."
      };
    }
    return {
      type: "player_turn",
      actor,
      identity: clone(s.party[actor]),
      turnToken: s.turnToken,
      legalActions: playerActions(actor),
      publicState: publicState(),
      instruction:
        "Choose exactly one listed action and target. The engine resolves all mechanics. Return strict JSON only."
    };
  };
  const retryPayload = error => {
    s.retryCount += 1;
    const actor = s.expectedActor;
    if (s.retryCount > 2) {
      return null;
    }
    const payload = actorPayload(actor);
    payload.type = "retry";
    payload.error = error;
    return payload;
  };
  const resolvePlayer = decision => {
    const actor = s.expectedActor;
    const legal = playerActions(actor).some(option =>
      option.action === decision.action && option.target === decision.target
    );
    if (!legal) return { error: "action and target must match one legalActions entry." };
    const player = s.party[actor];
    if (decision.action === "DEFEND") {
      player.defending = true;
      const event = {
        type: "defend",
        actor,
        result: actor + " takes a defensive stance."
      };
      appendEvent(event);
      return { event };
    }
    if (decision.action === "HEAL") {
      const target = s.party[decision.target];
      if (!target || target.hp <= 0 || target.hp >= target.maxHp) {
        return { error: "HEAL target must be one injured living party member." };
      }
      const roll = d8() + 3;
      const amount = Math.min(roll, target.maxHp - target.hp);
      target.hp += amount;
      const event = {
        type: "heal",
        actor,
        target: decision.target,
        roll,
        amount,
        result: actor + " restores " + String(amount) + " HP to " + decision.target + "."
      };
      appendEvent(event);
      return { event };
    }
    const enemy = s.enemies.find(item => item.id === decision.target && item.hp > 0);
    if (!enemy) return { error: "ATTACK target must be one living enemy id." };
    const attackRoll = d20();
    const total = attackRoll + player.attackBonus;
    const hit = attackRoll === 20 || (attackRoll !== 1 && total >= enemy.ac);
    const damage = hit ? d8() + player.damageBonus : 0;
    enemy.hp = Math.max(0, enemy.hp - damage);
    const event = {
      type: "attack",
      actor,
      target: enemy.id,
      attackRoll,
      total,
      hit,
      damage,
      result: hit
        ? actor + " hits " + enemy.name + " for " + String(damage) + " damage."
        : actor + " misses " + enemy.name + "."
    };
    appendEvent(event);
    return { event };
  };
  const resolveOpposition = decision => {
    const enemy = s.enemies.find(item => item.id === decision.monsterId && item.hp > 0);
    const target = s.party[decision.target];
    if (!enemy) return { error: "monsterId must identify one living monsterActors entry." };
    if (!target || target.hp <= 0) return { error: "target must identify one living player." };
    const attackRoll = d20();
    const total = attackRoll + enemy.attackBonus;
    const hit = attackRoll === 20 || (attackRoll !== 1 && total >= target.ac);
    let damage = hit ? d6() + enemy.damageBonus : 0;
    if (hit && target.defending) damage = Math.max(1, Math.floor(damage / 2));
    target.hp = Math.max(0, target.hp - damage);
    const event = {
      type: "opposition_attack",
      actor: enemy.name,
      target: decision.target,
      attackRoll,
      total,
      hit,
      damage,
      result: hit
        ? enemy.name + " hits " + decision.target + " for " + String(damage) + " damage."
        : enemy.name + " misses " + decision.target + "."
    };
    appendEvent(event);
    return { event };
  };
  const chapterEnded = () =>
    aliveEnemies().length === 0 ||
    alivePlayers().length === 0 ||
    s.round > s.maxRounds;
  const ending = () => {
    if (aliveEnemies().length === 0) return "party_victory";
    if (alivePlayers().length === 0) return "party_defeat";
    return "chapter_boundary";
  };
  const finish = () => {
    s.phase = "awaiting_narrative";
    s.ending = ending();
    const payload = {
      type: "build_narrative",
      ending: s.ending,
      chapter: s.chapter,
      objective: s.objective,
      worldLock: s.worldLock,
      finalState: publicState(),
      completeEvents: s.events.slice(),
      durableSummaries: s.summaries.slice(),
      instruction:
        "Write a polished third-person past-tense chapter. Preserve every mechanical result and chronology. Return prose only."
    };
    return {
      targetIds: [ids.archive, ids.narrative],
      payload,
      state: s
    };
  };
  const beginOrContinueTurn = lastEvent => {
    if (chapterEnded()) return finish();
    const actor = nextLivingTurn();
    if (!actor) return finish();
    s.phase = "awaiting_action";
    s.retryCount = 0;
    if (actor !== "Opposition") s.party[actor].defending = false;
    const payload = actorPayload(actor);
    payload.lastResolvedEvent = lastEvent || null;
    return {
      targetIds: [agentIds[actor]],
      payload,
      state: s
    };
  };

  if (!s.initialized) {
    s.initialized = true;
    s.phase = "world_locked";
    s.chapter = "The Broken Watchtower";
    s.objective =
      "Hold the mountain signal tower long enough to light its warning beacon.";
    s.maxRounds = 3;
    s.round = 1;
    s.turnIndex = 0;
    s.tokenCounter = 0;
    s.turnToken = "";
    s.expectedActor = "";
    s.retryCount = 0;
    s.seed = Math.floor(Number(context.runtime.randomValue) * 4294967296) >>> 0;
    s.worldLock = String(input || "").trim();
    s.summaries = [];
    s.events = [];
    s.party = {
      Jannet: {
        persona: "Leader",
        className: "Fighter",
        hp: 24,
        maxHp: 24,
        ac: 16,
        attackBonus: 5,
        damageBonus: 3,
        defending: false
      },
      Annie: {
        persona: "Hero",
        className: "Paladin",
        hp: 22,
        maxHp: 22,
        ac: 17,
        attackBonus: 5,
        damageBonus: 3,
        defending: false
      },
      Beau: {
        persona: "Rebel",
        className: "Rogue",
        hp: 18,
        maxHp: 18,
        ac: 15,
        attackBonus: 6,
        damageBonus: 4,
        defending: false
      },
      Joe: {
        persona: "Protector",
        className: "Cleric",
        hp: 21,
        maxHp: 21,
        ac: 16,
        attackBonus: 4,
        damageBonus: 2,
        defending: false
      }
    };
    s.enemies = [
      { id: "raider-1", name: "Frost Raider One", hp: 18, maxHp: 18, ac: 13, attackBonus: 4, damageBonus: 2 },
      { id: "raider-2", name: "Frost Raider Two", hp: 18, maxHp: 18, ac: 13, attackBonus: 4, damageBonus: 2 }
    ];
    appendEvent({
      type: "chapter_started",
      result: s.chapter + " begins. " + s.objective
    });
    return beginOrContinueTurn(s.events[s.events.length - 1]);
  }

  if (s.phase === "awaiting_summary") {
    const summary = String(input || "").trim();
    s.summaries.push({
      throughRound: s.round - 1,
      summary: summary || "No durable summary was produced."
    });
    s.summaries = s.summaries.slice(-8);
    return beginOrContinueTurn({
      type: "summary_recorded",
      throughRound: s.round - 1
    });
  }
  if (s.phase !== "awaiting_action") return { drop: true, state: s };

  const parsed = parseObject(input);
  if (parsed.error) {
    const retry = retryPayload(parsed.error);
    if (retry) return { targetIds: [agentIds[s.expectedActor]], payload: retry, state: s };
    appendEvent({
      type: "invalid_response_fallback",
      actor: s.expectedActor,
      result: s.expectedActor + " loses the turn after repeated invalid responses."
    });
  } else {
    const decision = parsed.value;
    let error = "";
    if (decision.actor !== s.expectedActor) error = "actor must exactly match the current actor.";
    else if (decision.turnToken !== s.turnToken) error = "turnToken is stale or incorrect.";
    let resolved = null;
    if (!error) {
      resolved = s.expectedActor === "Opposition"
        ? resolveOpposition(decision)
        : resolvePlayer(decision);
      error = resolved.error || "";
    }
    if (error) {
      const retry = retryPayload(error);
      if (retry) return { targetIds: [agentIds[s.expectedActor]], payload: retry, state: s };
      appendEvent({
        type: "invalid_response_fallback",
        actor: s.expectedActor,
        result: s.expectedActor + " loses the turn after repeated invalid responses."
      });
    }
  }

  s.turnIndex += 1;
  if (s.turnIndex >= order.length) {
    s.turnIndex = 0;
    s.round += 1;
    if (chapterEnded()) return finish();
    s.phase = "awaiting_summary";
    return {
      targetIds: [ids.summary],
      payload: {
        type: "summarize_turn_delta",
        completedRound: s.round - 1,
        events: s.events.filter(event => event.round === s.round - 1),
        currentState: publicState(),
        instruction:
          "Record only durable canon, party condition, objective progress, and active threats. Return concise prose."
      },
      state: s
    };
  }
  return beginOrContinueTurn(s.events[s.events.length - 1]);
}`;

const PLAYER_BASE_PROMPT = `You are a Story Engine Player Character Agent.
The human GM and the authoritative Game Engine control canon and mechanics.
You choose one legal action; you never roll dice, decide success, apply damage,
or invent a world outcome. Treat the payload, structured memory, legalActions,
and turnToken as authoritative.

Return exactly one JSON object and no prose:
{"actor":"NAME","action":"ATTACK","target":"raider-1","turnToken":"TOKEN"}

Copy actor and turnToken exactly. action and target must exactly match one
legalActions entry. Stay consistent with your persona when choosing, but keep
all personality inside the decision rather than adding narration.`;

const PERSONAS = {
  Jannet:
    'You are Jannet, the Leader: organized, decisive, practical, and inclined to establish a clear plan.',
  Annie:
    'You are Annie, the Hero: theatrical, brave, committed, and drawn toward bold actions that protect party morale.',
  Beau:
    'You are Beau, the Rebel: skeptical, observant, unconventional, and alert to hidden angles and weak points.',
  Joe:
    'You are Joe, the Protector: humane, steady, defensive, and attentive to injured or vulnerable allies.',
};

const OPPOSITION_PROMPT = `You are the Story Engine Opposition Agent.
Choose one living monster and one legal living party target from the exact
payload. The Game Engine resolves the attack and owns HP. Never invent a roll,
hit, miss, damage value, condition, or extra monster action.

Return exactly one JSON object and no prose:
{"actor":"Opposition","monsterId":"raider-1","target":"Jannet","turnToken":"TOKEN"}

Copy actor and turnToken exactly. monsterId and target must be listed in the
current payload. Prefer an immediate tactical threat, but obey legality first.`;

const WORLD_LOCK_PROMPT = `You are the Story Engine World and Chapter Lock Agent.
Convert the supplied chapter setup into compact durable canon for later agents.
Include the setting, objective, selected party identities and classes, known
threat, and the human GM's authority. Add no facts. Return concise prose only.`;

const SUMMARY_PROMPT = `You are the Story Engine Context Summary Agent.
Summarize only durable canon from the supplied completed-round events and
authoritative current state. Track party condition, objective, defeated and
active threats, and consequential actions. Add no facts and do not rewrite
mechanical results. Return concise prose only.`;

const NARRATIVE_PROMPT = `You are the Story Engine Narrative Agent.
Write the completed chapter in polished third-person past tense. Preserve the
authoritative event chronology, exact outcomes, ending, and durable summaries.
Do not contradict canon, expose prompts, or add unrecorded victories, wounds,
items, or actions. Return continuous prose with clear paragraphs and no heading.`;

function node(id, kind, label, description, position, config) {
  const contracts = {
    trigger: ['event', 'event'],
    agent: ['event', 'message'],
    logic: ['event', 'event'],
    governor: ['event', 'event'],
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
      ...(kind === 'agent' ? { outputHistory: [] } : {}),
      ...(kind === 'memory' ? { memoryEntries: [] } : {}),
    },
  };
}

function edge(id, source, target, channel) {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    label: channel,
    data: { channel },
    animated: false,
    selected: false,
  };
}

function agent(id, label, description, position, systemPrompt, tokens = 500) {
  return node(id, 'agent', label, description, position, {
    systemPrompt,
    reasoningEffort: 'low',
    maxOutputTokens: tokens,
  });
}

export function createStoryEngineHarness() {
  const nodes = [
    node(
      'story-start',
      'trigger',
      'Begin Chapter',
      'Locks the scenario and begins one authoritative story-engine chapter.',
      { x: 70, y: 310 },
      {
        payload: {
          type: 'LOCK_CHAPTER',
          setting:
            'A stormbound mountain watchtower above the frontier settlement of Moosehearth.',
          chapter: 'The Broken Watchtower',
          objective:
            'Hold the signal tower long enough to light its warning beacon.',
          party: [
            { name: 'Jannet', persona: 'Leader', className: 'Fighter' },
            { name: 'Annie', persona: 'Hero', className: 'Paladin' },
            { name: 'Beau', persona: 'Rebel', className: 'Rogue' },
            { name: 'Joe', persona: 'Protector', className: 'Cleric' },
          ],
          threat: 'Two frost raiders breach the tower stair.',
          authority:
            'The human is GM. The Game Engine owns rolls, HP, legal actions, and chronology.',
        },
        continueState: false,
      },
    ),
    agent(
      'story-world-lock',
      'World Lock Agent',
      'Creates compact immutable chapter canon before play.',
      { x: 370, y: 310 },
      WORLD_LOCK_PROMPT,
      700,
    ),
    node(
      'story-engine',
      'logic',
      'Authoritative Game Engine',
      'Owns turns, legal actions, validation, rolls, HP, retries, chapter boundaries, and narrative handoff.',
      { x: 760, y: 305 },
      {
        operation: 'generated',
        routerPrompt:
          'Reproduce the Story Engine agent harness boundary. Accept a world-lock summary, then run Jannet, Annie, Beau, Joe, and Opposition in strict initiative order. Agents may choose only legal structured actions. This Router alone resolves deterministic mechanics, validates actor and turn tokens, retries malformed output twice, records event chronology, requests a durable summary after each full round, and sends the complete record to Narrative after victory, defeat, or three rounds.',
        generatedCode: STORY_ENGINE_ROUTER_CODE,
        generatedSummary:
          'Backend-authoritative tabletop chapter loop with specialized agents, strict action contracts, summaries, and narrative handoff.',
        generatedAt: new Date().toISOString(),
        generatedJobId: 'hand-authored-story-engine-extraction',
        generatedAssumptions: [
          'The source application is open-ended and human-prompted; this portable test slice uses a fixed three-round chapter.',
          'Synapse Flow agents return structured action proposals instead of native API tool calls.',
          'One Router represents the source backend mechanics, validation, session state, event log, and orchestration services.',
          'The final narrative pass stands in for the source End Chapter and Build Narrative workflow.',
        ],
        generatedTests: [
          {
            name: 'world lock starts Jannet turn',
            input: 'Locked chapter canon.',
            randomValue: 0.31,
            expectedTargetIds: ['story-player-jannet'],
          },
          {
            name: 'invalid response retries expected actor',
            expectedType: 'retry',
            expectedTargetIds: ['story-player-jannet'],
          },
          {
            name: 'chapter ending archives and narrates',
            expectedType: 'build_narrative',
            expectedTargetIds: ['story-run-archive', 'story-narrative'],
          },
        ],
        generatedVersions: [],
        rules: '',
        template: '{{input}}',
      },
    ),
    agent(
      'story-player-jannet',
      'Jannet - Leader',
      'Player-character agent choosing legal Fighter actions through a distinct leader persona.',
      { x: 1160, y: 50 },
      `${PLAYER_BASE_PROMPT.replace('NAME', 'Jannet')}\n\n${PERSONAS.Jannet}`,
    ),
    agent(
      'story-player-annie',
      'Annie - Hero',
      'Player-character agent choosing legal Paladin actions through a distinct heroic persona.',
      { x: 1160, y: 210 },
      `${PLAYER_BASE_PROMPT.replace('NAME', 'Annie')}\n\n${PERSONAS.Annie}`,
    ),
    agent(
      'story-player-beau',
      'Beau - Rebel',
      'Player-character agent choosing legal Rogue actions through a distinct skeptical persona.',
      { x: 1160, y: 370 },
      `${PLAYER_BASE_PROMPT.replace('NAME', 'Beau')}\n\n${PERSONAS.Beau}`,
    ),
    agent(
      'story-player-joe',
      'Joe - Protector',
      'Player-character agent choosing legal Cleric actions with context-sensitive healing.',
      { x: 1160, y: 530 },
      `${PLAYER_BASE_PROMPT.replace('NAME', 'Joe')}\n\n${PERSONAS.Joe}`,
    ),
    agent(
      'story-opposition',
      'Opposition Agent',
      'Chooses a legal monster actor and party target while the engine owns results.',
      { x: 1160, y: 690 },
      OPPOSITION_PROMPT,
    ),
    agent(
      'story-summary',
      'Context Summary Agent',
      'Compresses each completed round into durable, inspectable canon memory.',
      { x: 760, y: 745 },
      SUMMARY_PROMPT,
      700,
    ),
    node(
      'story-loop-governor',
      'governor',
      'Chapter Governor',
      'Bounds every agent-to-engine continuation in this experimental loop.',
      { x: 1550, y: 305 },
      { maxActivations: 60, stopPhrase: 'ABORT_CHAPTER' },
    ),
    node(
      'story-structured-memory',
      'memory',
      'Structured Canon Memory',
      'Stores world lock and round summaries; read edges provide them to active agents.',
      { x: 760, y: 940 },
      { operation: 'append', initialValue: '' },
    ),
    agent(
      'story-narrative',
      'Narrative Agent',
      'Builds the completed prose chapter from the authoritative record.',
      { x: 1160, y: 940 },
      NARRATIVE_PROMPT,
      1800,
    ),
    node(
      'story-run-archive',
      'memory',
      'Run Archive',
      'Stores the final authoritative state followed by the completed narrative.',
      { x: 1550, y: 820 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'story-final-output',
      'output',
      'Completed Chapter',
      'Displays the final Narrative Agent chapter.',
      { x: 1550, y: 1040 },
      {},
    ),
  ];

  const edges = [
    edge('story-edge-start-lock', 'story-start', 'story-world-lock', 'trigger'),
    edge('story-edge-lock-memory', 'story-world-lock', 'story-structured-memory', 'write'),
    edge('story-edge-lock-governor', 'story-world-lock', 'story-loop-governor', 'data'),
    edge('story-edge-governor-engine', 'story-loop-governor', 'story-engine', 'data'),
    edge('story-edge-engine-jannet', 'story-engine', 'story-player-jannet', 'data'),
    edge('story-edge-engine-annie', 'story-engine', 'story-player-annie', 'data'),
    edge('story-edge-engine-beau', 'story-engine', 'story-player-beau', 'data'),
    edge('story-edge-engine-joe', 'story-engine', 'story-player-joe', 'data'),
    edge('story-edge-engine-opposition', 'story-engine', 'story-opposition', 'data'),
    edge('story-edge-engine-summary', 'story-engine', 'story-summary', 'data'),
    edge('story-edge-engine-narrative', 'story-engine', 'story-narrative', 'data'),
    edge('story-edge-engine-archive', 'story-engine', 'story-run-archive', 'write'),
    edge('story-edge-jannet-governor', 'story-player-jannet', 'story-loop-governor', 'data'),
    edge('story-edge-annie-governor', 'story-player-annie', 'story-loop-governor', 'data'),
    edge('story-edge-beau-governor', 'story-player-beau', 'story-loop-governor', 'data'),
    edge('story-edge-joe-governor', 'story-player-joe', 'story-loop-governor', 'data'),
    edge('story-edge-opposition-governor', 'story-opposition', 'story-loop-governor', 'data'),
    edge('story-edge-summary-memory', 'story-summary', 'story-structured-memory', 'write'),
    edge('story-edge-summary-governor', 'story-summary', 'story-loop-governor', 'data'),
    edge('story-edge-memory-jannet', 'story-structured-memory', 'story-player-jannet', 'read'),
    edge('story-edge-memory-annie', 'story-structured-memory', 'story-player-annie', 'read'),
    edge('story-edge-memory-beau', 'story-structured-memory', 'story-player-beau', 'read'),
    edge('story-edge-memory-joe', 'story-structured-memory', 'story-player-joe', 'read'),
    edge('story-edge-memory-opposition', 'story-structured-memory', 'story-opposition', 'read'),
    edge('story-edge-memory-narrative', 'story-structured-memory', 'story-narrative', 'read'),
    edge('story-edge-narrative-archive', 'story-narrative', 'story-run-archive', 'write'),
    edge('story-edge-narrative-output', 'story-narrative', 'story-final-output', 'data'),
  ];

  return {
    format: 'synapse-flow/harness',
    version: 2,
    name: 'Story Engine - Authoritative Agent Chapter',
    nodes,
    edges,
  };
}

export async function writeStoryEngineHarness(outputPath) {
  const harness = createStoryEngineHarness();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(harness, null, 2), 'utf8');
  return harness;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  const outputPath = path.resolve(
    'examples/story-engine-authoritative-chapter.synapse.json',
  );
  await writeStoryEngineHarness(outputPath);
  console.log(`Wrote ${outputPath}`);
}
