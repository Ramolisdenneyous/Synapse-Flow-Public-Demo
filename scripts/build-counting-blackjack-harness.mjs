import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const COUNTING_BLACKJACK_ROUTER_CODE = `function route(input, context, state) {
  const players = [
    { name: "Player One", id: "four-agent-blackjack-player-one" },
    { name: "Player Two", id: "four-agent-blackjack-player-two" },
    { name: "Player Three", id: "four-agent-blackjack-player-three" }
  ];
  const dealerId = "four-agent-blackjack-dealer-agent";
  const ledgerId = "four-agent-blackjack-round-ledger";
  const outputId = "four-agent-blackjack-table-display";
  const memoryIds = [
    "four-agent-blackjack-dealer-memory",
    "four-agent-blackjack-player-one-memory",
    "four-agent-blackjack-player-two-memory",
    "four-agent-blackjack-player-three-memory"
  ];
  const memoryByAgentId = {
    "four-agent-blackjack-dealer-agent": memoryIds[0],
    "four-agent-blackjack-player-one": memoryIds[1],
    "four-agent-blackjack-player-two": memoryIds[2],
    "four-agent-blackjack-player-three": memoryIds[3]
  };

  function observedTargets(...targetIds) {
    return [...memoryIds, ...targetIds];
  }

  function decisionTargets(agentId) {
    return [memoryByAgentId[agentId], agentId, outputId];
  }

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

  function hiLoValue(card) {
    const value = rank(card);
    if (["2", "3", "4", "5", "6"].includes(value)) return 1;
    if (["10", "J", "Q", "K", "A"].includes(value)) return -1;
    return 0;
  }

  function countingSnapshot(roundState) {
    const revealedCards = Array.isArray(roundState.revealedCards)
      ? roundState.revealedCards
      : [];
    const runningCount = revealedCards.reduce(
      (total, card) => total + hiLoValue(card),
      0
    );
    const decksRemaining = Math.max(roundState.deck.length / 52, 0.25);
    const rankFrequencies = {};
    for (const card of revealedCards) {
      const value = rank(card);
      rankFrequencies[value] = (rankFrequencies[value] || 0) + 1;
    }
    const unseenByRank = Object.fromEntries(
      ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].map(
        (value) => [value, 4 - (rankFrequencies[value] || 0)]
      )
    );
    return {
      system: "Hi-Lo",
      shoe: roundState.shoe,
      revealedCards,
      seenCards: revealedCards.length,
      unseenCards: 52 - revealedCards.length,
      cardsDealt: 52 - roundState.deck.length,
      cardsRemaining: roundState.deck.length,
      runningCount,
      decksRemaining: Number(decksRemaining.toFixed(2)),
      trueCount: Number((runningCount / decksRemaining).toFixed(2)),
      penetration: Number(((52 - roundState.deck.length) / 52).toFixed(3)),
      rankFrequencies,
      unseenByRank
    };
  }

  function publicTable(roundState) {
    return {
      hands: Object.fromEntries(
        players.map((player) => [player.name, roundState.hands[player.name]])
      ),
      totals: Object.fromEntries(
        players.map((player) => [
          player.name,
          handValue(roundState.hands[player.name]).total
        ])
      ),
      statuses: roundState.statuses,
      dealerUpCard: roundState.hands.Dealer[0],
      dealerHiddenCards: roundState.dealerRevealed
        ? 0
        : Math.max(0, roundState.hands.Dealer.length - 1),
      dealerHand: roundState.dealerRevealed
        ? roundState.hands.Dealer
        : [roundState.hands.Dealer[0]]
    };
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
      publicTable: publicTable(roundState),
      counting: countingSnapshot(roundState),
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
      publicTable: publicTable(roundState),
      counting: countingSnapshot(roundState),
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
      publicTable: publicTable(completed),
      counting: countingSnapshot(completed),
      lastEvent: event,
      message:
        "Round " +
        completed.round +
        " complete. Fire Deal Next Round to continue from the remaining " +
        completed.deck.length +
        " cards."
    };
    return {
      targetIds: observedTargets(ledgerId, outputId),
      payload,
      state: { ...completed, results }
    };
  }

  function activateDealer(roundState, event) {
    const revealedState = roundState.dealerRevealed
      ? roundState
      : {
          ...roundState,
          dealerRevealed: true,
          revealedCards: [
            ...roundState.revealedCards,
            ...roundState.hands.Dealer.slice(1)
          ]
        };
    const revealEvent = roundState.dealerRevealed
      ? event
      : {
          kind: "dealer_reveal",
          cards: roundState.hands.Dealer.slice(1),
          previousEvent: event,
          message: "The Dealer revealed the hidden card."
        };
    const dealerValue = handValue(revealedState.hands.Dealer);
    if (dealerValue.total === 21 && revealedState.hands.Dealer.length === 2) {
      return completeRound(revealedState, {
        kind: "dealer_blackjack",
        message: "The Dealer revealed blackjack."
      });
    }
    const nextState = {
      ...revealedState,
      phase: "dealer",
      actionNumber: revealedState.actionNumber + 1,
      statuses: { ...revealedState.statuses, Dealer: "acting" }
    };
    nextState.actionToken = nextToken(nextState, "Dealer");
    return {
      targetIds: decisionTargets(dealerId),
      payload: publicDealerTurn(nextState, revealEvent),
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
        targetIds: decisionTargets(player.id),
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
    const priorRevealed =
      !reshuffled && Array.isArray(state.revealedCards)
        ? state.revealedCards
        : [];
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
      reshuffled,
      dealerRevealed: false,
      revealedCards: [
        ...priorRevealed,
        hands["Player One"][0],
        hands["Player Two"][0],
        hands["Player Three"][0],
        hands.Dealer[0],
        hands["Player One"][1],
        hands["Player Two"][1],
        hands["Player Three"][1]
      ]
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
        targetIds: decisionTargets(currentPlayer.id),
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
          revealedCards: [...state.revealedCards, card],
          actionNumber: state.actionNumber + 1
        };
        nextState.actionToken = nextToken(nextState, currentPlayer.name);
        return {
          targetIds: decisionTargets(currentPlayer.id),
          payload: publicPlayerTurn(nextState, event),
          state: nextState
        };
      }
      state = {
        ...state,
        revealedCards: [...state.revealedCards, card]
      };
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
        targetIds: decisionTargets(dealerId),
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
    const nextState = {
      ...state,
      deck,
      hands,
      revealedCards: [...state.revealedCards, card]
    };
    if (nextValue.total > 21) return completeRound(nextState, event);
    nextState.actionNumber = state.actionNumber + 1;
    nextState.actionToken = nextToken(nextState, "Dealer");
    return {
      targetIds: decisionTargets(dealerId),
      payload: publicDealerTurn(nextState, event),
      state: nextState
    };
  }

  return { drop: true, payload: input, state };
}`;

