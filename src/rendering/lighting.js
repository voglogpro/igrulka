import * as T from '../../vendor/three/three.module.js';
import * as E from '../game/index.js';
import { weatherStyle } from './effects/weather-style.js';
export const WEATHER_FOG = new T.Color('#5d6c74');
export const FLASH_FOG = new T.Color('#cfe0ff');
export const NIGHT_FOG = new T.Color('#111e30');

export const DAY_FOG = new T.Color('#7297b0');

export const NIGHT_SUN = new T.Color('#a6bce9');

export const DUSK_SUN = new T.Color('#ffb389');

export const DAY_SUN = new T.Color('#fff2d8');

export function updateDaylight() {
  const d = E.dayPhase(this.state.time);
  this.hemi.intensity = 0.95 + d.daylight * 0.6;
  this.ambient.intensity = 0.3 + d.daylight * 0.05;
  this.sun.intensity = 0.65 + d.daylight * 1.9;
  this.sun.color
    .copy(NIGHT_SUN)
    .lerp(DUSK_SUN, T.MathUtils.smoothstep(d.daylight, 0, 0.12))
    .lerp(DAY_SUN, T.MathUtils.smoothstep(d.daylight, 0.12, 0.7));
  this.sky.material.uniforms.daylight.value = d.daylight;
  this.scene.fog.color.copy(NIGHT_FOG).lerp(DAY_FOG, d.daylight);
  this.scene.background.copy(this.scene.fog.color);
  this.scene.fog.density = 0.00055 + d.night * 0.0002;
  // Overcast light and a restrained distance haze; the post pass keeps fog near the ground.
  const wx = this.state.weather,
    amount = wx?.amount ?? 0,
    kind = wx?.kind ?? 'clear',
    overcast = kind === 'fog' ? 0.35 : kind === 'clear' ? 0 : 0.6,
    flash = this.weatherFX?.flash ?? 0;
  if (amount > 0) {
    this.sun.intensity *= 1 - overcast * amount;
    this.hemi.intensity *= 1 - 0.18 * overcast * amount;
    this.scene.fog.density += weatherStyle(wx).haze;
    this.scene.fog.color.lerp(WEATHER_FOG, amount * 0.12);
    this.scene.background.copy(this.scene.fog.color);
  }
  if (flash > 0) {
    this.hemi.intensity += flash * 3.2;
    this.scene.fog.color.lerp(FLASH_FOG, flash * 0.6);
    this.scene.background.copy(this.scene.fog.color);
  }
  this.post?.setAtmosphere(wx, d.daylight);
  this.sunDisc.position.set(Math.cos(d.angle) * -2300, Math.sin(d.angle) * 2300, -800);
  this.sunDisc.visible = d.daylight > 0;
  // Moving the shadow coverage translates the light AND its target together.
  // Only the day cycle controls their offset, so panning cannot change light direction.
  const t = this.controls.target,
    moved = !this.shadowFocus || this.shadowFocus.distanceTo(t) > 24;
  if (moved) {
    this.shadowFocus ??= new T.Vector3();
    this.shadowFocus.copy(t);
  }
  const anchor = this.shadowFocus;
  this.sun.position.set(
    anchor.x + Math.cos(d.angle) * -650,
    anchor.y + Math.max(160, Math.abs(Math.sin(d.angle)) * 800),
    anchor.z - 400,
  );
  this.sun.target.position.copy(anchor);
  this.sun.target.updateMatrixWorld();
  if (this.facadeMat) this.facadeMat.emissiveIntensity = 0.12 + d.night * 1.2;
  this.renderer.toneMappingExposure = 1.25 + d.night * 0.2 - 0.14 * amount * overcast;
  for (const mat of this.sharedMaterials)
    if (mat.emissiveIntensity > 0 && mat !== this.facadeMat) {
      mat.userData.baseEmission ??= mat.emissiveIntensity;
      mat.emissiveIntensity = mat.userData.baseEmission * (0.12 + d.night * 0.88);
    }
  if (
    moved ||
    this.lastShadowTime == null ||
    Math.abs(this.state.time - this.lastShadowTime) >= 0.25
  ) {
    this.lastShadowTime = this.state.time;
    this.renderer.shadowMap.needsUpdate = true;
  }
}
