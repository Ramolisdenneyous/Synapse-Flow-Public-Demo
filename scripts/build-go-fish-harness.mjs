import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GO_FISH_ROUTER_CODE = `function route(input, context, state) {
  const ids = {
    playerOne: "go-fish-player-one",
    playerTwo: "go-fish-player-two",
    playerThree: "go-fish-player-three",
    governor: "go-fish-governor",
    archive: "go-fish-game-archive",
    display: "go-fish-table-display"
  };
  const players = ["Player One", "Player Two", "Player Three"];
  const agentIds = {
    "Player One": ids.playerOne,
    "Player Two": ids.playerTwo,
    "Player Three": ids.playerThree
  };
  const rankOrder = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const suitOrder = ["S", "H", "D", "C"];
  const s = state && typeof state === "object" && !Array.isArray(state)
    ? JSON.parse(JSON.stringify(state))
    : {};

  const rankOf = card => String(card).slice(0, -1);
  const sortCards = cards => cards.slice().sort((left, right) => {
    const rankDifference = rankOrder.indexOf(rankOf(left)) - rankOrder.indexOf(rankOf(right));
    if (rankDifference) return rankDifference;
    return suitOrder.indexOf(left.slice(-1)) - suitOrder.indexOf(right.slice(-1));
  });
  const publicBooks = () => Object.fromEntries(
    players.map(player => [player, (s.books[player] || []).map(book => book.rank)])
  );
  const publicTable = () => ({
    game: "Go Fish",
    turnNumber: s.turnNumber,
    currentPlayer: players[s.currentPlayerIndex],
    deckCount: s.deck.length,
    handCounts: Object.fromEntries(players.map(player => [player, s.hands[player].length])),
    books: publicBooks(),
    bookCounts: Object.fromEntries(players.map(player => [player, s.books[player].length])),
    recentHistory: s.history.slice(-18)
  });
  const addHistory = event => {
    s.history.push({ sequence: s.history.length + 1, ...event });
    s.history = s.history.slice(-100);
  };
  const collectBooks = player => {
    const collected = [];
    for (const rank of rankOrder) {
      const matching = s.hands[player].filter(card => rankOf(card) === rank);
      if (matching.length !== 4) continue;
      s.hands[player] = s.hands[player].filter(card => rankOf(card) !== rank);
      s.books[player].push({ rank, cards: sortCards(matching) });
      collected.push(rank);
      addHistory({
        type: "book_completed",
        player,
        rank,
        bookNumber: s.books[player].length
      });
    }
    s.hands[player] = sortCards(s.hands[player]);
    return collected;
  };
  const winner = () => players.find(player => s.books[player].length >= 4) || null;
  const makeTurnToken = player => {
    s.turnNumber += 1;
    s.turnToken =
      "go-fish:" +
      String(s.turnNumber) +
      ":" +
      player +
      ":" +
      String(context.runtime.invocationId);
  };
  const playerPayload = (player, type, lastEvent) => {
    const opponents = players.filter(candidate => candidate !== player);
    return {
      type,
      game: "Go Fish",
      player,
      hand: sortCards(s.hands[player]),
      books: s.books[player].map(book => book.rank),
      legalTargets: opponents,
      legalRanks: [...new Set(s.hands[player].map(rankOf))],
      turnToken: s.turnToken,
      publicTable: publicTable(),
      lastEvent,
      instruction:
        "Return one strict JSON object with player, target, rank, and turnToken. " +
        "Target must be one legal opponent. Rank must exactly match one legalRanks value."
    };
  };
  const finishGame = (player, lastEvent) => {
    s.phase = "complete";
    s.winner = player;
    const payload = {
      type: "GAME_OVER",
      signal: "GAME_OVER",
      game: "Go Fish",
      winner: player,
      winningBookCount: s.books[player].length,
      hands: Object.fromEntries(players.map(name => [name, sortCards(s.hands[name])])),
      books: Object.fromEntries(
        players.map(name => [
          name,
          s.books[name].map(book => ({ rank: book.rank, cards: book.cards.slice() }))
        ])
      ),
      deck: s.deck.slice(),
      publicTable: publicTable(),
      completeHistory: s.history.slice(),
      lastEvent,
      message:
        player +
        " completed four books. GAME_OVER is routed through the Governor, which blocks continuation."
    };
    return {
      targetIds: [ids.archive, ids.governor, ids.display],
      payload,
      state: s
    };
  };
  const activatePlayer = lastEvent => {
    let skipped = 0;
    while (skipped < players.length) {
      const player = players[s.currentPlayerIndex];
      if (s.hands[player].length === 0 && s.deck.length) {
        const card = s.deck.pop();
        s.hands[player].push(card);
        collectBooks(player);
        addHistory({ type: "empty_hand_draw", player });
      }
      const gameWinner = winner();
      if (gameWinner) return finishGame(gameWinner, lastEvent);
      if (s.hands[player].length) {
        s.phase = "awaiting_ask";
        makeTurnToken(player);
        return {
          targetIds: [agentIds[player]],
          payload: playerPayload(player, "player_turn", lastEvent),
          state: s
        };
      }
      s.currentPlayerIndex = (s.currentPlayerIndex + 1) % players.length;
      skipped += 1;
    }
    const leader = players.slice().sort(
      (left, right) => s.books[right].length - s.books[left].length
    )[0];
    return finishGame(leader, {
      type: "no_playable_cards",
      message: "No player could make another legal ask."
    });
  };
  const parseDecision = value => {
    if (value && typeof value === "object" && !Array.isArray(value)) return { value };
    if (typeof value !== "string") return { error: "Decision must be a JSON object." };
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

  if (!s.initialized) {
    if (String(input).trim().toUpperCase() !== "START_GO_FISH") {
      return { drop: true, state: s };
    }
    const deck = [];
    for (const suit of suitOrder) {
      for (const rank of rankOrder) deck.push(rank + suit);
    }
    let seed = Math.floor(Number(context.runtime.randomValue) * 4294967296) >>> 0;
    const random = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const choice = Math.floor(random() * (index + 1));
      const held = deck[index];
      deck[index] = deck[choice];
      deck[choice] = held;
    }
    s.initialized = true;
    s.phase = "dealing";
    s.deck = deck;
    s.hands = { "Player One": [], "Player Two": [], "Player Three": [] };
    s.books = { "Player One": [], "Player Two": [], "Player Three": [] };
    s.history = [];
    s.turnNumber = 0;
    s.turnToken = null;
    s.currentPlayerIndex = 0;
    s.winner = null;
    for (let pass = 0; pass < 7; pass += 1) {
      for (const player of players) s.hands[player].push(s.deck.pop());
    }
    for (const player of players) {
      s.hands[player] = sortCards(s.hands[player]);
      collectBooks(player);
    }
    addHistory({
      type: "game_started",
      players: players.slice(),
      cardsPerPlayer: 7,
      deckCount: s.deck.length
    });
    const gameWinner = winner();
    return gameWinner
      ? finishGame(gameWinner, { type: "initial_books" })
      : activatePlayer({ type: "game_started" });
  }

  if (s.phase === "complete") return { drop: true, state: s };
  const currentPlayer = players[s.currentPlayerIndex];
  const parsed = parseDecision(input);
  const retry = error => ({
    targetIds: [agentIds[currentPlayer]],
    payload: playerPayload(currentPlayer, "retry", {
      type: "invalid_ask",
      error
    }),
    state: s
  });
  if (parsed.error) return retry(parsed.error);
  const decision = parsed.value;
  if (decision.player !== currentPlayer) {
    return retry("Expected player identity " + currentPlayer + ".");
  }
  if (decision.turnToken !== s.turnToken) {
    return retry("The turnToken is stale or incorrect.");
  }
  if (!players.includes(decision.target) || decision.target === currentPlayer) {
    return retry("Target must be one of the two opposing players.");
  }
  if (!rankOrder.includes(decision.rank)) {
    return retry("Rank must be A, 2-10, J, Q, or K.");
  }
  if (!s.hands[currentPlayer].some(card => rankOf(card) === decision.rank)) {
    return retry("A player may ask only for a rank currently held in that hand.");
  }

  const matchingCards = s.hands[decision.target].filter(
    card => rankOf(card) === decision.rank
  );
  let lastEvent;
  let continueTurn = false;
  if (matchingCards.length) {
    s.hands[decision.target] = s.hands[decision.target].filter(
      card => rankOf(card) !== decision.rank
    );
    s.hands[currentPlayer].push(...matchingCards);
    s.hands[currentPlayer] = sortCards(s.hands[currentPlayer]);
    const collected = collectBooks(currentPlayer);
    lastEvent = {
      type: "ask_succeeded",
      player: currentPlayer,
      target: decision.target,
      rank: decision.rank,
      transferred: matchingCards.length,
      booksCompleted: collected
    };
    addHistory(lastEvent);
    continueTurn = true;
  } else {
    const drawnCard = s.deck.length ? s.deck.pop() : null;
    const drewRequestedRank = Boolean(drawnCard && rankOf(drawnCard) === decision.rank);
    if (drawnCard) {
      s.hands[currentPlayer].push(drawnCard);
      s.hands[currentPlayer] = sortCards(s.hands[currentPlayer]);
    }
    const collected = collectBooks(currentPlayer);
    lastEvent = {
      type: "go_fish",
      player: currentPlayer,
      target: decision.target,
      rank: decision.rank,
      drewCard: Boolean(drawnCard),
      drewRequestedRank,
      booksCompleted: collected
    };
    addHistory(lastEvent);
    continueTurn = drewRequestedRank;
  }

  const gameWinner = winner();
  if (gameWinner) return finishGame(gameWinner, lastEvent);
  if (!continueTurn) {
    s.currentPlayerIndex = (s.currentPlayerIndex + 1) % players.length;
  }
  return activatePlayer(lastEvent);
}`;

