import { Vector3, MathUtils } from '../../vendor/three/three.module.js';
import { FIELD } from '../game/map.js';
export const CAMERA = {
  min: 100,
  max: 720,
  home: 540,
  minPitch: (Math.PI * 35) / 180,
  maxPitch: (Math.PI * 80) / 180,
  angle: new Vector3(-0.55, 0.8, 0.65).normalize(),
};
// The camera target stays over the playable field.
const BOUNDS = { x: FIELD.x - 60, z: FIELD.z - 60 };
export class FixedCamera {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.target = new Vector3(-615, 0, 0);
    this.desired = this.target.clone();
    this.distance = CAMERA.home;
    this.zoomDistance = CAMERA.home;
    this.angle = CAMERA.angle.clone();
    this.yaw = Math.atan2(this.angle.x, this.angle.z);
    this.pitch = Math.asin(this.angle.y);
    this.forward = new Vector3();
    this.right = new Vector3();
    this.enableKeyboardPan = true;
    this.enablePan = false;
    this.enableRotate = true;
    this.enableZoom = true;
    this.mouseButtons = { RIGHT: 'ROTATE' };
    this.minDistance = CAMERA.min;
    this.maxDistance = CAMERA.max;
    canvas.tabIndex = 0;
    canvas.setAttribute?.(
      'aria-label',
      'Карта: WASD — движение, ПКМ с перетаскиванием — поворот, колесо — масштаб',
    );
    canvas.addEventListener('pointerdown', () => this.focusInput());
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.canInteract && !this.canInteract()) return;
        e.preventDefault();
        this.focusInput();
        this.zoomDistance = MathUtils.clamp(
          this.zoomDistance * Math.exp(Math.sign(e.deltaY) * 0.12),
          CAMERA.min,
          CAMERA.max,
        );
      },
      { passive: false },
    );
    canvas.addEventListener('pointerdown', (e) => {
      if (this.canInteract && !this.canInteract()) return;
      if (e.button !== 2 || !this.enableRotate || e.buttons & 1) return;
      e.preventDefault();
      this.drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        cursor: canvas.style?.cursor || '',
      };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag?.id !== e.pointerId) return;
      if (!(e.buttons & 2)) {
        this.cancelRotation();
        return;
      }
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 6) return;
      this.drag.moved = true;
      if (canvas.style) canvas.style.cursor = 'grabbing';
      this.rotate(dx, dy);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.drag?.id !== e.pointerId) return;
      const click = e.button === 2 && !this.drag.moved;
      this.cancelRotation();
      if (click) this.onContextClick?.(e);
    });
    for (const name of ['pointercancel', 'lostpointercapture'])
      canvas.addEventListener(name, (e) => {
        if (this.drag?.id === e.pointerId) this.cancelRotation();
      });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.ownerDocument?.defaultView?.addEventListener('blur', () => this.cancelRotation());
    canvas.ownerDocument?.addEventListener('visibilitychange', () => {
      if (canvas.ownerDocument.hidden) this.cancelRotation();
    });
    this.rotate(0, 0);
    this.update(1);
  }
  get rotating() {
    return !!this.drag;
  }
  focusInput() {
    this.canvas.focus?.({ preventScroll: true });
  }
  cancelRotation() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.canvas.style) this.canvas.style.cursor = drag.cursor;
    if (this.canvas.hasPointerCapture?.(drag.id)) this.canvas.releasePointerCapture(drag.id);
  }
  rotate(dx, dy) {
    if (!this.enableRotate) return;
    this.yaw = MathUtils.euclideanModulo(this.yaw - dx * 0.005 + Math.PI, Math.PI * 2) - Math.PI;
    this.pitch = MathUtils.clamp(this.pitch + dy * 0.004, CAMERA.minPitch, CAMERA.maxPitch);
    this.angle.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(-this.forward.z, 0, this.forward.x);
  }
  focus(x, z, distance = CAMERA.max) {
    this.desired.set(
      MathUtils.clamp(x, -BOUNDS.x, BOUNDS.x),
      0,
      MathUtils.clamp(z, -BOUNDS.z, BOUNDS.z),
    );
    this.zoomDistance = MathUtils.clamp(distance, CAMERA.min, CAMERA.max);
  }
  update(dt = 1 / 60, keys = null) {
    if (this.enableKeyboardPan && keys) {
      const horizontal =
          Number(!!(keys.KeyD || keys.ArrowRight)) - Number(!!(keys.KeyA || keys.ArrowLeft)),
        vertical = Number(!!(keys.KeyW || keys.ArrowUp)) - Number(!!(keys.KeyS || keys.ArrowDown));
      if (horizontal || vertical) {
        const movement = this.right
          .clone()
          .multiplyScalar(horizontal)
          .addScaledVector(this.forward, vertical)
          .normalize();
        this.desired.addScaledVector(
          movement,
          this.distance * 0.6 * Math.min(0.1, Math.max(0, dt)),
        );
        this.desired.set(
          MathUtils.clamp(this.desired.x, -BOUNDS.x, BOUNDS.x),
          0,
          MathUtils.clamp(this.desired.z, -BOUNDS.z, BOUNDS.z),
        );
      }
    }
    const t = 1 - Math.exp(-Math.max(0, dt) * 10);
    this.target.lerp(this.desired, t);
    this.target.set(
      MathUtils.clamp(this.target.x, -BOUNDS.x, BOUNDS.x),
      0,
      MathUtils.clamp(this.target.z, -BOUNDS.z, BOUNDS.z),
    );
    this.distance = MathUtils.clamp(
      this.distance + (this.zoomDistance - this.distance) * t,
      CAMERA.min,
      CAMERA.max,
    );
    if (Math.abs(this.distance - this.zoomDistance) < 0.01) this.distance = this.zoomDistance;
    this.camera.position.copy(this.target).addScaledVector(this.angle, this.distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
  diagnostics() {
    return {
      fixedAngle: false,
      rotation: true,
      rotating: this.rotating,
      yaw: this.yaw,
      pitch: this.pitch,
      minPitch: CAMERA.minPitch,
      maxPitch: CAMERA.maxPitch,
      pan: false,
      keyboardPan: true,
      distance: this.distance,
      min: CAMERA.min,
      max: CAMERA.max,
      height: this.camera.position.y,
      target: { x: this.target.x, z: this.target.z },
    };
  }
}
