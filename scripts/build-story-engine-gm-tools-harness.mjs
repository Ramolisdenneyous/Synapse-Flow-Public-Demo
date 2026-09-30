import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GM_STORY_TURN_ROUTER_CODE = `function route(input, context, state) {
  const actors = [
    { id: "gm-story-jannet", name: "Jannet" },
    { id: "gm-story-annie", name: "Annie" },
    { id: "gm-story-beau", name: "Beau" },
    { id: "gm-story-joe", name: "Joe" },
    { id: "gm-story-opposition", name: "Opposition" }
  ];
  const s = state && typeof state === "object" && !Array.isArray(state)
    ? JSON.parse(JSON.stringify(state))
    : {};
  if (s.ended) return { targetIds: [], drop: true, state: s };
  const text = typeof input === "string" ? input.trim() : JSON.stringify(input);
  const actorIndex = Number.isInteger(s.nextActorIndex) ? s.nextActorIndex : 0;
  const actor = actors[actorIndex % actors.length];
  if (!s.initialized) {
    s.initialized = true;
    s.phase = "awaiting_gm";
    s.nextActorIndex = 0;
    s.turnNumber = 0;
    return {
      targetIds: ["gm-story-user"],
      payload: {
        type: "gm_turn_brief",
        nextActor: actors[0].name,
        upcomingTurn: 1,
        openingSituation: input && typeof input === "object"
          ? input.openingSituation || input
          : input,
        instruction: "Direct only the named next actor. Do not select a different actor."
      },
      state: s
    };
  }
  if (s.phase === "awaiting_gm") {
    if (/\\bend chapter\\b/i.test(text)) {
      s.ended = true;
      s.phase = "ended";
      return {
        targetIds: ["gm-story-final-narrator"],
        payload: "The GM ended the chapter. Build the final narrative from Canon Ledger. Final GM direction: " + text,
        state: s
      };
    }
    s.phase = "awaiting_actor";
    s.turnNumber += 1;
    return {
      targetIds: [actor.id],
      payload: {
        type: "gm_directed_turn",
        actor: actor.name,
        turnNumber: s.turnNumber,
        gmDirection: text,
        instruction: "Take one in-character action through the connected mechanics Tool, then narrate only the resulting story beat."
      },
      state: s
    };
  }
  if (s.phase === "awaiting_actor") {
    const completedActor = actor.name;
    s.nextActorIndex = (actorIndex + 1) % actors.length;
    s.phase = "awaiting_gm";
    const nextActor = actors[s.nextActorIndex];
    return {
      targetIds: ["gm-story-user"],
      payload: {
        type: "gm_turn_brief",
        completedActor,
        previousActorNarration: text,
        nextActor: nextActor.name,
        upcomingTurn: s.turnNumber + 1,
        instruction: "Respond to the completed beat, then direct only the named next actor. Do not select a different actor."
      },
      state: s
    };
  }
  return { targetIds: [], drop: true, state: s };
}`;

const ACTION_SCHEMA = JSON.stringify(
  {
    type: 'object',
    properties: {
      actor: {
        type: 'string',
        enum: ['Jannet', 'Annie', 'Beau', 'Joe', 'Opposition'],
      },
      action: {
        type: 'string',
        description: 'The concrete action attempted in the fiction.',
      },
      target: {
        type: 'string',
        description: 'The person, creature, object, place, or situation affected.',
      },
      intent: {
        type: 'string',
        description: 'What the actor hopes the action will accomplish.',
      },
    },
    required: ['actor', 'action', 'target', 'intent'],
    additionalProperties: false,
  },
  null,
  2,
);

