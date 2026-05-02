export function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

export function wrapAngle(angle: number): number {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = wrapAngle(target - current);
  return current + Math.max(-maxStep, Math.min(maxStep, delta));
}

export function distanceSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt(distanceSq(a, b));
}
