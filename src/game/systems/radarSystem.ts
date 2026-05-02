import type { Rect, SnakeRuntime } from '../core/types';

type Point = { x: number; y: number };
type RadarRect = { x: number; y: number; width: number; height: number };
type PickupLike = Point & { id: number; kind: string };
type MineLike = Point;

export type RadarBlip = {
  kind: 'player' | 'snake' | 'pickup' | 'mine';
  x: number;
  y: number;
  color: number;
};

export function worldToRadar(point: Point, bounds: Rect, radar: RadarRect): Point {
  const nx = (point.x - bounds.left) / bounds.width;
  const ny = (point.y - bounds.top) / bounds.height;
  return {
    x: radar.x + clamp01(nx) * radar.width,
    y: radar.y + clamp01(ny) * radar.height,
  };
}

export function calculateRadarBlips(input: {
  snakes: SnakeRuntime[];
  pickups: PickupLike[];
  mines: MineLike[];
  bounds: Rect;
  radar: RadarRect;
}): RadarBlip[] {
  const blips: RadarBlip[] = [];
  for (const snake of input.snakes) {
    if (!snake.alive) continue;
    const p = worldToRadar(snake, input.bounds, input.radar);
    blips.push({ kind: snake.isPlayer ? 'player' : 'snake', x: p.x, y: p.y, color: snake.color });
  }
  for (const pickup of input.pickups.filter((_, i) => i % 3 === 0 || input.pickups.length <= 16)) {
    const p = worldToRadar(pickup, input.bounds, input.radar);
    blips.push({ kind: 'pickup', x: p.x, y: p.y, color: pickup.kind === 'upgrade' ? 0xffd166 : 0x50fa7b });
  }
  for (const mine of input.mines) {
    const p = worldToRadar(mine, input.bounds, input.radar);
    blips.push({ kind: 'mine', x: p.x, y: p.y, color: 0xff3157 });
  }
  return blips;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