const PERSONAS = {
  Jannet:
    'You are Jannet, the Leader: organized, decisive, practical, and protective of the group.',
  Annie:
    'You are Annie, the Hero: theatrical, brave, hopeful, and drawn toward bold acts that lift morale.',
  Beau:
    'You are Beau, the Rebel: skeptical, observant, unconventional, and alert to hidden angles.',
  Joe:
    'You are Joe, the Protector: patient, compassionate, durable, and inclined to shield or restore others.',
  Opposition:
    'You portray the active opposition and environment: purposeful, dangerous, and fair. You challenge the party without deciding the heroes actions.',
};

function node(id, kind, label, description, position, config) {
  return {
    id,
    type: 'synapseNode',
    position,
    data: {
      kind,
      label,
      description,
      inputType:
        kind === 'tool'
          ? 'tool_request'
          : kind === 'memory'
            ? 'memory_write'
            : 'event',
      outputType:
        kind === 'output'
          ? 'none'
          : kind === 'tool'
            ? 'tool_result'
            : kind === 'memory'
              ? 'memory_read'
              : kind === 'agent' || kind === 'user'
                ? 'message'
                : 'event',
      config,
      status: 'idle',
      activity: '',
      lastOutput: '',
      ...(['agent', 'user'].includes(kind) ? { outputHistory: [] } : {}),
    },
  };
}

function edge(id, source, target, channel = 'data', targetHandle) {
  return {
    id,
    source,
    target,
    ...(targetHandle ? { targetHandle } : {}),
    type: 'smoothstep',
    label: channel,
    data: { channel },
    animated: false,
    selected: false,
  };
}

function actorNode(id, name, y) {
  return node(
    id,
    'agent',
    name === 'Opposition' ? 'Opposition Agent' : `${name} - Character`,
    `Takes one GM-directed ${name === 'Opposition' ? 'opposition' : 'character'} turn through the mechanics Tool and returns narrative prose.`,
    { x: 1250, y },
    {
      systemPrompt: `${PERSONAS[name]}

The human user is the Game Master. Treat the incoming GM direction and Canon Ledger as authoritative. You may propose only your own actor's action; do not dictate another character's choice or invent a mechanical result.

For every turn, call the connected resolve_story_action Tool exactly once using actor "${name}", a concrete action, a target, and your intent. Treat the Tool result as authoritative. After the Tool returns, write one concise narrative paragraph showing what your actor attempted and what actually happened. Stay in third-person past tense. Do not mention tools, prompts, schemas, dice APIs, or hidden mechanics. Do not output JSON, labels, bullet points, or Markdown code fences.`,
      reasoningEffort: 'low',
      maxOutputTokens: 700,
      requireToolCall: true,
    },
  );
}

