# Snake of Olympus

Fresh Phaser 3 + TypeScript implementation of the PRD in `/data/Hermes Developer/IMPLEMENTATION_PRD.md`.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Controls

- `Space`: start / fire rockets
- `A` / `Left`: turn left
- `D` / `Right`: turn right
- `W` / `Up`: boost
- Hold `F`: fang dash charge
- `P` / `Esc`: pause
- `R`: restart
- `M`: mute toggle
- `N`: damage numbers toggle hook

## Verification

```bash
npm test
npm run build
npm run test:e2e
```

## Current milestone

Playable v1-ish foundation:

- Vite + TypeScript + Phaser 3
- 10 snake roster with Hermes as player
- Arena shrink based on alive count
- Safer snake, fruit, and mine spawning helpers
- Fruit and upgrade pickups
- Speed/triple/shield buffs
- Rockets, boost, fang dash, collisions, death drops
- Late-game mines with head/body triggering
- HUD, leaderboard, feed, menu, pause, end screen
- Radar/minimap with snakes, pickups, and mines
- Spectator messaging after Hermes is eliminated
- Local settings and best score persistence
- Semantic audio event hooks ready for real SFX assets
- Vitest core/system rule tests and Playwright smoke test
