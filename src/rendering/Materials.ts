import * as THREE from 'three';
import { config } from '../config';

/** 全マテリアルで共有するグローバルuniform（太陽方向・フォグ・時間） */
export const shared = {
  uSun: { value: new THREE.Vector3(0.45, 0.82, 0.36).normalize() },
  uFogColor: { value: new THREE.Color(0xa6d4ee) },
  uFogNear: { value: config.world.fogNear },
  uFogFar: { value: config.world.fogFar },
  uTime: { value: 0 },
};

export const FOG_FN = /* glsl */ `
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
vec3 applyFog(vec3 c, vec3 wpos) {
  float d = length(wpos - cameraPosition);
  float f = smoothstep(uFogNear, uFogFar, d);
  return mix(c, uFogColor, f);
}`;

const VERT = /* glsl */ `
attribute vec3 aColor;
varying vec3 vCol; varying vec3 vN; varying vec3 vW;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(m) * normal);
  vCol = aColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSun; uniform float uSoft;
varying vec3 vCol; varying vec3 vN; varying vec3 vW;
${FOG_FN}
void main() {
  vec3 n = normalize(vN);
  float l = max(dot(n, uSun), 0.0);
  float amb = 0.50 + 0.12 * n.y;
  float shade = amb + 0.64 * l;
  shade = mix(shade, 0.86 + 0.2 * l, uSoft);
  vec3 c = vCol * shade;
  c += vec3(-0.02, 0.0, 0.06) * (1.0 - l) * 0.5;
  c = applyFog(c, vW);
  gl_FragColor = vec4(c, 1.0);
}`;

/** フラットシェーディングのボクセル用マテリアル（頂点色aColor + 面方向の陰影 + フォグ） */
export function createVoxelMaterial(soft = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: shared.uSun, uFogColor: shared.uFogColor, uFogNear: shared.uFogNear, uFogFar: shared.uFogFar, uSoft: { value: soft } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/** インスタンスカラーを使う発光寄りのパーティクル用マテリアル */
export function createParticleMaterial(opacity = 1, transparent = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: shared.uSun,
      uFogColor: shared.uFogColor,
      uFogNear: shared.uFogNear,
      uFogFar: shared.uFogFar,
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vCol; varying vec3 vN; varying vec3 vW;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(m) * normal);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uOpacity;
      varying vec3 vCol; varying vec3 vN; varying vec3 vW;
      ${FOG_FN}
      void main() {
        float l = max(dot(normalize(vN), uSun), 0.0);
        vec3 c = vCol * (0.82 + 0.28 * l);
        c = applyFog(c, vW);
        gl_FragColor = vec4(c, uOpacity);
      }`,
    transparent,
    depthWrite: !transparent,
  });
}
