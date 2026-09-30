function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isPosition3d(value) {
  return value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

export function defaultGraphPositions3d(nodes) {
  const positioned = nodes.map((node) => ({
    node,
    x: Number(node.position?.x) || 0,
    y: Number(node.position?.y) || 0,
  }));
  const xs = positioned.map((item) => item.x);
  const ys = positioned.map((item) => item.y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 0);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const scale = 12 / Math.max(maxX - minX, maxY - minY, 600);

  return new Map(positioned.map(({ node, x, y }) => {
    if (isPosition3d(node.position3d)) {
      return [node.id, { ...node.position3d }];
    }
    const depthBand = (hashString(node.id) % 9) - 4;
    return [node.id, {
      x: (x - centerX) * scale,
      y: -(y - centerY) * scale,
      z: depthBand * 0.58,
    }];
  }));
}

export function graphBounds3d(positions) {
  const values = [...positions.values()];
  if (!values.length) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 6 };
  }
  const center = values.reduce(
    (sum, value) => ({
      x: sum.x + value.x / values.length,
      y: sum.y + value.y / values.length,
      z: sum.z + value.z / values.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const radius = Math.max(
    4,
    ...values.map((value) => Math.hypot(
      value.x - center.x,
      value.y - center.y,
      value.z - center.z,
    )),
  );
  return { center, radius };
}
