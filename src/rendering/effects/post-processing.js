import * as T from '../../../vendor/three/three.module.js';
import { weatherStyle } from './weather-style.js';
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
        for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 d=vec2(cos(a),sin(a));c+=bright(vUv+d*pixel*5.)*.1;}
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
   void main(){vec3 col=texture2D(frame,vUv).rgb;
    // Depth reconstructs the ground, so the veil never paints over the sky or high roofs.
    if(groundFog>.001){float depth=texture2D(depthFrame,vUv).x;if(depth<.999999){
      vec4 view=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);view/=view.w;
      vec3 world=(cameraWorld*view).xyz;
      float low=1.-smoothstep(2.,22.,world.y);
      float distanceFade=smoothstep(65.,600.,length(view.xyz));
      float wisps=.84+.16*sin(world.x*.012+sin(world.z*.009)+time*.065);
      col=mix(col,fogTint,groundFog*low*distanceFade*wisps);
    }}
    col+=texture2D(glow,vUv).rgb*.72;
    float vig=1.-smoothstep(.23,.8,length((vUv-.5)*vec2(1.,.85)));col*=.88+.12*vig;
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    float grain=fract(sin(dot(gl_FragCoord.xy+floor(time*18.),vec2(12.9898,78.233)))*43758.5453)-.5;
    float luminance=dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722));
    gl_FragColor.rgb+=grain*mix(.029,.015,smoothstep(.1,.85,luminance));
   }`,
    });
    this.scene.add(new T.Mesh(geometry, this.material));
  }
  setAtmosphere(weather, daylight) {
    this.uniforms.groundFog.value = weatherStyle(weather).groundFog;
    this.uniforms.fogTint.value.copy(this.fogNight).lerp(this.fogDay, daylight);
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
