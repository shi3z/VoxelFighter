import * as THREE from 'three';
import { shared } from './Materials';

/** 水色→水平線付近の淡い青のグラデーション空。段階的なバンドで描画（ブリット時のディザでドット模様になる）。 */
export class Sky {
  readonly mesh: THREE.Mesh;
  constructor() {
    const g = new THREE.SphereGeometry(6000, 24, 12);
    const m = new THREE.ShaderMaterial({
      uniforms: { uFogColor: shared.uFogColor },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor; varying vec3 vD;
        void main(){
          float y = normalize(vD).y;
          float t = clamp(y, 0.0, 1.0);
          t = pow(t, 0.62);
          t = floor(t * 7.0) / 7.0;
          vec3 zen = vec3(0.30, 0.64, 0.92);
          vec3 mid = vec3(0.55, 0.80, 0.95);
          vec3 c = mix(uFogColor, mid, smoothstep(0.0, 0.35, t));
          c = mix(c, zen, smoothstep(0.35, 1.0, t));
          // 水平線のすぐ上に明るい霞の帯
          if (y > 0.0 && y < 0.035) c = mix(c, vec3(0.80, 0.92, 0.98), 0.45);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
  }
  follow(p: THREE.Vector3): void {
    this.mesh.position.copy(p);
  }
}
