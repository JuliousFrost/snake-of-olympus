import Phaser from 'phaser';
import { BALANCE, BUFF_WEIGHTS, WORLD } from '../config/balance';
import { SNAKE_ROSTER } from '../data/snakeRoster';
import type { BuffKind, PickupKind, SnakeRuntime } from '../core/types';
import { Rng } from '../core/rng';
import { angleTo, distanceSq, turnToward, wrapAngle } from '../core/math';
import { getArenaBounds, getContinuousArenaScale, clampToArena } from '../systems/arenaSystem';
import { applyDamage, applyHealing, getHeadRadius, getSegmentCount } from '../entities/snakeMath';
import { scoreSnake, sortLeaderboard } from '../systems/scoringSystem';
import { safeJsonRead, safeJsonWrite, getSafeStorage } from '../core/persistence';
import { chooseSpawnPoint, maintainPickupTargets } from '../systems/spawnSystem';
import { calculateRadarBlips } from '../systems/radarSystem';
import { createAudioEventQueue, type AudioEventName } from '../systems/audioSystem';
import {
  createDamageIndicator,
  getOlympusStar,
  getPickupIcon,
  getSnakeSegmentStyle,
  updateDamageIndicators,
  type DamageIndicator,
} from '../systems/visualSystem';

type Rocket = { x: number; y: number; vx: number; vy: number; life: number; ownerId: string; color: number };
type Pickup = { id: number; x: number; y: number; kind: PickupKind; buff?: BuffKind; value: number };
type Mine = { x: number; y: number; armed: number; cooldown: number };
type Feed = { text: string; life: number };
type Settings = { shake: boolean; damageNumbers: boolean; masterVolume: number; musicVolume: number; sfxVolume: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: number; size: number; alpha: number };
type AudioEngine = { context: AudioContext; gain: GainNode };
type SliderKind = 'music' | 'sfx';
type AdjustableSound = Phaser.Sound.BaseSound & { setVolume(value: number): Phaser.Sound.BaseSound };
type ViewBounds = { left: number; right: number; top: number; bottom: number };
type SfxAssetKey = 'sfx-retro-laser' | 'sfx-damage' | 'sfx-apple' | 'sfx-powerup';

