import Phaser from 'phaser';
import { BALANCE, BUFF_WEIGHTS, WORLD } from '../config/balance';
import { SNAKE_ROSTER } from '../data/snakeRoster';
import type { BuffKind, PickupKind, SnakeRuntime } from '../core/types';
import { Rng } from '../core/rng';
import { angleTo, distance, distanceSq, turnToward, wrapAngle } from '../core/math';
import { getArenaBounds, getArenaScale, clampToArena } from '../systems/arenaSystem';
import { applyDamage, applyHealing, getHeadRadius, getSegmentCount } from '../entities/snakeMath';
import { scoreSnake, sortLeaderboard } from '../systems/scoringSystem';
import { safeJsonRead, safeJsonWrite, getSafeStorage } from '../core/persistence';
import { chooseSpawnPoint, maintainPickupTargets } from '../systems/spawnSystem';
import { calculateRadarBlips } from '../systems/radarSystem';
import { createAudioEventQueue, type AudioEventName } from '../systems/audioSystem';
import {
  createDamageIndicator,
  getOlympusStar,
  getSnakeSegmentStyle,
  updateDamageIndicators,
  type DamageIndicator,
} from '../systems/visualSystem';

type Rocket = { x: number; y: number; vx: number; vy: number; life: number; ownerId: string; color: number };
type Pickup = { id: number; x: number; y: number; kind: PickupKind; buff?: BuffKind; value: number };
type Mine = { x: number; y: number; armed: number; cooldown: number };
type Feed = { text: string; life: number };
type Settings = { shake: boolean; damageNumbers: boolean; masterVolume: number; sfxVolume: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number; alpha: number };
type AudioEngine = { context: AudioContext; gain: GainNode };

const DEFAULT_SETTINGS: Settings = { shake: true, damageNumbers: true, masterVolume: 0.7, sfxVolume: 0.8 };

export class MatchScene extends Phaser.Scene {
  private rng = new Rng(20260502);
  private snakes: SnakeRuntime[] = [];
  private rockets: Rocket[] = [];
  private pickups: Pickup[] = [];
  private mines: Mine[] = [];
  private particles: Particle[] = [];
  private damageIndicators: DamageIndicator[] = [];
  private floatingTextObjects: Phaser.GameObjects.Text[] = [];
  private feed: Feed[] = [];
  private graphics!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private matchState: 'menu' | 'active' | 'paused' | 'complete' = 'menu';
  private elapsed = 0;
  private arenaScale = 1;
  private nextMine = 1.2;
  private pickupId = 1;
  private settings: Settings = DEFAULT_SETTINGS;
  private audioEvents = createAudioEventQueue(DEFAULT_SETTINGS);
  private audioEngine?: AudioEngine;
  private bestScore = 0;

  constructor() {
    super('MatchScene');
  }

  create() {
    const storage = getSafeStorage(window);
    this.settings = safeJsonRead(storage, 'soo:settings', DEFAULT_SETTINGS);
    this.audioEvents = createAudioEventQueue(this.settings);
    this.bestScore = safeJsonRead(storage, 'soo:bestScore', 0);
    this.cameras.main.setBackgroundColor('#07101f');
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.graphics = this.add.graphics();
    this.hud = this.add.text(16, 12, '', { fontFamily: 'monospace', fontSize: '15px', color: '#dff7ff', lineSpacing: 4 }).setScrollFactor(0).setDepth(20);
    this.overlay = this.add.text(0, 0, '', { fontFamily: 'Arial Black, Arial', fontSize: '28px', color: '#ffffff', align: 'center', stroke: '#06101f', strokeThickness: 8 }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.title = this.add.text(0, 0, '', { fontFamily: 'Arial Black, Arial', fontSize: '42px', color: '#ffd166', align: 'center', stroke: '#06101f', strokeThickness: 10 }).setOrigin(0.5).setScrollFactor(0).setDepth(31);
    const keyboard = this.input.keyboard!;
    this.keys = keyboard.addKeys('A,D,W,F,SPACE,LEFT,RIGHT,UP,ESC,P,R,M,N') as Record<string, Phaser.Input.Keyboard.Key>;
    keyboard.on('keydown-SPACE', () => this.matchState === 'menu' && this.startMatch());
    keyboard.on('keydown-R', () => this.startMatch());
    keyboard.on('keydown-P', () => this.togglePause());
    keyboard.on('keydown-ESC', () => this.togglePause());
    keyboard.on('keydown-M', () => this.toggleMute());
    keyboard.on('keydown-N', () => this.toggleDamageNumbers());
    window.addEventListener('blur', () => { if (this.matchState === 'active') this.matchState = 'paused'; });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupSceneObjects());
    this.drawMenu();
  }

  private startMatch() {
    this.matchState = 'active';
    this.elapsed = 0;
    this.arenaScale = 1;
    this.rockets = [];
    this.pickups = [];
    this.mines = [];
    this.particles = [];
    this.damageIndicators = [];
    this.clearFloatingText();
    this.feed = [{ text: 'The gates of Olympus open.', life: BALANCE.feedLife }];
    this.nextMine = 1.2;
    const startBounds = getArenaBounds(1);
    const placed: SnakeRuntime[] = [];
    this.snakes = SNAKE_ROSTER.map((roster, i) => {
      const point = chooseSpawnPoint(startBounds, placed, [], {
        fallbackIndex: i,
        random: () => this.rng.next(),
      });
      const angle = angleTo(point.x, point.y, WORLD.width / 2, WORLD.height / 2);
      const hp = roster.isPlayer ? BALANCE.startHp : this.rng.int(BALANCE.minAiHp, BALANCE.maxAiHp);
      const x = point.x;
      const y = point.y;
      const snake = {
        ...roster,
        x, y, angle, hp, alive: true, kills: 0, fruits: 0, survival: 0, score: 0,
        body: Array.from({ length: getSegmentCount(hp) }, (_, j) => ({ x: x - Math.cos(angle) * j * BALANCE.segmentSpacing, y: y - Math.sin(angle) * j * BALANCE.segmentSpacing })),
        buffs: {}, cooldowns: { rocket: 0, charge: 0, boostDrain: 0, wall: 0, head: 0, body: 0, chargeHit: 0 },
        chargeHeld: 0, dashTime: 0, aiThink: this.rng.between(BALANCE.aiThinkIntervalMin, BALANCE.aiThinkIntervalMax), targetAngle: angle,
      } satisfies SnakeRuntime;
      placed.push(snake);
      return snake;
    });
    this.maintainPickups();
    this.overlay.setText('');
    this.title.setText('');
  }

