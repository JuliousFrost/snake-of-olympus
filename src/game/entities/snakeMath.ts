import { BALANCE } from '../config/balance';

export function getHeadRadius(hp: number): number {
  const clamped = Math.max(0, Math.min(BALANCE.maxHp, hp));
  return 14 + (clamped / BALANCE.maxHp) * 3.2;
}

export function getSegmentCount(hp: number): number {
  const raw = Math.round(10 + Math.max(0, hp) * 0.42);
  return Math.max(11, Math.min(38, raw));
}

export function applyHealing(hp: number, amount: number): number {
  return Math.min(BALANCE.maxHp, Math.max(0, hp + Math.max(0, amount)));
}

export function applyDamage(hp: number, amount: number, shielded: boolean) {
  if (shielded && amount > 0) return { hp, killed: false, damage: 0, blocked: true };
  const damage = Math.max(0.2, amount);
  const nextHp = Math.max(0, hp - damage);
  return { hp: nextHp, killed: hp > 0 && nextHp <= 0, damage, blocked: false };
}
