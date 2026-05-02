import { BALANCE } from '../config/balance';
import type { Rect, SnakeRuntime } from '../core/types';
import { distanceSq } from '../core/math';

type Point = { x: number; y: number };
type MineLike = Point;

type SpawnOptions = {
  minDistance?: number;
  margin?: number;
  attempts?: number;
  random?: () => number;
  fallbackIndex?: number;
};

export function maintainPickupTargets(aliveCount: number, currentBase: number, currentUpgrade: number) {
  const baseTarget = BALANCE.baseFruitTarget + Math.max(0, aliveCount - 6);
  const upgradeTarget = BALANCE.upgradeFruitTarget + Math.max(0, Math.floor((aliveCount - 2) / 4));
  return {
    baseTarget,
    upgradeTarget,
    baseNeeded: Math.max(0, baseTarget - currentBase),
    upgradeNeeded: Math.max(0, upgradeTarget - currentUpgrade),
  };
}

export function chooseSpawnPoint(bounds: Rect, blockedSnakes: SnakeRuntime[], blockedMines: MineLike[], options: SpawnOptions = {}): Point {
  const minDistance = options.minDistance ?? BALANCE.spawnSafeRadius;
  const margin = options.margin ?? BALANCE.spawnMargin;
  const attempts = options.attempts ?? 80;
  const random = options.random ?? Math.random;

  for (let i = 0; i < attempts; i++) {
    const point = {
      x: bounds.left + margin + random() * Math.max(1, bounds.width - margin * 2),
      y: bounds.top + margin + random() * Math.max(1, bounds.height - margin * 2),
    };
    if (isPointSafe(point, blockedSnakes, blockedMines, minDistance)) return point;
  }

  return fallbackSpawnPoint(bounds, margin, options.fallbackIndex ?? blockedSnakes.length, blockedSnakes, blockedMines, minDistance);
}

export function isPointSafe(point: Point, snakes: SnakeRuntime[], mines: MineLike[], minDistance: number): boolean {
  const safeDistanceSq = minDistance * minDistance;
  const mineSafeDistance = minDistance * 0.7;
  const mineSafeDistanceSq = mineSafeDistance * mineSafeDistance;

  return snakes.every((snake) => !snake.alive || (
    distanceSq(point, snake) >= safeDistanceSq &&
    snake.body.every((segment) => distanceSq(point, segment) >= safeDistanceSq)
  )) && mines.every((mine) => distanceSq(point, mine) >= mineSafeDistanceSq);
}

function fallbackSpawnPoint(bounds: Rect, margin: number, index: number, snakes: SnakeRuntime[], mines: MineLike[], minDistance: number): Point {
  const safeWidth = Math.max(1, bounds.width - margin * 2);
  const safeHeight = Math.max(1, bounds.height - margin * 2);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let offset = 0; offset < 32; offset++) {
    const i = index + offset;
    const radius = 0.18 + (i % 8) * 0.045;
    const angle = i * goldenAngle;
    const point = {
      x: bounds.centerX + Math.cos(angle) * safeWidth * 0.5 * radius,
      y: bounds.centerY + Math.sin(angle) * safeHeight * 0.5 * radius,
    };
    const clamped = {
      x: Math.max(bounds.left + margin, Math.min(bounds.right - margin, point.x)),
      y: Math.max(bounds.top + margin, Math.min(bounds.bottom - margin, point.y)),
    };
    if (isPointSafe(clamped, snakes, mines, minDistance)) return clamped;
  }
  return { x: bounds.centerX, y: bounds.centerY };
}
