import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FOUR_AGENT_BLACKJACK_ROUTER_CODE = `function route(input, context, state) {
  const players = [
    { name: "Player One", id: "four-agent-blackjack-player-one" },
    { name: "Player Two", id: "four-agent-blackjack-player-two" },
    { name: "Player Three", id: "four-agent-blackjack-player-three" }
  ];
  const dealerId = "four-agent-blackjack-dealer-agent";
  const ledgerId = "four-agent-blackjack-round-ledger";
  const outputId = "four-agent-blackjack-table-display";

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

  function nextToken(roundState, actor) {
    return (
      "round-" +
      roundState.round +
      "-action-" +
      roundState.actionNumber +
      "-" +
      actor.replaceAll(" ", "-").toLowerCase() +
      "-" +
      context.runtime.invocationId.slice(0, 8)
    );
  }

  function publicPlayerTurn(roundState, event, type) {
    const player = players[roundState.playerIndex];
    const value = handValue(roundState.hands[player.name]);
    return {
      type: type || "player_turn",
      round: roundState.round,
      shoe: roundState.shoe,
      player: player.name,
      hand: roundState.hands[player.name],
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

  function publicDealerTurn(roundState, event, type) {
    const value = handValue(roundState.hands.Dealer);
    const legalActions = value.total < 17 ? ["hit"] : ["stand"];
    return {
      type: type || "dealer_turn",
      round: roundState.round,
      shoe: roundState.shoe,
      dealer: "Dealer",
      hand: roundState.hands.Dealer,
      total: value.total,
      soft: value.soft,
      legalActions,
      actionToken: roundState.actionToken,
      cardsRemaining: roundState.deck.length,
      playerTotals: Object.fromEntries(
        players.map((player) => [
          player.name,
          handValue(roundState.hands[player.name]).total
        ])
      ),
      lastEvent: event,
      instruction: "Return the one legal Dealer action as strict JSON."
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
    const dealerValue = handValue(roundState.hands.Dealer);
    const statuses = {
      ...roundState.statuses,
      Dealer: dealerValue.total > 21 ? "bust" : "stand"
    };
    const completed = {
      ...roundState,
      phase: "round_complete",
      statuses
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
        handValue(completed.hands[name]).total
      ])
    );
    const payload = {
      type: "round_complete",
      round: completed.round,
      shoe: completed.shoe,
      hands: completed.hands,
      totals,
      results,
      dealerStatus: statuses.Dealer,
      cardsRemaining: completed.deck.length,
      lastEvent: event,
      message:
        "Round " +
        completed.round +
        " complete. Fire Deal Next Round to continue from the remaining " +
        completed.deck.length +
        " cards."
    };
    return {
      targetIds: [ledgerId, outputId],
      payload,
      state: { ...completed, results }
    };
  }

  function activateDealer(roundState, event) {
    const dealerValue = handValue(roundState.hands.Dealer);
    if (dealerValue.total === 21 && roundState.hands.Dealer.length === 2) {
      return completeRound(roundState, {
        kind: "dealer_blackjack",
        message: "The Dealer revealed blackjack."
      });
    }
    const nextState = {
      ...roundState,
      phase: "dealer",
      actionNumber: roundState.actionNumber + 1,
      statuses: { ...roundState.statuses, Dealer: "acting" }
    };
    nextState.actionToken = nextToken(nextState, "Dealer");
    return {
      targetIds: [dealerId, outputId],
      payload: publicDealerTurn(nextState, event),
      state: nextState
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
        payload: publicPlayerTurn(nextState, event),
        state: nextState
      };
    }
    return activateDealer(roundState, event);
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
    return activateNextPlayer(roundState, -1, {
      kind: "round_dealt",
      reshuffled,
      message: reshuffled
        ? "A fresh deck was shuffled and the round was dealt."
        : "The round was dealt from the remaining deck."
    });
  }

  if (!state.initialized) {
    return { drop: true, payload: input, state };
  }

  if (state.phase === "players") {
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
        payload: publicPlayerTurn(
          state,
          {
            kind: "invalid_player_decision",
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
        return activateDealer(state, {
          kind: "deck_exhausted",
          message: "No card remained for the requested player hit."
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
          payload: publicPlayerTurn(nextState, event),
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
  }

  if (state.phase === "dealer") {
    const decision = parseDecision(input);
    const action = String(decision && decision.action || "").toLowerCase();
    const dealerValue = handValue(state.hands.Dealer);
    const legalActions = dealerValue.total < 17 ? ["hit"] : ["stand"];
    const valid =
      decision &&
      decision.dealer === "Dealer" &&
      decision.actionToken === state.actionToken &&
      legalActions.includes(action);

    if (!valid) {
      return {
        targetIds: [dealerId, outputId],
        payload: publicDealerTurn(
          state,
          {
            kind: "invalid_dealer_decision",
            message: "Use the exact Dealer identity, actionToken, and legal action."
          },
          "dealer_retry"
        ),
        state
      };
    }

    if (action === "stand") {
      return completeRound(state, {
        kind: "dealer_stand",
        total: dealerValue.total,
        message: "Dealer stood at " + dealerValue.total + "."
      });
    }

    if (state.deck.length === 0) {
      return completeRound(state, {
        kind: "deck_exhausted",
        message: "No card remained for the Dealer hit."
      });
    }
    const deck = state.deck.slice();
    const card = deck.shift();
    const hands = {
      ...state.hands,
      Dealer: [...state.hands.Dealer, card]
    };
    const nextValue = handValue(hands.Dealer);
    const event = {
      kind: nextValue.total > 21 ? "dealer_bust" : "dealer_hit",
      card,
      total: nextValue.total,
      message:
        nextValue.total > 21
          ? "Dealer drew " + card + " and busted at " + nextValue.total + "."
          : "Dealer drew " + card + " for " + nextValue.total + "."
    };
    const nextState = { ...state, deck, hands };
    if (nextValue.total > 21) return completeRound(nextState, event);
    nextState.actionNumber = state.actionNumber + 1;
    nextState.actionToken = nextToken(nextState, "Dealer");
    return {
      targetIds: [dealerId, outputId],
      payload: publicDealerTurn(nextState, event),
      state: nextState
    };
  }

  return { drop: true, payload: input, state };
}`;

