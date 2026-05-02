export type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number; centerX: number; centerY: number };
export type BuffKind = 'speed' | 'triple' | 'shield';
export type PickupKind = 'fruit' | 'upgrade';

export type SnakeRuntime = {
  id: string;
  name: string;
  isPlayer: boolean;
  color: number;
  accent: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  kills: number;
  fruits: number;
  survival: number;
  score: number;
  body: { x: number; y: number }[];
  buffs: Partial<Record<BuffKind, number>>;
  cooldowns: {
    rocket: number;
    charge: number;
    boostDrain: number;
    wall: number;
    head: number;
    body: number;
    chargeHit: number;
  };
  chargeHeld: number;
  dashTime: number;
  aiThink: number;
  targetAngle: number;
};

export type LeaderboardEntry = Pick<SnakeRuntime, 'id' | 'name' | 'alive' | 'kills' | 'hp' | 'score'>;
