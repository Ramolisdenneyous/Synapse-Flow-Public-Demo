import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connectedToolsFor } from '../src/engine/executor.js';

describe('Mage Local RAG example harness', () => {
  it('binds one Agent to the completed local index contract', () => {
    const harness = JSON.parse(readFileSync('examples/mage-rpg-local-rag-demo.synapse.json', 'utf8'));
    const agent = harness.nodes.find((node) => node.data.kind === 'agent');
    const search = harness.nodes.find((node) => node.data.kind === 'search');
    const tools = connectedToolsFor(agent, harness.nodes, harness.edges.map((edge) => ({
      ...edge,
      data: { channel: edge.channel },
    })));

    expect(search.data.config.provider).toBe('localrag');
    expect(search.data.config.searchMode).toBe('assisted');
    expect(search.data.config.localIndexPath).toMatch(/Mage-RPG-Rules\.synapse-rag\.sqlite$/);
    expect(agent.data.config.requireToolCall).toBe(true);
    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe('search_mage_rules');
  });
});