const ROUTER_PROMPT = `Run a single-deck blackjack table with four Luna
participants: one Dealer Agent and three player Agents.

The Table Engine owns only authoritative mechanics: the remaining deck, dealing,
hand totals, action tokens, validation, round number, and final comparisons.
The Dealer must be a connected Luna Agent. The Table Engine must send the
Dealer's revealed hand to that Agent and wait for strict JSON hit-or-stand
responses instead of choosing Dealer actions internally.

This prototype uses hit and stand only. It does not model betting, splits,
doubles, surrender, or insurance. Players may choose hit or stand. The Dealer
Agent must hit below 17 and stand on hard or soft 17 or above. Reject invalid or
stale participant decisions and retry the same Agent without advancing.

On DEAL_ROUND, reuse the remaining private deck. Shuffle a new 52-card deck only
when no prior deck exists or fewer than 20 cards remain. After all players
finish, route to the Dealer Agent until it stands or busts. Send the completed
round only to Round Ledger and Table Display, with no continuation target.

Use context.runtime.randomValue to shuffle. Preserve the remaining deck and
round number in private Router state for continuation Trigger sessions.`;

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
    'Chooses hit or stand for one blackjack hand using the Table Engine state.',
    position,
    {
      systemPrompt: `You are ${name}, one of three players at a blackjack table.

You receive an authoritative player_turn or retry payload from the Table Engine.
Choose exactly one action from legalActions.

Use sensible blackjack play:
- Stand on hard 17 or higher.
- Hit hard 11 or lower.
- On hard 12, stand against Dealer 4 through 6 and otherwise hit.
- On hard 13 through 16, stand against Dealer 2 through 6 and otherwise hit.
- On soft totals below 18, hit; on soft 19 or higher, stand.
- On soft 18, stand against Dealer 2 through 8 and otherwise hit.

Return exactly one JSON object with no Markdown and no extra text:
{"player":"${name}","action":"hit","actionToken":"TOKEN_FROM_INPUT"}

The action must be "hit" or "stand". Copy actionToken exactly. Never invent or
alter cards. The Table Engine resolves all authoritative mechanics.`,
      reasoningEffort: 'low',
      maxOutputTokens: 160,
    },
  );
}

