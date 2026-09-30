import { describe, expect, it } from 'vitest';
import {
  defaultGraphPositions3d,
  graphBounds3d,
  isPosition3d,
} from '../src/three/graphLayout3d.js';

describe('graphLayout3d', () => {
  it('derives a stable spatial layout from the 2D graph', () => {
    const nodes = [
      { id: 'left', position: { x: 0, y: 100 } },
      { id: 'right', position: { x: 600, y: 300 } },
    ];

    const first = defaultGraphPositions3d(nodes);
    const second = defaultGraphPositions3d(nodes);

    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get('left').x).toBeLessThan(first.get('right').x);
    expect(first.get('left').y).toBeGreaterThan(first.get('right').y);
    expect(Number.isFinite(first.get('left').z)).toBe(true);
  });

  it('preserves explicitly arranged 3D coordinates', () => {
    const position3d = { x: 4.5, y: -2, z: 9 };
    const positions = defaultGraphPositions3d([
      { id: 'custom', position: { x: 0, y: 0 }, position3d },
    ]);

    expect(isPosition3d(position3d)).toBe(true);
    expect(positions.get('custom')).toEqual(position3d);
    expect(positions.get('custom')).not.toBe(position3d);
  });

  it('frames empty and populated graphs with a useful minimum radius', () => {
    expect(graphBounds3d(new Map()).radius).toBe(6);
    expect(graphBounds3d(new Map([
      ['a', { x: -10, y: 0, z: 0 }],
      ['b', { x: 10, y: 0, z: 0 }],
    ]))).toEqual({ center: { x: 0, y: 0, z: 0 }, radius: 10 });
  });
});
