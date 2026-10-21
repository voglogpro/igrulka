import * as T from '../../../vendor/three/three.module.js';
export class EveningPost {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new T.WebGLRenderTarget(1, 1, {
      type: T.HalfFloatType,
      depthBuffer: true,
      samples: 4,
    });
    this.scene = new T.Scene();
    this.camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      frame: { value: this.target.texture },
      pixel: { value: new T.Vector2(1, 1) },
      time: { value: 0 },
    };
    this.material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `
   uniform sampler2D frame;uniform vec2 pixel;uniform float time;varying vec2 vUv;
   vec3 bright(vec2 p){vec3 c=texture2D(frame,p).rgb;return max(c-vec3(1.05),vec3(0.));}
   void main(){vec3 col=texture2D(frame,vUv).rgb;vec3 glow=vec3(0.);for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 d=vec2(cos(a),sin(a));glow+=bright(vUv+d*pixel*3.)*.065;glow+=bright(vUv+d*pixel*8.)*.025;}col+=glow;
    float vig=1.-smoothstep(.23,.8,length((vUv-.5)*vec2(1.,.85)));col*=.88+.12*vig;
    gl_FragColor=vec4(col,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    float grain=fract(sin(dot(gl_FragCoord.xy+floor(time*18.),vec2(12.9898,78.233)))*43758.5453)-.5;gl_FragColor.rgb+=grain*.022;
   }`,
    });
    this.scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.material));
  }
  resize(width, height) {
    const ratio = this.renderer.getPixelRatio();
    this.target.setSize(
      Math.max(1, Math.floor(width * ratio)),
      Math.max(1, Math.floor(height * ratio)),
    );
    this.uniforms.pixel.value.set(1 / (width * ratio), 1 / (height * ratio));
  }
  render(scene, camera, time) {
    this.uniforms.time.value = time;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    const info = {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    return info;
  }
}
