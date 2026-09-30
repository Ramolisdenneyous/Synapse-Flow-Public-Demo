import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BLACKJACK_ROUTER_CODE = `function route(input, context, state) {
  const players = [
    { name: "Player One", id: "blackjack-player-one" },
    { name: "Player Two", id: "blackjack-player-two" },
    { name: "Player Three", id: "blackjack-player-three" }
  ];
  const ledgerId = "blackjack-round-ledger";
  const outputId = "blackjack-table-display";

  function shuffledDeck(randomValue) {
    const suits = ["S", "H", "D", "C"];
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    const deck = [];
    for (const suit of suits) {
      for (const rank of ranks) deck.push(rank + suit);
    }

    let seed = Math.floor(randomValue * 4294967296) >>> 0;
    function nextRandom() {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const choice = Math.floor(nextRandom() * (index + 1));
      const held = deck[index];
      deck[index] = deck[choice];
      deck[choice] = held;
    }
    return deck;
  }

  function rank(card) {
    return String(card).slice(0, -1);
  }

  function handValue(hand) {
    let total = 0;
    let aces = 0;
    for (const card of hand) {
      const value = rank(card);
      if (value === "A") {
        total += 11;
        aces += 1;
      } else if (["K", "Q", "J"].includes(value)) {
        total += 10;
      } else {
        total += Number(value);
      }
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return { total, soft: aces > 0 };
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

  function nextToken(roundState, playerName) {
    return (
      "round-" +
      roundState.round +
      "-action-" +
      roundState.actionNumber +
      "-" +
      playerName.replaceAll(" ", "-").toLowerCase() +
      "-" +
      context.runtime.invocationId.slice(0, 8)
    );
  }

  function publicTurn(roundState, event, type) {
    const player = players[roundState.playerIndex];
    const playerHand = roundState.hands[player.name];
    const value = handValue(playerHand);
    return {
      type: type || "player_turn",
      round: roundState.round,
      shoe: roundState.shoe,
      player: player.name,
      hand: playerHand,
      total: value.total,
      soft: value.soft,
      dealerUpCard: roundState.hands.Dealer[0],
      dealerHiddenCards: Math.max(0, roundState.hands.Dealer.length - 1),
      legalActions: ["hit", "stand"],
      actionToken: roundState.actionToken,
      cardsRemaining: roundState.deck.length,
      lastEvent: event,
      instruction: "Return one strict JSON hit-or-stand decision."
    };
  }

  function resultFor(playerName, roundState, dealerValue) {
    const hand = roundState.hands[playerName];
    const playerValue = handValue(hand).total;
    const playerBlackjack = hand.length === 2 && playerValue === 21;
    const dealerBlackjack = roundState.hands.Dealer.length === 2 && dealerValue === 21;
    if (playerValue > 21) return "loss";
    if (playerBlackjack && dealerBlackjack) return "push";
    if (playerBlackjack) return "blackjack";
    if (dealerBlackjack) return "loss";
    if (dealerValue > 21) return "win";
    if (playerValue > dealerValue) return "win";
    if (playerValue < dealerValue) return "loss";
    return "push";
  }

  function completeRound(roundState, event) {
    const deck = roundState.deck.slice();
    const dealerHand = roundState.hands.Dealer.slice();
    let dealerValue = handValue(dealerHand);
    while (dealerValue.total < 17 && deck.length > 0) {
      dealerHand.push(deck.shift());
      dealerValue = handValue(dealerHand);
    }

    const hands = { ...roundState.hands, Dealer: dealerHand };
    const completed = {
      ...roundState,
      phase: "round_complete",
      deck,
      hands,
      statuses: {
        ...roundState.statuses,
        Dealer: dealerValue.total > 21 ? "bust" : "stand"
      }
    };
    const results = Object.fromEntries(
      players.map((player) => [
        player.name,
        resultFor(player.name, completed, dealerValue.total)
      ])
    );
    const totals = Object.fromEntries(
      ["Dealer", ...players.map((player) => player.name)].map((name) => [
        name,
        handValue(hands[name]).total
      ])
    );
    const payload = {
      type: "round_complete",
      round: completed.round,
      shoe: completed.shoe,
      hands,
      totals,
      results,
      dealerStatus: completed.statuses.Dealer,
      cardsRemaining: deck.length,
      lastEvent: event,
      message:
        "Round " +
        completed.round +
        " complete. Fire Deal Next Round to continue from the remaining " +
        deck.length +
        " cards."
    };
    return {
      targetIds: [ledgerId, outputId],
      payload,
      state: { ...completed, results }
    };
  }

  function activateNextPlayer(roundState, afterIndex, event) {
    for (let index = afterIndex + 1; index < players.length; index += 1) {
      const player = players[index];
      if (roundState.statuses[player.name] !== "waiting") continue;
      const nextState = {
        ...roundState,
        playerIndex: index,
        actionNumber: roundState.actionNumber + 1,
        statuses: { ...roundState.statuses, [player.name]: "acting" }
      };
      nextState.actionToken = nextToken(nextState, player.name);
      return {
        targetIds: [player.id, outputId],
        payload: publicTurn(nextState, event),
        state: nextState
      };
    }
    return completeRound(roundState, event);
  }

  const startRequested =
    String(input || "").trim().toUpperCase() === "DEAL_ROUND" ||
    (input && typeof input === "object" && input.type === "deal_round");

  if (startRequested) {
    let deck = Array.isArray(state.deck) ? state.deck.slice() : [];
    let shoe = Number(state.shoe) || 0;
    let reshuffled = false;
    if (deck.length < 20) {
      deck = shuffledDeck(context.runtime.randomValue);
      shoe += 1;
      reshuffled = true;
    }

    const hands = {
      Dealer: [],
      "Player One": [],
      "Player Two": [],
      "Player Three": []
    };
    const dealOrder = [...players.map((player) => player.name), "Dealer"];
    for (let pass = 0; pass < 2; pass += 1) {
      for (const name of dealOrder) hands[name].push(deck.shift());
    }

    const statuses = { Dealer: "hidden" };
    for (const player of players) {
      statuses[player.name] =
        handValue(hands[player.name]).total === 21 ? "blackjack" : "waiting";
    }
    const roundState = {
      initialized: true,
      phase: "players",
      shoe,
      round: (Number(state.round) || 0) + 1,
      deck,
      hands,
      statuses,
      playerIndex: -1,
      actionNumber: 0,
      actionToken: "",
      reshuffled
    };
    if (handValue(hands.Dealer).total === 21) {
      return completeRound(roundState, {
        kind: "dealer_blackjack",
        message: "The Dealer has blackjack."
      });
    }
    return activateNextPlayer(roundState, -1, {
      kind: "round_dealt",
      reshuffled,
      message: reshuffled
        ? "A fresh deck was shuffled and the round was dealt."
        : "The round was dealt from the remaining deck."
    });
  }

  if (!state.initialized || state.phase !== "players") {
    return { drop: true, payload: input, state };
  }

  const currentPlayer = players[state.playerIndex];
  const decision = parseDecision(input);
  const action = String(decision && decision.action || "").toLowerCase();
  const valid =
    decision &&
    decision.player === currentPlayer.name &&
    decision.actionToken === state.actionToken &&
    ["hit", "stand"].includes(action);

  if (!valid) {
    return {
      targetIds: [currentPlayer.id, outputId],
      payload: publicTurn(
        state,
        {
          kind: "invalid_decision",
          message: "Use the exact player, actionToken, and a legal action."
        },
        "retry"
      ),
      state
    };
  }

  const deck = state.deck.slice();
  const hands = { ...state.hands };
  const statuses = { ...state.statuses };
  let event;

  if (action === "hit") {
    if (deck.length === 0) {
      return completeRound(state, {
        kind: "deck_exhausted",
        message: "The deck was exhausted before another card could be dealt."
      });
    }
    const card = deck.shift();
    hands[currentPlayer.name] = [...hands[currentPlayer.name], card];
    const value = handValue(hands[currentPlayer.name]).total;
    event = {
      kind: value > 21 ? "player_bust" : "player_hit",
      player: currentPlayer.name,
      card,
      total: value,
      message:
        value > 21
          ? currentPlayer.name + " drew " + card + " and busted at " + value + "."
          : currentPlayer.name + " drew " + card + " for " + value + "."
    };
    if (value < 21) {
      const nextState = {
        ...state,
        deck,
        hands,
        actionNumber: state.actionNumber + 1
      };
      nextState.actionToken = nextToken(nextState, currentPlayer.name);
      return {
        targetIds: [currentPlayer.id, outputId],
        payload: publicTurn(nextState, event),
        state: nextState
      };
    }
    statuses[currentPlayer.name] = value > 21 ? "bust" : "stand";
  } else {
    statuses[currentPlayer.name] = "stand";
    event = {
      kind: "player_stand",
      player: currentPlayer.name,
      total: handValue(hands[currentPlayer.name]).total,
      message:
        currentPlayer.name +
        " stood at " +
        handValue(hands[currentPlayer.name]).total +
        "."
    };
  }

  return activateNextPlayer(
    { ...state, deck, hands, statuses },
    state.playerIndex,
    event
  );
}`;