export const COUNTING_BLACKJACK_ROUTER_PROMPT = `AUTHORITY
Implement the complete deterministic Table Engine for one single-deck blackjack
round. The Router owns the deck, dealing, hands, totals, phases, legal-action
validation, correlation tokens, public card history, Hi-Lo reference count,
continuation state, and scoring. The four Luna Agents choose only hit or stand.
Never ask an Agent to invent, deal, remove, or validate cards.

CONNECTED IDS
- Trigger: four-agent-blackjack-next-round-trigger
- Router: four-agent-blackjack-table-engine
- Dealer Agent: four-agent-blackjack-dealer-agent
- Player Agents: four-agent-blackjack-player-one,
  four-agent-blackjack-player-two, four-agent-blackjack-player-three
- Private Count Memories: four-agent-blackjack-dealer-memory,
  four-agent-blackjack-player-one-memory,
  four-agent-blackjack-player-two-memory,
  four-agent-blackjack-player-three-memory
- Completed-round Memory: four-agent-blackjack-round-ledger
- Observer Output: four-agent-blackjack-table-display

LITERAL INPUT CONTRACTS
1. Deal Next Round emits the primitive string "DEAL_ROUND". It does not emit an
   object. Start a round when String(input).trim().toUpperCase() is DEAL_ROUND.
2. Every Luna Agent returns raw model text. Extract the first complete JSON object
   from that string and parse it. Also tolerate an already-parsed plain object.
3. Player One returns:
   {"player":"Player One","action":"hit","actionToken":"TOKEN_FROM_INPUT","countReport":{"shoe":1,"runningCount":0,"trueCount":0,"seenCards":7}}
   Player Two and Player Three use their exact display Names in player.
4. Dealer Agent returns:
   {"dealer":"Dealer","action":"hit","actionToken":"TOKEN_FROM_INPUT","countReport":{"shoe":1,"runningCount":0,"trueCount":0,"seenCards":8}}
5. countReport is advisory. Ignore it for authoritative mechanics. Accept it and
   any other harmless extra fields. Validate identity, action, and actionToken.

PRIVATE ROUTER STATE
Keep JSON-safe fields sufficient for:
- initialized, phase ("players", "dealer", or "round_complete")
- shoe and round numbers
- remaining deck as unique card codes
- hands keyed by "Dealer", "Player One", "Player Two", and "Player Three"
- statuses for all four participants
- current playerIndex
- actionNumber and actionToken
- reshuffled and dealerRevealed booleans
- cumulative revealedCards for the current shoe
- final results
Manual Trigger continuation preserves this state. A normal Run All supplies
empty state. DEAL_ROUND after round_complete begins one new round from the same
remaining deck unless the reshuffle condition applies.

DECK AND DEAL
- A fresh deck contains exactly 52 unique codes. Suits are S, H, D, C. Ranks are
  A,2,3,4,5,6,7,8,9,10,J,Q,K. A card is rank plus suit, such as 10H or AS.
- Shuffle only when no prior deck exists or fewer than 20 cards remain. Increment
  shoe and reset revealedCards only when shuffling.
- Use context.runtime.randomValue as the seed for a deterministic Fisher-Yates
  shuffle. A small local seeded PRNG may expand that one runtime value.
- Deal two passes in this exact order: Player One, Player Two, Player Three,
  Dealer. Remove dealt cards from the remaining deck.
- All six player cards and only the Dealer up card are public after the deal.
  Append those seven cards to revealedCards in deal order. Do not expose or count
  the Dealer hole card yet.
- Mark a two-card player total of 21 as blackjack and skip that player's turn.

HAND VALUES AND RULES
- Aces count as 11, reduced to 1 as needed to avoid busting.
- J, Q, and K count as 10.
- Players may hit or stand. A hit removes exactly one card from the deck, appends
  it to that hand and revealedCards, and requests another decision unless the
  hand reaches 21 or busts.
- A stand ends that player's turn. Then activate the next waiting player.
- Before Dealer Agent's first turn, reveal the Dealer hole card exactly once and
  append it to revealedCards.
- Dealer legalActions contains only ["hit"] below 17 and only ["stand"] on hard
  or soft 17 and above. The Router enforces this rule but the Dealer Agent must
  return every Dealer action.
- A Dealer hit reveals exactly one card. Continue Dealer Agent turns until stand
  or bust.
- Support only hit and stand. Do not add betting, splits, doubles, surrender, or
  insurance.

COUNTING SNAPSHOT
Every Agent-turn, retry, and round-complete payload must contain a counting
object computed only from revealedCards:
- system: "Hi-Lo"
- shoe
- revealedCards in reveal order
- seenCards and unseenCards
- cardsDealt and cardsRemaining
- runningCount: ranks 2-6 are +1, 7-9 are 0, 10/J/Q/K/A are -1
- decksRemaining, no lower than 0.25
- trueCount = runningCount / decksRemaining
- penetration
- rankFrequencies
- unseenByRank, starting from four of each rank
Reasonable numeric rounding is allowed. The cumulative revealedCards sequence
is authoritative, so later Agents and continuation rounds can independently
check the count without double-counting.

PUBLIC TABLE
Every public payload must also contain publicTable with all three player hands
and totals, participant statuses, Dealer up card, Dealer hidden-card count, and
Dealer hand. Before dealerRevealed, Dealer hand contains only the up card and the
hidden-card count is 1. After reveal it contains the complete Dealer hand and the
hidden-card count is 0.

TOKENS AND INVALID INPUT
- Create a fresh actionToken for every requested decision using round,
  actionNumber, participant identity, and context.runtime.invocationId.
- Player identity must exactly match the currently active player.
- Dealer identity must exactly be "Dealer".
- action must be lowercase hit or stand and must be present in legalActions.
- A malformed JSON string, stale token, wrong identity, or illegal action does
  not mutate deck, hands, status, phase, playerIndex, or actionNumber.
- Retry the same Agent with type "retry" for a player or "dealer_retry" for the
  Dealer, a useful lastEvent error, and the same actionToken.

AGENT TURN PAYLOADS
Player turn type is "player_turn" and contains:
round, shoe, player, hand, total, soft, dealerUpCard, dealerHiddenCards,
legalActions ["hit","stand"], actionToken, cardsRemaining, publicTable, counting,
lastEvent, and an instruction to return one strict JSON decision.

Dealer turn type is "dealer_turn" and contains:
round, shoe, dealer "Dealer", full Dealer hand, total, soft, the one-item
legalActions array, actionToken, cardsRemaining, playerTotals, publicTable,
counting, lastEvent, and an instruction to return the one legal action.

EXACT ACTIVE ROUTING
Before an Agent acts, write the same complete turn payload to only that Agent's
private Count Memory, then activate that Agent and update Table Display:
- Dealer: ["four-agent-blackjack-dealer-memory",
  "four-agent-blackjack-dealer-agent",
  "four-agent-blackjack-table-display"]
- Player One: ["four-agent-blackjack-player-one-memory",
  "four-agent-blackjack-player-one",
  "four-agent-blackjack-table-display"]
- Player Two: ["four-agent-blackjack-player-two-memory",
  "four-agent-blackjack-player-two",
  "four-agent-blackjack-table-display"]
- Player Three: ["four-agent-blackjack-player-three-memory",
  "four-agent-blackjack-player-three",
  "four-agent-blackjack-table-display"]
Keep each Memory ID before its Agent ID in targetIds for Sequential mode.

ROUND COMPLETION
- Reveal the Dealer hole card before scoring, including Dealer blackjack.
- Player bust loses. A two-card player 21 is blackjack unless Dealer also has a
  two-card 21, which is a push. Dealer blackjack beats other non-blackjack hands.
  Dealer bust makes every non-busted player win. Otherwise compare totals.
- Emit type "round_complete" with round, shoe, complete hands, totals, results,
  dealerStatus, cardsRemaining, publicTable, counting, lastEvent, and a message
  telling the user to fire Deal Next Round.
- Synchronize all four private Count Memories, append Round Ledger, and update
  Table Display with exactly:
  ["four-agent-blackjack-dealer-memory",
   "four-agent-blackjack-player-one-memory",
   "four-agent-blackjack-player-two-memory",
   "four-agent-blackjack-player-three-memory",
   "four-agent-blackjack-round-ledger",
   "four-agent-blackjack-table-display"]
- Do not target any Agent or Trigger after round completion.

GENERATION TEST CONTRACT
- tests[].input is passed directly to route as a literal string with state {}.
- Do not put {"input":...,"state":...} or any wrapper into tests[].input.
- Include at least one fresh-round test whose input field is exactly
  "DEAL_ROUND". Choose a randomValue that does not deal Player One blackjack and
  expect exactly Player One Count Memory, Player One, and Table Display.
- Do not invent non-empty Router state inside tests[].input. Stateful behavior
  will be tested separately by the user.
- Keep generated code synchronous, explicit, JSON-safe, and under the Router
  sandbox's 24,000-character limit.`;

