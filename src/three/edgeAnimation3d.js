export function edgePulseDirection(className = '') {
  return String(className).includes('edge-pulse-tool-return') ? -1 : 1;
}

export function edgePulseProgress(elapsed, offset = 0, direction = 1) {
  const forward = (elapsed * 0.86 + offset) % 1;
  return direction < 0 ? 1 - forward : forward;
}

export function edgeArrowSample(direction = 1) {
  return direction < 0
    ? { progress: 0.11, tangentScale: -1 }
    : { progress: 0.89, tangentScale: 1 };
}
