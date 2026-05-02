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

Playable v2 visual polish milestone:

- Vite + TypeScript + Phaser 3
- 10 snake roster with Hermes as player
- Arena shrink based on alive count
- Upgraded neon/Olympus arena: star-map backdrop, layered grid, glowing arena rings, styled pickups, mines, rockets, and particle trails
- Armored segmented snakes with glow, tapering bodies, scale plates, eyes, nose/head direction details, shields, dash aura, and fang lines
- Floating damage indicators, impact particles, and screen shake when snakes take damage
- Procedural browser SFX wired to semantic audio events. Toggle with `M`
- Safer snake, fruit, upgrade, and mine spawning helpers
- Fruit and upgrade pickups
- Speed/triple/shield buffs
- Rockets, boost, fang dash, collisions, death drops
- Late-game mines with head/body triggering
- AI snakes pursue fruit/upgrades/enemies, avoid mines/walls/body hazards, and use rockets/dash tactically
- HUD, leaderboard, feed, menu, pause, end screen
- Radar/minimap with snakes, pickups, and mines
- Spectator messaging after Hermes is eliminated
- Local settings and best score persistence
- Vitest core/system/visual tests and Playwright smoke test
