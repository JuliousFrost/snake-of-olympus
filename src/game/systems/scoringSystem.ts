import type { LeaderboardEntry } from '../core/types';

export function scoreSnake(stats: { kills: number; fruits: number; hp: number; survival: number }): number {
  return Math.round(stats.kills * 120 + stats.fruits * 18 + stats.hp * 10 + stats.survival * 3);
}

export function sortLeaderboard<T extends LeaderboardEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (b.hp !== a.hp) return b.hp - a.hp;
    return b.score - a.score;
  });
}
