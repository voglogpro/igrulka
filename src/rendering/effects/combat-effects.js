import * as T from '../../../vendor/three/three.module.js';
import { ParticleBatch } from './particles.js';
import { StreakBatch, StreakParticles } from './streaks.js';
import { CasingPool } from './casings.js';
import { WEAPON_FX, weaponClass } from './weapon-profiles.js';
import { projectilePoint, projectileHeading } from './tracer-path.js';

// Beyond this camera distance shots keep only their flash; nearby combat gets the full detail.
const DETAIL_DISTANCE = 720;
const WRECK_LIFE = 14;
const SPARK_COLOR = [5, 2.4, 0.6];
// Tracer compositions differ by army, as in real conflicts: red-orange for us, green for them.
const TRACER = [
  [6.2, 1.5, 0.32],
  [1, 5.4, 1.2],
];
const tracerColor = (p) => TRACER[p.side === 1 ? 1 : 0];
const HOT_CORE = [4.6, 4, 3.1];
const SHELL_HEAD = [7, 3, 0.7];
const INTERCEPTOR_HEAD = [5, 3.4, 1.4];
const PLAIN_ROUND = [0.95, 0.9, 0.8];
const TAIL_STEPS = 6;
const scaled = (color, k, out) => {
  out[0] = color[0] * k;
  out[1] = color[1] * k;
  out[2] = color[2] * k;
  return out;
};