const DEFAULT_SETTINGS: Settings = { shake: true, damageNumbers: true, masterVolume: 0.7, musicVolume: 0.55, sfxVolume: 0.8 };
const MUSIC_BASE_GAIN = 0.4;
const SFX_BASE_GAIN = 2;
const SFX_ASSET_GAIN = 1.6;

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
  private staticGraphics!: Phaser.GameObjects.Graphics;
  private graphics!: Phaser.GameObjects.Graphics;

  private hud!: Phaser.GameObjects.Text;
  private leaderboardText!: Phaser.GameObjects.Text;
  private feedText!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private pauseSliderGraphics!: Phaser.GameObjects.Graphics;
  private pauseMusicText!: Phaser.GameObjects.Text;
  private pauseSfxText!: Phaser.GameObjects.Text;
  private musicHitArea!: Phaser.GameObjects.Rectangle;
  private sfxHitArea!: Phaser.GameObjects.Rectangle;
  private backgroundMusic?: AdjustableSound;
  private audioAssetsQueued = false;
  private activeSlider?: SliderKind;
  private menuBackground?: Phaser.GameObjects.Image;
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
  private menuDirty = true;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private lastHudText = '';
  private lastLeaderboardText = '';
  private lastFeedText = '';
  private colorCache = new Map<number, string>();

  constructor() {
    super('MatchScene');
  }

  preload() {
    this.load.image('start-screen', '/assets/start-screen.png');
  }

  create() {
    const storage = getSafeStorage(window);
    this.settings = this.normalizeSettings(safeJsonRead<Partial<Settings>>(storage, 'soo:settings', DEFAULT_SETTINGS));
    this.audioEvents = createAudioEventQueue(this.settings);
    this.bestScore = safeJsonRead(storage, 'soo:bestScore', 0);
    this.cameras.main.setBackgroundColor('#120b18');
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.staticGraphics = this.add.graphics().setDepth(0);
    this.graphics = this.add.graphics().setDepth(5);
    this.drawStaticBackdrop();
    this.cacheStaticBackdrop();
    this.menuBackground = this.add.image(this.scale.width / 2, this.scale.height / 2, 'start-screen').setOrigin(0.5).setScrollFactor(0).setDepth(10);
    this.hud = this.add.text(16, 12, '', { fontFamily: 'Georgia, Times New Roman, serif', fontSize: '15px', color: '#fff4d6', lineSpacing: 5, stroke: '#180b24', strokeThickness: 3 }).setScrollFactor(0).setDepth(20);
    this.leaderboardText = this.add.text(0, 0, '', { fontFamily: 'Courier New, ui-monospace, monospace', fontSize: '16px', color: '#fff8e8', lineSpacing: 7, stroke: '#180b24', strokeThickness: 2 }).setScrollFactor(0).setDepth(22);
    this.feedText = this.add.text(16, 0, '', { fontFamily: 'Georgia, Times New Roman, serif', fontSize: '13px', color: '#f3d48b', lineSpacing: 6, stroke: '#160812', strokeThickness: 2 }).setScrollFactor(0).setDepth(22);
    this.overlay = this.add.text(0, 0, '', { fontFamily: 'Georgia, Times New Roman, serif', fontSize: '28px', color: '#fff4d6', align: 'center', stroke: '#160812', strokeThickness: 8 }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.title = this.add.text(0, 0, '', { fontFamily: 'Georgia, Times New Roman, serif', fontSize: '42px', color: '#ffd166', align: 'center', stroke: '#160812', strokeThickness: 10 }).setOrigin(0.5).setScrollFactor(0).setDepth(31);
    this.pauseSliderGraphics = this.add.graphics().setScrollFactor(0).setDepth(32);
    this.pauseMusicText = this.add.text(0, 0, '', { fontFamily: 'Georgia, Times New Roman, serif', fontSize: '18px', color: '#fff4d6', stroke: '#160812', strokeThickness: 4 }).setScrollFactor(0).setDepth(33).setVisible(false);
    this.pauseSfxText = this.add.text(0, 0, '', { fontFamily: 'Georgia, Times New Roman, serif', fontSize: '18px', color: '#fff4d6', stroke: '#160812', strokeThickness: 4 }).setScrollFactor(0).setDepth(33).setVisible(false);
    this.musicHitArea = this.createPauseSliderHitArea('music');
    this.sfxHitArea = this.createPauseSliderHitArea('sfx');
    const keyboard = this.input.keyboard!;
    this.keys = keyboard.addKeys('A,D,W,F,SPACE,LEFT,RIGHT,UP,ESC,P,R,M,N') as Record<string, Phaser.Input.Keyboard.Key>;
    keyboard.on('keydown-SPACE', () => this.matchState === 'menu' && this.startMatch());
    keyboard.on('keydown-R', () => this.startMatch());
    keyboard.on('keydown-P', () => this.togglePause());
    keyboard.on('keydown-ESC', () => this.togglePause());
    keyboard.on('keydown-M', () => this.toggleMute());
    keyboard.on('keydown-N', () => this.toggleDamageNumbers());
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => { if (this.activeSlider) this.setVolumeFromPointer(this.activeSlider, pointer.x); });
    this.input.on('pointerup', () => { this.activeSlider = undefined; });
    window.addEventListener('blur', () => { if (this.matchState === 'active') this.matchState = 'paused'; });
    this.scale.on(Phaser.Scale.Events.RESIZE, () => { this.menuDirty = true; });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanupSceneObjects());
    this.drawMenu();
    this.queueAudioAssets();
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
    this.lastHudText = '';
    this.lastLeaderboardText = '';
    this.lastFeedText = '';
    this.startBackgroundMusic();
    this.hidePauseSliders();
    this.overlay.setText('');
    this.title.setText('');
  }

  update(_: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.updateHudSize();
    if (this.matchState === 'menu') {
      this.hidePauseSliders();
      if (this.menuDirty || this.scale.width !== this.lastViewportWidth || this.scale.height !== this.lastViewportHeight) this.drawMenu();
      return;
    }
    if (this.matchState === 'paused') { this.drawWorld(); this.drawPauseOverlay(); return; }
    if (this.matchState === 'complete') { this.hidePauseSliders(); this.drawWorld(); return; }
    this.elapsed += dt;
    this.step(dt);
    this.drawWorld();
  }

  private step(dt: number) {
    const alive = this.snakes.filter((s) => s.alive);
    this.arenaScale += (getContinuousArenaScale({ aliveCount: alive.length, totalSnakes: BALANCE.snakeCount, elapsedSeconds: this.elapsed }) - this.arenaScale) * Math.min(1, dt * 1.8);
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
      let fruit: Pickup | undefined;
      let fruitDistSq = Number.POSITIVE_INFINITY;
      for (const p of this.pickups) {
        if (lowHp && p.kind !== 'fruit') continue;
        const dSq = distanceSq(s, p);
        if (dSq < fruitDistSq) { fruit = p; fruitDistSq = dSq; }
      }

      let enemy: SnakeRuntime | undefined;
      let enemyDistSq = Number.POSITIVE_INFINITY;
      for (const other of this.snakes) {
        if (!other.alive || other.id === s.id) continue;
        const dSq = distanceSq(s, other);
        if (!enemy || other.hp < enemy.hp || (other.hp === enemy.hp && dSq < enemyDistSq)) {
          enemy = other;
          enemyDistSq = dSq;
        }
      }

      const mineAvoidanceSq = BALANCE.aiMineAvoidanceRadius * BALANCE.aiMineAvoidanceRadius;
      const mine = this.mines.find((m) => distanceSq(s, m) < mineAvoidanceSq);
      const bodyThreat = this.findBodyThreat(s, 105);
      if (nearWall) s.targetAngle = angleTo(s.x, s.y, bounds.centerX, bounds.centerY);
      else if (mine) s.targetAngle = angleTo(mine.x, mine.y, s.x, s.y);
      else if (bodyThreat) s.targetAngle = angleTo(bodyThreat.x, bodyThreat.y, s.x, s.y);
      else if (fruit && (lowHp || this.rng.next() < 0.55)) s.targetAngle = angleTo(s.x, s.y, fruit.x, fruit.y);
      else if (enemy) s.targetAngle = angleTo(s.x, s.y, enemy.x, enemy.y);
      if (enemy) {
        const delta = Math.abs(wrapAngle(angleTo(s.x, s.y, enemy.x, enemy.y) - s.angle));
        if (enemyDistSq < BALANCE.aiFireRange * BALANCE.aiFireRange && delta < BALANCE.aiFireAngleGate && s.cooldowns.rocket <= 0) this.fireRocket(s);
        if (enemyDistSq < BALANCE.aiChargeRange * BALANCE.aiChargeRange && delta < BALANCE.aiChargeAngleGate && s.cooldowns.charge <= 0 && s.hp > BALANCE.minChargeHp) {
          s.dashTime = BALANCE.chargeDashDuration; s.cooldowns.charge = BALANCE.chargeCooldown; this.emitAudio('dash-launch', 0.45);
        }
      }
    }
    s.angle = turnToward(s.angle, s.targetAngle, BALANCE.turnRate * dt);
  }

  private findBodyThreat(snake: SnakeRuntime, radius: number) {
    const radiusSq = radius * radius;
    let threat: { x: number; y: number } | undefined;
    let threatDistanceSq = Number.POSITIVE_INFINITY;
    for (const other of this.snakes) {
      if (!other.alive || other.id === snake.id) continue;
      for (let i = 8; i < other.body.length; i++) {
        const segment = other.body[i];
        const dSq = distanceSq(snake, segment);
        if (dSq < radiusSq && dSq < threatDistanceSq) {
          threat = segment;
          threatDistanceSq = dSq;
        }
      }
    }
    return threat;
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
    for (const s of this.snakes) {
      if (!s.alive) continue;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const p = this.pickups[i];
        const radius = getHeadRadius(s.hp) + (p.kind === 'upgrade' ? BALANCE.powerupFruitRadius : 12);
        if (distanceSq(s, p) < radius * radius) {
          s.hp = applyHealing(s.hp, p.value); s.fruits += 1;
          if (p.buff) s.buffs[p.buff] = p.buff === 'speed' ? BALANCE.speedFruitDuration : p.buff === 'triple' ? BALANCE.tripleFruitDuration : BALANCE.shieldFruitDuration;
          this.pickups.splice(i, 1);
          this.emitAudio(p.kind === 'upgrade' ? 'upgrade-pickup' : 'fruit-pickup', s.isPlayer ? 1 : 0.4);
          this.feedLine(`${s.name} claimed ${p.buff ?? 'fruit'}`);
        }
      }
    }
  }

  private updateMines(dt: number) {
    let alive = 0;
    for (const s of this.snakes) if (s.alive) alive += 1;
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
      const victim = this.snakes.find((s) => s.alive && this.mineHitsSnake(mine, s));
      if (victim) {
        const headRadius = getHeadRadius(victim.hp) + BALANCE.landmineRadius;
        const bodyHit = distanceSq(victim, mine) >= headRadius * headRadius;
        this.hurt(victim, bodyHit ? BALANCE.landmineBodyDamage : BALANCE.landmineDamage, undefined, 'mine');
        this.emitAudio('mine-trigger');
        mine.cooldown = BALANCE.landmineTriggerCooldown;
        this.feedLine(`${victim.name} hit a mine!`);
      }
    }
  }

  private mineHitsSnake(mine: Mine, snake: SnakeRuntime) {
    const headRadius = getHeadRadius(snake.hp) + BALANCE.landmineRadius;
    if (distanceSq(snake, mine) < headRadius * headRadius) return true;
    const bodyRadius = 8 + BALANCE.landmineRadius;
    const bodyRadiusSq = bodyRadius * bodyRadius;
    for (let i = 5; i < snake.body.length; i++) {
      if (distanceSq(snake.body[i], mine) < bodyRadiusSq) return true;
    }
    return false;
  }

  private resolveCollisions() {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      for (const s of this.snakes) {
        if (!s.alive || s.id === r.ownerId) continue;
        const headRadius = getHeadRadius(s.hp) + BALANCE.rocketRadius;
        const headHit = distanceSq(s, r) < headRadius * headRadius;
        const bodyHit = !headHit && this.bodyHitsPoint(s.body, r, 5, 12 + BALANCE.rocketRadius);
        if (headHit || bodyHit) {
          const owner = this.snakes.find((x) => x.id === r.ownerId);
          this.hurt(s, BALANCE.rocketDamage * (headHit ? BALANCE.rocketHeadMultiplier : 1), owner, 'rocket');
          this.emitAudio('rocket-impact', owner?.isPlayer ? 1 : 0.45);
          this.rockets.splice(i, 1);
          break;
        }
      }
    }
    for (const a of this.snakes) {
      if (!a.alive) continue;
      const aHeadRadius = getHeadRadius(a.hp);
      for (const b of this.snakes) {
        if (!b.alive || b.id === a.id) continue;
        const headRadius = aHeadRadius + getHeadRadius(b.hp);
        if (distanceSq(a, b) < headRadius * headRadius && a.cooldowns.head <= 0) {
          this.hurt(a, BALANCE.headCrashDamage, undefined, 'crash'); a.cooldowns.head = BALANCE.headCrashCooldown;
        }
        if (a.cooldowns.body <= 0 && this.bodyHitsPoint(b.body, a, 8, aHeadRadius + 8)) {
          const dmg = a.dashTime > 0 ? BALANCE.chargeDamage : BALANCE.bodyCrashDamage;
          this.hurt(a, dmg, b, 'body');
          if (a.dashTime > 0) this.hurt(b, BALANCE.chargeDamage * 0.45, a, 'fang');
          a.cooldowns.body = BALANCE.bodyCrashCooldown;
        }
      }
    }
  }

  private bodyHitsPoint(body: { x: number; y: number }[], point: { x: number; y: number }, startIndex: number, radius: number) {
    const radiusSq = radius * radius;
    for (let i = startIndex; i < body.length; i++) {
      if (distanceSq(body[i], point) < radiusSq) return true;
    }
    return false;
  }

  private hurt(target: SnakeRuntime, amount: number, attacker?: SnakeRuntime, source = 'damage') {
    const result = applyDamage(target.hp, amount, Boolean(target.buffs.shield));
    target.hp = result.hp;
    if (result.blocked) {
      if (this.settings.damageNumbers) {
        this.damageIndicators.push({ ...createDamageIndicator(target, 0, 'shield', false, () => this.rng.next()), text: 'BLOCK', color: 0x8be9fd, scale: 1.05 });
        this.damageIndicators = this.damageIndicators.slice(-36);
      }
      this.emitAudio('damage-hit', target.isPlayer ? 0.7 : 0.25);
      this.spawnImpact(target.x, target.y, 0x8be9fd, 5);
      return;
    }
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
    let writeIndex = 0;
    for (let i = Math.max(0, this.particles.length - 260); i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 10 * dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      this.particles[writeIndex++] = p;
    }
    this.particles.length = writeIndex;
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

  private togglePause() {
    if (this.matchState === 'active') this.matchState = 'paused';
    else if (this.matchState === 'paused') { this.overlay.setText(''); this.hidePauseSliders(); this.matchState = 'active'; }
    this.emitAudio('menu-confirm', 0.7);
  }
  private toggleMute() { this.settings.masterVolume = this.settings.masterVolume > 0 ? 0 : 0.7; this.saveSettings(); this.emitAudio('menu-confirm', 0.7); }
  private toggleDamageNumbers() { this.settings.damageNumbers = !this.settings.damageNumbers; this.saveSettings(); this.emitAudio('menu-confirm', 0.7); }
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
      gain.gain.value = 0.28;
      gain.connect(context.destination);
      this.audioEngine = { context, gain };
    }
    if (this.audioEngine.context.state === 'suspended') void this.audioEngine.context.resume();
    return this.audioEngine;
  }

  private normalizeSettings(settings: Partial<Settings>): Settings {
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      masterVolume: Phaser.Math.Clamp(settings.masterVolume ?? DEFAULT_SETTINGS.masterVolume, 0, 1),
      musicVolume: Phaser.Math.Clamp(settings.musicVolume ?? DEFAULT_SETTINGS.musicVolume, 0, 1),
      sfxVolume: Phaser.Math.Clamp(settings.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume, 0, 1),
    };
  }

  private saveSettings() {
    this.settings = this.normalizeSettings(this.settings);
    this.audioEvents = createAudioEventQueue(this.settings);
    this.updateBackgroundMusicVolume();
    safeJsonWrite(getSafeStorage(window), 'soo:settings', this.settings);
  }

  private getMusicVolume() {
    return Phaser.Math.Clamp(this.settings.masterVolume * this.settings.musicVolume * MUSIC_BASE_GAIN, 0, 1);
  }

  private startBackgroundMusic() {
    const volume = this.getMusicVolume();
    if (!this.cache.audio.exists('olympus-music')) { this.queueAudioAssets(); return; }
    if (!this.backgroundMusic) this.backgroundMusic = this.sound.add('olympus-music', { loop: true, volume }) as AdjustableSound;
    this.updateBackgroundMusicVolume();
    if (volume > 0 && !this.backgroundMusic.isPlaying) this.backgroundMusic.play({ loop: true, volume });
  }

  private queueAudioAssets() {
    if (this.audioAssetsQueued) return;
    this.audioAssetsQueued = true;
    this.load.audio('olympus-music', '/assets/audio/into-tartarus.mp3');
    this.load.audio('sfx-retro-laser', '/assets/audio/sfx/retro-laser.mp3');
    this.load.audio('sfx-damage', '/assets/audio/sfx/damage.mp3');
    this.load.audio('sfx-apple', '/assets/audio/sfx/regular-apple.mp3');
    this.load.audio('sfx-powerup', '/assets/audio/sfx/powerup.mp3');
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.matchState !== 'menu') this.startBackgroundMusic();
    });
    this.load.start();
  }

  private updateBackgroundMusicVolume() {
    const volume = this.getMusicVolume();
    this.backgroundMusic?.setVolume(volume);
    if (volume > 0 && this.backgroundMusic && !this.backgroundMusic.isPlaying && this.matchState !== 'menu') this.backgroundMusic.play({ loop: true, volume });
  }

  private playProceduralSound(name: AudioEventName, volume: number) {
    if (this.playAssetSound(name, volume)) return;
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
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * SFX_BASE_GAIN * 0.22), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.end);
    oscillator.connect(gain).connect(engine.gain);
    oscillator.start(now);
    oscillator.stop(now + sound.end + 0.02);
  }

  private playAssetSound(name: AudioEventName, volume: number) {
    const key = this.getAssetSfxKey(name);
    if (!key || volume <= 0) return false;
    if (!this.cache.audio.exists(key)) { this.queueAudioAssets(); return false; }
    this.sound.play(key, { volume: Phaser.Math.Clamp(volume * SFX_ASSET_GAIN, 0, 1) });
    return true;
  }

  private getAssetSfxKey(name: AudioEventName): SfxAssetKey | undefined {
    switch (name) {
      case 'rocket-fire': return 'sfx-retro-laser';
      case 'damage-hit':
      case 'rocket-impact': return 'sfx-damage';
      case 'fruit-pickup': return 'sfx-apple';
      case 'upgrade-pickup': return 'sfx-powerup';
      default: return undefined;
    }
  }

  private feedLine(text: string) { this.feed.push({ text, life: BALANCE.feedLife }); this.feed = this.feed.slice(-BALANCE.feedMaxStored); }

  private createPauseSliderHitArea(kind: SliderKind) {
    const hitArea = this.add.rectangle(0, 0, 270, 34, 0xffffff, 0.001).setOrigin(0, 0.5).setScrollFactor(0).setDepth(34).setVisible(false).setInteractive({ useHandCursor: true });
    hitArea.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.activeSlider = kind;
      this.setVolumeFromPointer(kind, pointer.x);
    });
    return hitArea;
  }

  private sliderLayout(kind: SliderKind) {
    const centerX = this.scale.width / 2;
    const y = this.scale.height / 2 + (kind === 'music' ? 76 : 126);
    return { labelX: centerX - 185, trackX: centerX - 68, trackY: y, trackWidth: 250, y };
  }

  private setVolumeFromPointer(kind: SliderKind, pointerX: number) {
    const layout = this.sliderLayout(kind);
    const value = Phaser.Math.Clamp((pointerX - layout.trackX) / layout.trackWidth, 0, 1);
    if (kind === 'music') this.settings.musicVolume = value;
    else this.settings.sfxVolume = value;
    this.saveSettings();
  }

  private drawPauseOverlay() {
    this.drawOverlay('PAUSED\nP/Esc resume · R restart\nA/D turn · W boost · Space rockets · Hold F dash');
    this.drawPauseSliders();
  }

  private drawPauseSliders() {
    const rows: Array<{ kind: SliderKind; label: string; value: number; text: Phaser.GameObjects.Text; hitArea: Phaser.GameObjects.Rectangle }> = [
      { kind: 'music', label: 'Music', value: this.settings.musicVolume, text: this.pauseMusicText, hitArea: this.musicHitArea },
      { kind: 'sfx', label: 'SFX', value: this.settings.sfxVolume, text: this.pauseSfxText, hitArea: this.sfxHitArea },
    ];
    this.pauseSliderGraphics.clear();
    this.pauseSliderGraphics.fillStyle(0x120b18, 0.82).fillRoundedRect(this.scale.width / 2 - 250, this.scale.height / 2 + 42, 500, 128, 18);
    this.pauseSliderGraphics.lineStyle(2, 0xffd166, 0.78).strokeRoundedRect(this.scale.width / 2 - 250, this.scale.height / 2 + 42, 500, 128, 18);
    for (const row of rows) {
      const layout = this.sliderLayout(row.kind);
      const pct = Math.round(row.value * 100);
      row.text.setText(`${row.label} ${pct}%`).setPosition(layout.labelX, layout.y - 12).setVisible(true);
      row.hitArea.setPosition(layout.trackX, layout.trackY).setVisible(true);
      this.pauseSliderGraphics.fillStyle(0x3c2235, 0.96).fillRoundedRect(layout.trackX, layout.trackY - 7, layout.trackWidth, 14, 7);
      this.pauseSliderGraphics.fillGradientStyle(0xfff4d6, 0xffd166, 0xffb12c, 0xd88a16, 1).fillRoundedRect(layout.trackX, layout.trackY - 7, Math.max(10, layout.trackWidth * row.value), 14, 7);
      this.pauseSliderGraphics.lineStyle(2, 0xfff4d6, 0.76).strokeRoundedRect(layout.trackX, layout.trackY - 7, layout.trackWidth, 14, 7);
      this.pauseSliderGraphics.fillStyle(0xfff4d6, 1).fillCircle(layout.trackX + layout.trackWidth * row.value, layout.trackY, 12);
      this.pauseSliderGraphics.lineStyle(2, 0xffd166, 1).strokeCircle(layout.trackX + layout.trackWidth * row.value, layout.trackY, 12);
    }
  }

  private hidePauseSliders() {
    this.pauseSliderGraphics.clear();
    this.pauseMusicText.setVisible(false);
    this.pauseSfxText.setVisible(false);
    this.musicHitArea.setVisible(false);
    this.sfxHitArea.setVisible(false);
    this.activeSlider = undefined;
  }

  private drawMenu() {
    this.graphics.clear();
    this.clearFloatingText();
    this.fitMenuBackground();
    this.title.setText('');
    this.overlay.setText('');
    this.hidePauseSliders();
    this.hud.setText('');
    this.leaderboardText.setText('');
    this.feedText.setText('');
    this.lastViewportWidth = this.scale.width;
    this.lastViewportHeight = this.scale.height;
    this.menuDirty = false;
  }

  private drawWorld() {
    this.menuBackground?.setVisible(false);
    this.title.setText('');
    this.graphics.clear();
    const b = getArenaBounds(this.arenaScale);
    const view = this.getWorldView(180);
    this.drawArena(b);
    this.drawPickups(view);
    this.drawMines(view);
    this.drawRockets(view);
    this.drawParticles(view);
    this.drawSnakes(view);
    this.drawDamageIndicators();
    this.drawRadar(b);
    this.drawHud();
  }

  private fitMenuBackground() {
    const background = this.menuBackground;
    if (!background) return;
    const scale = Math.max(this.scale.width / background.width, this.scale.height / background.height);
    background
      .setVisible(true)
      .setPosition(this.scale.width / 2, this.scale.height / 2)
      .setScale(scale);
  }

  private getWorldView(padding = 0): ViewBounds {
    const camera = this.cameras.main;
    const zoom = camera.zoom || 1;
    return {
      left: camera.scrollX - padding / zoom,
      right: camera.scrollX + this.scale.width / zoom + padding / zoom,
      top: camera.scrollY - padding / zoom,
      bottom: camera.scrollY + this.scale.height / zoom + padding / zoom,
    };
  }

  private isInView(point: { x: number; y: number }, radius: number, view: ViewBounds) {
    return point.x + radius >= view.left && point.x - radius <= view.right && point.y + radius >= view.top && point.y - radius <= view.bottom;
  }

  private cacheStaticBackdrop() {
    const key = 'olympus-static-backdrop';
    this.textures.remove(key);
    this.staticGraphics.generateTexture(key, WORLD.width, WORLD.height);
    this.staticGraphics.destroy();
    this.add.image(0, 0, key).setOrigin(0).setDepth(0);
  }

  private drawStaticBackdrop() {
    const graphics = this.staticGraphics;
    graphics.clear();
    graphics.fillGradientStyle(0x14091f, 0x2c1743, 0x07101f, 0x03040a, 1).fillRect(0, 0, WORLD.width, WORLD.height);

    graphics.fillStyle(0xffd166, 0.08).fillCircle(WORLD.width * 0.5, WORLD.height * 0.16, 620);
    graphics.fillStyle(0xfff1b8, 0.05).fillCircle(WORLD.width * 0.5, WORLD.height * 0.16, 820);
    graphics.lineStyle(3, 0xffd166, 0.08).strokeCircle(WORLD.width * 0.5, WORLD.height * 0.16, 700);

    for (let i = 0; i < 110; i++) {
      const star = getOlympusStar(i);
      const divineStar = i % 6 === 0;
      graphics.fillStyle(divineStar ? 0xffd166 : 0xf7e8c8, star.alpha * (divineStar ? 0.9 : 0.55)).fillCircle(star.x * WORLD.width, star.y * WORLD.height, star.size * (divineStar ? 1.25 : 0.85));
    }

    graphics.lineStyle(2, 0xffd166, 0.08);
    for (let i = -8; i <= 8; i++) {
      const x = WORLD.width * 0.5 + i * 150;
      graphics.lineBetween(WORLD.width * 0.5, WORLD.height * 0.08, x, WORLD.height);
    }

    graphics.fillStyle(0x1b1a2c, 0.62).fillTriangle(0, WORLD.height * 0.58, WORLD.width * 0.22, WORLD.height * 0.28, WORLD.width * 0.46, WORLD.height * 0.58);
    graphics.fillTriangle(WORLD.width * 0.32, WORLD.height * 0.6, WORLD.width * 0.58, WORLD.height * 0.32, WORLD.width * 0.86, WORLD.height * 0.6);
    graphics.fillTriangle(WORLD.width * 0.62, WORLD.height * 0.58, WORLD.width * 0.84, WORLD.height * 0.26, WORLD.width, WORLD.height * 0.58);
    graphics.lineStyle(2, 0xfff4d6, 0.12);
    for (let y = 120; y <= WORLD.height; y += 170) graphics.lineBetween(0, y, WORLD.width, y + Math.sin(y * 0.008) * 54);

    const templeY = WORLD.height - 360;
    graphics.fillStyle(0xf7e8c8, 0.08).fillRoundedRect(WORLD.width * 0.5 - 520, templeY + 16, 1040, 230, 18);
    graphics.fillStyle(0xffd166, 0.12).fillTriangle(WORLD.width * 0.5 - 560, templeY + 48, WORLD.width * 0.5, templeY - 70, WORLD.width * 0.5 + 560, templeY + 48);
    graphics.lineStyle(4, 0xffd166, 0.18).lineBetween(WORLD.width * 0.5 - 560, templeY + 48, WORLD.width * 0.5 + 560, templeY + 48);
    for (let i = 0; i < 9; i++) {
      const x = WORLD.width * 0.5 - 420 + i * 105;
      graphics.fillStyle(0xfff4d6, 0.11).fillRoundedRect(x, templeY + 70, 42, 210, 12);
      graphics.lineStyle(2, 0xffd166, 0.11).lineBetween(x + 12, templeY + 82, x + 12, templeY + 264);
      graphics.lineBetween(x + 30, templeY + 82, x + 30, templeY + 264);
      graphics.fillStyle(0xffd166, 0.11).fillRoundedRect(x - 12, templeY + 56, 66, 18, 7);
      graphics.fillRoundedRect(x - 14, templeY + 268, 70, 18, 7);
    }

    graphics.fillStyle(0xffd166, 0.045).fillCircle(WORLD.width * 0.5, WORLD.height * 0.48, 560);
    graphics.lineStyle(3, 0xffd166, 0.12).strokeCircle(WORLD.width * 0.5, WORLD.height * 0.48, 570);
    graphics.lineStyle(2, 0xffffff, 0.08).strokeCircle(WORLD.width * 0.5, WORLD.height * 0.48, 410);
  }

  private drawArena(bounds: ReturnType<typeof getArenaBounds>) {
    this.graphics.fillStyle(0x201526, 0.44).fillRoundedRect(bounds.left - 18, bounds.top - 18, bounds.width + 36, bounds.height + 36, 34);
    this.graphics.lineStyle(22, 0xffd166, 0.1).strokeRoundedRect(bounds.left - 10, bounds.top - 10, bounds.width + 20, bounds.height + 20, 32);
    this.graphics.lineStyle(10, 0xc69b4d, 0.54).strokeRoundedRect(bounds.left, bounds.top, bounds.width, bounds.height, 24);
    this.graphics.lineStyle(3, 0xfff4d6, 0.5).strokeRoundedRect(bounds.left + 8, bounds.top + 8, bounds.width - 16, bounds.height - 16, 18);
    this.graphics.fillStyle(0xfff4d6, 0.04).fillRoundedRect(bounds.left + 16, bounds.top + 16, bounds.width - 32, bounds.height - 32, 16);

    this.graphics.lineStyle(1, 0xfff4d6, 0.14);
    for (let x = Math.ceil(bounds.left / 130) * 130; x <= bounds.right; x += 130) this.graphics.lineBetween(x, bounds.top + 12, x, bounds.bottom - 12);
    for (let y = Math.ceil(bounds.top / 130) * 130; y <= bounds.bottom; y += 130) this.graphics.lineBetween(bounds.left + 12, y, bounds.right - 12, y);

    this.graphics.lineStyle(2, 0xffd166, 0.18).strokeCircle(bounds.centerX, bounds.centerY, Math.min(bounds.width, bounds.height) * 0.22);
    this.graphics.lineStyle(2, 0xffffff, 0.1).strokeCircle(bounds.centerX, bounds.centerY, Math.min(bounds.width, bounds.height) * 0.36);
    this.graphics.lineStyle(1.5, 0xc69b4d, 0.18);
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      this.graphics.lineBetween(bounds.centerX, bounds.centerY, bounds.centerX + Math.cos(angle) * Math.min(bounds.width, bounds.height) * 0.2, bounds.centerY + Math.sin(angle) * Math.min(bounds.width, bounds.height) * 0.2);
    }
  }

  private drawPickups(view: ViewBounds) {
    this.pickups.forEach((p) => {
      const icon = getPickupIcon(p.kind, p.buff);
      const isUpgrade = p.kind === 'upgrade';
      const pulse = 1 + Math.sin(this.elapsed * 5 + p.id) * 0.08;
      const radius = (isUpgrade ? 20 : 13) * pulse;
      if (!this.isInView(p, radius + 22, view)) return;
      this.graphics.fillStyle(icon.color, 0.16).fillCircle(p.x, p.y, radius + 18);
      this.graphics.lineStyle(3, icon.color, 0.78).strokeCircle(p.x, p.y, radius + 7);
      this.graphics.fillStyle(isUpgrade ? 0x11162a : 0x12351f, 0.92).fillCircle(p.x, p.y, radius);
      this.graphics.fillStyle(icon.color, isUpgrade ? 0.24 : 0.92).fillCircle(p.x, p.y, isUpgrade ? radius * 0.68 : radius * 0.86);
      this.drawPickupSymbol(p.x, p.y, radius, icon.symbol, icon.color);
    });
  }

  private drawPickupSymbol(x: number, y: number, radius: number, symbol: ReturnType<typeof getPickupIcon>['symbol'], color: number) {
    this.graphics.lineStyle(Math.max(2, radius * 0.14), 0xffffff, 0.9);
    this.graphics.fillStyle(0xffffff, 0.92);
    if (symbol === 'heart') {
      this.graphics.fillCircle(x - radius * 0.22, y - radius * 0.08, radius * 0.22);
      this.graphics.fillCircle(x + radius * 0.22, y - radius * 0.08, radius * 0.22);
      this.graphics.fillTriangle(x - radius * 0.46, y, x + radius * 0.46, y, x, y + radius * 0.5);
    } else if (symbol === 'bolt') {
      this.graphics.fillStyle(color, 1).fillTriangle(x + radius * 0.1, y - radius * 0.62, x - radius * 0.42, y + radius * 0.04, x + radius * 0.03, y + radius * 0.04);
      this.graphics.fillTriangle(x - radius * 0.04, y - radius * 0.02, x + radius * 0.42, y - radius * 0.02, x - radius * 0.12, y + radius * 0.62);
    } else if (symbol === 'triple-shot') {
      [-0.42, 0, 0.42].forEach((offset) => {
        this.graphics.fillStyle(color, 1).fillCircle(x + offset * radius, y + radius * 0.08, radius * 0.13);
        this.graphics.lineStyle(2, 0xffffff, 0.85).lineBetween(x + offset * radius, y + radius * 0.08, x + offset * radius, y - radius * 0.46);
      });
    } else if (symbol === 'shield') {
      this.graphics.lineStyle(Math.max(2, radius * 0.15), color, 1).strokeCircle(x, y, radius * 0.48);
      this.graphics.lineStyle(Math.max(2, radius * 0.12), 0xffffff, 0.85).lineBetween(x - radius * 0.24, y, x - radius * 0.04, y + radius * 0.22);
      this.graphics.lineStyle(Math.max(2, radius * 0.12), 0xffffff, 0.85).lineBetween(x - radius * 0.04, y + radius * 0.22, x + radius * 0.3, y - radius * 0.24);
    } else {
      this.graphics.fillStyle(0xff3157, 1).fillTriangle(x, y - radius * 0.58, x - radius * 0.54, y + radius * 0.42, x + radius * 0.54, y + radius * 0.42);
      this.graphics.fillStyle(0xffffff, 0.95).fillRect(x - radius * 0.05, y - radius * 0.2, radius * 0.1, radius * 0.35);
      this.graphics.fillCircle(x, y + radius * 0.26, radius * 0.06);
    }
  }

  private drawMines(view: ViewBounds) {
    this.mines.forEach((m) => {
      if (!this.isInView(m, BALANCE.landmineRadius + 42, view)) return;
      const armed = m.armed > 0.65;
      const pulse = armed ? 1 + Math.sin(this.elapsed * 12) * 0.18 : 1;
      this.graphics.fillStyle(0xff3157, armed ? 0.16 : 0.05).fillCircle(m.x, m.y, (BALANCE.landmineRadius + 22) * pulse);
      this.graphics.lineStyle(2, armed ? 0xff3157 : 0x865050, armed ? 0.85 : 0.45).strokeCircle(m.x, m.y, BALANCE.landmineRadius + 10);
      this.graphics.fillStyle(0x190912, 0.95).fillCircle(m.x, m.y, BALANCE.landmineRadius);
      this.drawPickupSymbol(m.x, m.y, BALANCE.landmineRadius * 0.95, 'warning', armed ? 0xff3157 : 0x865050);
    });
  }

  private drawRockets(view: ViewBounds) {
    this.rockets.forEach((r) => {
      if (!this.isInView(r, 70, view)) return;
      this.graphics.lineStyle(12, r.color, 0.14).lineBetween(r.x - r.vx * 0.055, r.y - r.vy * 0.055, r.x, r.y);
      this.graphics.lineStyle(5, r.color, 0.85).lineBetween(r.x - r.vx * 0.035, r.y - r.vy * 0.035, r.x, r.y);
      this.graphics.fillStyle(0xffffff, 1).fillCircle(r.x, r.y, BALANCE.rocketRadius + 1);
      this.graphics.fillStyle(r.color, 1).fillCircle(r.x, r.y, BALANCE.rocketRadius - 2);
    });
  }

  private drawParticles(view: ViewBounds) {
    this.particles.forEach((p) => {
      if (!this.isInView(p, p.size + 8, view)) return;
      this.graphics.fillStyle(p.color, p.alpha * 0.55).fillCircle(p.x, p.y, p.size + 3);
      this.graphics.fillStyle(p.color, p.alpha).fillCircle(p.x, p.y, p.size);
    });
  }

  private drawSnakes(view: ViewBounds) {
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const body = s.body.length ? s.body : [s];
      let anyVisible = this.isInView(s, getHeadRadius(s.hp) + 32, view);
      if (!anyVisible) {
        for (const seg of body) {
          if (this.isInView(seg, getHeadRadius(s.hp) + 22, view)) { anyVisible = true; break; }
        }
      }
      if (!anyVisible) continue;
      for (let i = body.length - 1; i >= 0; i--) {
        const seg = body[i];
        if (!this.isInView(seg, getHeadRadius(s.hp) + 28, view)) continue;
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
      if (s.buffs.shield) {
        this.graphics.lineStyle(4, 0x8be9fd, 0.82).strokeCircle(s.x, s.y, radius + 10 + Math.sin(this.elapsed * 8) * 2);
      } else if (s.dashTime > 0) {
        this.graphics.lineStyle(3, s.accent, 0.72).strokeCircle(s.x, s.y, radius + 15);
      }
      this.graphics.fillStyle(0xffffff, 0.92).fillCircle(s.x + Math.cos(leftEye) * radius * 0.42, s.y + Math.sin(leftEye) * radius * 0.42, Math.max(2.6, radius * 0.15));
      this.graphics.fillStyle(0xffffff, 0.92).fillCircle(s.x + Math.cos(rightEye) * radius * 0.42, s.y + Math.sin(rightEye) * radius * 0.42, Math.max(2.6, radius * 0.15));
      this.graphics.fillStyle(0x07101f, 0.96).fillCircle(noseX, noseY, Math.max(2, radius * 0.12));
      this.graphics.lineStyle(2, s.accent, 0.85).lineBetween(noseX, noseY, noseX + Math.cos(s.angle - 0.26) * 16, noseY + Math.sin(s.angle - 0.26) * 16);
      this.graphics.lineStyle(2, s.accent, 0.85).lineBetween(noseX, noseY, noseX + Math.cos(s.angle + 0.26) * 16, noseY + Math.sin(s.angle + 0.26) * 16);
      if (s.isPlayer) this.drawDashChargeBar(s, radius);
    }
  }

  private drawDashChargeBar(s: SnakeRuntime, radius: number) {
    if (s.chargeHeld <= 0 || s.dashTime > 0) return;
    const progress = Phaser.Math.Clamp(s.chargeHeld / BALANCE.chargeHoldDuration, 0, 1);
    const width = Math.max(104, radius * 4.4);
    const height = 14;
    const x = s.x - width / 2;
    const y = s.y - radius - 46;
    const glow = 0.35 + progress * 0.55;

    this.graphics.fillStyle(0xffd166, glow * 0.36).fillRoundedRect(x - 10, y - 10, width + 20, height + 20, 11);
    this.graphics.fillStyle(0x180b24, 0.92).fillRoundedRect(x, y, width, height, 7);
    this.graphics.fillStyle(0x3c2235, 0.96).fillRoundedRect(x + 2, y + 2, width - 4, height - 4, 5);
    this.graphics.fillGradientStyle(0xfff4d6, 0xffd166, 0xffb12c, 0xd88a16, 1).fillRoundedRect(x + 2, y + 2, Math.max(32, (width - 4) * progress), height - 4, 5);
    this.graphics.lineStyle(3, 0xfff4d6, 0.82).strokeRoundedRect(x, y, width, height, 7);
    this.graphics.lineStyle(2, 0xffd166, 0.96).lineBetween(x + width * progress, y - 5, x + width * progress, y + height + 5);
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
        .setColor(this.getColorString(indicator.color))
        .setAlpha(indicator.alpha)
        .setScale(1 / zoom)
        .setVisible(true);
    });
    for (let i = this.damageIndicators.length; i < this.floatingTextObjects.length; i++) this.floatingTextObjects[i].setVisible(false);
  }

  private clearFloatingText() {
    this.floatingTextObjects.forEach((text) => text.setVisible(false));
  }

  private getColorString(color: number) {
    let cached = this.colorCache.get(color);
    if (!cached) {
      cached = Phaser.Display.Color.IntegerToColor(color).rgba;
      this.colorCache.set(color, cached);
    }
    return cached;
  }

  private cleanupSceneObjects() {
    this.floatingTextObjects.forEach((text) => text.destroy());
    this.floatingTextObjects = [];
    this.backgroundMusic?.stop();
    this.backgroundMusic?.destroy();
    this.backgroundMusic = undefined;
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
    this.graphics.fillStyle(0x221327, 0.78).fillRoundedRect(radar.x - 10 / zoom, radar.y - 10 / zoom, radar.width + 20 / zoom, radar.height + 22 / zoom, 10 / zoom);
    this.graphics.lineStyle(3 / zoom, 0xffd166, 0.72).strokeRect(radar.x, radar.y, radar.width, radar.height);
    this.graphics.lineStyle(1 / zoom, 0xfff4d6, 0.32).strokeRect(radar.x + 5 / zoom, radar.y + 5 / zoom, radar.width - 10 / zoom, radar.height - 10 / zoom);
    const blips = calculateRadarBlips({ snakes: this.snakes, pickups: this.pickups, mines: this.mines, bounds, radar });
    for (const blip of blips) {
      const radius = blip.kind === 'player' ? 4.2 / zoom : blip.kind === 'snake' ? 3.1 / zoom : 2.4 / zoom;
      this.graphics.fillStyle(blip.color, blip.kind === 'pickup' ? 0.7 : 0.95).fillCircle(blip.x, blip.y, radius);
    }
  }

  private drawHud() {
    const player = this.snakes.find((s) => s.isPlayer)!;
    let alive = 0;
    for (const s of this.snakes) if (s.alive) alive += 1;
    const leaderboard = sortLeaderboard(this.snakes);
    const leader = leaderboard[0];
    const spectator = player.alive ? '' : ` · SPECTATING ${leader?.name ?? 'arena'}`;
    const arenaPct = Math.round(this.arenaScale * 100);
    const buffs = Object.entries(player.buffs).map(([k, v]) => `${k.toUpperCase()} ${Math.ceil(v ?? 0)}s`).join('   ') || 'NO BUFF';
    const hudText = `HP ${Math.round(player.hp)}   K ${player.kills}   SCORE ${player.score}   ALIVE ${alive}/10   ARENA ${arenaPct}%${spectator}
ROCKET ${player.cooldowns.rocket <= 0 ? 'READY' : player.cooldowns.rocket.toFixed(1) + 's'}   FANG ${player.cooldowns.charge <= 0 ? 'READY' : player.cooldowns.charge.toFixed(1) + 's'}   ${buffs}`;
    if (hudText !== this.lastHudText) {
      this.hud.setText(hudText);
      this.lastHudText = hudText;
    }

    const camera = this.cameras.main;
    const zoom = camera.zoom || 1;
    const hx = camera.scrollX + 8 / zoom;
    const hy = camera.scrollY + 8 / zoom;
    const hw = Math.min(this.hud.width + 34, this.scale.width - 450) / zoom;
    this.graphics.fillGradientStyle(0x8f6720, 0x5a3217, 0x2a1826, 0x3a2117, 0.68).fillRoundedRect(hx, hy, hw, 70 / zoom, 16 / zoom);
    this.graphics.lineStyle(3 / zoom, 0xffd166, 0.76).strokeRoundedRect(hx, hy, hw, 70 / zoom, 16 / zoom);
    this.graphics.lineStyle(1 / zoom, 0xfff4d6, 0.36).strokeRoundedRect(hx + 7 / zoom, hy + 7 / zoom, hw - 14 / zoom, 56 / zoom, 12 / zoom);
    this.graphics.fillStyle(0xffd166, 0.2).fillRoundedRect(hx + 12 / zoom, hy + 12 / zoom, hw - 24 / zoom, 20 / zoom, 9 / zoom);

    const top = leaderboard.slice(0, 5);
    const icons = ['♛', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
    const leaderboardText = top.map((s, i) => `${icons[i]} ${s.name.padEnd(10).slice(0, 10)} ${s.alive ? '●' : '×'}  KO ${s.kills.toString().padStart(2, ' ')}`).join('\n');
    this.leaderboardText.setPosition(this.scale.width - 332, 190);
    if (leaderboardText !== this.lastLeaderboardText) {
      this.leaderboardText.setText(leaderboardText);
      this.lastLeaderboardText = leaderboardText;
    }

    const feedText = this.feed.slice(-BALANCE.feedRowsShown).map((f) => `› ${f.text}`).join('\n');
    this.feedText.setPosition(16, this.scale.height - 98);
    if (feedText !== this.lastFeedText) {
      this.feedText.setText(feedText);
      this.lastFeedText = feedText;
    }

    const lx = camera.scrollX + (this.scale.width - 356) / zoom;
    const ly = camera.scrollY + 154 / zoom;
    this.graphics.fillStyle(0x221327, 0.82).fillRoundedRect(lx, ly, 338 / zoom, 190 / zoom, 16 / zoom);
    this.graphics.lineStyle(3 / zoom, 0xffd166, 0.78).strokeRoundedRect(lx, ly, 338 / zoom, 190 / zoom, 16 / zoom);
    this.graphics.lineStyle(1 / zoom, 0xfff4d6, 0.28).strokeRoundedRect(lx + 7 / zoom, ly + 7 / zoom, 324 / zoom, 176 / zoom, 12 / zoom);
    this.graphics.fillStyle(0xffd166, 0.16).fillRoundedRect(lx + 10 / zoom, ly + 10 / zoom, 318 / zoom, 30 / zoom, 10 / zoom);
    this.graphics.lineStyle(1 / zoom, 0xfff4d6, 0.38).lineBetween(lx + 16 / zoom, ly + 50 / zoom, lx + 322 / zoom, ly + 50 / zoom);
    this.graphics.fillStyle(0xffd166, 0.92).fillCircle(lx + 28 / zoom, ly + 25 / zoom, 7 / zoom);
    this.graphics.lineStyle(2 / zoom, 0xffd166, 0.9).lineBetween(lx + 42 / zoom, ly + 25 / zoom, lx + 132 / zoom, ly + 25 / zoom);

    top.forEach((s, i) => {
      const y = ly + (62 + i * 25) / zoom;
      const barWidth = Math.max(3, Math.min(74, (Math.max(0, s.hp) / BALANCE.maxHp) * 74));
      this.graphics.fillStyle(0x10203a, 0.9).fillRoundedRect(lx + 248 / zoom, y + 4 / zoom, 74 / zoom, 7 / zoom, 4 / zoom);
      this.graphics.fillStyle(s.alive ? s.color : 0x5d6677, 0.9).fillRoundedRect(lx + 248 / zoom, y + 4 / zoom, barWidth / zoom, 7 / zoom, 4 / zoom);
    });

    const fx = camera.scrollX + 8 / zoom;
    const fy = camera.scrollY + (this.scale.height - 112) / zoom;
    this.graphics.fillStyle(0x120b18, 0.72).fillRoundedRect(fx, fy, 380 / zoom, 96 / zoom, 14 / zoom);
    this.graphics.lineStyle(1.5 / zoom, 0xffd166, 0.42).strokeRoundedRect(fx, fy, 380 / zoom, 96 / zoom, 14 / zoom);
  }

  private drawOverlay(text: string) {
    this.overlay.setPosition(this.scale.width / 2, this.scale.height / 2).setFontSize(28).setText(text);
  }

  private updateHudSize() {
    this.hud.setFontSize(this.scale.width < 1400 ? 13 : 15);
  }
}
