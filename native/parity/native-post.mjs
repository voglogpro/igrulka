import { Color, Vector2, Vector4 } from '../../vendor/three/three.module.js';
import { weatherStyle } from '../../src/rendering/effects/weather-style.js';

export function adaptivePostSamples(scale = 1, maxSamples = 4, previous = 4) {
  const desired = scale <= 0.9 ? 2 : scale >= 1 ? 4 : previous;
  const supported = maxSamples >= 4 ? 4 : maxSamples >= 2 ? 2 : maxSamples >= 1 ? 1 : 0;
  return Math.min(desired, supported);
}

export class EveningPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.fogNight = new Color('#68777b');
    this.fogDay = new Color('#a4b0ad');
    this.uniforms = {
      groundFog: { value: 0 },
      fogTint: { value: this.fogNight.clone() },
      visionActive: { value: 0 },
      time: { value: 0 },
      grainPixelScale: { value: new Vector2(1, 1) },
    };
    this.target = { scissor: new Vector4(), scissorTest: false, samples: 4 };
    this.bloom = { scissor: new Vector4(), scissorTest: false };
    this.daylight = 0;
    this.renderScale = 1;
    this.scenePixelRatio = 1;
  }
  setAtmosphere(weather, daylight) {
    this.daylight = daylight;
    this.uniforms.groundFog.value = weatherStyle(weather).groundFog;
    this.uniforms.fogTint.value.copy(this.fogNight).lerp(this.fogDay, daylight);
  }
  setVision() {
    this.uniforms.visionActive.value = 0;
  }
  resize(width, height, scale = 1) {
    this.renderScale = scale;
    this.scenePixelRatio = this.renderer.getPixelRatio() * scale;
    this.uniforms.grainPixelScale.value.set(scale, scale);
  }
  render(scene, camera, time) {
    this.uniforms.time.value = time;
    const post = {
      daylight: this.daylight,
      groundFog: this.uniforms.groundFog.value,
      fogTint: this.uniforms.fogTint.value.toArray(),
      grain: true,
      bloom: true,
      renderScale: this.renderScale,
      grainPixelScale: this.uniforms.grainPixelScale.value.toArray(),
    };
    this.renderer.render(scene, camera, { time, post });
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
}