export class CombatEffects {
  constructor(world) {
    this.world = world;
    this.smoke = new ParticleBatch(world.scene, 1280, 0);
    this.glow = new ParticleBatch(world.scene, 1280, 1);
    this.rings = new ParticleBatch(world.scene, 64, 2);
    this.streaks = new StreakBatch(world.scene, 4096);
    this.sparks = new StreakParticles(900);
    this.casings = new CasingPool(world.scene, 320);
    this.clock = 0;
    this.emitters = new Map();
    this.rounds = new Map();
    this.airRounds = new Map();
    this.trails = new Map();
    this.groundTracers = new Map();
    this.wrecks = [];
    this.eye = new T.Vector3();
    this.lights = Array.from({ length: 3 }, () => {
      const light = new T.PointLight('#ffc18a', 0, 120, 2);
      light.userData.life = 0;
      light.userData.total = 0.24;
      world.scene.add(light);
      return light;
    });
    this.debris = Array.from({ length: 96 }, () => ({ life: 0 }));
    this.debrisCursor = 0;
    this.shards = new T.InstancedMesh(
      new T.BoxGeometry(1, 0.18, 2.7),
      new T.MeshStandardMaterial({ color: '#6e7771', metalness: 0.4, roughness: 0.6 }),
      96,
    );
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.dummy = new T.Object3D();
    this.zero = new T.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 96; i++) this.shards.setMatrixAt(i, this.zero);
    world.scene.add(this.shards);
    this.traceCapacity = 1536;
    this.tracePositions = new Float32Array(this.traceCapacity * 3 * 2);
    this.traceColors = new Float32Array(this.traceCapacity * 3 * 2);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.tracePositions, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'color',
      new T.BufferAttribute(this.traceColors, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setDrawRange(0, 0);
    this.tracers = new T.LineSegments(
      geometry,
      new T.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: T.AdditiveBlending,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    this.tracers.frustumCulled = false;
    world.scene.add(this.tracers);
    this.tracerHeads = 0;
    this.lead = 0;
    this.point = { x: 0, y: 0, z: 0 };
    this.point2 = { x: 0, y: 0, z: 0 };
    this.point3 = { x: 0, y: 0, z: 0 };
    this.halo = [0, 0, 0];
    this.body = [0, 0, 0];
    this.core = [0, 0, 0];
  }
  cameraDistance(x, y, z) {
    const camera = this.world.camera;
    if (!camera) return 0;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    return Math.hypot(this.eye.x - x, this.eye.y - y, this.eye.z - z);
  }
  floor(x, z) {
    const h = this.world.height?.(x, z);
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  }
  puff(x, y, z, size = 2, life = 2, options = {}) {
    this.smoke.spawn(x, y, z, {
      size,
      life,
      growth: size * 0.55,
      vx: 2,
      vy: 4,
      vz: 1,
      opacity: 0.32,
      ...options,
    });
  }
  // Sparks are velocity-aligned streaks, so they read as hot fragments rather than dots.
  spark(x, y, z, size = 0.6, life = 0.5, options = {}) {
    this.sparks.spawn({
      x,
      y,
      z,
      life,
      length: size * 1.4,
      width: Math.max(0.08, size * 0.32),
      stretch: 0.035,
      gravity: options.gravity ?? 18,
      drag: options.drag ?? 0.6,
      vx: options.vx ?? 0,
      vy: options.vy ?? 0,
      vz: options.vz ?? 0,
      color: options.color || SPARK_COLOR,
      opacity: options.opacity ?? 1,
    });
  }
  flash(x, y, z, size = 3, life = 0.09) {
    this.glow.spawn(x, y, z, { size, life, opacity: 1, growth: 10, color: [6, 3, 0.8] });
  }
  light(x, y, z, power, distance, life, steal = true) {
    let light = null;
    for (const candidate of this.lights)
      if (!light || candidate.userData.life < light.userData.life) light = candidate;
    // Muzzle flashes only use a free light and never cut an explosion short.
    if (!steal && light.userData.life > 0) return;
    light.position.set(x, y, z);
    light.userData.life = life;
    light.userData.total = life;
    light.userData.power = power;
    light.distance = distance;
  }
  fragment(x, y, z, scale = 1, vx = 0, vy = 0, vz = 0) {
    const p = this.debris[this.debrisCursor];
    this.debrisCursor = (this.debrisCursor + 1) % this.debris.length;
    Object.assign(p, {
      x,
      y,
      z,
      life: 3.5,
      total: 3.5,
      scale,
      vx: vx + (Math.random() - 0.5) * 24,
      vy: vy + 12 + Math.random() * 18,
      vz: vz + (Math.random() - 0.5) * 24,
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      rz: Math.random() * 6,
      spin: (Math.random() - 0.5) * 8,
    });
  }
  explode(x, y, z, size = 1, air = false) {
    this.flash(x, y + 2, z, size * 9, 0.17);
    for (let i = 0; i < 14 * size; i++) {
      const a = Math.random() * 6.28,
        r = Math.random() * size * 5;
      this.glow.spawn(x + Math.cos(a) * r, y + Math.random() * size * 3, z + Math.sin(a) * r, {
        size: size * (2 + Math.random() * 3),
        life: 0.3 + Math.random() * 0.45,
        growth: 8 * size,
        vy: 8 + Math.random() * 14,
        opacity: 0.34,
        color: i % 2 ? [3.5, 0.55, 0.035] : [1.9, 0.15, 0.008],
      });
    }
    for (let i = 0; i < 12 * size; i++)
      this.puff(
        x + (Math.random() - 0.5) * size * 7,
        y + size * 3,
        z + (Math.random() - 0.5) * size * 7,
        size * (2 + Math.random() * 2),
        2.5 + Math.random() * 2,
        {
          vy: 5 + Math.random() * 9,
          vx: (Math.random() - 0.5) * 12,
          vz: (Math.random() - 0.5) * 12,
          color: air ? [0.13, 0.15, 0.18] : [0.09, 0.1, 0.115],
          opacity: 0.35,
        },
      );
    for (let i = 0; i < 22 * size; i++)
      this.spark(x, y + 2, z, 0.3 + Math.random() * 0.6, 0.5 + Math.random() * 0.9, {
        vx: (Math.random() - 0.5) * size * 70,
        vy: 10 + Math.random() * size * 48,
        vz: (Math.random() - 0.5) * size * 70,
      });
    if (!air) {
      this.rings.spawn(x, 1.3, z, {
        size: 2,
        life: 0.6,
        growth: 60 * size,
        opacity: 0.2,
        color: [0.62, 0.5, 0.32],
      });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.puff(x, 1, z, 1.1 * size, 0.75, {
          vx: Math.cos(a) * size * 32,
          vy: 1,
          vz: Math.sin(a) * size * 32,
          drag: 1.8,
          opacity: 0.16,
          color: [0.25, 0.22, 0.17],
        });
      }
      // Clods of earth thrown up by the blast.
      for (let i = 0; i < 8 * size; i++)
        this.spark(x, y + 1, z, 0.5 + Math.random() * 0.5, 0.9 + Math.random() * 0.6, {
          vx: (Math.random() - 0.5) * size * 40,
          vy: 14 + Math.random() * size * 30,
          vz: (Math.random() - 0.5) * size * 40,
          gravity: 34,
          color: [0.35, 0.28, 0.2],
          opacity: 0.8,
        });
    }
    for (let i = 0; i < 5 * size; i++) this.fragment(x, y + 2, z, 0.7 + Math.random() * size);
    this.light(x, y + 6, z, 70 * size, 100 * size, 0.24);
  }
  // Proximity-fused 35 mm round or a missed interceptor: black puff with a hot core.
  airburst(x, y, z, size = 1) {
    this.glow.spawn(x, y, z, {
      size: 2.4 * size,
      life: 0.12,
      opacity: 1,
      growth: 14 * size,
      color: [6, 3.2, 1],
    });
    for (let i = 0; i < 3; i++)
      this.puff(
        x + (Math.random() - 0.5) * 2 * size,
        y + (Math.random() - 0.5) * 2 * size,
        z + (Math.random() - 0.5) * 2 * size,
        1.5 * size,
        2.6 + Math.random(),
        {
          vx: (Math.random() - 0.5) * 3,
          vy: 0.6,
          vz: (Math.random() - 0.5) * 3,
          growth: 1.8 * size,
          opacity: 0.42,
          color: [0.06, 0.065, 0.07],
        },
      );
    for (let i = 0; i < 7 * size; i++)
      this.spark(x, y, z, 0.35, 0.35 + Math.random() * 0.3, {
        vx: (Math.random() - 0.5) * 70,
        vy: (Math.random() - 0.5) * 70,
        vz: (Math.random() - 0.5) * 70,
        gravity: 6,
      });
  }
  muzzle(e, shooter) {
    const fx = WEAPON_FX[weaponClass(e, shooter?.key ?? e.shooter)] || WEAPON_FX.rifle,
      dx0 = e.tx - (e.mx ?? e.x),
      dy0 = e.ty - (e.my ?? e.y),
      dz0 = e.tz - (e.mz ?? e.z),
      d = Math.hypot(dx0, dy0, dz0) || 1,
      dx = dx0 / d,
      dy = dy0 / d,
      dz = dz0 / d,
      // Ground fire is reported from the unit centre; move the flash out to the muzzle.
      reach = e.ground && !e.barrelTip ? fx.reach || 1.3 : 0,
      x = (e.mx ?? e.x + dx * 8) + dx * reach,
      y = (e.my ?? e.y + dy * 8) + dy * reach,
      z = (e.mz ?? e.z + dz * 8) + dz * reach,
      id = e.buildingId ?? -1,
      round = (this.rounds.get(id) || 0) + 1,
      far = this.cameraDistance(x, y, z) > DETAIL_DISTANCE;
    this.rounds.set(id, round);
    // Hot core plus a short-lived wider bloom.
    this.glow.spawn(x, y, z, {
      size: fx.flash,
      life: 0.06,
      opacity: 1,
      growth: fx.flash * 3.5,
      color: [7, 3.6, 1.1],
    });
    if (far) return;
    this.glow.spawn(x + dx * fx.flash, y + dy * fx.flash, z + dz * fx.flash, {
      size: fx.flash * 1.2,
      life: 0.045,
      opacity: 0.4,
      growth: fx.flash * 2.5,
      color: [4.5, 1.6, 0.25],
    });
    // Forward jet of burning propellant.
    this.sparks.spawn({
      x: x + dx * fx.jet,
      y: y + dy * fx.jet,
      z: z + dz * fx.jet,
      dx,
      dy,
      dz,
      length: fx.jet,
      width: fx.flash * 0.55,
      life: 0.055,
      grow: 0.5,
      color: [6, 3.2, 1],
    });
    // Side petals of the flash hider / muzzle brake, rotated a little every round.
    if (fx.petals) {
      const ux = Math.abs(dy) < 0.95 ? 0 : 1,
        uy = Math.abs(dy) < 0.95 ? 1 : 0,
        ax = dy * 0 - dz * uy,
        ay = dz * ux - dx * 0,
        az = dx * uy - dy * ux,
        al = Math.hypot(ax, ay, az) || 1,
        bx = dy * (az / al) - dz * (ay / al),
        by = dz * (ax / al) - dx * (az / al),
        bz = dx * (ay / al) - dy * (ax / al);
      for (let i = 0; i < fx.petals; i++) {
        const angle = (i / fx.petals) * Math.PI * 2 + round * 0.9,
          c = Math.cos(angle),
          s = Math.sin(angle),
          px = (ax / al) * c + bx * s,
          py = (ay / al) * c + by * s,
          pz = (az / al) * c + bz * s,
          reach = fx.flash * (fx.brake ? 1.3 : 0.8);
        this.sparks.spawn({
          x: x + px * reach + dx * 0.3,
          y: y + py * reach + dy * 0.3,
          z: z + pz * reach + dz * 0.3,
          dx: px,
          dy: py,
          dz: pz,
          length: reach,
          width: fx.flash * 0.3,
          life: 0.045,
          color: [5, 2.2, 0.55],
        });
      }
    }
    if (fx.casing)
      this.casings.eject(
        e.x + dx * 1.2,
        (e.y ?? y) + 0.4,
        e.z + dz * 1.2,
        dx,
        dz,
        fx.casing,
        this.floor(e.x, e.z),
      );
    if (round % fx.every === 0)
      this.puff(x + dx * fx.flash, y + dy * fx.flash, z + dz * fx.flash, fx.smoke, 0.9 + fx.smoke, {
        vx: dx * 6 + (Math.random() - 0.5),
        vy: dy * 6 + 1.2,
        vz: dz * 6 + (Math.random() - 0.5),
        drag: 2.2,
        growth: fx.smoke * 1.4,
        opacity: 0.1 + fx.smoke * 0.04,
        color: [0.36, 0.36, 0.35],
      });
    if (fx.brake)
      for (const side of [-1, 1])
        this.puff(x - dz * side * 0.8, y, z + dx * side * 0.8, fx.smoke * 0.7, 0.8, {
          vx: -dz * side * 11,
          vy: 1.5,
          vz: dx * side * 11,
          drag: 3,
          opacity: 0.2,
          color: [0.46, 0.45, 0.42],
        });
    if (fx.blast) {
      // Ground-level overpressure ring around a tank gun and dust kicked under the muzzle.
      const floor = this.floor(x, z) + 0.6;
      this.rings.spawn(x, floor, z, {
        size: 1.5,
        life: 0.4,
        growth: 34,
        opacity: 0.18,
        color: [0.6, 0.52, 0.38],
      });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.puff(x + dx * 3, y, z + dz * 3, 1.4, 1.6, {
          vx: Math.cos(a) * 9 + dx * 12,
          vy: Math.sin(a) * 4 + 2,
          vz: Math.sin(a) * 9 + dz * 12,
          drag: 2.4,
          opacity: 0.24,
          color: [0.48, 0.46, 0.42],
        });
      }
    }
    if (fx.backblast) {
      for (let i = 0; i < 8; i++)
        this.puff(e.x - dx * 2, (e.y ?? y) + 0.5, e.z - dz * 2, fx.smoke, 2.2 + Math.random(), {
          vx: -dx * (10 + Math.random() * 12) + (Math.random() - 0.5) * 6,
          vy: Math.max(0.5, -dy * 8) + Math.random() * 3,
          vz: -dz * (10 + Math.random() * 12) + (Math.random() - 0.5) * 6,
          drag: 1.4,
          growth: fx.smoke * 1.2,
          opacity: 0.3,
          color: [0.6, 0.6, 0.58],
        });
      this.rings.spawn(e.x, this.floor(e.x, e.z) + 0.6, e.z, {
        size: 2,
        life: 0.55,
        growth: 26,
        opacity: 0.16,
        color: [0.62, 0.55, 0.42],
      });
    }
    if (fx.light && round % (fx.lightEvery || 1) === 0)
      this.light(x, y + 1, z, fx.light, 18 + fx.light * 2, 0.07, false);
  }
  wreck(x, z, size = 1, life = WRECK_LIFE) {
    if (this.wrecks.length < 40)
      this.wrecks.push({ x, z, size, life, until: this.clock + life, next: 0 });
  }
  // A destroyed building: blast, rolling dust wave, flying debris and fires that burn for a while.
  collapse(x, z, key) {
    const big = ['industry', 'power', 'factory', 'hq', 'lab'].includes(key),
      spread = big ? 14 : 10;
    this.explode(x, 3, z, big ? 1.5 : 1.15);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2,
        speed = 9 + Math.random() * 12;
      this.puff(
        x + Math.cos(a) * spread * 0.5,
        2,
        z + Math.sin(a) * spread * 0.5,
        3.5,
        5 + Math.random() * 2,
        {
          vx: Math.cos(a) * speed,
          vy: 1.5 + Math.random() * 3,
          vz: Math.sin(a) * speed,
          drag: 0.9,
          growth: 3,
          opacity: 0.4,
          color: [0.42, 0.39, 0.33],
        },
      );
    }
    for (let i = 0; i < 14; i++)
      this.puff(
        x + (Math.random() - 0.5) * spread,
        6 + Math.random() * 10,
        z + (Math.random() - 0.5) * spread,
        4,
        6,
        {
          vy: 5 + Math.random() * 5,
          growth: 3.5,
          opacity: 0.32,
          color: [0.33, 0.31, 0.27],
        },
      );
    for (let i = 0; i < (big ? 16 : 10); i++)
      this.fragment(
        x + (Math.random() - 0.5) * spread,
        6,
        z + (Math.random() - 0.5) * spread,
        0.8 + Math.random() * 1.8,
      );
    const fires = big ? 4 : 2;
    for (let i = 0; i < fires; i++)
      this.wreck(
        x + (Math.random() - 0.5) * spread * 1.2,
        z + (Math.random() - 0.5) * spread * 1.2,
        big ? 1.9 : 1.5,
        28 + Math.random() * 20,
      );
  }
  // A round striking the ground, a wall, armour or a soldier. Heavier guns throw bigger plumes.
  bulletImpact(e) {
    const fx = WEAPON_FX[weaponClass({ ground: true }, e.shooter)] || WEAPON_FX.rifle,
      size = Math.min(3, Math.max(1, fx.flash / 0.8)),
      floor = this.floor(e.x, e.z),
      fx0 = e.x - (e.fromX ?? e.x - 1),
      fz0 = e.z - (e.fromZ ?? e.z),
      fl = Math.hypot(fx0, fz0) || 1,
      // Direction the round was travelling; debris flies back toward the shooter.
      bx = -fx0 / fl,
      bz = -fz0 / fl,
      jitter = () => Math.random() - 0.5;
    if (e.surface === 'armor') {
      // Hot spall and a white flash: the round glances off or breaks up on the plate.
      this.glow.spawn(e.x, floor + 2.2, e.z, {
        size: 0.9 * size,
        life: 0.05,
        opacity: 1,
        growth: 6 * size,
        color: [7, 5.5, 3],
      });
      for (let i = 0; i < 5 + 3 * size; i++)
        this.spark(e.x, floor + 2.2, e.z, 0.26, 0.2 + Math.random() * 0.35, {
          vx: bx * 18 + jitter() * 46,
          vy: 3 + Math.random() * 20,
          vz: bz * 18 + jitter() * 46,
          gravity: 24,
          color: [7, 4, 1.4],
        });
      this.puff(e.x, floor + 2.2, e.z, 0.5 * size, 0.6, {
        vy: 1.2,
        opacity: 0.2,
        color: [0.3, 0.3, 0.32],
      });
      return;
    }
    if (e.surface === 'body') {
      this.puff(e.x, floor + 1.4, e.z, 0.45, 0.5, {
        vx: bx * 2,
        vy: 1.5,
        vz: bz * 2,
        growth: 0.8,
        opacity: 0.2,
        color: [0.3, 0.26, 0.22],
      });
      return;
    }
    const wall = e.surface === 'wall',
      dust = wall ? [0.56, 0.54, 0.5] : [0.42, 0.36, 0.27],
      y = floor + (wall ? 2.5 + Math.random() * 4 : 0.5);
    // A thin vertical spurt, then a lazy cloud that drifts and settles.
    this.puff(e.x, y + 0.6 * size, e.z, 0.32 * size, 0.45, {
      vx: bx * 3,
      vy: 9 * size,
      vz: bz * 3,
      drag: 3.2,
      growth: 0.6,
      opacity: 0.34,
      color: dust,
    });
    this.puff(e.x, y, e.z, 0.6 * size, 0.9 + 0.3 * size, {
      vx: bx * 2 + jitter() * 2,
      vy: 1.6,
      vz: bz * 2 + jitter() * 2,
      growth: 1.3 * size,
      opacity: 0.22,
      color: dust,
    });
    for (let i = 0; i < 2 + size * 1.5; i++)
      this.spark(e.x, y, e.z, wall ? 0.18 : 0.22, 0.3 + Math.random() * 0.25, {
        vx: bx * 8 + jitter() * 14,
        vy: 6 + Math.random() * 9 * size,
        vz: bz * 8 + jitter() * 14,
        gravity: 30,
        color: wall ? [0.75, 0.72, 0.66] : [0.5, 0.42, 0.3],
        opacity: 0.85,
      });
    // Stones and concrete sometimes strike a spark.
    if (Math.random() < (wall ? 0.35 : 0.12))
      this.spark(e.x, y, e.z, 0.2, 0.18, {
        vx: bx * 20 + jitter() * 20,
        vy: 5 + Math.random() * 8,
        vz: bz * 20 + jitter() * 20,
        color: SPARK_COLOR,
      });
  }
  handle(e, shooter = null) {
    if (e.type === 'intercept') {
      if (e.mode === 'fall') {
        this.flash(e.x, e.y, e.z, 5, 0.1);
        for (let i = 0; i < 14; i++)
          this.spark(e.x, e.y, e.z, 0.5, 0.5, {
            vx: (Math.random() - 0.5) * 35,
            vy: Math.random() * 14,
            vz: (Math.random() - 0.5) * 35,
          });
        this.fragment(e.x, e.y, e.z, 3, e.vx, e.vy, e.vz);
      } else this.explode(e.x, e.y, e.z, e.key === 'ballistic' ? 1.6 : 1, true);
    }
    if (e.type === 'impact' || e.type === 'crash')
      this.explode(
        e.x,
        e.y || 2,
        e.z,
        e.key === 'fpv'
          ? 0.55
          : e.key === 'artillery'
            ? 1.5
            : e.key === 'rocket'
              ? 1.05
              : e.key === 'tank'
                ? 0.8
                : e.key === 'ballistic'
                  ? 2.6
                  : e.key === 'heavy'
                    ? 1.7
                    : 1.2,
      );
    if (e.type === 'destroy') this.collapse(e.x, e.z, e.key);
    if (e.type === 'cleared')
      for (let i = 0; i < 7; i++)
        this.puff(e.x, 1, e.z, 2, 1.1, { color: [0.42, 0.39, 0.32], opacity: 0.25 });
    if (e.type === 'hit') {
      const air = (e.y ?? 2) > 6;
      if (air) {
        // Rounds striking an airframe: bright sparks and a wisp of smoke.
        for (let i = 0; i < 5; i++)
          this.spark(e.x, e.y, e.z, 0.32, 0.25 + Math.random() * 0.2, {
            vx: (Math.random() - 0.5) * 34,
            vy: Math.random() * 10,
            vz: (Math.random() - 0.5) * 34,
          });
        this.puff(e.x, e.y, e.z, 0.7, 0.9, { vy: 0.5, opacity: 0.22, color: [0.2, 0.2, 0.22] });
      } else if (this.cameraDistance(e.x, 2, e.z) < DETAIL_DISTANCE) this.bulletImpact(e);
    }
    if (e.type === 'shot') this.muzzle(e, shooter);
    if (e.type === 'launch') {
      this.puff(e.x, 2, e.z, 1.4, 0.9, { vy: 2, opacity: 0.2 });
      this.flash(e.x, 5, e.z, 1.4, 0.12);
    }
  }
  emit(state, dt, visible = () => true) {
    if (dt <= 0) return;
    this.clock += dt;
    for (const b of state.buildings) {
      if (b.hp <= 0 || b.progress < 1 || !['industry', 'power', 'factory'].includes(b.key))
        continue;
      const interval = b.key === 'factory' && !b.queue?.length ? 0.85 : 0.26;
      if (this.clock - (this.emitters.get(b.id) || 0) < interval) continue;
      this.emitters.set(b.id, this.clock);
      const c = Math.cos(b.rotation || 0),
        s = Math.sin(b.rotation || 0),
        x = b.key === 'industry' ? -9 : b.key === 'power' ? 8 : 9,
        z = b.key === 'industry' ? -7 : b.key === 'power' ? -5 : 0;
      this.puff(
        b.x + x * c + z * s,
        b.key === 'industry' ? 34 : b.key === 'power' ? 26 : 19,
        b.z + z * c - x * s,
        b.key === 'factory' ? 1.1 : 2,
        3.8,
        {
          vy: b.key === 'factory' ? 2.5 : 4,
          opacity: b.key === 'power' ? 0.18 : 0.27,
          color: b.key === 'power' ? [0.57, 0.61, 0.59] : [0.3, 0.34, 0.35],
        },
      );
    }
    for (const u of state.units) {
      if (u.delay > 0 || !visible(u)) continue;
      const burning = u.status === 'falling' || u.hp / u.maxHp < 0.45,
        missile = ['cruise', 'ballistic'].includes(u.key),
        interval = burning ? 0.055 : missile ? 0.055 : 0.18;
      if (this.clock - (this.emitters.get(u.id) || 0) < interval) continue;
      this.emitters.set(u.id, this.clock);
      if (burning) {
        this.puff(u.x, u.y, u.z, 1.6, 2.2, { vy: 1, opacity: 0.38, color: [0.17, 0.18, 0.2] });
        this.glow.spawn(u.x, u.y, u.z, {
          size: 1.8,
          life: 0.23,
          opacity: 0.8,
          color: [3.5, 0.8, 0.07],
        });
      } else if (missile) {
        this.puff(u.x, u.y, u.z, 0.65, 1.1, { vy: 0, opacity: 0.18, color: [0.6, 0.63, 0.64] });
        this.flash(u.x, u.y, u.z, 1.1, 0.08);
      } else
        this.puff(u.x, u.y - 0.4, u.z, 0.2, 0.6, {
          vy: 0,
          opacity: 0.055,
          color: [0.45, 0.49, 0.5],
        });
    }
    // Interceptors leave a continuous white motor trail with a flickering exhaust.
    for (const p of state.projectiles) {
      // Interceptors and MLRS rockets burn a motor all the way and leave the same trail.
      if (p.kind !== 'interceptor' && p.shooterKey !== 'mlrs') continue;
      const speed = Math.hypot(p.vx, p.vy, p.vz) || 1,
        nx = p.x - (p.vx / speed) * 2,
        ny = p.y - (p.vy / speed) * 2,
        nz = p.z - (p.vz / speed) * 2,
        last = this.trails.get(p.id) || { x: nx, y: ny, z: nz },
        gap = Math.hypot(nx - last.x, ny - last.y, nz - last.z),
        steps = Math.min(14, Math.floor(gap / 1.4));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.puff(
          last.x + (nx - last.x) * t,
          last.y + (ny - last.y) * t,
          last.z + (nz - last.z) * t,
          1.5,
          2.6 + Math.random() * 0.8,
          {
            vx: (Math.random() - 0.5) * 1.5,
            vy: 0.7,
            vz: (Math.random() - 0.5) * 1.5,
            growth: 2.2,
            opacity: 0.16,
            color: [0.72, 0.73, 0.74],
          },
        );
      }
      if (steps || !this.trails.has(p.id)) this.trails.set(p.id, { x: nx, y: ny, z: nz });
      this.glow.spawn(
        nx + (p.vx / speed) * 0.8,
        ny + (p.vy / speed) * 0.8,
        nz + (p.vz / speed) * 0.8,
        {
          size: 1.3 + Math.random() * 0.5,
          life: 0.05,
          opacity: 0.9,
          color: [5, 3, 1.2],
        },
      );
    }
    if (this.trails.size > 64) {
      const live = new Set(state.projectiles.map((p) => p.id));
      for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);
    }
    // Burning wrecks: a smoke column with flickering flames that dies down.
    this.wrecks = this.wrecks.filter((w) => w.until > this.clock);
    for (const w of this.wrecks) {
      if (w.next > this.clock) continue;
      const left = (w.until - this.clock) / (w.life || WRECK_LIFE),
        size = w.size || 1;
      w.next = this.clock + (0.12 + (1 - left) * 0.25) / Math.sqrt(size);
      this.puff(
        w.x + (Math.random() - 0.5) * 3 * size,
        3,
        w.z + (Math.random() - 0.5) * 3 * size,
        1.6 * size,
        4 + size * 2,
        {
          vx: 1.5,
          vy: (6 + left * 4) * Math.sqrt(size),
          vz: 0.8,
          growth: 2.4 * size,
          opacity: 0.2 + left * 0.18,
          color: [0.08, 0.085, 0.09],
        },
      );
      if (Math.random() < left + 0.2)
        this.glow.spawn(
          w.x + (Math.random() - 0.5) * 3,
          2 + Math.random() * 2,
          w.z + (Math.random() - 0.5) * 3,
          {
            size: (1.4 + left * 1.6) * size,
            life: 0.25,
            vy: 3,
            opacity: 0.6,
            color: [3.6, 0.9, 0.08],
          },
        );
    }
    if (this.emitters.size > 400) {
      const ids = new Set(
        [...state.buildings, ...state.units, ...state.projectiles].map((o) => o.id),
      );
      for (const id of this.emitters.keys()) if (!ids.has(id)) this.emitters.delete(id);
    }
    if (this.rounds.size > 400) {
      const ids = new Set([...state.buildings, ...(state.groundUnits || [])].map((o) => o.id));
      for (const id of this.rounds.keys()) if (!ids.has(id)) this.rounds.delete(id);
    }
  }
  updateTracers(projectiles) {
    let segment = 0;
    const seen = new Set();
    for (const p of projectiles) {
      if (p.domain !== 'ground' && p.kind !== 'bullet') {
        seen.add(p.id);
        this.airRounds.set(p.id, { x: p.x, y: p.y, z: p.z, kind: p.kind });
      }
      if (p.kind === 'bullet' && !p.tracer) continue;
      if (p.domain === 'ground' && p.kind === 'bullet') {
        seen.add(p.id);
        this.groundTracers.set(p.id, p);
      }
      // The tail follows the real path back from the drawn head and fades toward the muzzle.
      const ahead = this.lead || 0,
        tail = p.kind === 'bullet' ? (p.domain === 'ground' ? 0.12 : 0.16) : 0.08,
        color =
          p.kind === 'interceptor'
            ? [1.6, 2.6, 4]
            : p.kind === 'shell'
              ? [4, 1.7, 0.4]
              : tracerColor(p).map((v) => v * 0.75);
      for (let i = 0; i < TAIL_STEPS && segment < this.traceCapacity; i++, segment++)
        for (let end = 0; end < 2; end++) {
          const k = (i + end) / TAIL_STEPS,
            offset = segment * 6 + end * 3,
            q = projectilePoint(p, ahead - tail * k, this.point);
          this.tracePositions[offset] = q.x;
          this.tracePositions[offset + 1] = q.y;
          this.tracePositions[offset + 2] = q.z;
          const intensity = (1 - k) ** 1.6;
          this.traceColors[offset] = color[0] * intensity;
          this.traceColors[offset + 1] = color[1] * intensity;
          this.traceColors[offset + 2] = color[2] * intensity;
        }
    }
    this.tracerProjectiles = projectiles;
    this.tracers.geometry.setDrawRange(0, segment * 2);
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
    // Air rounds that vanished since the last frame burst where they were last seen.
    let vanished = 0;
    for (const [id, round] of this.airRounds) {
      if (seen.has(id)) continue;
      this.airRounds.delete(id);
      // A loaded save or a network snapshot can drop many at once; those are not detonations.
      if (++vanished > 24 || round.y < 4) continue;
      if (round.kind === 'shell') this.airburst(round.x, round.y, round.z, 1);
      else if (round.kind === 'interceptor') this.airburst(round.x, round.y, round.z, 1.6);
    }
    // Some tracers skip off the ground and tumble away, glowing, as they do in real firefights.
    vanished = 0;
    for (const [id, p] of this.groundTracers) {
      if (seen.has(id)) continue;
      this.groundTracers.delete(id);
      if (++vanished > 24 || Math.random() > 0.32) continue;
      const speed = Math.hypot(p.vx, p.vz) || 1,
        turn = (Math.random() - 0.5) * 1.6,
        dx = p.vx / speed,
        dz = p.vz / speed,
        rx = dx * Math.cos(turn) - dz * Math.sin(turn),
        rz = dx * Math.sin(turn) + dz * Math.cos(turn),
        hop = 60 + Math.random() * 90;
      this.sparks.spawn({
        x: p.tx ?? p.x,
        y: this.floor(p.tx ?? p.x, p.tz ?? p.z) + 0.6,
        z: p.tz ?? p.z,
        vx: rx * hop,
        vy: 25 + Math.random() * 60,
        vz: rz * hop,
        gravity: 30,
        drag: 0.4,
        life: 0.45 + Math.random() * 0.45,
        length: 2.5,
        width: 0.3,
        stretch: 0.03,
        color: tracerColor(p),
      });
    }
  }
  // Glowing heads for every tracer and interceptor, aligned with the flight direction. A tracer is
  // three layers: a white-hot core, the burning colour and a wide dim halo. Far from the camera the
  // layers widen, so fire stays readable when zoomed out. Plain rounds near the camera leave only a
  // faint heat streak.
  drawTracerStreaks() {
    let heads = 0;
    const ahead = this.lead || 0,
      camera = this.world.camera;
    if (camera) this.eye.setFromMatrixPosition(camera.matrixWorld);
    for (const p of this.tracerProjectiles || []) {
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      if (!speed) continue;
      const q = projectilePoint(p, ahead, this.point),
        x = q.x,
        y = q.y,
        z = q.z,
        { dx, dy, dz } = projectileHeading(p, ahead, this.point2, this.point3),
        flown = p.life + ahead,
        distance = camera ? Math.hypot(this.eye.x - x, this.eye.y - y, this.eye.z - z) : 0;
      if (flown <= 0) continue;
      if (p.kind === 'bullet' && !p.tracer) {
        if (distance < 320)
          this.streaks.add(
            x,
            y,
            z,
            dx,
            dy,
            dz,
            Math.min(6, speed * 0.022, speed * flown),
            0.1,
            PLAIN_ROUND,
            0.22 * (1 - distance / 320),
          );
        continue;
      }
      const interceptor = p.kind === 'interceptor',
        shell = p.kind === 'shell',
        zoom = Math.min(2.6, Math.max(1, distance / 380)),
        // The compound ignites a few metres out of the muzzle, then burns with a slight flicker.
        ignite = Math.min(1, flown / 0.035),
        flicker = 0.84 + 0.16 * Math.sin(this.clock * 53 + ((p.id * 2.399) % 6.283) * 7),
        glow = ignite * (interceptor ? 1 : flicker),
        length = Math.min(interceptor ? 9 : shell ? 11 : 8, speed * 0.032, speed * flown) * zoom,
        width = (interceptor ? 1.1 : shell ? 0.5 : 0.24) * zoom,
        color = interceptor ? INTERCEPTOR_HEAD : shell ? SHELL_HEAD : tracerColor(p);
      if (!interceptor)
        this.streaks.add(
          x,
          y,
          z,
          dx,
          dy,
          dz,
          length * 0.85,
          width * 3.4,
          scaled(color, 0.15 * glow, this.halo),
          0.5,
        );
      this.streaks.add(x, y, z, dx, dy, dz, length, width, scaled(color, glow, this.body), 0.9);
      if (!interceptor)
        this.streaks.add(
          x,
          y,
          z,
          dx,
          dy,
          dz,
          length * 0.45,
          width * 0.38,
          scaled(HOT_CORE, glow, this.core),
          1,
        );
      heads++;
    }
    this.tracerHeads = heads;
  }
  update(dt, elapsed, camera) {
    this.smoke.update(dt, camera);
    this.glow.update(dt, camera);
    this.rings.update(dt, camera);
    this.casings.update(dt);
    this.streaks.begin(camera);
    this.drawTracerStreaks();
    this.sparks.update(dt, this.streaks);
    this.streaks.end();
    for (const light of this.lights) {
      light.userData.life = Math.max(0, light.userData.life - dt);
      light.intensity =
        light.userData.power * Math.pow(light.userData.life / light.userData.total, 2) || 0;
    }
    for (let i = 0; i < this.debris.length; i++) {
      const p = this.debris[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.shards.setMatrixAt(i, this.zero);
        this.shards.instanceMatrix.needsUpdate = true;
        continue;
      }
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.3) {
        p.y = 0.3;
        p.vy = Math.abs(p.vy) * 0.18;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      p.rx += p.spin * dt;
      p.rz += p.spin * 0.7 * dt;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rx, p.ry, p.rz);
      this.dummy.scale.setScalar(p.scale * Math.min(1, p.life));
      this.dummy.updateMatrix();
      this.shards.setMatrixAt(i, this.dummy.matrix);
      this.shards.instanceMatrix.needsUpdate = true;
    }
  }
  diagnostics() {
    return {
      particles: this.smoke.active + this.glow.active + this.rings.active + this.sparks.active,
      capacity:
        this.smoke.capacity + this.glow.capacity + this.rings.capacity + this.sparks.slots.length,
      lights: this.lights.length,
      drawBatches: 7,
      tracerSegments: this.tracers.geometry.drawRange.count / 2,
      streaks: this.streaks.count,
      tracerHeads: this.tracerHeads,
      casings: this.casings.active,
      wrecks: this.wrecks.length,
    };
  }
}