const ROUTER_PROMPT = COUNTING_BLACKJACK_ROUTER_PROMPT;

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
    'Uses private shoe memory and card counting to choose hit or stand.',
    position,
    {
      systemPrompt: `You are ${name}, one of three players at a blackjack table.

You receive an authoritative player_turn or retry payload from the Table Engine.
Choose exactly one action from legalActions.

Your explicitly connected private memory contains the latest complete public
observation for the current shoe. Independently check its Hi-Lo running count:
2 through 6 are +1, 7 through 9 are 0, and 10 through Ace are -1. Do not count
the same revealed card twice. A new shoe resets the count.

Use sensible blackjack play:
- Stand on hard 17 or higher.
- Hit hard 11 or lower.
- On hard 12, stand against Dealer 4 through 6 and otherwise hit.
- On hard 13 through 16, stand against Dealer 2 through 6 and otherwise hit.
- On soft totals below 18, hit; on soft 19 or higher, stand.
- On soft 18, stand against Dealer 2 through 8 and otherwise hit.
- Use true-count deviations when relevant: stand on hard 16 versus Dealer 10 at
  true count 0 or higher; stand on hard 15 versus Dealer 10 at +4 or higher;
  stand on hard 12 versus Dealer 3 at +2 or higher, and versus Dealer 2 at +3
  or higher.

Return exactly one JSON object with no Markdown and no extra text:
{"player":"${name}","action":"hit","actionToken":"TOKEN_FROM_INPUT","countReport":{"shoe":1,"runningCount":0,"trueCount":0,"seenCards":7}}

The action must be "hit" or "stand". Copy actionToken exactly. Never invent or
alter cards. Report your count from the newest public snapshot. The Table Engine
resolves all authoritative mechanics.`,
      reasoningEffort: 'low',
      maxOutputTokens: 240,
    },
  );
}

