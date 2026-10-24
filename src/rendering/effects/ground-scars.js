import * as T from '../../../vendor/three/three.module.js';
import { GROUND_SCARS } from '../../game/combat/ground-scars.js';

// One fixed batch for all persistent scars; no impact creates a mesh or a material.
export class GroundScarBatch {
  constructor(scene) {
    const capacity = GROUND_SCARS.capacity,
      geometry = new T.PlaneGeometry(2, 2);
    this.alpha = new T.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aOpacity', this.alpha);
    this.mesh = new T.InstancedMesh(
      geometry,
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        vertexShader: `attribute float aOpacity;varying vec2 vUv;varying float vAlpha;
      void main(){vUv=uv;vAlpha=aOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
        fragmentShader: `varying vec2 vUv;varying float vAlpha;
      void main(){vec2 p=(vUv-.5)*2.;float angle=atan(p.y,p.x);
        float r=length(p)*(1.+.045*sin(angle*7.)+.025*cos(angle*11.));
        float bowl=1.-smoothstep(.28,.78,r);float rim=smoothstep(.65,.8,r)*(1.-smoothstep(.8,1.,r));
        float alpha=(bowl*.48+rim*.23)*vAlpha;if(alpha<.005)discard;
        gl_FragColor=vec4(mix(vec3(.075,.066,.052),vec3(.28,.23,.16),rim),alpha);
        #include <colorspace_fragment>
      }`,
      }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.alpha.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.dummy = new T.Object3D();
    scene.add(this.mesh);
  }
  update(scars, time, height = () => 0) {
    let count = 0;
    const list = scars || [];
    for (let index = 0; index < list.length; index++) {
      const scar = list[index];
      if (count >= GROUND_SCARS.capacity) break;
      const age = Math.max(0, time - scar.time);
      if (age >= GROUND_SCARS.life) continue;
      const fade =
        Math.min(1, (GROUND_SCARS.life - age) / 180) *
        Math.min(1, (GROUND_SCARS.capacity - list.length + index + 1) / 12);
      this.dummy.position.set(scar.x, Math.max(0, height(scar.x, scar.z)) + 0.12, scar.z);
      this.dummy.rotation.set(-Math.PI / 2, 0, (scar.id % 37) * 0.17);
      this.dummy.scale.set(scar.radius, scar.radius, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);
      this.alpha.setX(count, fade);
      count++;
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
  }
}
