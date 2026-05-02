import { describe, expect, it } from 'vitest';
import { getArenaScale, getArenaBounds } from '../src/game/systems/arenaSystem';
import { getSegmentCount, getHeadRadius, applyDamage, applyHealing } from '../src/game/entities/snakeMath';
import { scoreSnake, sortLeaderboard } from '../src/game/systems/scoringSystem';
import { safeJsonRead, safeJsonWrite, getSafeStorage } from '../src/game/core/persistence';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
};

describe('Snake of Olympus core rules', () => {
  it('shrinks arena based on alive count and clamps to min scale', () => {
    expect(getArenaScale(10, 10)).toBeCloseTo(1);
    expect(getArenaScale(1, 10)).toBeCloseTo(0.58);
    expect(getArenaScale(0, 10)).toBeCloseTo(0.58);
    expect(getArenaScale(6, 10)).toBeCloseTo(0.58 + 0.42 * (5 / 9));
  });

  it('centers arena bounds inside world dimensions', () => {
    const bounds = getArenaBounds(0.58);
    expect(bounds.width).toBeCloseTo(1508);
    expect(bounds.height).toBeCloseTo(870);
    expect(bounds.left).toBeCloseTo((2600 - 1508) / 2);
  });

  it('derives segment count and radius from hp', () => {
    expect(getSegmentCount(34)).toBe(24);
    expect(getSegmentCount(0)).toBe(11);
    expect(getSegmentCount(100)).toBe(38);
    expect(getHeadRadius(58)).toBeCloseTo(17.2);
  });

  it('applies healing, damage, death, and shield mitigation safely', () => {
    expect(applyHealing(57, 5)).toBe(58);
    expect(applyDamage(10, 2, false)).toEqual({ hp: 8, killed: false, damage: 2 });
    expect(applyDamage(1, 2, false)).toEqual({ hp: 0, killed: true, damage: 2 });
    expect(applyDamage(10, 1, true).damage).toBeCloseTo(0.55);
    expect(applyDamage(10, 0.1, true).damage).toBeCloseTo(0.2);
  });

  it('scores and sorts leaderboard exactly by alive, kills, hp, then score', () => {
    expect(scoreSnake({ kills: 2, fruits: 3, hp: 20, survival: 10 })).toBe(524);
    const sorted = sortLeaderboard([
      { id: 'dead', name: 'Dead', alive: false, kills: 99, hp: 58, score: 9999 },
      { id: 'a', name: 'A', alive: true, kills: 1, hp: 20, score: 200 },
      { id: 'b', name: 'B', alive: true, kills: 2, hp: 10, score: 100 },
      { id: 'c', name: 'C', alive: true, kills: 2, hp: 30, score: 100 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['c', 'b', 'a', 'dead']);
  });

  it('handles local storage missing, blocked, or malformed data without crashing', () => {
    const storage = memoryStorage();
    expect(getSafeStorage({ get localStorage() { throw new Error('blocked'); } })).toBeUndefined();
    expect(safeJsonRead(storage, 'missing', { shake: true })).toEqual({ shake: true });
    storage.setItem('bad', '{');
    expect(safeJsonRead(storage, 'bad', { shake: false })).toEqual({ shake: false });
    expect(safeJsonWrite(storage, 'settings', { volume: 0.5 })).toBe(true);
    expect(safeJsonRead(storage, 'settings', { volume: 1 })).toEqual({ volume: 0.5 });
  });
});
