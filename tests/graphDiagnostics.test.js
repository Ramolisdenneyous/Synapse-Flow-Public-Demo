import { describe, expect, it } from 'vitest';
import { diagnoseGraph } from '../src/engine/graphDiagnostics.js';

function node(id, kind, label) {
  return { id, data: { kind, label } };
}

function edge(source, target, channel = 'data') {
  return { source, target, data: { channel } };
}

describe('graph diagnostics', () => {
  it('reports duplicate labels and execution cycles', () => {
    const nodes = [
      node('a', 'agent', 'Luna Agent'),
      node('b', 'agent', 'Luna Agent'),
      node('c', 'agent', 'Luna Agent'),
    ];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];

    const warnings = diagnoseGraph(nodes, edges);

    expect(warnings.map((warning) => warning.code)).toContain('duplicate-label');
    expect(warnings.map((warning) => warning.code)).toContain('execution-cycle');
    expect(
      warnings.find((warning) => warning.code === 'execution-cycle').severity,
    ).toBe('info');
  });

  it('reports an inactive memory read edge to output', () => {
    const nodes = [
      node('memory', 'memory', 'Memory'),
      node('output', 'output', 'Output'),
    ];

    const warnings = diagnoseGraph(nodes, [
      edge('memory', 'output', 'read'),
    ]);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'inactive-memory-edge' }),
      ]),
    );
  });

  it('allows memory read edges into agents', () => {
    const nodes = [
      node('memory', 'memory', 'Memory'),
      node('agent', 'agent', 'Agent'),
    ];

    expect(
      diagnoseGraph(nodes, [edge('memory', 'agent', 'read')]).some(
        (warning) =>
          warning.code === 'inactive-memory-edge' ||
          warning.code === 'invalid-read-connection',
      ),
    ).toBe(false);
  });

  it('allows any node output to feed User Input through a read edge', () => {
    const nodes = [
      node('agent', 'agent', 'Agent'),
      node('user', 'user', 'User Input'),
    ];

    expect(
      diagnoseGraph(nodes, [edge('agent', 'user', 'read')]).some(
        (warning) =>
          warning.code === 'inactive-memory-edge' ||
          warning.code === 'invalid-read-connection',
      ),
    ).toBe(false);
  });

  it('accepts Agent Tool capabilities but excludes them from execution cycles', () => {
    const nodes = [
      node('trigger', 'trigger', 'Start'),
      node('agent', 'agent', 'Actor'),
      node('tool', 'tool', 'Action Tool'),
    ];
    const diagnostics = diagnoseGraph(nodes, [
      { id: 'start', ...edge('trigger', 'agent', 'trigger') },
      { id: 'capability', ...edge('agent', 'tool', 'tool') },
    ]);

    expect(diagnostics.some((item) => item.code === 'invalid-tool-connection')).toBe(false);
    expect(diagnostics.some((item) => item.code === 'execution-cycle')).toBe(false);
    expect(diagnostics.some((item) => item.code === 'unreachable-node')).toBe(false);
  });

  it('accepts Agent API Search capabilities as non-scheduling tool edges', () => {
    const nodes = [
      node('trigger', 'trigger', 'Start'),
      node('agent', 'agent', 'Researcher'),
      node('search', 'search', 'Live Search'),
    ];
    const diagnostics = diagnoseGraph(nodes, [
      { id: 'start', ...edge('trigger', 'agent', 'trigger') },
      { id: 'capability', ...edge('agent', 'search', 'tool') },
    ]);

    expect(diagnostics.some((item) => item.code === 'invalid-tool-connection')).toBe(false);
    expect(diagnostics.some((item) => item.code === 'execution-cycle')).toBe(false);
  });

  it('blocks structurally invalid generated routers and dangling edges', () => {
    const trigger = {
      id: 'trigger',
      data: { kind: 'trigger', label: 'Start', config: {} },
    };
    const router = {
      id: 'router',
      data: {
        kind: 'logic',
        label: 'Router',
        config: { operation: 'generated', generatedCode: '' },
      },
    };
    const diagnostics = diagnoseGraph(
      [trigger, router],
      [
        { id: 'to-router', ...edge('trigger', 'router', 'trigger') },
        { id: 'dangling', ...edge('router', 'missing') },
      ],
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-router-code', severity: 'error' }),
        expect.objectContaining({ code: 'dangling-edge', severity: 'error' }),
      ]),
    );
  });

  it('recognizes a cycle protected by a governor', () => {
    const nodes = [
      node('trigger', 'trigger', 'Start'),
      node('agent', 'agent', 'Worker'),
      node('governor', 'governor', 'Governor'),
    ];
    const diagnostics = diagnoseGraph(nodes, [
      { id: 'a', ...edge('trigger', 'agent', 'trigger') },
      { id: 'b', ...edge('agent', 'governor') },
      { id: 'c', ...edge('governor', 'agent') },
    ]);
    const cycle = diagnostics.find((item) => item.code === 'execution-cycle');

    expect(cycle.message).toContain('Governed loop detected');
  });
});