export function createGmToolStoryEngineHarness() {
  const actorIds = [
    'gm-story-jannet',
    'gm-story-annie',
    'gm-story-beau',
    'gm-story-joe',
    'gm-story-opposition',
  ];
  const nodes = [
    node(
      'gm-story-start',
      'trigger',
      'Begin GM Chapter',
      'Presents the locked opening situation to the human GM.',
      { x: 50, y: 340 },
      {
        payload: {
          type: 'begin_gm_chapter',
          openingSituation:
            'The Broken Watchtower begins above Moosehearth during a violent winter storm. Jannet, Annie, Beau, and Joe must light the warning beacon while frost raiders climb the tower. Write END CHAPTER whenever the scene should conclude.',
        },
        continueState: false,
      },
    ),
    node(
      'gm-story-user',
      'user',
      'Human Game Master',
      'Pauses before every actor turn so the GM can dictate action flow, adjudicate fiction, or end the chapter.',
      { x: 340, y: 340 },
      {
        mode: 'manual',
        systemPrompt:
          'You are the Game Master for a tense but fair fantasy adventure. The incoming turn brief names exactly one next actor. Respond in natural prose with the next situation, ruling, or direction for that named actor only; never redirect the turn to a different actor. Preserve established canon and give the named actor something concrete to respond to. Write END CHAPTER when the scene has reached a satisfying boundary. Never output JSON or code.',
        reasoningEffort: 'low',
        maxOutputTokens: 700,
      },
    ),
    node(
      'gm-story-governor',
      'governor',
      'GM Turn Governor',
      'Bounds the open GM and actor loop while allowing an explicit chapter ending.',
      { x: 660, y: 340 },
      { maxActivations: 30, stopPhrase: 'ABORT CHAPTER' },
    ),
    node(
      'gm-story-turn-router',
      'logic',
      'Turn Sequencer',
      'Announces the fixed next actor before every GM prompt, routes the GM direction to that actor, and hands END CHAPTER to final narration.',
      { x: 930, y: 340 },
      {
        operation: 'generated',
        routerPrompt:
          'Maintain strict round-robin order Jannet, Annie, Beau, Joe, Opposition through alternating awaiting_gm and awaiting_actor phases. On the initial Trigger, send Human Game Master a gm_turn_brief naming Jannet before accepting any GM prose. After every actor narration, advance the index and send Human Game Master a new gm_turn_brief naming the next actor. While awaiting_gm, route the GM prose only to the actor already named in that brief. If GM prose contains END CHAPTER case-insensitively, route only to Final Narrator and permanently stop actor routing. Stable target IDs are gm-story-user, gm-story-jannet, gm-story-annie, gm-story-beau, gm-story-joe, gm-story-opposition, and gm-story-final-narrator.',
        generatedCode: GM_STORY_TURN_ROUTER_CODE,
        generatedSummary:
          'Round-robin sequencer that briefs the GM before every actor turn and provides an explicit final-narration branch.',
        generatedAt: new Date().toISOString(),
        generatedJobId: 'hand-authored-gm-tool-story-engine',
        generatedAssumptions: [
          'The GM controls scene direction in prose and does not need a machine-readable action contract.',
          'Each actor must complete one native Tool call before returning narrative prose.',
          'The shared Tool simulates the real application mechanics boundary; production reconstruction replaces it with the real game service.',
        ],
        generatedTests: [
          {
            name: 'opening announces Jannet to GM',
            input: 'BEGIN_CHAPTER',
            expectedTargetIds: ['gm-story-user'],
          },
        ],
        generatedVersions: [],
        rules: '',
        template: '{{input}}',
      },
    ),
    actorNode('gm-story-jannet', 'Jannet', 20),
    actorNode('gm-story-annie', 'Annie', 180),
    actorNode('gm-story-beau', 'Beau', 340),
    actorNode('gm-story-joe', 'Joe', 500),
    actorNode('gm-story-opposition', 'Opposition', 660),
    node(
      'gm-story-action-tool',
      'tool',
      'Authoritative Story Action',
      'Simulates the real game-engine capability that resolves one actor action before narration.',
      { x: 1620, y: 340 },
      {
        mode: 'llm',
        mockResponse: 'The attempted action resolves without changing the situation.',
        behaviorPrompt:
          'You are the authoritative mechanics service for a fantasy Story Engine prototype. You receive one strict function-call object with actor, action, target, and intent, plus explicitly connected Canon Ledger context. Resolve only that action. Preserve established facts, do not choose another actor action, and do not narrate a full scene. Return one compact JSON object with keys success (boolean), outcome (string), consequence (string), and canonUpdate (string). The calling character Agent will convert this private mechanical result into narrative prose.',
        functionName: 'resolve_story_action',
        functionDescription:
          'Resolve one proposed story action against established canon. Call this exactly once before narrating an actor turn; its outcome is authoritative.',
        parametersSchema: ACTION_SCHEMA,
      },
    ),
    node(
      'gm-story-canon',
      'memory',
      'Canon Ledger',
      'Stores each GM direction and each resulting actor narration in chronological order.',
      { x: 710, y: 840 },
      {
        operation: 'append',
        initialValue:
          'Chapter: The Broken Watchtower. Setting: a stormbound mountain signal tower above Moosehearth. Party: Jannet the Leader, Annie the Hero, Beau the Rebel, and Joe the Protector. Threat: frost raiders are climbing the tower. Objective: light the warning beacon. The GM owns canon and flow; the mechanics Tool owns action outcomes.',
      },
    ),
    node(
      'gm-story-final-narrator',
      'agent',
      'Final Narrator',
      'Builds the completed chapter from the chronological Canon Ledger after the GM ends play.',
      { x: 1250, y: 860 },
      {
        systemPrompt:
          'Write a polished third-person past-tense fantasy chapter from the complete Canon Ledger. Preserve chronology, GM rulings, character actions, Tool-resolved consequences, and the ending. Do not add new mechanical outcomes or continue beyond the GM ending. Return narrative prose only, with no JSON, headings, or commentary.',
        reasoningEffort: 'medium',
        maxOutputTokens: 2200,
        requireToolCall: false,
      },
    ),
    node(
      'gm-story-archive',
      'memory',
      'Chapter Archive',
      'Stores the final reconstructed chapter.',
      { x: 1620, y: 820 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'gm-story-output',
      'output',
      'Completed GM Chapter',
      'Displays the final chapter after the GM ends the simulation.',
      { x: 1620, y: 980 },
      {},
    ),
  ];

  const edges = [
    edge('gm-story-edge-start-router', 'gm-story-start', 'gm-story-turn-router', 'trigger'),
    edge('gm-story-edge-user-canon', 'gm-story-user', 'gm-story-canon', 'write'),
    edge('gm-story-edge-user-governor', 'gm-story-user', 'gm-story-governor', 'data'),
    edge('gm-story-edge-governor-router', 'gm-story-governor', 'gm-story-turn-router', 'data'),
    edge('gm-story-edge-router-user', 'gm-story-turn-router', 'gm-story-user', 'data'),
    ...actorIds.map((actorId) =>
      edge(`gm-story-edge-router-${actorId}`, 'gm-story-turn-router', actorId, 'data'),
    ),
    edge(
      'gm-story-edge-router-final',
      'gm-story-turn-router',
      'gm-story-final-narrator',
      'data',
    ),
    ...actorIds.flatMap((actorId) => [
      edge(`gm-story-edge-${actorId}-canon`, actorId, 'gm-story-canon', 'write'),
      edge(`gm-story-edge-${actorId}-router`, actorId, 'gm-story-turn-router', 'data'),
      edge(`gm-story-edge-${actorId}-tool`, actorId, 'gm-story-action-tool', 'tool'),
      edge(`gm-story-edge-canon-${actorId}`, 'gm-story-canon', actorId, 'read'),
    ]),
    edge(
      'gm-story-edge-canon-user',
      'gm-story-canon',
      'gm-story-user',
      'read',
      'read',
    ),
    edge('gm-story-edge-canon-tool', 'gm-story-canon', 'gm-story-action-tool', 'read'),
    edge(
      'gm-story-edge-canon-final',
      'gm-story-canon',
      'gm-story-final-narrator',
      'read',
    ),
    edge(
      'gm-story-edge-final-archive',
      'gm-story-final-narrator',
      'gm-story-archive',
      'write',
    ),
    edge(
      'gm-story-edge-final-output',
      'gm-story-final-narrator',
      'gm-story-output',
      'data',
    ),
  ];

  return {
    format: 'synapse-flow/harness',
    version: 2,
    name: 'Story Engine v2 - GM Between Every Tool-Using Agent',
    nodes,
    edges,
  };
}

export async function writeGmToolStoryEngineHarness(outputPath) {
  const harness = createGmToolStoryEngineHarness();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(harness, null, 2), 'utf8');
  return harness;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  const outputPath = path.resolve(
    'examples/story-engine-gm-mediated-tools.synapse.json',
  );
  await writeGmToolStoryEngineHarness(outputPath);
  console.log(`Wrote ${outputPath}`);
}