const PLAYER_PROMPT = `You are one of three players in a standard game of Go Fish.
The authoritative Game Engine gives you your exact private hand, completed books,
legal targets, legal ranks, public table information, and a turnToken.

Choose one opponent and one rank from legalRanks. You may ask only for a rank
that appears in your hand. Use public history and book counts strategically.

Return exactly one JSON object and no prose:
{"player":"PLAYER_NAME","target":"Player Two","rank":"7","turnToken":"TOKEN_FROM_INPUT"}

Copy player and turnToken exactly. target must be one legalTargets value. rank
must be one exact legalRanks value.`;

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

function player(id, name, position) {
  return node(
    id,
    'agent',
    name,
    'Chooses which opponent to ask and which held rank to request.',
    position,
    {
      systemPrompt: PLAYER_PROMPT.replace('PLAYER_NAME', name),
      reasoningEffort: 'low',
      maxOutputTokens: 400,
    },
  );
}

export function createGoFishHarness() {
  const nodes = [
    node(
      'go-fish-start',
      'trigger',
      'Start Go Fish',
      'Starts one fresh three-player Go Fish game.',
      { x: 80, y: 310 },
      { payload: 'START_GO_FISH', continueState: false },
    ),
    node(
      'go-fish-engine',
      'logic',
      'Game Engine',
      'Owns the deck, hands, books, legal asks, turns, draws, and victory.',
      { x: 390, y: 300 },
      {
        operation: 'generated',
        routerPrompt:
          'Run standard three-player Go Fish. Deal seven cards each from one shuffled 52-card deck. Agents choose only a legal target and a rank they hold. End immediately when the first player completes four books and emit GAME_OVER through the Governor.',
        generatedCode: GO_FISH_ROUTER_CODE,
        generatedSummary:
          'Authoritative three-player Go Fish engine with strict asks, private hands, books, and first-to-four victory.',
        generatedAt: new Date().toISOString(),
        generatedJobId: 'hand-authored-go-fish-engine',
        generatedAssumptions: [
          'Three-player Go Fish deals seven cards to each player.',
          'A successful ask or drawing the requested rank grants another turn.',
          'A book is four cards of the same rank and is removed from the hand.',
        ],
        generatedTests: [
          {
            name: 'fresh game activates Player One',
            input: 'START_GO_FISH',
            randomValue: 0.37,
            expectedTargetIds: ['go-fish-player-one'],
          },
          {
            name: 'fourth book emits Governor stop signal',
            expectedType: 'GAME_OVER',
            expectedTargetIds: [
              'go-fish-game-archive',
              'go-fish-governor',
              'go-fish-table-display',
            ],
          },
        ],
        generatedVersions: [],
        rules: '',
        template: '{{input}}',
      },
    ),
    player('go-fish-player-one', 'Player One', { x: 735, y: 90 }),
    player('go-fish-player-two', 'Player Two', { x: 735, y: 300 }),
    player('go-fish-player-three', 'Player Three', { x: 735, y: 510 }),
    node(
      'go-fish-governor',
      'governor',
      'Game Governor',
      'Passes player asks to the Game Engine and blocks the GAME_OVER continuation.',
      { x: 1080, y: 300 },
      { maxActivations: 10000, stopPhrase: 'GAME_OVER' },
    ),
    node(
      'go-fish-game-archive',
      'memory',
      'Completed Game Archive',
      'Stores the complete final game state and history.',
      { x: 1080, y: 535 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'go-fish-table-display',
      'output',
      'Final Table',
      'Captures the winner, books, remaining hands, deck, and complete history.',
      { x: 1390, y: 300 },
      {},
    ),
  ];
  const edges = [
    edge('go-fish-edge-start-engine', 'go-fish-start', 'go-fish-engine', 'trigger'),
    edge('go-fish-edge-engine-one', 'go-fish-engine', 'go-fish-player-one', 'data'),
    edge('go-fish-edge-engine-two', 'go-fish-engine', 'go-fish-player-two', 'data'),
    edge('go-fish-edge-engine-three', 'go-fish-engine', 'go-fish-player-three', 'data'),
    edge('go-fish-edge-one-governor', 'go-fish-player-one', 'go-fish-governor', 'data'),
    edge('go-fish-edge-two-governor', 'go-fish-player-two', 'go-fish-governor', 'data'),
    edge('go-fish-edge-three-governor', 'go-fish-player-three', 'go-fish-governor', 'data'),
    edge('go-fish-edge-engine-governor', 'go-fish-engine', 'go-fish-governor', 'data'),
    edge('go-fish-edge-governor-engine', 'go-fish-governor', 'go-fish-engine', 'data'),
    edge('go-fish-edge-engine-archive', 'go-fish-engine', 'go-fish-game-archive', 'write'),
    edge('go-fish-edge-engine-display', 'go-fish-engine', 'go-fish-table-display', 'data'),
  ];
  return {
    format: 'synapse-flow/harness',
    version: 2,
    name: 'Three Player Go Fish - Governor Test',
    nodes,
    edges,
  };
}

export async function writeGoFishHarness(outputPath) {
  const harness = createGoFishHarness();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(harness, null, 2), 'utf8');
  return harness;
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (currentFile === invokedFile) {
  const outputPath = path.resolve(
    'examples/three-player-go-fish-governor.synapse.json',
  );
  await writeGoFishHarness(outputPath);
  console.log(`Wrote ${outputPath}`);
}