function dealer(position) {
  return node(
    'four-agent-blackjack-dealer-agent',
    'agent',
    'Dealer Agent',
    'Uses private shoe memory while controlling each required Dealer action.',
    position,
    {
      systemPrompt: `You are the Dealer at a blackjack table.

You receive an authoritative dealer_turn or dealer_retry payload from the Table
Engine. It contains the Dealer hand, total, whether it is soft, legalActions,
and actionToken.

Your explicitly connected private memory contains the latest complete public
observation for the current shoe. Independently check its Hi-Lo running count:
2 through 6 are +1, 7 through 9 are 0, and 10 through Ace are -1. Do not count
the same revealed card twice. A new shoe resets the count.

Return exactly one JSON object with no Markdown and no extra text:
{"dealer":"Dealer","action":"hit","actionToken":"TOKEN_FROM_INPUT","countReport":{"shoe":1,"runningCount":0,"trueCount":0,"seenCards":8}}

Choose exactly the one action listed in legalActions. Copy actionToken exactly.
Report your count from the newest public snapshot. Card counting does not let
you violate the Dealer's legal action.
Never invent, deal, remove, or rename cards. The Table Engine controls the deck,
validates your response, and scores the round.`,
      reasoningEffort: 'low',
      maxOutputTokens: 220,
    },
  );
}