const ROUTER_PROMPT = `Run a standard single-deck blackjack table with one
deterministic Dealer and three Luna players named Player One, Player Two, and
Player Three.

This prototype uses hit and stand only. It does not model betting, splits,
doubles, surrender, or insurance. A Dealer blackjack ends the round immediately.

The Dealer owns the authoritative shuffled deck, hands, card totals, action
tokens, round number, legal actions, dealer play, and results. On DEAL_ROUND,
reuse the remaining deck from private state. Shuffle a fresh 52-card deck only
when no prior deck exists or fewer than 20 cards remain. Deal two cards to each
player and the Dealer in table order.

Send a public turn only to the active player and Table Display. The player must
return strict JSON containing player, action "hit" or "stand", and the exact
actionToken. Reject invalid or stale decisions and retry the same player without
advancing. Deal hits from the authoritative deck. Aces count as 11 or 1.

After all players stand, bust, or have blackjack, the Dealer draws until 17 and
stands on soft 17. Compare all three hands against the Dealer using blackjack,
win, loss, and push results. Send the final round only to Round Ledger and Table
Display, with no continuation target so the queue stops.

Use context.runtime.randomValue to shuffle. Keep the remaining deck and round
number in private Router state so a continuation Trigger can start the next
round from the same deck.`;

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

