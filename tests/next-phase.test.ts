import { describe, expect, it } from 'vitest';
import { chooseSpawnPoint, maintainPickupTargets } from '../src/game/systems/spawnSystem';
import { calculateRadarBlips, worldToRadar } from '../src/game/systems/radarSystem';
import { createAudioEventQueue } from '../src/game/systems/audioSystem';
import { getArenaBounds } from '../src/game/systems/arenaSystem';
import type { SnakeRuntime } from '../src/game/core/types';

const snake = (id: string, x: number, y: number, alive = true): SnakeRuntime => ({
  id,
  name: id,
  isPlayer: id === 'hermes',
  color: 0xffffff,
  accent: 0xffd166,
  x,
  y,
  angle: 0,
  hp: 34,
  alive,
  kills: 0,
  fruits: 0,
  survival: 0,
  score: 0,
  body: [{ x, y }],
  buffs: {},
  cooldowns: { rocket: 0, charge: 0, boostDrain: 0, wall: 0, head: 0, body: 0, chargeHit: 0 },
  chargeHeld: 0,
  dashTime: 0,
  aiThink: 0,
  targetAngle: 0,
});

describe('next-phase support systems', () => {
  it('finds spawn points inside the arena away from blocked positions', () => {
    const bounds = getArenaBounds(1);
    const blocked = [snake('blocker', 1300, 750)];
    const point = chooseSpawnPoint(bounds, blocked, [], {
      minDistance: 220,
      margin: 170,
      attempts: 60,
      random: () => 0.5,
      fallbackIndex: 2,
    });

    expect(point.x).toBeGreaterThanOrEqual(bounds.left + 170);
    expect(point.x).toBeLessThanOrEqual(bounds.right - 170);
    expect(point.y).toBeGreaterThanOrEqual(bounds.top + 170);
    expect(point.y).toBeLessThanOrEqual(bounds.bottom - 170);
    expect(Math.hypot(point.x - blocked[0].x, point.y - blocked[0].y)).toBeGreaterThanOrEqual(220);
  });

  it('keeps fallback spawns inside arena margins and avoids snake bodies', () => {
    const bounds = getArenaBounds(1);
    const bodyBlocker = snake('body', 400, 400);
    bodyBlocker.body = [{ x: 400, y: 400 }, { x: 1300, y: 750 }];

    for (let fallbackIndex = 0; fallbackIndex < 20; fallbackIndex++) {
      const point = chooseSpawnPoint(bounds, [bodyBlocker], [], {
        minDistance: 220,
        margin: 170,
        attempts: 0,
        fallbackIndex,
      });
      expect(point.x).toBeGreaterThanOrEqual(bounds.left + 170);
      expect(point.x).toBeLessThanOrEqual(bounds.right - 170);
      expect(point.y).toBeGreaterThanOrEqual(bounds.top + 170);
      expect(point.y).toBeLessThanOrEqual(bounds.bottom - 170);
    }

    const point = chooseSpawnPoint(bounds, [bodyBlocker], [], {
      minDistance: 220,
      margin: 170,
      attempts: 1,
      random: () => 0.5,
      fallbackIndex: 3,
    });
    expect(Math.hypot(point.x - 1300, point.y - 750)).toBeGreaterThanOrEqual(220);
  });

  it('reports exact pickup deficits from alive count', () => {
    expect(maintainPickupTargets(10, 20, 4)).toEqual({ baseTarget: 28, upgradeTarget: 10, baseNeeded: 8, upgradeNeeded: 6 });
    expect(maintainPickupTargets(2, 40, 20)).toEqual({ baseTarget: 24, upgradeTarget: 8, baseNeeded: 0, upgradeNeeded: 0 });
  });

  it('maps world positions and living entities into radar coordinates', () => {
    const bounds = getArenaBounds(0.58);
    const radar = { x: 20, y: 30, width: 180, height: 110 };
    expect(worldToRadar({ x: bounds.left, y: bounds.top }, bounds, radar)).toEqual({ x: 20, y: 30 });
    expect(worldToRadar({ x: bounds.right, y: bounds.bottom }, bounds, radar)).toEqual({ x: 200, y: 140 });

    const blips = calculateRadarBlips({
      snakes: [snake('hermes', bounds.left, bounds.top), snake('dead', bounds.right, bounds.bottom, false)],
      pickups: [{ id: 1, x: bounds.centerX, y: bounds.centerY, kind: 'upgrade', value: 1 }],
      mines: [{ x: bounds.right, y: bounds.bottom, armed: 1, cooldown: 0 }],
      bounds,
      radar,
    });
    expect(blips.map((b) => b.kind)).toEqual(['player', 'pickup', 'mine']);
  });

  it('queues semantic audio events while respecting mute and volume settings', () => {
    const queue = createAudioEventQueue({ masterVolume: 0.5, sfxVolume: 0.5 });
    queue.emit('rocket-fire');
    queue.emit('snake-death', 0.8);
    expect(queue.drain()).toEqual([
      { name: 'rocket-fire', volume: 0.25 },
      { name: 'snake-death', volume: 0.2 },
    ]);

    const muted = createAudioEventQueue({ masterVolume: 0, sfxVolume: 1 });
    muted.emit('fruit-pickup');
    expect(muted.drain()).toEqual([]);
  });
});
