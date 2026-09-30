import { describe, expect, it } from 'vitest';
import {
  createPortableProject,
  exportGraphMarkdown,
  portableProjectFingerprint,
} from '../src/model/exportMarkdown.js';

describe('exportGraphMarkdown', () => {
  it('includes contracts, channels, and a Mermaid flow', () => {
    const nodes = [
      {
        id: 'start',
        data: {
          label: 'Start',
          kind: 'trigger',
          description: 'Begin.',
          inputType: 'none',
          outputType: 'event',
          config: { payload: 'go' },
        },
      },
      {
        id: 'finish',
        data: {
          label: 'Finish',
          kind: 'output',
          description: 'Capture.',
          inputType: 'event',
          outputType: 'none',
          config: {},
        },
      },
    ];
    const edges = [
      { source: 'start', target: 'finish', data: { channel: 'trigger' } },
    ];

    const markdown = exportGraphMarkdown({ name: 'Test Harness', nodes, edges });

    expect(markdown).toContain('# Synapse Flow Harness: Test Harness');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('Stable ID: `start`');
    expect(markdown).toContain('state is isolated by stable node id');
  });

  it('exports stable ids, exact connection records, and an authoritative graph appendix', () => {
    const graph = {
      name: 'Rebuild Me',
      nodes: [
        {
          id: 'start',
          type: 'synapseNode',
          position: { x: 25, y: 50 },
          position3d: { x: 1.5, y: -2, z: 3 },
          data: {
            label: 'Start',
            kind: 'trigger',
            description: 'Begin.',
            inputType: 'event',
            outputType: 'event',
            config: { payload: 'go', continueState: false },
          },
        },
      ],
      edges: [],
    };
    const project = createPortableProject(graph);
    const markdown = exportGraphMarkdown(graph);

    expect(project).toMatchObject({
      format: 'synapse-flow/harness',
      version: 2,
      name: 'Rebuild Me',
    });
    expect(portableProjectFingerprint(project)).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(project.nodes[0].position3d).toEqual({ x: 1.5, y: -2, z: 3 });
    expect(markdown).toContain('## IDE Reconstruction Procedure');
    expect(markdown).toContain('## Machine-Readable Graph');
    expect(markdown).toContain('"id": "start"');
    expect(markdown).toContain('Graph fingerprint: `fnv1a32:');
  });

  it('documents User Input participation and prose-only reconstruction rules', () => {
    const user = {
      id: 'user',
      type: 'synapseNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Human Turn',
        kind: 'user',
        description: 'Collect the player response.',
        inputType: 'event',
        outputType: 'message',
        config: {
          mode: 'auto',
          systemPrompt: 'Play a curious tester.',
          reasoningEffort: 'low',
          maxOutputTokens: 500,
        },
      },
    };

    const markdown = exportGraphMarkdown({
      name: 'User Contract',
      nodes: [user],
      edges: [],
    });

    expect(markdown).toContain('Participation mode: auto');
    expect(markdown).toContain('Natural-language prose only');
    expect(markdown).toContain('Manual User Input node suspends');
    expect(markdown).toContain('User Input observation context');
  });

  it('exports API Search provider, capability, and safety contracts', () => {
    const search = {
      id: 'search',
      type: 'synapseNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Live Research',
        kind: 'search',
        description: 'Search current sources.',
        inputType: 'tool_request',
        outputType: 'tool_result',
        config: {
          provider: 'web',
          searchMode: 'raw',
          functionName: 'search_current_sources',
          functionDescription: 'Search when current evidence is required.',
          usageInstructions: 'Preserve useful source URLs.',
          maxResults: 5,
          searchContextSize: 'low',
        },
      },
    };

    const markdown = exportGraphMarkdown({ name: 'Search Contract', nodes: [search], edges: [] });

    expect(markdown).toContain('Search provider: web');
    expect(markdown).toContain('Search result mode: raw');
    expect(markdown).toContain('`search_current_sources`');
    expect(markdown).toContain('untrusted external data');
  });
});