  update(_: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.updateHudSize();
    if (this.matchState === 'menu') { this.drawMenu(); return; }
    if (this.matchState === 'paused') { this.drawWorld(); this.drawOverlay('PAUSED\nP/Esc resume · R restart\nA/D turn · W boost · Space rockets · Hold F dash'); return; }
    if (this.matchState === 'complete') { this.drawWorld(); return; }
    this.elapsed += dt;
    this.step(dt);
    this.drawWorld();
  }

  private step(dt: number) {
    const alive = this.snakes.filter((s) => s.alive);
    this.arenaScale += (getArenaScale(alive.length, BALANCE.snakeCount) - this.arenaScale) * Math.min(1, dt * 1.8);
    this.updateSnakes(dt);
    this.updateRockets(dt);
    this.updatePickups();
    this.updateMines(dt);
    this.resolveCollisions();
    this.maintainPickups();
    this.updateVisualEffects(dt);
    this.feed.forEach((f) => f.life -= dt);
    this.feed = this.feed.filter((f) => f.life > 0).slice(-BALANCE.feedMaxStored);
    this.snakes.forEach((s) => {
      if (s.alive) s.survival += dt;
      s.score = scoreSnake(s);
    });
    this.followCamera();
    this.checkEndState();
    this.flushAudioHooks();
  }

  private updateSnakes(dt: number) {
    const bounds = getArenaBounds(this.arenaScale);
    for (const s of this.snakes) {
      if (!s.alive) continue;
      Object.keys(s.cooldowns).forEach((key) => { s.cooldowns[key as keyof SnakeRuntime['cooldowns']] = Math.max(0, s.cooldowns[key as keyof SnakeRuntime['cooldowns']] - dt); });
      for (const key of Object.keys(s.buffs) as BuffKind[]) {
        s.buffs[key] = Math.max(0, (s.buffs[key] ?? 0) - dt);
        if (s.buffs[key] === 0) delete s.buffs[key];
      }
      if (s.isPlayer) this.updatePlayerInput(s, dt); else this.updateAi(s, dt);
      const boosting = s.isPlayer ? (this.keys.W.isDown || this.keys.UP.isDown) : distanceSq(s, { x: bounds.centerX, y: bounds.centerY }) > 100000;
      const canBoost = boosting && s.hp > BALANCE.minBoostHp && s.dashTime <= 0 && s.chargeHeld <= 0;
      if (canBoost) {
        s.cooldowns.boostDrain -= dt;
        if (s.cooldowns.boostDrain <= 0) {
          s.hp = Math.max(1, s.hp - BALANCE.boostHpDrain);
          s.cooldowns.boostDrain = BALANCE.boostHpInterval;
        }
      }
      const speedBuff = s.buffs.speed ? BALANCE.speedFruitSpeedBonus : 0;
      const boostBonus = s.buffs.speed ? BALANCE.speedFruitBoostBonus : 0;
      let speed = canBoost ? BALANCE.boostSpeed + boostBonus : BALANCE.snakeSpeed + speedBuff;
      if (s.dashTime > 0) { speed = BALANCE.chargeDashSpeed; s.dashTime -= dt; }
      s.x += Math.cos(s.angle) * speed * dt;
      s.y += Math.sin(s.angle) * speed * dt;
      const radius = getHeadRadius(s.hp);
      const clamped = clampToArena(s.x, s.y, radius, bounds);
      if ((clamped.x !== s.x || clamped.y !== s.y) && s.cooldowns.wall <= 0) {
        this.hurt(s, BALANCE.wallDamage, undefined, 'wall');
        s.cooldowns.wall = BALANCE.wallCrashCooldown;
      }
      s.x = clamped.x; s.y = clamped.y;
      if (s.dashTime > 0 || canBoost) this.spawnTrail(s, canBoost ? 0.5 : 1);
      s.body.unshift({ x: s.x, y: s.y });
      const needed = getSegmentCount(s.hp);
      while (s.body.length > needed) s.body.pop();
      while (s.body.length < needed) s.body.push({ ...s.body[s.body.length - 1] });
    }
  }

  private updatePlayerInput(s: SnakeRuntime, dt: number) {
    const turn = BALANCE.turnRate * (s.dashTime > 0 ? BALANCE.chargeTurnModifier : 1) * dt;
    if (this.keys.A.isDown || this.keys.LEFT.isDown) s.angle -= turn;
    if (this.keys.D.isDown || this.keys.RIGHT.isDown) s.angle += turn;
    if (this.keys.F.isDown && s.hp > BALANCE.minChargeHp && s.cooldowns.charge <= 0) {
      s.chargeHeld = Math.min(BALANCE.chargeHoldDuration, s.chargeHeld + dt);
      if (s.chargeHeld >= BALANCE.chargeHoldDuration) {
        s.dashTime = BALANCE.chargeDashDuration;
        s.cooldowns.charge = BALANCE.chargeCooldown;
        s.chargeHeld = 0;
        this.emitAudio('dash-launch');
        this.feedLine('Hermes launches Fang Dash!');
      }
    } else if (s.chargeHeld > 0) s.chargeHeld = Math.max(0, s.chargeHeld - dt * 2);
    if (this.keys.SPACE.isDown && s.cooldowns.rocket <= 0 && s.dashTime <= 0 && s.chargeHeld <= 0) this.fireRocket(s);
  }

