import blackjack from '../../examples/four-agent-blackjack.synapse.json';

export const DEFAULT_DEMO = blackjack;

export const DEMOS = [
  { id: 'four-agent-blackjack', label: 'Four-Agent Blackjack', load: async () => blackjack },
  { id: 'three-player-blackjack', label: 'Three-Player Blackjack', load: () => import('../../examples/three-player-blackjack.synapse.json').then((module) => module.default) },
  { id: 'go-fish', label: 'Three-Player Go Fish', load: () => import('../../examples/three-player-go-fish-governor.synapse.json').then((module) => module.default) },
  { id: 'pvp-arena', label: '2v2 PVP Arena', load: () => import('../../examples/2v2-pvp-arena.synapse.json').then((module) => module.default) },
  { id: 'story-engine', label: 'Story Engine', load: () => import('../../examples/story-engine-authoritative-chapter.synapse.json').then((module) => module.default) },
];
