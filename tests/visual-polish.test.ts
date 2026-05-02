import { describe, expect, it } from 'vitest';
import { createDamageIndicator, updateDamageIndicators, getSnakeSegmentStyle, getOlympusStar } from '../src/game/systems/visualSystem';

describe('visual polish systems', () => {
  it('creates readable damage indicators that float up and fade out', () => {
    const indicator = createDamageIndicator({ x: 400, y: 300 }, 12.8, 'rocket', true, () => 0.5);

    expect(indicator.text).toBe('-13');
    expect(indicator.color).toBe(0xff4d6d);
    expect(indicator.life).toBeGreaterThan(0.6);
    expect(indicator.scale).toBeGreaterThan(1);

    const updated = updateDamageIndicators([indicator], 0.35);
    expect(updated).toHaveLength(1);
    expect(updated[0].y).toBeLessThan(300);
    expect(updated[0].alpha).toBeLessThan(1);

    expect(updateDamageIndicators(updated, 2)).toHaveLength(0);
  });

  it('varies snake body segment style so snakes look armored instead of plain lines', () => {
    const head = getSnakeSegmentStyle({ index: 0, total: 20, hp: 42, color: 0x44ccff, accent: 0xffd166, dashTime: 0, shielded: false });
    const middle = getSnakeSegmentStyle({ index: 8, total: 20, hp: 42, color: 0x44ccff, accent: 0xffd166, dashTime: 0, shielded: false });
    const tail = getSnakeSegmentStyle({ index: 19, total: 20, hp: 42, color: 0x44ccff, accent: 0xffd166, dashTime: 0, shielded: false });
    const dashed = getSnakeSegmentStyle({ index: 8, total: 20, hp: 42, color: 0x44ccff, accent: 0xffd166, dashTime: 0.2, shielded: true });

    expect(head.radius).toBeGreaterThan(middle.radius);
    expect(middle.radius).toBeGreaterThan(tail.radius);
    expect(middle.hasScalePlate).toBe(true);
    expect(dashed.glowAlpha).toBeGreaterThan(middle.glowAlpha);
    expect(dashed.ringColor).toBe(0x8be9fd);
  });

  it('generates deterministic parallax star points for Olympus background detail', () => {
    expect(getOlympusStar(0)).toEqual(getOlympusStar(0));
    expect(getOlympusStar(0).x).toBeGreaterThanOrEqual(0);
    expect(getOlympusStar(0).x).toBeLessThanOrEqual(1);
    expect(getOlympusStar(12).alpha).toBeGreaterThan(0);
  });
});