function player(id, name, position) {
  return node(
    id,
    'agent',
    name,
    'Chooses hit or stand for one blackjack hand using the Dealer state.',
    position,
    {
      systemPrompt: `You are ${name}, one of three players at a blackjack table.

You receive an authoritative player_turn or retry payload from the Dealer. It
contains your hand, total, whether the total is soft, the Dealer up-card,
legalActions, and actionToken.

Choose exactly one legal action. Use sensible blackjack play:
- Stand on hard 17 or higher.
- Hit hard 11 or lower.
- On hard 12, stand against Dealer 4 through 6 and otherwise hit.
- On hard 13 through 16, stand against Dealer 2 through 6 and otherwise hit.
- On soft totals below 18, hit; on soft 19 or higher, stand.
- On soft 18, stand against Dealer 2 through 8 and otherwise hit.

Return exactly one JSON object with no Markdown and no extra text:
{"player":"${name}","action":"hit","actionToken":"TOKEN_FROM_INPUT"}

The action must be "hit" or "stand". Copy actionToken exactly. Never invent,
deal, remove, or rename cards. The Dealer resolves all authoritative rules.`,
      reasoningEffort: 'low',
      maxOutputTokens: 160,
    },
  );
}

export function createBlackjackHarness() {
  const nodes = [
    node(
      'blackjack-next-round-trigger',
      'trigger',
      'Deal Next Round',
      'Starts a fresh table or continues with the remaining deck after a completed round.',
      { x: 40, y: 340 },
      { payload: 'DEAL_ROUND', continueState: true },
    ),
    node(
      'blackjack-dealer',
      'logic',
      'Dealer',
      'Owns the deck, deals cards, validates turns, plays the Dealer hand, and scores each round.',
      { x: 340, y: 340 },
      {
        operation: 'generated',
        routerPrompt: ROUTER_PROMPT,
        generatedCode: BLACKJACK_ROUTER_CODE,
        generatedSummary:
          'Runs one three-player blackjack round and retains the remaining deck for continuation.',
        generatedAt: '2026-07-30T00:00:00.000Z',
        generatedJobId: 'blackjack-bootstrap',
        rules: '',
        template: '{{input}}',
      },
    ),
    player('blackjack-player-one', 'Player One', { x: 700, y: 80 }),
    player('blackjack-player-two', 'Player Two', { x: 700, y: 300 }),
    player('blackjack-player-three', 'Player Three', { x: 700, y: 520 }),
    node(
      'blackjack-round-ledger',
      'memory',
      'Round Ledger',
      'Appends each completed round and persists it across continuation fires.',
      { x: 1080, y: 220 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'blackjack-table-display',
      'output',
      'Table Display',
      'Shows the current player turn and the completed round result.',
      { x: 1080, y: 400 },
      {},
    ),
  ];

  const edges = [
    edge(
      'blackjack-edge-trigger-dealer',
      'blackjack-next-round-trigger',
      'blackjack-dealer',
      'trigger',
    ),
    edge('blackjack-edge-dealer-one', 'blackjack-dealer', 'blackjack-player-one', 'data'),
    edge('blackjack-edge-dealer-two', 'blackjack-dealer', 'blackjack-player-two', 'data'),
    edge('blackjack-edge-dealer-three', 'blackjack-dealer', 'blackjack-player-three', 'data'),
    edge('blackjack-edge-one-dealer', 'blackjack-player-one', 'blackjack-dealer', 'data'),
    edge('blackjack-edge-two-dealer', 'blackjack-player-two', 'blackjack-dealer', 'data'),
    edge('blackjack-edge-three-dealer', 'blackjack-player-three', 'blackjack-dealer', 'data'),
    edge(
      'blackjack-edge-dealer-ledger',
      'blackjack-dealer',
      'blackjack-round-ledger',
      'write',
    ),
    edge(
      'blackjack-edge-dealer-display',
      'blackjack-dealer',
      'blackjack-table-display',
      'data',
    ),
  ];

  return {
    version: 1,
    name: 'Three Player Blackjack',
    nodes,
    edges,
  };
}

export async function writeBlackjackHarness(outputPath) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(
    resolved,
    `${JSON.stringify(createBlackjackHarness(), null, 2)}\n`,
    'utf8',
  );
  return resolved;
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const output = path.resolve(
    here,
    '..',
    'examples',
    'three-player-blackjack.synapse.json',
  );
  await writeBlackjackHarness(output);
  console.log(output);
}
