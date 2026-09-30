function stableSortById(items) {
  return [...items].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function continuationGraphKey(name, nodes, edges) {
  return JSON.stringify({
    name,
    nodes: stableSortById(nodes).map((node) => ({
      id: node.id,
      kind: node.data.kind,
      label: node.data.label,
      description: node.data.description,
      inputType: node.data.inputType,
      outputType: node.data.outputType,
      config: node.data.config,
    })),
    edges: stableSortById(edges).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      channel: edge.data?.channel || 'data',
    })),
  });
}

export function initializeRunState(
  nodes,
  {
    preserve = false,
    previousMemory = {},
    previousRouterState = {},
  } = {},
) {
  const memory = Object.fromEntries(
    nodes
      .filter((node) => node.data.kind === 'memory')
      .map((node) => [
        node.id,
        preserve && Object.hasOwn(previousMemory, node.id)
          ? structuredClone(previousMemory[node.id])
          : node.data.config.initialValue || '',
      ]),
  );
  const routerState = Object.fromEntries(
    nodes
      .filter(
        (node) =>
          node.data.kind === 'logic' &&
          preserve &&
          Object.hasOwn(previousRouterState, node.id),
      )
      .map((node) => [node.id, structuredClone(previousRouterState[node.id])]),
  );

  return { memory, routerState };
}
