import { makeGlow as makeGlowForWorld, makeFacade as makeFacadeForWorld } from './textures.js';
import {
  height as heightForWorld,
  terrain as terrainForWorld,
  environment as environmentForWorld,
  makeCover as makeCoverForWorld,
  bridges as bridgesForWorld,
  clearTrees as clearTreesForWorld,
} from './terrain/environment.js';
import { syncTrenches as syncTrenchesForWorld } from './terrain/trenches.js';
import { DistrictView } from './terrain/districts.js';
import { updateDaylight as updateDaylightForWorld } from './lighting.js';
import { model as modelForWorld } from './models/buildings.js';
import {
  setBuild as setBuildForWorld,
  cancelRoad as cancelRoadForWorld,
  pointerUp as pointerUpForWorld,
  groundCommandAt,
  groundPoint as groundPointForWorld,
  updateGhost as updateGhostForWorld,
} from './input/build-tools.js';
import { road as roadForWorld } from './terrain/roads.js';
import { sync as syncForWorld } from './sync.js';
import { updateMinimap as updateMinimapForWorld } from './minimap.js';
import * as T from '../../vendor/three/three.module.js';
import { InfantryBatch } from './models/infantry/soldiers.js';
import { CombatEffects } from './effects/combat-effects.js';
import { FogVeil } from './fog-veil.js';
import { FrontlineView } from './defense/frontline-view.js';
import { FortificationView } from './defense/fortifications.js';
import { Traffic } from './traffic.js';
import { ServiceFleet } from './service-fleet.js';
import { WeatherFX } from './effects/weather-fx.js';
import { disposeTree } from './mesh-utils.js';
import { aircraftModel } from './models/aircraft.js';
import { FixedCamera } from './camera.js';
import { TacticalView } from './tactical-overlays.js';
import { EveningPost } from './effects/post-processing.js';
import { RenderBudget, renderPixelRatio } from './performance/render-budget.js';
import { GroundVisibility } from './performance/ground-visibility.js';
import { DeploymentPreview } from './deployment-preview.js';
import * as E from '../game/index.js';
import { BUILDINGS, riverX } from '../game/index.js';
const clamp = T.MathUtils.clamp;
export class RTSWorld {
  constructor(host, state, callbacks) {
    this.host = host;
    this.state = state;
    this.callbacks = callbacks;
    this.models = new Map();
    this.groundModels = new Map();
    this.unitModels = new Map();
    this.roadModels = new Map();
    this.materials = new Map();
    this.sharedGeometries = new Set();
    this.sharedMaterials = new Set();
    this.battleTime = 0;
    this.visualDt = 0;
    this.previousSimTime = state.time;
    this.shakeEnergy = 0;
    this.shakeStrength = 0.45;
    this.roadVisuals = new Map();
    this.renderBudget = new RenderBudget();
    this.groundVisibility = new GroundVisibility();
    this.keys = {};
    this.armySelection = [];
    this.trenchModels = new Map();
    this.eventId = 0;
    this.quality = 'ultra';
    this.elapsed = 0;
    this.last = performance.now();
    this.roadAnchor = null;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#253749');
    this.scene.fog = new T.FogExp2('#33424d', 0.00085);
    this.renderer = new T.WebGLRenderer({
      // Geometry is multisampled in EveningPost; the canvas draws a fullscreen quad.
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(
      renderPixelRatio(host.clientWidth, host.clientHeight, devicePixelRatio),
    );
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.38;
    host.appendChild(this.renderer.domElement);
    this.camera = new T.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 2, 9000);
    this.camera.position.set(-850, 430, 480);
    this.controls = new FixedCamera(this.camera, this.renderer.domElement);
    this.controls.canInteract = () => !this.callbacks.isModal?.();
    this.controls.onContextClick = (e) => {
      if (this.callbacks.isModal?.()) return;
      this.selectionBox.hidden = true;
      this.down = null;
      if (this.armySelection.length && !this.buildKey && !this.aiming && !this.groundTargeting) {
        groundCommandAt.call(this, e);
        return;
      }
      this.callbacks.onCancelTool?.(true);
    };
    this.hemi = new T.HemisphereLight('#9eaed3', '#3d5147', 1.1);
    this.ambient = new T.AmbientLight('#8299ad', 0.18);
    this.scene.add(this.hemi, this.ambient);
    this.sun = new T.DirectionalLight('#ff9d79', 1.5);
    this.sun.position.set(-650, 155, -400);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -900,
      right: 900,
      top: 700,
      bottom: -700,
      near: 1,
      far: 2300,
    });
    this.sun.shadow.normalBias = 1.1;
    this.sun.shadow.bias = -0.00025;
    this.scene.add(this.sun);
    this.boxGeo = new T.BoxGeometry(1, 1, 1);
    this.cylGeo = new T.CylinderGeometry(1, 1, 1, 12);
    this.coneGeo = new T.ConeGeometry(1, 1, 8);
    this.sphereGeo = new T.IcosahedronGeometry(1, 1);
    for (const geo of [this.boxGeo, this.cylGeo, this.coneGeo, this.sphereGeo])
      this.sharedGeometries.add(geo);
    this.facade = this.makeFacade();
    this.glowTexture = this.makeGlow();
    this.terrain();
    this.environment();
    this.bridges();
    this.makeCover();
    this.districtView = new DistrictView(this);
    this.selection = new T.Mesh(
      new T.RingGeometry(0.96, 1, 100),
      new T.MeshBasicMaterial({
        color: '#9bdfb3',
        transparent: true,
        opacity: 0.9,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.position.y = 0.65;
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.coverage = new T.Mesh(
      new T.RingGeometry(0.994, 1, 160),
      new T.MeshBasicMaterial({
        color: '#9bdfb3',
        transparent: true,
        opacity: 0.42,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.coverage.rotation.x = -Math.PI / 2;
    this.coverage.position.y = 0.8;
    this.coverage.visible = false;
    this.scene.add(this.coverage);
    this.ghost = new T.Group();
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    this.selected = null;
    this.buildKey = null;
    this.rotation = 0;
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'selection-box';
    this.selectionBox.hidden = true;
    host.appendChild(this.selectionBox);
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (this.callbacks.isModal?.()) return;
      if (e.button !== 0 || this.controls.rotating) return;
      this.down = {
        x: e.clientX,
        y: e.clientY,
        ground: this.groundPoint(e)?.clone(),
        time: performance.now(),
        button: e.button,
      };
      this.keys.MouseLeft = e.button === 0;
      if (e.button === 0) this.renderer.domElement.setPointerCapture(e.pointerId);
    });
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      this.lastPointer = e;
      if (this.callbacks.isModal?.()) return;
      if (
        this.down &&
        !this.buildKey &&
        !this.aiming &&
        !this.groundTargeting &&
        Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 7
      ) {
        this.selectionBox.hidden = false;
        Object.assign(this.selectionBox.style, {
          left: Math.min(e.clientX, this.down.x) + 'px',
          top: Math.min(e.clientY, this.down.y) + 'px',
          width: Math.abs(e.clientX - this.down.x) + 'px',
          height: Math.abs(e.clientY - this.down.y) + 'px',
        });
      }
      if (this.aiming && !this.controls.rotating) {
        const p = this.groundPoint(e);
        if (p) this.callbacks.onAimHover?.(p);
      }
      if (this.groundTargeting === 'fpv') {
        const p = this.groundPoint(e),
          u = this.state.groundUnits.find(
            (u) => this.armySelection.includes(u.id) && u.key === 'operator',
          );
        if (p && u) this.tactical?.previewTactical(u, p);
      }
      if (this.groundTargeting === 'deploy') {
        const p = this.groundPoint(e);
        if (p) this.callbacks.onGroundHover?.(p);
      }
      if (this.groundTargeting === 'defendline' && this.down?.ground) {
        const p = this.groundPoint(e);
        if (p) this.tactical?.previewDefenseLine(this.down.ground, p, this.armySelection);
      }
      this.updateGhost(e);
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    this.renderer.domElement.addEventListener('pointercancel', () => {
      this.selectionBox.hidden = true;
      this.down = null;
      this.keys.MouseLeft = false;
    });
    window.addEventListener('keydown', (e) => {
      if (
        this.callbacks.isModal?.() ||
        e.target.closest?.(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      this.keys[e.code] = true;
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.code === 'KeyR' && this.buildKey) {
        this.rotation += Math.PI / 4;
        this.updateGhost(this.lastPointer);
      }
    });
    window.addEventListener('keyup', (e) => (this.keys[e.code] = false));
    document.addEventListener('focusin', () => {
      this.keys = {};
    });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.down = null;
      this.controls.cancelRotation();
    });
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      if (document.hidden) this.keys = {};
    });
    this.sun.shadow.mapSize.set(4096, 4096);
    Object.assign(this.sun.shadow.camera, { left: -480, right: 480, top: 480, bottom: -480 });
    this.sun.shadow.normalBias = 0.35;
    this.sun.shadow.bias = -0.00012;
    this.post = new EveningPost(this.renderer);
    this.post.resize(host.clientWidth, host.clientHeight);
    this.resizeObserver = new ResizeObserver(() => {
      this.camera.aspect = host.clientWidth / host.clientHeight;
      this.camera.updateProjectionMatrix();
      this.resizeRender();
    });
    this.resizeObserver.observe(host);
    this.infantry = new InfantryBatch(this);
    this.combatFX = new CombatEffects(this);
    this.fogVeil = new FogVeil(this.scene);
    this.weatherFX = new WeatherFX(this.scene);
    this.traffic = new Traffic(this);
    this.serviceFleet = new ServiceFleet(this.scene, {
      height: (x, z) => this.height(x, z),
      visible: (s, v) => v.side === 0 || E.fogVisible(s, 0, v.x, v.z),
    });
    this.tactical = new TacticalView(this);
    this.deploymentPreview = new DeploymentPreview(this.scene);
    this.frontlineView = new FrontlineView(this.scene, (x, z) => this.height(x, z));
    this.fortifications = new FortificationView(this.scene, {
      height: (x, z) => this.height(x, z),
      visible: (s, t) => t.side === 0 || E.fogVisible(s, 0, t.x, t.z),
    });
    this.trenchModels = this.fortifications.models;
    this.sync();
    // Let the app finish wiring its UI before the first GPU frame.
    this.frame = requestAnimationFrame(this.animate);
  }
  mat(color, extra = {}) {
    const key = color + JSON.stringify(extra);
    if (!this.materials.has(key)) {
      const material = new T.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
      this.materials.set(key, material);
      this.sharedMaterials.add(material);
    }
    return this.materials.get(key);
  }
  box(parent, x, y, z, w, h, d, color, extra = {}) {
    const mesh = new T.Mesh(
      this.boxGeo,
      typeof color === 'object' ? color : this.mat(color, extra),
    );
    mesh.position.set(x, y + h / 2, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  cyl(parent, x, y, z, r, h, color) {
    const m = new T.Mesh(this.cylGeo, this.mat(color));
    m.position.set(x, y + h / 2, z);
    m.scale.set(r, h, r);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  makeGlow(...args) {
    return makeGlowForWorld.call(this, ...args);
  }
  makeFacade(...args) {
    return makeFacadeForWorld.call(this, ...args);
  }
  height(...args) {
    return heightForWorld.call(this, ...args);
  }
  terrain(...args) {
    return terrainForWorld.call(this, ...args);
  }
  environment(...args) {
    return environmentForWorld.call(this, ...args);
  }
  makeCover(...args) {
    return makeCoverForWorld.call(this, ...args);
  }
  syncTrenches(...args) {
    return syncTrenchesForWorld.call(this, ...args);
  }
  setArmySelection(ids) {
    this.armySelection = [...ids];
    if (ids.length > 1) this.coverage.visible = false;
  }
  setGroundTargeting(mode) {
    const previous = this.groundTargeting;
    this.groundTargeting = mode;
    if (mode !== 'deploy') this.deploymentPreview?.set(null);
    this.host.classList.toggle('ground-targeting', !!mode);
    if (previous) {
      this.tactical?.preview(null);
      this.tactical?.previewDefenseLine(null);
      this.coverage.visible = false;
    }
    if (mode === 'fpv') {
      const u = this.state.groundUnits.find(
        (u) => this.armySelection.includes(u.id) && u.key === 'operator' && !u.carrierId,
      );
      if (u) {
        this.coverage.visible = true;
        this.coverage.scale.setScalar(320);
        this.coverage.position.set(u.x, 1.4, u.z);
      }
    }
  }
  bridges(...args) {
    return bridgesForWorld.call(this, ...args);
  }
  updateDaylight(...args) {
    return updateDaylightForWorld.call(this, ...args);
  }
  model(...args) {
    return modelForWorld.call(this, ...args);
  }
  clearTrees(...args) {
    return clearTreesForWorld.call(this, ...args);
  }
  setBuild(...args) {
    return setBuildForWorld.call(this, ...args);
  }
  cancelRoad(...args) {
    return cancelRoadForWorld.call(this, ...args);
  }
  pointerUp(...args) {
    return pointerUpForWorld.call(this, ...args);
  }
  groundPoint(...args) {
    return groundPointForWorld.call(this, ...args);
  }
  updateGhost(...args) {
    return updateGhostForWorld.call(this, ...args);
  }
  select(id) {
    this.selected = id;
    const b = E.observedTarget(this.state, 0, id);
    this.selection.visible = !!b;
    this.coverage.visible = false;
    if (!b) return;
    const range =
      E.isInfantry(b.key) && b.key !== 'mog'
        ? 0
        : b.key === 'radar'
          ? 320
          : (BUILDINGS[b.key] || E.GROUND_UNITS[b.key])?.range;
    if (range && b.side === 0 && (!b.ground || this.armySelection.length <= 1)) {
      this.coverage.visible = true;
      this.coverage.scale.setScalar(range);
      this.coverage.position.set(b.x, 1.4, b.z);
    }
    this.selection.position.set(b.x, 0.9, b.z);
    this.selection.scale.setScalar(
      b.key === 'road' ? 8 : ((BUILDINGS[b.key] || E.GROUND_UNITS[b.key])?.size || 30) * 0.8,
    );
    this.selection.material.color.set(b.side === 0 ? '#a4ecc3' : '#f5ac8b');
    if (b.ground && b.side === 0) this.selection.visible = false;
  }
  focus(x, z, distance = 570) {
    this.controls.focus(x, z, distance);
  }
  road(...args) {
    return roadForWorld.call(this, ...args);
  }
  disposeContents(root) {
    for (const child of [...root.children])
      disposeTree(child, this.sharedGeometries, this.sharedMaterials);
    root.clear();
  }
  sync(...args) {
    const result = syncForWorld.call(this, ...args);
    this.serviceFleet.sync(this.state);
    return result;
  }
  aircraft(u) {
    return aircraftModel(this, u);
  }
  particle(x, y, z, kind, size = 1, life = 1) {
    if (kind === 'smoke') this.combatFX.puff(x, y, z, size, life);
    else this.combatFX.spark(x, y, z, size, life);
  }
  // Own field units whose position projects inside the current viewport.
  unitsOnScreen(filter = () => true) {
    const v = new T.Vector3();
    return (this.state.groundUnits || [])
      .filter((u) => {
        if (u.side !== 0 || u.hp <= 0 || u.carrierId || !filter(u)) return false;
        v.set(u.x, (u.y || 1) + 1, u.z).project(this.camera);
        return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      })
      .map((u) => u.id);
  }
  explosion(x, y, z, size = 1) {
    this.combatFX.explode(x, y, z, size);
    this.addShake(x, z, size);
  }
  addShake(x, z, size) {
    const distance = Math.hypot(x - this.controls.target.x, z - this.controls.target.z),
      strength = Math.max(0, 1 - distance / 850) * size;
    this.shakeEnergy = Math.min(3, this.shakeEnergy + strength);
  }
  setQuality() {
    this.quality = 'ultra';
  }
  resizeRender() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    this.renderer.setPixelRatio(
      renderPixelRatio(width, height, devicePixelRatio, this.renderBudget.scale),
    );
    this.renderer.setSize(width, height);
    this.post.resize(width, height);
  }
  updateMinimap(...args) {
    return updateMinimapForWorld.call(this, ...args);
  }
  setAiming(value) {
    this.aiming = value;
  }
  setFrontlineVisible(value) {
    this.frontlineView.setVisible(value);
  }
  setOrderPreview(order) {
    this.orderPreview = order;
    this.tactical.preview(order);
  }
  diagnostics() {
    return {
      renderer: 'WebGL / Three.js',
      buildings: this.models.size,
      units: this.unitModels.size,
      groundUnits: this.groundModels.size,
      day: E.dayPhase(this.state.time),
      projectiles: this.state.projectiles.length,
      effects: this.combatFX.diagnostics().particles,
      fx: this.combatFX.diagnostics(),
      memory: { ...this.renderer.info.memory, programs: this.renderer.info.programs.length },
      fogOfWar: true,
      weather: this.weatherFX.diagnostics(),
      traffic: this.traffic.diagnostics(),
      serviceFleet: this.serviceFleet.diagnostics(),
      frontline: this.frontlineView.diagnostics(),
      fortifications: this.fortifications.diagnostics(),
      detectedEnemies: this.state.units.filter(
        (u) => u.side === 1 && E.unitVisible(this.state, 0, u),
      ).length,
      orderPreview: !!this.tactical.orderSignature,
      quality: 'ultra',
      triangles: this.renderInfo?.triangles,
      calls: this.renderInfo?.calls,
      evening: true,
      grain: true,
      bloom: true,
      shadows: 4096,
      pixelRatio: this.renderer.getPixelRatio(),
      renderScale: this.renderBudget.scale,
      camera: this.controls.diagnostics(),
      riverBed: this.height(riverX(0), 0),
      waterLevel: -2.5,
    };
  }
  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now(),
      wallDt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    if (this.renderBudget.observe(wallDt)) this.resizeRender();
    this.elapsed += wallDt;
    this.callbacks.onFrame?.(wallDt);
    const simDt = Math.max(0, this.state.time - this.previousSimTime);
    this.previousSimTime = this.state.time;
    this.visualDt = Math.min(0.12, simDt);
    this.battleTime += this.visualDt;
    const keyboardAllowed =
      !this.callbacks.isModal?.() &&
      !document.activeElement?.closest?.(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      );
    if (!keyboardAllowed) this.keys = {};
    this.controls.update(wallDt, keyboardAllowed ? this.keys : null);
    if (this.shakeEnergy > 0) {
      this.shakeEnergy = Math.max(0, this.shakeEnergy - this.visualDt * 5);
      const a = this.shakeEnergy * this.shakeStrength;
      this.camera.position.x += Math.sin(this.battleTime * 83) * a;
      this.camera.position.y += Math.sin(this.battleTime * 107) * a * 0.45;
      this.camera.rotateZ(Math.sin(this.battleTime * 67) * a * 0.0009);
      this.camera.updateMatrixWorld();
    }
    this.updateDaylight();
    this.sync();
    this.frontlineView.update(E.frontlineReport(this.state, 0));
    this.fogVeil.update(this.state, wallDt);
    this.weatherFX.update(this.visualDt, this.controls.target, this.state.weather);
    this.combatFX.emit(this.state, this.visualDt, (u) => E.unitVisible(this.state, 0, u));
    this.combatFX.update(this.visualDt, this.elapsed, this.camera);
    this.traffic.update(this.state, this.visualDt, this.combatFX);
    this.serviceFleet.update(this.battleTime);
    if (this.buildKey && this.lastPointer) this.updateGhost(this.lastPointer);
    if (this.aiming && this.lastPointer && !this.controls.rotating) {
      const p = this.groundPoint(this.lastPointer);
      if (p) this.callbacks.onAimHover?.(p);
    }
    this.callbacks.onAmbient?.(wallDt);
    this.renderInfo = this.post.render(this.scene, this.camera, this.battleTime);
  };
}