  private updateAi(s: SnakeRuntime, dt: number) {
    s.aiThink -= dt;
    if (s.aiThink <= 0) {
      s.aiThink = this.rng.between(BALANCE.aiThinkIntervalMin, BALANCE.aiThinkIntervalMax);
      const bounds = getArenaBounds(this.arenaScale);
      const nearWall = s.x < bounds.left + BALANCE.aiNearWallMargin || s.x > bounds.right - BALANCE.aiNearWallMargin || s.y < bounds.top + BALANCE.aiNearWallMargin || s.y > bounds.bottom - BALANCE.aiNearWallMargin;
      const lowHp = s.hp < 18;
      const fruit = this.pickups.filter((p) => lowHp ? p.kind === 'fruit' : true).sort((a, b) => distanceSq(s, a) - distanceSq(s, b))[0];
      const enemy = this.snakes.filter((o) => o.alive && o.id !== s.id).sort((a, b) => a.hp - b.hp || distanceSq(s, a) - distanceSq(s, b))[0];
      const mine = this.mines.find((m) => distance(s, m) < BALANCE.aiMineAvoidanceRadius);
      const bodyThreat = this.snakes
        .filter((o) => o.alive && o.id !== s.id)
        .flatMap((o) => o.body.slice(8).map((seg) => ({ ...seg, ownerHp: o.hp })))
        .filter((seg) => distance(s, seg) < 105)
        .sort((a, b) => distanceSq(s, a) - distanceSq(s, b))[0];
      if (nearWall) s.targetAngle = angleTo(s.x, s.y, bounds.centerX, bounds.centerY);
      else if (mine) s.targetAngle = angleTo(mine.x, mine.y, s.x, s.y);
      else if (bodyThreat) s.targetAngle = angleTo(bodyThreat.x, bodyThreat.y, s.x, s.y);
      else if (fruit && (lowHp || this.rng.next() < 0.55)) s.targetAngle = angleTo(s.x, s.y, fruit.x, fruit.y);
      else if (enemy) s.targetAngle = angleTo(s.x, s.y, enemy.x, enemy.y);
      if (enemy) {
        const d = distance(s, enemy);
        const delta = Math.abs(wrapAngle(angleTo(s.x, s.y, enemy.x, enemy.y) - s.angle));
        if (d < BALANCE.aiFireRange && delta < BALANCE.aiFireAngleGate && s.cooldowns.rocket <= 0) this.fireRocket(s);
        if (d < BALANCE.aiChargeRange && delta < BALANCE.aiChargeAngleGate && s.cooldowns.charge <= 0 && s.hp > BALANCE.minChargeHp) {
          s.dashTime = BALANCE.chargeDashDuration; s.cooldowns.charge = BALANCE.chargeCooldown; this.emitAudio('dash-launch', 0.45);
        }
      }
    }
    s.angle = turnToward(s.angle, s.targetAngle, BALANCE.turnRate * dt);
  }

  private fireRocket(owner: SnakeRuntime) {
    if (this.rockets.length >= BALANCE.maxRockets) this.rockets.shift();
    const spreads = owner.buffs.triple ? [-BALANCE.tripleRocketSpread, 0, BALANCE.tripleRocketSpread] : [0];
    for (const spread of spreads) {
      while (this.rockets.length >= BALANCE.maxRockets) this.rockets.shift();
      const angle = owner.angle + spread;
      this.rockets.push({ x: owner.x + Math.cos(angle) * 24, y: owner.y + Math.sin(angle) * 24, vx: Math.cos(angle) * BALANCE.rocketSpeed, vy: Math.sin(angle) * BALANCE.rocketSpeed, life: BALANCE.rocketLife, ownerId: owner.id, color: owner.accent });
    }
    owner.cooldowns.rocket = BALANCE.rocketCooldown;
    this.emitAudio('rocket-fire', owner.isPlayer ? 1 : 0.45);
  }

  private updateRockets(dt: number) {
    this.rockets.forEach((r) => { r.x += r.vx * dt; r.y += r.vy * dt; r.life -= dt; });
    this.rockets = this.rockets.filter((r) => r.life > 0 && r.x >= 0 && r.x <= WORLD.width && r.y >= 0 && r.y <= WORLD.height);
  }

  private updatePickups() {
    for (const s of this.snakes.filter((x) => x.alive)) {
      for (const p of [...this.pickups]) {
        if (distance(s, p) < getHeadRadius(s.hp) + (p.kind === 'upgrade' ? BALANCE.powerupFruitRadius : 12)) {
          s.hp = applyHealing(s.hp, p.value); s.fruits += 1;
          if (p.buff) s.buffs[p.buff] = p.buff === 'speed' ? BALANCE.speedFruitDuration : p.buff === 'triple' ? BALANCE.tripleFruitDuration : BALANCE.shieldFruitDuration;
          this.pickups = this.pickups.filter((x) => x.id !== p.id);
          this.emitAudio(p.kind === 'upgrade' ? 'upgrade-pickup' : 'fruit-pickup', s.isPlayer ? 1 : 0.4);
          this.feedLine(`${s.name} claimed ${p.buff ?? 'fruit'}`);
        }
      }
    }
  }

