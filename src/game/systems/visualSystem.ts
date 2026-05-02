import { getHeadRadius } from '../entities/snakeMath';

export type DamageIndicator = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: number;
  alpha: number;
  scale: number;
  source: string;
  critical: boolean;
};

export function createDamageIndicator(
  point: { x: number; y: number },
  amount: number,
  source = 'damage',
  critical = false,
  random: () => number = Math.random,
): DamageIndicator {
  const rounded = Math.max(1, Math.round(amount));
  const color = source === 'mine'
    ? 0xffb000
    : source === 'wall' || source === 'crash'
      ? 0xff6b35
      : source === 'body' || source === 'fang'
        ? 0xff4dff
        : 0xff4d6d;
  const maxLife = critical ? 1.05 : 0.82;
  return {
    x: point.x + (random() - 0.5) * 20,
    y: point.y - 18 + (random() - 0.5) * 12,
    vx: (random() - 0.5) * 54,
    vy: -72 - random() * 34,
    life: maxLife,
    maxLife,
    text: `-${rounded}`,
    color,
    alpha: 1,
    scale: critical ? 1.34 : 1.08 + Math.min(0.32, rounded / 70),
    source,
    critical,
  };
}

export function updateDamageIndicators(indicators: DamageIndicator[], dt: number): DamageIndicator[] {
  let writeIndex = 0;
  for (let i = 0; i < indicators.length; i++) {
    const indicator = indicators[i];
    indicator.life -= dt;
    if (indicator.life <= 0) continue;

    const t = Math.max(0, indicator.life / indicator.maxLife);
    indicator.x += indicator.vx * dt;
    indicator.y += indicator.vy * dt;
    indicator.vy -= 12 * dt;
    indicator.alpha = Math.min(1, t * 1.25);
    indicator.scale *= 0.992 + 0.018 * t;
    indicators[writeIndex++] = indicator;
  }
  indicators.length = writeIndex;
  return indicators;
}

export type SnakeSegmentStyleInput = {
  index: number;
  total: number;
  hp: number;
  color: number;
  accent: number;
  dashTime: number;
  shielded: boolean;
};

export type SnakeSegmentStyle = {
  radius: number;
  glowRadius: number;
  glowAlpha: number;
  bodyColor: number;
  innerColor: number;
  ringColor: number;
  hasScalePlate: boolean;
  plateAlpha: number;
};

export function getSnakeSegmentStyle(input: SnakeSegmentStyleInput): SnakeSegmentStyle {
  const headRadius = getHeadRadius(input.hp);
  const total = Math.max(1, input.total - 1);
  const t = Math.min(1, Math.max(0, input.index / total));
  const taper = 1 - t * 0.62;
  const pulse = input.dashTime > 0 ? 1.16 : 1;
  const radius = Math.max(4, headRadius * (input.index === 0 ? 1.06 : 0.82 * taper) * pulse);
  return {
    radius,
    glowRadius: radius + (input.dashTime > 0 ? 14 : 7),
    glowAlpha: input.dashTime > 0 ? 0.46 : input.shielded ? 0.34 : 0.2,
    bodyColor: input.color,
    innerColor: input.accent,
    ringColor: input.shielded ? 0x8be9fd : input.accent,
    hasScalePlate: input.index > 0 && input.index % 2 === 0,
    plateAlpha: 0.28 + (1 - t) * 0.32,
  };
}

export type PickupIcon = {
  label: string;
  symbol: 'heart' | 'bolt' | 'triple-shot' | 'shield' | 'warning';
  color: number;
};

export function getPickupIcon(kind: 'fruit' | 'upgrade' | 'mine', buff?: 'speed' | 'triple' | 'shield'): PickupIcon {
  if (kind === 'mine') return { label: 'DANGER', symbol: 'warning', color: 0xff3157 };
  if (kind === 'fruit') return { label: 'HP', symbol: 'heart', color: 0x50fa7b };
  if (buff === 'shield') return { label: 'SHIELD', symbol: 'shield', color: 0x8be9fd };
  if (buff === 'triple') return { label: 'TRIPLE', symbol: 'triple-shot', color: 0xffd166 };
  return { label: 'SPEED', symbol: 'bolt', color: 0xbdff4d };
}

function fract(value: number) {
  return value - Math.floor(value);
}

export function getOlympusStar(index: number) {
  const x = fract(Math.sin(index * 12.9898 + 78.233) * 43758.5453);
  const y = fract(Math.sin(index * 4.1414 + 19.19) * 24634.6345);
  const size = 0.8 + fract(Math.sin(index * 2.713) * 991.31) * 2.8;
  const alpha = 0.14 + fract(Math.sin(index * 6.119) * 171.77) * 0.42;
  return { x, y, size, alpha };
}
