import * as T from '../../../vendor/three/three.module.js';
import { weatherStyle } from './weather-style.js';
import { FILM_GRAIN_GLSL } from './film-grain.js';
const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
export class EveningPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      depthBuffer: true,
      samples: 4,
    });
    this.target.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
    this.fogNight = new T.Color('#68777b');
    this.fogDay = new T.Color('#a4b0ad');
    this.bloom = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, depthBuffer: false });
    this.scene = new T.Scene();
    this.bloomScene = new T.Scene();
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      frame: { value: this.target.texture },
      glow: { value: this.bloom.texture },
      pixel: { value: new T.Vector2(1, 1) },
      time: { value: 0 },
      depthFrame: { value: this.target.depthTexture },
      inverseProjection: { value: new T.Matrix4() },
      cameraWorld: { value: new T.Matrix4() },
      groundFog: { value: 0 },
      fogTint: { value: this.fogNight.clone() },
      visionFrame: { value: null },
      visionOrigin: { value: new T.Vector2() },
      visionExtent: { value: new T.Vector2(1, 1) },
      visionActive: { value: 0 },
      visionTint: { value: new T.Color('#102024') },
    };
    const geometry = new T.PlaneGeometry(2, 2);
    this.bloomMaterial = new T.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      vertexShader,
      fragmentShader: `uniform sampler2D frame;uniform vec2 pixel;varying vec2 vUv;
      vec3 bright(vec2 p){return max(texture2D(frame,p).rgb-vec3(1.05),vec3(0.));}
      void main(){vec3 c=bright(vUv)*.2;
        for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 d=vec2(cos(a),sin(a));vec2 e=vec2(cos(a+.3927),sin(a+.3927));c+=bright(vUv+d*pixel*2.5)*.06+bright(vUv+e*pixel*5.)*.045;}
        gl_FragColor=vec4(c,1.);}`,
    });
    this.bloomScene.add(new T.Mesh(geometry, this.bloomMaterial));
    this.material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader,
      fragmentShader: `
   uniform sampler2D frame;uniform sampler2D glow;uniform sampler2D depthFrame;uniform float time;
   uniform mat4 inverseProjection;uniform mat4 cameraWorld;uniform float groundFog;uniform vec3 fogTint;varying vec2 vUv;
   uniform sampler2D visionFrame;uniform vec2 visionOrigin;uniform vec2 visionExtent;uniform float visionActive;uniform vec3 visionTint;
   ${FILM_GRAIN_GLSL}
   void main(){vec3 col=texture2D(frame,vUv).rgb+texture2D(glow,vUv).rgb*.72;
    if(groundFog>.001){float depth=texture2D(depthFrame,vUv).x;if(depth<.999999){
      vec4 view=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);view/=view.w;
      vec3 world=(cameraWorld*view).xyz;
      // Integrate a soft height density along the eye ray. Tall roofs fade gradually
      // rather than cutting a crisp silhouette out of a low horizontal fog plane.
      float eye=max(0.,cameraWorld[3].y)/45.;float surface=max(0.,world.y)/45.;
      float delta=eye-surface;
      float density=abs(delta)>.001?(exp(-surface)-exp(-eye))/delta:exp(-surface);
      float wisps=.9+.1*sin(world.x*.012+sin(world.z*.009)+time*.065);
      float haze=1.-exp(-groundFog*.007*length(view.xyz)*max(0.,density)*wisps);
      col=mix(col,fogTint,clamp(haze,0.,.38));

    }}
    float vig=1.-smoothstep(.23,.8,length((vUv-.5)*vec2(1.,.85)));col*=.88+.12*vig;
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    float grain=filmGrain(gl_FragCoord.xy,time);
    float luminance=dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));
    gl_FragColor.rgb+=grain*mix(.013,.006,smoothstep(.1,.85,luminance));
   }`,
    });
    this.scene.add(new T.Mesh(geometry, this.material));
  }
  setAtmosphere(weather, daylight) {
    this.uniforms.groundFog.value = weatherStyle(weather).groundFog;
    this.uniforms.fogTint.value.copy(this.fogNight).lerp(this.fogDay, daylight);
  }
  // Retained for older callers; map fog cannot be re-enabled by a stale mask.
  setVision() {
    this.uniforms.visionActive.value = 0;
  }
  resize(width, height) {
    const ratio = this.renderer.getPixelRatio();
    const x = Math.max(1, Math.floor(width * ratio)),
      y = Math.max(1, Math.floor(height * ratio));
    this.target.setSize(x, y);
    this.bloom.setSize(Math.max(1, Math.ceil(x / 2)), Math.max(1, Math.ceil(y / 2)));
    this.uniforms.pixel.value.set(1 / x, 1 / y);
  }
  render(scene, camera, time) {
    this.uniforms.time.value = time;
    // Clear weather needs neither a depth resolve nor a full-screen depth texture fetch.
    this.target.resolveDepthBuffer = this.uniforms.groundFog.value > 0.001;
    camera.updateMatrixWorld();
    this.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    const info = {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    this.renderer.setRenderTarget(this.bloom);
    this.renderer.render(this.bloomScene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    return info;
  }
}