  private updateMines(dt: number) {
    const alive = this.snakes.filter((s) => s.alive).length;
    this.mines.forEach((m) => { m.armed += dt; m.cooldown = Math.max(0, m.cooldown - dt); });
    if (alive <= BALANCE.landmineActivationAliveCount) {
      this.nextMine -= dt;
      if (this.nextMine <= 0 && this.mines.length < BALANCE.landmineMax) {
        const b = getArenaBounds(this.arenaScale);
        const point = chooseSpawnPoint(b, this.snakes, this.mines, {
          minDistance: BALANCE.landmineSpawnPadding,
          margin: BALANCE.landmineSpawnPadding,
          random: () => this.rng.next(),
          fallbackIndex: this.mines.length,
        });
        this.mines.push({ x: point.x, y: point.y, armed: 0, cooldown: 0 });
        this.nextMine = this.rng.between(BALANCE.landmineSpawnIntervalMin, BALANCE.landmineSpawnIntervalMax);
      }
    }
    for (const mine of this.mines) {
      if (mine.armed < 0.65 || mine.cooldown > 0) continue;
      const victim = this.snakes.find((s) => s.alive && (
        distance(s, mine) < getHeadRadius(s.hp) + BALANCE.landmineRadius ||
        s.body.slice(5).some((seg) => distance(seg, mine) < 8 + BALANCE.landmineRadius)
      ));
      if (victim) {
        const bodyHit = distance(victim, mine) >= getHeadRadius(victim.hp) + BALANCE.landmineRadius;
        this.hurt(victim, bodyHit ? BALANCE.landmineBodyDamage : BALANCE.landmineDamage, undefined, 'mine');
        this.emitAudio('mine-trigger');
        mine.cooldown = BALANCE.landmineTriggerCooldown;
        this.feedLine(`${victim.name} hit a mine!`);
      }
    }
  }

  private resolveCollisions() {
    for (const r of [...this.rockets]) {
      for (const s of this.snakes) {
        if (!s.alive || s.id === r.ownerId) continue;
        const headHit = distance(s, r) < getHeadRadius(s.hp) + BALANCE.rocketRadius;
        const bodyHit = !headHit && s.body.slice(5).some((seg) => distance(seg, r) < 12 + BALANCE.rocketRadius);
        if (headHit || bodyHit) {
          const owner = this.snakes.find((x) => x.id === r.ownerId);
          this.hurt(s, BALANCE.rocketDamage * (headHit ? BALANCE.rocketHeadMultiplier : 1), owner, 'rocket');
          this.emitAudio('rocket-impact', owner?.isPlayer ? 1 : 0.45);
          this.rockets = this.rockets.filter((x) => x !== r);
          break;
        }
      }
    }
    for (const a of this.snakes.filter((s) => s.alive)) {
      for (const b of this.snakes.filter((s) => s.alive && s.id !== a.id)) {
        if (distance(a, b) < getHeadRadius(a.hp) + getHeadRadius(b.hp) && a.cooldowns.head <= 0) {
          this.hurt(a, BALANCE.headCrashDamage, undefined, 'crash'); a.cooldowns.head = BALANCE.headCrashCooldown;
        }
        if (a.cooldowns.body <= 0 && b.body.slice(8).some((seg) => distance(a, seg) < getHeadRadius(a.hp) + 8)) {
          const dmg = a.dashTime > 0 ? BALANCE.chargeDamage : BALANCE.bodyCrashDamage;
          this.hurt(a, dmg, b, 'body');
          if (a.dashTime > 0) this.hurt(b, BALANCE.chargeDamage * 0.45, a, 'fang');
          a.cooldowns.body = BALANCE.bodyCrashCooldown;
        }
      }
    }
  }

  private hurt(target: SnakeRuntime, amount: number, attacker?: SnakeRuntime, source = 'damage') {
    const result = applyDamage(target.hp, amount, Boolean(target.buffs.shield));
    target.hp = result.hp;
    if (result.damage > 0) {
      if (this.settings.damageNumbers) {
        this.damageIndicators.push(createDamageIndicator(target, result.damage, source, result.damage >= BALANCE.rocketDamage, () => this.rng.next()));
        this.damageIndicators = this.damageIndicators.slice(-36);
      }
      this.emitAudio('damage-hit', target.isPlayer ? 1 : 0.35);
      this.spawnImpact(target.x, target.y, source === 'mine' ? 0xffb000 : source === 'fang' ? 0xff4dff : 0xff4d6d, source === 'rocket' || source === 'mine' ? 12 : 7);
      if (this.settings.shake && (target.isPlayer || source === 'rocket' || source === 'mine')) this.cameras.main.shake(source === 'mine' ? 120 : 70, source === 'mine' ? 0.008 : 0.004);
    }
    if (result.killed) {
      target.alive = false;
      this.feedLine(`${attacker?.name ?? source} defeated ${target.name}`);
      if (attacker && attacker.id !== target.id) attacker.kills += 1;
      this.emitAudio('snake-death');
      for (let i = 0; i < 5; i++) this.spawnPickup(target.x + this.rng.between(-60, 60), target.y + this.rng.between(-60, 60), 'fruit');
    }
  }

  private updateVisualEffects(dt: number) {
    this.damageIndicators = updateDamageIndicators(this.damageIndicators, dt);
    this.particles = this.particles
      .map((p) => {
        const life = p.life - dt;
        const t = Math.max(0, life / p.maxLife);
        return { ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt, vy: p.vy + 10 * dt, life, alpha: t };
      })
      .filter((p) => p.life > 0)
      .slice(-260);
  }

