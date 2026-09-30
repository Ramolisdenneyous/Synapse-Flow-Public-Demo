import { describe, expect, it } from 'vitest';
import {
  edgeArrowSample,
  edgePulseDirection,
  edgePulseProgress,
} from '../src/three/edgeAnimation3d.js';

describe('3D edge animation direction', () => {
  it('moves tool calls from the Agent toward the Tool', () => {
    const direction = edgePulseDirection('edge-pulse edge-pulse-tool-call');

    expect(direction).toBe(1);
    expect(edgePulseProgress(0.25, 0, direction)).toBeCloseTo(0.215);
    expect(edgeArrowSample(direction)).toEqual({ progress: 0.89, tangentScale: 1 });
  });

  it('moves tool results from the Tool back toward the requesting Agent', () => {
    const direction = edgePulseDirection('edge-pulse edge-pulse-tool-return');

    expect(direction).toBe(-1);
    expect(edgePulseProgress(0.25, 0, direction)).toBeCloseTo(0.785);
    expect(edgeArrowSample(direction)).toEqual({ progress: 0.11, tangentScale: -1 });
  });
});
