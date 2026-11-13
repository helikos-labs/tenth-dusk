// Falling ash (ART-DIRECTION §3.6): ASH_COUNT pale flakes drift and fall through the view, as one THREE.Points drawn in
// one call. They live in a box (ASH.box) round the camera's target (uFocus, set where the camera follows the hero),
// anchored in the world and wrapped by the vertex shader: each falls at its own speed and sways, from uTime alone, so
// nothing runs on the CPU per frame and the flakes move only when a frame is drawn anyway (phones draw on demand). Each
// flake reads the fog of war under it (the ground behind it on screen, along the view ray down to the fog floor, as
// the mist does) and shows only over seen ground (C7). With prefers-reduced-motion the flakes hang still (uDrift 0).
// The Points are drawn by scenes/AshFall.tsx; this module holds what node's tests can load (no JSX).
import * as THREE from 'three'
import { next } from '../rules/rng.ts'
import { ASH_GLSL, FOG_FLOOR, FOG_LOOKUP_GLSL, FOG_TINT_GLSL, FOG_UNIFORMS_GLSL, NOISE_GLSL, WARP_GLSL, type FogUniforms } from './materials.ts'

export const ASH_COUNT = 150

/**
 * The flakes: the box round the camera's target (world units, x by y by z), how far its centre lies above the target,
 * fall speeds (units/s), the sway's reach (units), size at the target's depth (CSS px), colour and alpha.
 */
export const ASH = {
  box: [14, 6, 14] as const,
  lift: 1.5,
  fall: [0.15, 0.35] as const,
  sway: 0.3,
  size: [2, 4] as const,
  colour: new THREE.Color('#bdb7ab'),
  alpha: 0.55,
}

/** The camera's target (world space), which the flakes' box follows. */
export interface AshUniforms extends FogUniforms {
  uFocus: { value: THREE.Vector3 }
}

const f3 = (v: number) => v.toFixed(3)
const BOX = `vec3(${ASH.box.map(f3).join(', ')})`

/**
 * The flakes' geometry: per flake, `position` its place in the box (0 to 1 on each axis) and `aFlake` its fall speed
 * (units/s), sway phase (radians) and size (CSS px at the target's depth). Seeded, so every world shows the same fall.
 */
export function ashGeometry(): THREE.BufferGeometry {
  const pos = new Float32Array(ASH_COUNT * 3)
  const flake = new Float32Array(ASH_COUNT * 3)
  let s = 0x7a5f
  const rand = () => {
    const [v, n] = next(s)
    s = n
    return v
  }
  for (let i = 0; i < ASH_COUNT; i++) {
    pos.set([rand(), rand(), rand()], i * 3)
    flake.set([ASH.fall[0] + (ASH.fall[1] - ASH.fall[0]) * rand(), Math.PI * 2 * rand(), ASH.size[0] + (ASH.size[1] - ASH.size[0]) * rand()], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aFlake', new THREE.BufferAttribute(flake, 3))
  return g
}

/** Whether the viewer asks for reduced motion (none to ask outside a browser). */
const reducedMotion = () => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The flakes' material: the shared uniforms (uTime, the fog's, uFocus) by reference, the scene's fog, and its own
 * uDrift (1, or 0 for reduced motion, read once here) and uPx (the pixel ratio, set by AshFall.tsx).
 */
export function makeAshMaterial(uniforms: AshUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...(uniforms as unknown as Record<string, THREE.IUniform>),
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uDrift: { value: reducedMotion() ? 0 : 1 },
      uPx: { value: 1 },
    },
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
#include <fog_pars_vertex>
uniform float uTime;
uniform float uDrift;
uniform float uPx;
uniform vec3 uFocus;
${FOG_UNIFORMS_GLSL}
attribute vec3 aFlake;
varying float vAlpha;
${NOISE_GLSL}
${WARP_GLSL}
${FOG_TINT_GLSL}
${FOG_LOOKUP_GLSL}
${ASH_GLSL}
void main() {
  const vec3 box = ${BOX};
  // Its place in the world: falling and swaying from its seed (still for reduced motion), then wrapped into the box
  // round the camera's target.
  float t = uTime * uDrift;
  vec3 p = position * box;
  p.y -= t * aFlake.x;
  p.x += ${f3(ASH.sway)} * sin(t * 0.7 + aFlake.y);
  p.z += ${f3(ASH.sway)} * sin(t * 0.53 + aFlake.y * 1.7);
  vec3 c = uFocus + vec3(0.0, ${f3(ASH.lift)}, 0.0);
  vec3 rel = mod(p - c + 0.5 * box, box) - 0.5 * box;
  vec3 w = c + rel;
  // The fog of the ground behind it on screen: the view ray carried on down to the fog floor (unseen and sunk land
  // lies there). None over unseen or sunk ground (C7): no size, and outside the clip volume.
  vec2 g = w.xz + (w.xz - cameraPosition.xz) * (w.y - ${f3(FOG_FLOOR)}) / max(cameraPosition.y - w.y, 1e-3);
  float td_seen = td_seenShare(td_fogAt(rr_province(g, true)));
  if (td_seen <= 0.0) {
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  // Fading in and out at the box's faces, so a wrapped flake doesn't pop.
  vec3 e = smoothstep(vec3(0.0), vec3(1.0), 0.5 * box - abs(rel));
  vAlpha = ${f3(ASH.alpha)} * td_seen * e.x * e.y * e.z;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // Its size at the target's depth, larger nearer the camera and smaller beyond.
  gl_PointSize = clamp(aFlake.z * length(cameraPosition - uFocus) / max(-mvPosition.z, 0.1), 1.0, 6.0) * uPx;
  #include <fog_vertex>
}`,
    fragmentShader: /* glsl */ `
#include <fog_pars_fragment>
varying float vAlpha;
void main() {
  // A soft round flake.
  vec2 d = gl_PointCoord - 0.5;
  float a = vAlpha * (1.0 - smoothstep(0.06, 0.25, dot(d, d)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(${ASH.colour.r.toFixed(4)}, ${ASH.colour.g.toFixed(4)}, ${ASH.colour.b.toFixed(4)}), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
  })
}

/** The falling ash: one Points, drawn after the mist, never culled (the shader places it) and never picked. */
export function makeAshFall(uniforms: AshUniforms): THREE.Points {
  const points = new THREE.Points(ashGeometry(), makeAshMaterial(uniforms))
  points.frustumCulled = false
  points.renderOrder = 4
  points.matrixAutoUpdate = false
  points.raycast = () => {}
  return points
}
