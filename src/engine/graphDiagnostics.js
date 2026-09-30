import { acceptsReadContext } from '../model/catalog.js';

export function diagnoseGraph(nodes, edges) {
  const warnings = [];
  const labels = new Map();
  const nodeIds = new Set();
  const edgeIds = new Set();
  const allowedChannels = new Set(['data', 'trigger', 'read', 'write', 'tool']);

  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      warnings.push({
        code: 'duplicate-node-id',
        severity: 'error',
        nodeIds: [node.id],
        message: `Multiple nodes use the id "${node.id}". Every node id must be unique before this harness can run.`,
      });
    }
    nodeIds.add(node.id);
    if (!node.data?.label?.trim()) {
      warnings.push({
        code: 'missing-node-label',
        severity: 'error',
        nodeIds: [node.id],
        message: `Node ${node.id} has no label. Give every node a readable unique name.`,
      });
    }
    if (
      node.data?.kind === 'logic' &&
      node.data?.config?.operation === 'generated' &&
      !node.data?.config?.generatedCode?.trim()
    ) {
      warnings.push({
        code: 'missing-router-code',
        severity: 'error',
        nodeIds: [node.id],
        message: `${node.data.label} is configured for generated code but has no implementation. Build or change the Router before running.`,
      });
    }
    if (
      node.data?.kind === 'agent' &&
      !node.data?.config?.systemPrompt?.trim()
    ) {
      warnings.push({
        code: 'missing-agent-prompt',
        severity: 'warning',
        nodeIds: [node.id],
        message: `${node.data.label} has an empty system prompt, so its role cannot be reconstructed reliably.`,
      });
    }
    if (
      node.data?.kind === 'user' &&
      node.data?.config?.mode === 'auto' &&
      !node.data?.config?.systemPrompt?.trim()
    ) {
      warnings.push({
        code: 'missing-user-prompt',
        severity: 'warning',
        nodeIds: [node.id],
        message: `${node.data.label} is in Auto mode but has no system prompt describing the simulated user.`,
      });
    }
  }

  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      warnings.push({
        code: 'duplicate-edge-id',
        severity: 'error',
        edgeIds: [edge.id],
        message: `Multiple connections use the id "${edge.id}". Every connection id must be unique.`,
      });
    }
    edgeIds.add(edge.id);
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (!source || !target) {
      warnings.push({
        code: 'dangling-edge',
        severity: 'error',
        edgeIds: [edge.id],
        nodeIds: [edge.source, edge.target],
        message: `Connection ${edge.id || '(missing id)'} references a node that is not present in the graph.`,
      });
      continue;
    }
    const channel = edge.data?.channel || 'data';
    if (!allowedChannels.has(channel)) {
      warnings.push({
        code: 'unknown-channel',
        severity: 'error',
        edgeIds: [edge.id],
        nodeIds: [source.id, target.id],
        message: `${source.data.label} -> ${target.data.label} uses unknown channel "${channel}".`,
      });
    }
    if (channel === 'write' && target.data.kind !== 'memory') {
      warnings.push({
        code: 'invalid-write-target',
        severity: 'error',
        edgeIds: [edge.id],
        nodeIds: [source.id, target.id],
        message: `${source.data.label} -> ${target.data.label} is a write connection, but write connections must target Memory.`,
      });
    }
    if (
      channel === 'tool' &&
      (source.data.kind !== 'agent' || !['tool', 'search'].includes(target.data.kind))
    ) {
      warnings.push({
        code: 'invalid-tool-connection',
        severity: 'error',
        edgeIds: [edge.id],
        nodeIds: [source.id, target.id],
        message: `${source.data.label} -> ${target.data.label} is a capability connection, which must run from a Luna Agent to a Tool or API Search node.`,
      });
    }
    if (
      channel === 'read' &&
      source.data.kind !== 'memory' &&
      target.data.kind !== 'user'
    ) {
      warnings.push({
        code: 'invalid-read-connection',
        severity: 'error',
        edgeIds: [edge.id],
        nodeIds: [source.id, target.id],
        message: `${source.data.label} -> ${target.data.label} is a read connection, but read connections must start at Memory.`,
      });
    } else if (
      channel === 'read' &&
      !acceptsReadContext(target)
    ) {
      warnings.push({
        code: 'inactive-memory-edge',
        severity: 'error',
        edgeIds: [edge.id],
        nodeIds: [source.id, target.id],
        message: `${source.data.label} -> ${target.data.label} is a read edge, so it cannot trigger ${target.data.label}. Change it to a data connection.`,
      });
    }
  }

  for (const node of nodes) {
    const key = node.data.label.trim().toLowerCase();
    const matches = labels.get(key) || [];
    matches.push(node);
    labels.set(key, matches);
  }

  for (const matches of labels.values()) {
    if (matches.length < 2) continue;
    warnings.push({
      code: 'duplicate-label',
      severity: 'warning',
      nodeIds: matches.map((node) => node.id),
      message: `${matches.length} nodes share the label "${matches[0].data.label}". Give them unique names so routes and logs are unambiguous.`,
    });
  }

  const executableEdges = edges.filter(
    (edge) =>
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target) &&
      !['read', 'tool'].includes(edge.data?.channel),
  );
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of executableEdges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set();
  const active = new Set();
  const stack = [];
  const reportedCycles = new Set();

  function visit(nodeId) {
    if (active.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      const cycle = [...stack.slice(start), nodeId];
      const key = [...new Set(cycle)].sort().join('|');
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        const names = cycle.map(
          (id) => nodes.find((node) => node.id === id)?.data.label || id,
        );
        const governed = cycle.some(
          (id) => nodes.find((node) => node.id === id)?.data.kind === 'governor',
        );
        warnings.push({
          code: 'execution-cycle',
          severity: 'info',
          nodeIds: cycle,
          message: governed
            ? `Governed loop detected: ${names.join(' -> ')}. Its Governor provides a deterministic stopping boundary.`
            : `Agent loop detected: ${names.join(' -> ')}. This loop will continue until manually stopped or governed by a Router or Governor.`,
        });
      }
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    active.add(nodeId);
    stack.push(nodeId);
    for (const targetId of adjacency.get(nodeId) || []) visit(targetId);
    stack.pop();
    active.delete(nodeId);
  }

  for (const node of nodes) visit(node.id);

  for (const node of nodes) {
    const outgoing = executableEdges.filter((edge) => edge.source === node.id);
    if (node.data.kind === 'trigger' && outgoing.length === 0) {
      warnings.push({
        code: 'trigger-without-route',
        severity: 'warning',
        nodeIds: [node.id],
        message: `${node.data.label} has no executable outgoing connection, so firing it cannot start another node.`,
      });
    }
    if (node.data.kind === 'output' && outgoing.length > 0) {
      warnings.push({
        code: 'output-with-route',
        severity: 'error',
        nodeIds: [node.id],
        edgeIds: outgoing.map((edge) => edge.id),
        message: `${node.data.label} is terminal but has outgoing executable connections.`,
      });
    }
  }

  const triggerIds = nodes
    .filter((node) => node.data.kind === 'trigger')
    .map((node) => node.id);
  if (triggerIds.length) {
    const reachable = new Set(triggerIds);
    const pending = [...triggerIds];
    while (pending.length) {
      const sourceId = pending.shift();
      for (const edge of edges.filter(
        (candidate) =>
          candidate.source === sourceId && candidate.data?.channel !== 'read',
      )) {
        if (!nodeIds.has(edge.target) || reachable.has(edge.target)) continue;
        reachable.add(edge.target);
        pending.push(edge.target);
      }
    }
    for (const node of nodes) {
      if (reachable.has(node.id) || node.data.kind === 'memory') continue;
      warnings.push({
        code: 'unreachable-node',
        severity: 'warning',
        nodeIds: [node.id],
        message: `${node.data.label} cannot be reached from any Trigger.`,
      });
    }
  } else if (nodes.length) {
    warnings.push({
      code: 'missing-trigger',
      severity: 'warning',
      nodeIds: [],
      message: 'This harness has no Trigger. Run All cannot seed an event until one is added.',
    });
  }

  return warnings;
}
