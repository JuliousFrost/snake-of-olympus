import type { SnakeRuntime } from '../core/types';

export const SNAKE_ROSTER: Array<Pick<SnakeRuntime, 'id' | 'name' | 'isPlayer' | 'color' | 'accent'>> = [
  { id: 'hermes', name: 'Hermes', isPlayer: true, color: 0x38f8bd, accent: 0xffd166 },
  { id: 'zeus', name: 'Zeus', isPlayer: false, color: 0xf8f0a8, accent: 0x67d3ff },
  { id: 'hera', name: 'Hera', isPlayer: false, color: 0xb56cff, accent: 0xff8bd1 },
  { id: 'poseidon', name: 'Poseidon', isPlayer: false, color: 0x38a8ff, accent: 0x7fffd4 },
  { id: 'athena', name: 'Athena', isPlayer: false, color: 0xf0f6ff, accent: 0x6c7bff },
  { id: 'apollo', name: 'Apollo', isPlayer: false, color: 0xffb84d, accent: 0xfff0a3 },
  { id: 'artemis', name: 'Artemis', isPlayer: false, color: 0x8eff7a, accent: 0xcafcff },
  { id: 'ares', name: 'Ares', isPlayer: false, color: 0xff4d5a, accent: 0xffa46c },
  { id: 'aphrodite', name: 'Aphrodite', isPlayer: false, color: 0xff78c8, accent: 0xfff1f8 },
  { id: 'hephaestus', name: 'Hephaestus', isPlayer: false, color: 0xd66a2f, accent: 0xffcc66 },
];
