import { describe, expect, it } from 'vitest';
import { createApiSearchDemo } from '../scripts/build-api-search-demo.mjs';
import { connectedToolsFor } from '../src/engine/executor.js';

describe('API Search example harness', () => {
  it('requires one explicitly connected live-search capability', () => {
    const harness = createApiSearchDemo();
    const agent = harness.nodes.find((node) => node.data.kind === 'agent');
    const search = harness.nodes.find((node) => node.data.kind === 'search');
    const tools = connectedToolsFor(agent, harness.nodes, harness.edges.map((edge) => ({
      ...edge,
      data: { channel: edge.channel },
    })));

    expect(agent.data.config.requireToolCall).toBe(true);
    expect(search.data.config.provider).toBe('web');
    expect(search.data.config.searchMode).toBe('assisted');
    expect(tools).toHaveLength(1);
    expect(tools[0].definition.name).toBe('search_current_web');
    expect(tools[0].definition.parameters.required).toEqual(['query', 'limit']);
  });
});
