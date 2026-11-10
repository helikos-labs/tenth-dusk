// The mist of the fog of war (§15.4): one plane over the board's bounds, MIST.height above the ground, drawn in one
// call. Its shader finds each point's province through the warp, as the ground does (materials.ts), reads the fog
// from texel 2 of the state texture, blended across the warped borders, and draws MIST.unseen × unseen + MIST.sunk ×
// sunk alpha, broken up by two layers of scrolling fbm. Walls count as remembered: no mist.
import * as THREE from 'three'
import { FOG_LOOKUP_GLSL, FOG_TINT_GLSL, FOG_UNIFORMS_GLSL, NOISE_GLSL, WARP_GLSL, type FogUniforms } from './materials.ts'

export const MIST = { height: 0.9, unseen: 0.45, sunk: 0.2, colour: new THREE.Color('#5b6878') }

export interface MistUniforms extends FogUniforms {
  /** The board's bounds the plane covers: min x, min z, max x, max z. */
  uBounds: { value: THREE.Vector4 }
}

/** The mist plane: a unit quad the vertex shader stretches over `uBounds`. */
export function makeMist(uniforms: MistUniforms): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    // The scene's fog too, so the mist fades into the Hush with the land under it.
    uniforms: { ...(uniforms as unknown as Record<string, THREE.IUniform>), ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
#include <fog_pars_vertex>
uniform vec4 uBounds;
varying vec3 vWPos;
void main() {
  vec4 w = vec4(mix(uBounds.x, uBounds.z, position.x + 0.5), ${MIST.height.toFixed(3)}, mix(uBounds.y, uBounds.w, position.z + 0.5), 1.0);
  vWPos = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
${FOG_UNIFORMS_GLSL}
varying vec3 vWPos;
${NOISE_GLSL}
${WARP_GLSL}
${FOG_TINT_GLSL}
${FOG_LOOKUP_GLSL}
float td_fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * rr_snoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
void main() {
  TDFog f = td_fogAt(rr_province(vWPos.xz, true));
  float a = (${MIST.unseen.toFixed(3)} * f.w.x + ${MIST.sunk.toFixed(3)} * f.w.y) / max(dot(f.w, vec4(1.0)) + f.wall, 1e-4);
  if (a < 0.002) discard;
  vec2 p = vWPos.xz;
  float n = 0.5 * (td_fbm(p * 0.3 + vec2(uTime * 0.04, uTime * 0.015)) + td_fbm(p * 0.8 - vec2(uTime * 0.025, -uTime * 0.05)));
  a *= 0.35 + 0.65 * smoothstep(-0.45, 0.45, n);
  gl_FragColor = vec4(${`vec3(${MIST.colour.r.toFixed(4)}, ${MIST.colour.g.toFixed(4)}, ${MIST.colour.b.toFixed(4)})`}, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  })
  const mesh = new THREE.Mesh(geo, mat)
  // The quad is a unit square until the shader stretches it, so three.js can't cull it by its geometry.
  mesh.frustumCulled = false
  mesh.renderOrder = 3
  mesh.matrixAutoUpdate = false
  mesh.raycast = () => {}
  return mesh
}