export function createCountingBlackjackHarness() {
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
        generatedCode: COUNTING_BLACKJACK_ROUTER_CODE,
        generatedSummary:
          'Runs one blackjack round with four card-counting Agents and isolated private Memories.',
        generatedAt: '2026-07-30T00:00:00.000Z',
        generatedJobId: 'counting-blackjack-bootstrap',
        rules: '',
        template: '{{input}}',
      },
    ),
    dealer({ x: 700, y: 30 }),
    player('four-agent-blackjack-player-one', 'Player One', { x: 700, y: 210 }),
    player('four-agent-blackjack-player-two', 'Player Two', { x: 700, y: 390 }),
    player('four-agent-blackjack-player-three', 'Player Three', { x: 700, y: 570 }),
    node(
      'four-agent-blackjack-dealer-memory',
      'memory',
      'Dealer Count Memory',
      'Stores the latest complete public shoe snapshot for the Dealer Agent.',
      { x: 1080, y: 30 },
      { operation: 'replace', initialValue: '' },
    ),
    node(
      'four-agent-blackjack-player-one-memory',
      'memory',
      'Player One Count Memory',
      'Stores the latest complete public shoe snapshot for Player One.',
      { x: 1080, y: 210 },
      { operation: 'replace', initialValue: '' },
    ),
    node(
      'four-agent-blackjack-player-two-memory',
      'memory',
      'Player Two Count Memory',
      'Stores the latest complete public shoe snapshot for Player Two.',
      { x: 1080, y: 390 },
      { operation: 'replace', initialValue: '' },
    ),
    node(
      'four-agent-blackjack-player-three-memory',
      'memory',
      'Player Three Count Memory',
      'Stores the latest complete public shoe snapshot for Player Three.',
      { x: 1080, y: 570 },
      { operation: 'replace', initialValue: '' },
    ),
    node(
      'four-agent-blackjack-round-ledger',
      'memory',
      'Round Ledger',
      'Appends each completed round across continuation sessions.',
      { x: 1440, y: 210 },
      { operation: 'append', initialValue: '' },
    ),
    node(
      'four-agent-blackjack-table-display',
      'output',
      'Table Display',
      'Shows current player and Dealer turns plus the completed round.',
      { x: 1440, y: 390 },
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
      'four-agent-blackjack-edge-engine-dealer-memory',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-dealer-memory',
      'write',
    ),
    edge(
      'four-agent-blackjack-edge-engine-one-memory',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-player-one-memory',
      'write',
    ),
    edge(
      'four-agent-blackjack-edge-engine-two-memory',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-player-two-memory',
      'write',
    ),
    edge(
      'four-agent-blackjack-edge-engine-three-memory',
      'four-agent-blackjack-table-engine',
      'four-agent-blackjack-player-three-memory',
      'write',
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
      'four-agent-blackjack-edge-dealer-memory-read',
      'four-agent-blackjack-dealer-memory',
      'four-agent-blackjack-dealer-agent',
      'read',
    ),
    edge(
      'four-agent-blackjack-edge-one-memory-read',
      'four-agent-blackjack-player-one-memory',
      'four-agent-blackjack-player-one',
      'read',
    ),
    edge(
      'four-agent-blackjack-edge-two-memory-read',
      'four-agent-blackjack-player-two-memory',
      'four-agent-blackjack-player-two',
      'read',
    ),
    edge(
      'four-agent-blackjack-edge-three-memory-read',
      'four-agent-blackjack-player-three-memory',
      'four-agent-blackjack-player-three',
      'read',
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
    name: 'Four Agent Counting Blackjack',
    nodes,
    edges,
  };
}

export async function writeCountingBlackjackHarness(outputPath) {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(
    resolved,
    `${JSON.stringify(createCountingBlackjackHarness(), null, 2)}\n`,
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
    'four-agent-counting-blackjack.synapse.json',
  );
  await writeCountingBlackjackHarness(output);
  console.log(output);
}
