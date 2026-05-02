import { BALANCE, WORLD } from '../config/balance';
import type { Rect } from '../core/types';

export function getArenaScale(aliveCount: number, totalSnakes: number): number {
  const min = WORLD.arenaMinScale;
  if (totalSnakes <= 1) return min;
  const alive = Math.max(1, Math.min(aliveCount, totalSnakes));
  return min + (1 - min) * ((alive - 1) / (totalSnakes - 1));
}

export function getContinuousArenaScale({
  aliveCount,
  totalSnakes,
  elapsedSeconds,
}: {
  aliveCount: number;
  totalSnakes: number;
  elapsedSeconds: number;
}): number {
  const aliveDrivenScale = getArenaScale(aliveCount, totalSnakes);
  const timeProgress = Math.max(0, Math.min(1, (elapsedSeconds - BALANCE.arenaTimeShrinkStart) / BALANCE.arenaTimeShrinkDuration));
  const lowPlayerPressure = aliveCount <= 3 ? BALANCE.arenaLowPlayerExtraShrink : aliveCount <= 5 ? BALANCE.arenaLowPlayerExtraShrink * 0.55 : 0;
  const timeDrivenScale = 1 - timeProgress * (1 - WORLD.arenaFinalMinScale);
  const pressureScale = aliveDrivenScale - lowPlayerPressure * timeProgress;
  return Math.max(WORLD.arenaFinalMinScale, Math.min(pressureScale, timeDrivenScale));
}

export function getArenaBounds(scale: number): Rect {
  const safeScale = Math.max(WORLD.arenaFinalMinScale, Math.min(1, scale));
  const width = WORLD.width * safeScale;
  const height = WORLD.height * safeScale;
  const left = (WORLD.width - width) / 2;
  const top = (WORLD.height - height) / 2;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: WORLD.width / 2,
    centerY: WORLD.height / 2,
  };
}

export function clampToArena(x: number, y: number, radius: number, bounds: Rect) {
  return {
    x: Math.max(bounds.left + radius, Math.min(bounds.right - radius, x)),
    y: Math.max(bounds.top + radius, Math.min(bounds.bottom - radius, y)),
  };
}