function dealer(position) {
  return node(
    'four-agent-blackjack-dealer-agent',
    'agent',
    'Dealer Agent',
    'Controls the Dealer hand by returning each required hit or stand action.',
    position,
    {
      systemPrompt: `You are the Dealer at a blackjack table.

You receive an authoritative dealer_turn or dealer_retry payload from the Table
Engine. It contains the Dealer hand, total, whether it is soft, legalActions,
and actionToken.

Return exactly one JSON object with no Markdown and no extra text:
{"dealer":"Dealer","action":"hit","actionToken":"TOKEN_FROM_INPUT"}

Choose exactly the one action listed in legalActions. Copy actionToken exactly.
Never invent, deal, remove, or rename cards. The Table Engine controls the deck,
validates your response, and scores the round.`,
      reasoningEffort: 'low',
      maxOutputTokens: 140,
    },
  );
}

export function createFourAgentBlackjackHarness() {
  const nodes = [
    node(
      'four-agent-blackjack-next-round-trigger',
      'trigger',
      'Deal Next Round',
      'Starts a fresh table or continues with the remaining deck after a completed round.',
      { x: 40, y: 370 },
      { payload: 'DEAL_ROUND', continueState: true },
    ),
    node(
      'four-agent-blackjack-table-engine',
      'logic',
      'Table Engine',
      'Owns cards and rules while routing every Dealer and player decision through Luna Agents.',
      { x: 340, y: 370 },
      {
        operation: 'generated',
        routerPrompt: ROUTER_PROMPT,
        generatedCode: FOUR_AGENT_BLACKJACK_ROUTER_CODE,
        generatedSummary:
          'Runs one blackjack round with a fourth Luna Agent controlling Dealer actions.',
        generatedAt: '2026-07-30T00:00:00.000Z',
        generatedJobId: 'four-agent-blackjack-bootstrap',
        rules: '',
        template: '{{input}}',
      },
    ),
    dealer({ x: 700, y: 30 }),
    player('four-agent-blackjack-player-one', 'Player One', { x: 700, y: 210 }),
    player('four-agent-blackjack-player-two', 'Player Two', { x: 700, y: 390 }),
    player('four-agent-blackjack-player-three', 'Player Three', { x: 700, y: 570 }),
    node(
      'four-agent-blackjack-round-ledger',
      'memory',
      'Round Ledger',
      'Appends each completed round across continuation sessions.',
      { x: 1080, y: 190 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'four-agent-blackjack-table-display',
      'output',
      'Table Display',
      'Shows current player and Dealer turns plus the completed round.',
      { x: 1080, y: 370 },
      {},
    ),
  ];

  const edges = [
    edge(
      'four-agent-blackjack-edge-trigger-engine',
      'four-agent-blackjack-next-round-trigger',
      'four-agent-blackjack-table-engine',
      'trigger',
    ),
    edge(
      'four-agent-blackjack-edge-engine-dealer',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-dealer-agent',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-engine-one',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-player-one',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-engine-two',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-player-two',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-engine-three',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-player-three',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-dealer-engine',
      'four-agent-blackjack-dealer-agent',
      'four-agent-blackjack-table-engine',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-one-engine',
      'four-agent-blackjack-player-one',
      'four-agent-blackjack-table-engine',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-two-engine',
      'four-agent-blackjack-player-two',
      'four-agent-blackjack-table-engine',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-three-engine',
      'four-agent-blackjack-player-three',
      'four-agent-blackjack-table-engine',
      'data',
    ),
    edge(
      'four-agent-blackjack-edge-engine-ledger',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-round-ledger',
      'write',
    ),
    edge(
      'four-agent-blackjack-edge-engine-display',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-table-display',
      'data',
    ),
  ];

  return {
    version: 1,
    name: 'Four Agent Blackjack',
    nodes,
    edges,
  };
}

export async function writeFourAgentBlackjackHarness(outputPath) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(
    resolved,
    `${JSON.stringify(createFourAgentBlackjackHarness(), null, 2)}\n`,
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
    'four-agent-blackjack.synapse.json',
  );
  await writeFourAgentBlackjackHarness(output);
  console.log(output);
}