  private spawnTrail(s: SnakeRuntime, intensity = 1) {
    if (this.rng.next() > 0.62) return;
    const offset = getHeadRadius(s.hp) * 0.7;
    this.particles.push({
      x: s.x - Math.cos(s.angle) * offset + this.rng.between(-8, 8),
      y: s.y - Math.sin(s.angle) * offset + this.rng.between(-8, 8),
      vx: -Math.cos(s.angle) * this.rng.between(15, 55) + this.rng.between(-20, 20),
      vy: -Math.sin(s.angle) * this.rng.between(15, 55) + this.rng.between(-20, 20),
      life: 0.28 + intensity * 0.26,
      maxLife: 0.28 + intensity * 0.26,
      color: s.dashTime > 0 ? s.accent : s.color,
      size: this.rng.between(3, 8) * intensity,
      alpha: 1,
    });
  }

  private spawnImpact(x: number, y: number, color: number, count: number) {
    for (let i = 0; i < count; i++) {
      const angle = this.rng.between(0, Math.PI * 2);
      const speed = this.rng.between(50, 180);
      const life = this.rng.between(0.25, 0.62);
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color, size: this.rng.between(2, 6), alpha: 1 });
    }
  }

  private maintainPickups() {
    const alive = this.snakes.filter((s) => s.alive).length;
    const currentBase = this.pickups.filter((p) => p.kind === 'fruit').length;
    const currentUpgrade = this.pickups.filter((p) => p.kind === 'upgrade').length;
    const targets = maintainPickupTargets(alive, currentBase, currentUpgrade);
    for (let i = 0; i < targets.baseNeeded; i++) this.spawnRandomPickup('fruit');
    for (let i = 0; i < targets.upgradeNeeded; i++) this.spawnRandomPickup('upgrade');
  }

  private spawnRandomPickup(kind: PickupKind) {
    const b = getArenaBounds(this.arenaScale);
    const point = chooseSpawnPoint(b, this.snakes, this.mines, {
      minDistance: kind === 'upgrade' ? 120 : 80,
      margin: BALANCE.fruitSpawnMargin,
      random: () => this.rng.next(),
      fallbackIndex: this.pickups.length,
    });
    this.spawnPickup(point.x, point.y, kind);
  }

  private spawnPickup(x: number, y: number, kind: PickupKind) {
    const buff = kind === 'upgrade' ? this.weightedBuff() : undefined;
    this.pickups.push({ id: this.pickupId++, x, y, kind, buff, value: kind === 'fruit' ? this.rng.int(BALANCE.fruitValueMin, BALANCE.fruitValueMax) : 1 });
  }

  private weightedBuff(): BuffKind {
    const roll = this.rng.next();
    if (roll < BUFF_WEIGHTS.speed) return 'speed';
    if (roll < BUFF_WEIGHTS.speed + BUFF_WEIGHTS.triple) return 'triple';
    return 'shield';
  }

  private followCamera() {
    const player = this.snakes.find((s) => s.isPlayer);
    const leader = sortLeaderboard(this.snakes)[0];
    const target = player?.alive ? player : leader;
    if (!target) return;
    const camera = this.cameras.main;
    const nextX = Phaser.Math.Linear(camera.scrollX + camera.width / 2, target.x, 0.08);
    const nextY = Phaser.Math.Linear(camera.scrollY + camera.height / 2, target.y, 0.08);
    camera.centerOn(nextX, nextY);
    camera.setZoom(Phaser.Math.Linear(camera.zoom, target.dashTime > 0 ? 0.95 : 1, 0.04));
  }

  private checkEndState() {
    const alive = this.snakes.filter((s) => s.alive);
    if (alive.length <= 1) {
      this.matchState = 'complete';
      const player = this.snakes.find((s) => s.isPlayer)!;
      if (player.score > this.bestScore) { this.bestScore = player.score; safeJsonWrite(getSafeStorage(window), 'soo:bestScore', this.bestScore); }
      this.emitAudio('victory');
      this.drawOverlay(`${alive[0]?.name ?? 'No one'} wins!\nYour score: ${player.score} · Best: ${this.bestScore}\nPress R to restart`);
    }
  }

  private togglePause() { if (this.matchState === 'active') this.matchState = 'paused'; else if (this.matchState === 'paused') { this.overlay.setText(''); this.matchState = 'active'; } this.emitAudio('menu-confirm', 0.7); }
  private toggleMute() { this.settings.masterVolume = this.settings.masterVolume > 0 ? 0 : 0.7; this.audioEvents = createAudioEventQueue(this.settings); safeJsonWrite(getSafeStorage(window), 'soo:settings', this.settings); this.emitAudio('menu-confirm', 0.7); }
  private toggleDamageNumbers() { this.settings.damageNumbers = !this.settings.damageNumbers; safeJsonWrite(getSafeStorage(window), 'soo:settings', this.settings); this.emitAudio('menu-confirm', 0.7); }
  private emitAudio(name: AudioEventName, intensity = 1) { this.audioEvents.emit(name, intensity); }
  private flushAudioHooks() {
    for (const event of this.audioEvents.drain()) this.playProceduralSound(event.name, event.volume);
  }

  private getAudioEngine() {
    if (this.settings.masterVolume <= 0 || this.settings.sfxVolume <= 0) return undefined;
    if (!this.audioEngine) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return undefined;
      const context = new AudioContextClass();
      const gain = context.createGain();
      gain.gain.value = 0.16;
      gain.connect(context.destination);
      this.audioEngine = { context, gain };
    }
    if (this.audioEngine.context.state === 'suspended') void this.audioEngine.context.resume();
    return this.audioEngine;
  }

  private playProceduralSound(name: AudioEventName, volume: number) {
    const engine = this.getAudioEngine();
    if (!engine || volume <= 0) return;
    const now = engine.context.currentTime;
    const profile: Record<AudioEventName, { frequency: number; end: number; type: OscillatorType }> = {
      'fruit-pickup': { frequency: 660, end: 0.09, type: 'sine' },
      'upgrade-pickup': { frequency: 880, end: 0.16, type: 'triangle' },
      'rocket-fire': { frequency: 155, end: 0.12, type: 'sawtooth' },
      'rocket-impact': { frequency: 90, end: 0.18, type: 'square' },
      'dash-launch': { frequency: 330, end: 0.2, type: 'sawtooth' },
      'damage-hit': { frequency: 120, end: 0.09, type: 'square' },
      'snake-death': { frequency: 70, end: 0.32, type: 'sawtooth' },
      'mine-trigger': { frequency: 55, end: 0.24, type: 'square' },
      victory: { frequency: 523, end: 0.28, type: 'triangle' },
      'menu-confirm': { frequency: 720, end: 0.08, type: 'sine' },
    };
    const sound = profile[name];
    const oscillator = engine.context.createOscillator();
    const gain = engine.context.createGain();
    oscillator.type = sound.type;
    oscillator.frequency.setValueAtTime(sound.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, sound.frequency * (name === 'victory' ? 1.5 : 0.55)), now + sound.end);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * this.settings.masterVolume * this.settings.sfxVolume * 0.22), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.end);
    oscillator.connect(gain).connect(engine.gain);
    oscillator.start(now);
    oscillator.stop(now + sound.end + 0.02);
  }

  private feedLine(text: string) { this.feed.push({ text, life: BALANCE.feedLife }); this.feed = this.feed.slice(-BALANCE.feedMaxStored); }

  private drawMenu() {
    this.graphics.clear();
    this.clearFloatingText();
    this.drawBackdrop();
    this.title.setPosition(this.scale.width / 2, this.scale.height / 2 - 120).setText('SNAKE OF OLYMPUS');
    this.overlay.setPosition(this.scale.width / 2, this.scale.height / 2 + 20).setText('Press SPACE to play\nA/D turn · W boost · Space rockets · Hold F fang dash\nP pause · R restart · M mute · N damage numbers\nBest score: ' + this.bestScore);
    this.hud.setText('');
  }

  private drawWorld() {
    this.title.setText('');
    this.graphics.clear();
    this.clearFloatingText();
    this.drawBackdrop();
    const b = getArenaBounds(this.arenaScale);
    this.drawArena(b);
    this.drawPickups();
    this.drawMines();
    this.drawRockets();
    this.drawParticles();
    this.drawSnakes();
    this.drawDamageIndicators();
    this.drawRadar(b);
    this.drawHud();
  }

  private drawBackdrop() {
    this.graphics.fillGradientStyle(0x030712, 0x0b1730, 0x21103f, 0x050816, 1).fillRect(0, 0, WORLD.width, WORLD.height);
    for (let i = 0; i < 90; i++) {
      const star = getOlympusStar(i);
      this.graphics.fillStyle(i % 7 === 0 ? 0xffd166 : 0x9bdcff, star.alpha).fillCircle(star.x * WORLD.width, star.y * WORLD.height, star.size);
    }
    this.graphics.lineStyle(2, 0x1b335f, 0.18);
    for (let x = -WORLD.height; x <= WORLD.width; x += 210) this.graphics.lineBetween(x, 0, x + WORLD.height, WORLD.height);
    this.graphics.lineStyle(1, 0x6f52ff, 0.1);
    for (let y = 80; y <= WORLD.height; y += 160) this.graphics.lineBetween(0, y, WORLD.width, y + Math.sin(y * 0.01) * 70);
    this.graphics.fillStyle(0xffd166, 0.05).fillCircle(WORLD.width * 0.5, WORLD.height * 0.48, 520);
    this.graphics.lineStyle(3, 0xffd166, 0.09).strokeCircle(WORLD.width * 0.5, WORLD.height * 0.48, 570);
  }

  private drawArena(bounds: ReturnType<typeof getArenaBounds>) {
    this.graphics.fillStyle(0x050914, 0.28).fillRoundedRect(bounds.left, bounds.top, bounds.width, bounds.height, 24);
    this.graphics.lineStyle(18, 0x8be9fd, 0.12).strokeRoundedRect(bounds.left - 7, bounds.top - 7, bounds.width + 14, bounds.height + 14, 32);
    this.graphics.lineStyle(8, 0xffd166, 0.45).strokeRoundedRect(bounds.left, bounds.top, bounds.width, bounds.height, 24);
    this.graphics.lineStyle(2, 0xffffff, 0.42).strokeRoundedRect(bounds.left + 7, bounds.top + 7, bounds.width - 14, bounds.height - 14, 18);
    this.graphics.lineStyle(1, 0x2d426e, 0.32);
    for (let x = Math.ceil(bounds.left / 130) * 130; x <= bounds.right; x += 130) this.graphics.lineBetween(x, bounds.top, x, bounds.bottom);
    for (let y = Math.ceil(bounds.top / 130) * 130; y <= bounds.bottom; y += 130) this.graphics.lineBetween(bounds.left, y, bounds.right, y);
    this.graphics.lineStyle(2, 0xffd166, 0.12).strokeCircle(bounds.centerX, bounds.centerY, Math.min(bounds.width, bounds.height) * 0.22);
    this.graphics.lineStyle(2, 0x8be9fd, 0.1).strokeCircle(bounds.centerX, bounds.centerY, Math.min(bounds.width, bounds.height) * 0.36);
  }

  private drawPickups() {
    this.pickups.forEach((p) => {
      const isUpgrade = p.kind === 'upgrade';
      const pulse = 1 + Math.sin(this.elapsed * 5 + p.id) * 0.08;
      const radius = (isUpgrade ? 18 : 11) * pulse;
      const color = isUpgrade ? 0xffd166 : 0x50fa7b;
      this.graphics.fillStyle(color, 0.16).fillCircle(p.x, p.y, radius + 18);
      this.graphics.lineStyle(3, color, 0.7).strokeCircle(p.x, p.y, radius + 6);
      if (isUpgrade) {
        this.graphics.fillStyle(0x11162a, 0.9).fillCircle(p.x, p.y, radius);
        this.graphics.lineStyle(3, color, 0.95).strokeCircle(p.x, p.y, radius);
        this.graphics.lineStyle(3, 0xffffff, 0.6).lineBetween(p.x - radius * 0.55, p.y, p.x + radius * 0.55, p.y);
        this.graphics.lineStyle(3, 0xffffff, 0.6).lineBetween(p.x, p.y - radius * 0.55, p.x, p.y + radius * 0.55);
      } else {
        this.graphics.fillStyle(0x12351f, 0.85).fillCircle(p.x, p.y, radius + 2);
        this.graphics.fillStyle(color, 0.95).fillCircle(p.x, p.y, radius);
        this.graphics.fillStyle(0xffffff, 0.35).fillCircle(p.x - radius * 0.35, p.y - radius * 0.3, radius * 0.28);
      }
    });
  }

  private drawMines() {
    this.mines.forEach((m) => {
      const armed = m.armed > 0.65;
      const pulse = armed ? 1 + Math.sin(this.elapsed * 12) * 0.18 : 1;
      this.graphics.fillStyle(0xff3157, armed ? 0.16 : 0.05).fillCircle(m.x, m.y, (BALANCE.landmineRadius + 22) * pulse);
      this.graphics.lineStyle(2, armed ? 0xff3157 : 0x865050, armed ? 0.85 : 0.45).strokeCircle(m.x, m.y, BALANCE.landmineRadius + 10);
      this.graphics.fillStyle(0x190912, 0.95).fillCircle(m.x, m.y, BALANCE.landmineRadius);
      this.graphics.lineStyle(3, armed ? 0xffd166 : 0x865050, 0.9).lineBetween(m.x - 11, m.y, m.x + 11, m.y);
      this.graphics.lineStyle(3, armed ? 0xffd166 : 0x865050, 0.9).lineBetween(m.x, m.y - 11, m.x, m.y + 11);
    });
  }

  private drawRockets() {
    this.rockets.forEach((r) => {
      this.graphics.lineStyle(12, r.color, 0.14).lineBetween(r.x - r.vx * 0.055, r.y - r.vy * 0.055, r.x, r.y);
      this.graphics.lineStyle(5, r.color, 0.85).lineBetween(r.x - r.vx * 0.035, r.y - r.vy * 0.035, r.x, r.y);
      this.graphics.fillStyle(0xffffff, 1).fillCircle(r.x, r.y, BALANCE.rocketRadius + 1);
      this.graphics.fillStyle(r.color, 1).fillCircle(r.x, r.y, BALANCE.rocketRadius - 2);
    });
  }

  private drawParticles() {
    this.particles.forEach((p) => {
      this.graphics.fillStyle(p.color, p.alpha * 0.55).fillCircle(p.x, p.y, p.size + 3);
      this.graphics.fillStyle(p.color, p.alpha).fillCircle(p.x, p.y, p.size);
    });
  }

  private drawSnakes() {
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const body = s.body.length ? s.body : [s];
      for (let i = body.length - 1; i >= 0; i--) {
        const seg = body[i];
        const style = getSnakeSegmentStyle({ index: i, total: body.length, hp: s.hp, color: s.color, accent: s.accent, dashTime: s.dashTime, shielded: Boolean(s.buffs.shield) });
        this.graphics.fillStyle(style.bodyColor, style.glowAlpha * 0.38).fillCircle(seg.x, seg.y, style.glowRadius);
        this.graphics.fillStyle(style.bodyColor, 0.9).fillCircle(seg.x, seg.y, style.radius);
        this.graphics.lineStyle(Math.max(1.5, style.radius * 0.16), 0xffffff, 0.22).strokeCircle(seg.x, seg.y, style.radius * 0.86);
        if (style.hasScalePlate) {
          this.graphics.fillStyle(style.innerColor, style.plateAlpha).fillCircle(seg.x, seg.y, Math.max(2, style.radius * 0.28));
        }
      }
      const radius = getHeadRadius(s.hp);
      const noseX = s.x + Math.cos(s.angle) * radius * 0.72;
      const noseY = s.y + Math.sin(s.angle) * radius * 0.72;
      const leftEye = s.angle - 0.58;
      const rightEye = s.angle + 0.58;
      this.graphics.lineStyle(3, s.buffs.shield ? 0x8be9fd : s.accent, 0.82).strokeCircle(s.x, s.y, radius + (s.dashTime > 0 ? 15 : 7));
      this.graphics.fillStyle(0xffffff, 0.92).fillCircle(s.x + Math.cos(leftEye) * radius * 0.42, s.y + Math.sin(leftEye) * radius * 0.42, Math.max(2.6, radius * 0.15));
      this.graphics.fillStyle(0xffffff, 0.92).fillCircle(s.x + Math.cos(rightEye) * radius * 0.42, s.y + Math.sin(rightEye) * radius * 0.42, Math.max(2.6, radius * 0.15));
      this.graphics.fillStyle(0x07101f, 0.96).fillCircle(noseX, noseY, Math.max(2, radius * 0.12));
      this.graphics.lineStyle(2, s.accent, 0.85).lineBetween(noseX, noseY, noseX + Math.cos(s.angle - 0.26) * 16, noseY + Math.sin(s.angle - 0.26) * 16);
      this.graphics.lineStyle(2, s.accent, 0.85).lineBetween(noseX, noseY, noseX + Math.cos(s.angle + 0.26) * 16, noseY + Math.sin(s.angle + 0.26) * 16);
    }
  }

  private drawDamageIndicators() {
    this.clearFloatingText();
    this.damageIndicators.forEach((indicator) => {
      const size = 15 * indicator.scale;
      this.graphics.lineStyle(4, 0x07101f, indicator.alpha * 0.8).strokeRoundedRect(indicator.x - size * 0.95, indicator.y - size * 0.7, size * 1.9, size * 1.08, 8);
      this.graphics.fillStyle(0x07101f, indicator.alpha * 0.46).fillRoundedRect(indicator.x - size * 0.95, indicator.y - size * 0.7, size * 1.9, size * 1.08, 8);
      this.graphics.lineStyle(2, indicator.color, indicator.alpha).strokeRoundedRect(indicator.x - size * 0.95, indicator.y - size * 0.7, size * 1.9, size * 1.08, 8);
    });
    const camera = this.cameras.main;
    const zoom = camera.zoom || 1;
    this.damageIndicators.forEach((indicator, index) => {
      let text = this.floatingTextObjects[index];
      if (!text) {
        text = this.add.text(indicator.x, indicator.y, '', {
          fontFamily: 'Arial Black, Arial',
          stroke: '#040812',
          strokeThickness: 5,
        }).setOrigin(0.5).setDepth(25);
        this.floatingTextObjects[index] = text;
      }
      text
        .setText(indicator.text)
        .setPosition(indicator.x, indicator.y)
        .setFontSize(Math.round(17 * indicator.scale))
        .setColor(Phaser.Display.Color.IntegerToColor(indicator.color).rgba)
        .setAlpha(indicator.alpha)
        .setScale(1 / zoom)
        .setVisible(true);
    });
    for (let i = this.damageIndicators.length; i < this.floatingTextObjects.length; i++) this.floatingTextObjects[i].setVisible(false);
  }

  private clearFloatingText() {
    this.floatingTextObjects.forEach((text) => text.setVisible(false));
  }

  private cleanupSceneObjects() {
    this.floatingTextObjects.forEach((text) => text.destroy());
    this.floatingTextObjects = [];
    if (this.audioEngine?.context.state !== 'closed') void this.audioEngine?.context.close();
    this.audioEngine = undefined;
  }

  private drawRadar(bounds: ReturnType<typeof getArenaBounds>) {
    const camera = this.cameras.main;
    const zoom = camera.zoom || 1;
    const radar = {
      x: camera.scrollX + (this.scale.width - 214) / zoom,
      y: camera.scrollY + 18 / zoom,
      width: 180 / zoom,
      height: 110 / zoom,
    };
    this.graphics.fillStyle(0x06101f, 0.76).fillRoundedRect(radar.x - 10 / zoom, radar.y - 10 / zoom, radar.width + 20 / zoom, radar.height + 22 / zoom, 10 / zoom);
    this.graphics.lineStyle(2 / zoom, 0x8be9fd, 0.8).strokeRect(radar.x, radar.y, radar.width, radar.height);
    const blips = calculateRadarBlips({ snakes: this.snakes, pickups: this.pickups, mines: this.mines, bounds, radar });
    for (const blip of blips) {
      const radius = blip.kind === 'player' ? 4.2 / zoom : blip.kind === 'snake' ? 3.1 / zoom : 2.4 / zoom;
      this.graphics.fillStyle(blip.color, blip.kind === 'pickup' ? 0.7 : 0.95).fillCircle(blip.x, blip.y, radius);
    }
  }

  private drawHud() {
    const player = this.snakes.find((s) => s.isPlayer)!;
    const alive = this.snakes.filter((s) => s.alive).length;
    const board = sortLeaderboard(this.snakes).slice(0, 5).map((s, i) => `${i + 1}. ${s.name.padEnd(10).slice(0, 10)} ${s.alive ? '♥' : '×'} K${s.kills} HP${Math.round(s.hp)}`).join('\n');
    const buffs = Object.entries(player.buffs).map(([k, v]) => `${k}:${(v ?? 0).toFixed(0)}s`).join(' ') || 'none';
    const leader = sortLeaderboard(this.snakes)[0];
    const spectator = player.alive ? '' : `\nSPECTATING ${leader?.name ?? 'arena'} · Hermes eliminated`;
    this.hud.setText(`Snake of Olympus${spectator}\nTime ${this.elapsed.toFixed(0)}s · Alive ${alive}/10 · Mines ${alive <= BALANCE.landmineActivationAliveCount ? 'ACTIVE' : 'dormant'}\nHP ${Math.round(player.hp)} · Kills ${player.kills} · Fruit ${player.fruits} · Score ${player.score}\nRocket ${player.cooldowns.rocket <= 0 ? 'READY' : player.cooldowns.rocket.toFixed(1)} · Fang ${player.cooldowns.charge <= 0 ? 'READY' : player.cooldowns.charge.toFixed(1)} · Buffs ${buffs}\n\nLeaderboard\n${board}\n\nFeed\n${this.feed.slice(-BALANCE.feedRowsShown).map((f) => '• ' + f.text).join('\n')}`);
  }

  private drawOverlay(text: string) {
    this.overlay.setPosition(this.scale.width / 2, this.scale.height / 2).setText(text);
  }

  private updateHudSize() {
    this.hud.setFontSize(this.scale.width < 1400 ? 13 : 15);
  }
}
