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

Playable v0 foundation:

- Vite + TypeScript + Phaser 3
- 10 snake roster with Hermes as player
- Arena shrink based on alive count
- Fruit and upgrade pickups
- Speed/triple/shield buffs
- Rockets, boost, fang dash, collisions, death drops
- Late-game mines
- HUD, leaderboard, feed, menu, pause, end screen
- Local settings and best score persistence
- Vitest core rule tests and Playwright smoke test
