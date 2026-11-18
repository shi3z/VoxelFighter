import * as THREE from 'three';
import { config } from '../config';
import { shared } from './Materials';

THREE.ColorManagement.enabled = false;

/**
 * レトロ3D描画: シーンを低解像度RenderTarget(MSAA付き)に描き、
 * シャープバイリニアで画面に拡大。拡大時にBayerディザ+階調制限を掛ける。
 */
export class PixelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blit: THREE.ShaderMaterial;
  width = 640;
  height = 360;
  readonly skyScene = new THREE.Scene();
  stats = { calls: 0, triangles: 0 };
  onResize?: (w: number, h: number) => void;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(0xa6d4ee, 1);
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.target = this.makeTarget(this.width, this.height);
    this.blit = new THREE.ShaderMaterial({
      uniforms: {
        tex: { value: this.target.texture },
        res: { value: new THREE.Vector2(this.width, this.height) },
        levels: { value: config.render.levels },
        dither: { value: config.render.dither ? 1 : 0 },
        scale: { value: 3 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex; uniform vec2 res; uniform float levels; uniform float dither; uniform float scale;
        varying vec2 vUv;
        float bayer(vec2 p){
          int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          // 4x4 Bayer
          float m[16];
          m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0;
          m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
          m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0;
          m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
          float v = 0.0;
          for (int k = 0; k < 16; k++) if (k == i) v = m[k];
          return (v + 0.5) / 16.0;
        }
        void main(){
          // シャープバイリニア: テクセル内部はくっきり、境界だけ1画面ピクセル幅で補間してジャギーを和らげる
          vec2 p = vUv * res;
          vec2 fr = fract(p);
          // テクセル境界から 1 画面ピクセル分だけ隣と補間し、内部は単色のまま
          float sx = clamp(fr.x * scale, 0.0, 0.5) + clamp((fr.x - 1.0) * scale + 0.5, 0.0, 0.5);
          float sy = clamp(fr.y * scale, 0.0, 0.5) + clamp((fr.y - 1.0) * scale + 0.5, 0.0, 0.5);
          vec3 c = texture2D(tex, (floor(p) + vec2(sx, sy)) / res).rgb;
          float L = levels - 1.0;
          float b = dither > 0.5 ? bayer(floor(vUv * res)) : 0.5;
          c = floor(c * L + b) / L;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blit);
    quad.frustumCulled = false;
    this.quadScene.add(quad);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const t = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: config.render.msaa,
      generateMipmaps: false,
    });
    return t;
  }

  resize(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(W, H);
    const h = Math.max(120, Math.round(config.render.height));
    const w = Math.max(160, Math.round((h * W) / H));
    this.width = w;
    this.height = h;
    this.target.dispose();
    this.target = this.makeTarget(w, h);
    this.blit.uniforms.tex.value = this.target.texture;
    this.blit.uniforms.res.value.set(w, h);
    this.blit.uniforms.scale.value = Math.max(1, (W * this.renderer.getPixelRatio()) / w);
    this.onResize?.(w, h);
  }

  /** 解像度を変更（描画負荷と見た目に応じて） */
  setRenderHeight(h: number): void {
    config.render.height = h;
    this.resize();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.info.reset();
    this.blit.uniforms.levels.value = config.render.levels;
    this.blit.uniforms.dither.value = config.render.dither ? 1 : 0;
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(shared.uFogColor.value, 1);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
