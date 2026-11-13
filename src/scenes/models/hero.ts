// The Lampwright (§1): a tall, gaunt cloaked figure, hooded over a dark void of a face, leaning on a staff from which
// the ember's lantern hangs, a warm point light that flickers. Ported from the concept scene's `makeHero` onto the
// world's modelling kit (world/models/kit.ts): cached geometries and materials, idle and walk ticks through `rig`, and
// baked (kit `prepare`) to a few meshes: the figure, the hood and the lantern. In the world (`dressHero`) the cloak's
// edges catch a faint cool rim, and an ember silhouette shows through whatever hides the hero.
import * as THREE from 'three'
import { box, cone, geo, mat, part, rig, sphere, torus } from '../../world/models/kit.ts'
import { glow, rod } from './parts.ts'

/** The hero's height, in hex units (a hex has circumradius 1), before the scene's scale. */
export const HERO_HEIGHT = 1
/** The concept modelled the figure 1.145 tall (to the lantern hook); this brings it to HERO_HEIGHT. */
const K = HERO_HEIGHT / 1.145

/** The lantern's light: warm, short-reaching, flickering round `LIGHT.intensity`. */
export const LIGHT = { color: '#ff9248', intensity: 5, distance: 5.5, decay: 2 }

/** The lantern's halo: an additive glow this wide (before the hero's scale), flickering with the light. */
const HALO = 0.8

const COLOR = { cloak: '#2b303b', mantle: '#6a2a22', scarf: '#8e3b2a', leather: '#5a3b26', metal: '#2a2c30', wood: '#3d2a1e', hand: '#3a2e28', boot: '#1b1b1e', void: '#07080a' }

/** A deterministic jitter in [-0.5, 0.5) for vertex i. */
const jitter = (i: number) => {
  let t = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35)
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296 - 0.5
}

const lathe = (pts: [number, number][], seg: number) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg)

/**
 * The hero, standing on y = 0 at the origin, facing +z, HERO_HEIGHT tall. Its tick breathes, turns the hood a little,
 * swings the lantern and flickers its light; while `userData.moving` is set on the root it walks in place (a stride's
 * bob and sway, a lean, the lantern swinging wider), easing in and out.
 */
export function makeHero(): THREE.Group {
  const cloth = mat(COLOR.cloak, { flat: true, rough: 0.92 })
  const metal = mat(COLOR.metal, { flat: true, metal: 0.6, rough: 0.5 })
  const leather = mat(COLOR.leather, { flat: true })

  const root = new THREE.Group()
  root.name = 'hero'
  // The figure: everything but the hood and the lantern, which move on their own.
  const fig = new THREE.Group()
  fig.scale.setScalar(K)
  root.add(fig)

  // The cloak, with a ragged hem.
  const cloak = geo('hero-cloak', () => {
    const g = lathe([[0, 0.03], [0.205, 0.03], [0.215, 0.07], [0.18, 0.28], [0.15, 0.48], [0.135, 0.6], [0.09, 0.68], [0, 0.7]], 11)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.05) p.setY(i, p.getY(i) + jitter(i) * 0.06)
    g.computeVertexNormals()
    return g
  })
  fig.add(part(cloak, cloth))
  fig.add(part(geo('hero-mantle', () => lathe([[0, 0.73], [0.12, 0.69], [0.185, 0.6], [0.2, 0.5], [0.17, 0.49]], 9)), mat(COLOR.mantle, { flat: true })))
  fig.add(part(torus(0.075, 0.032, 5, 9), mat(COLOR.scarf, { flat: true }), [0, 0.705, 0], [Math.PI / 2, 0, 0]))
  // The arm, the hand on the staff, the staff and its hook.
  fig.add(rod([0.14, 0.64, 0], [0.2, 0.5, 0.1], 0.045, 0.04, cloth))
  fig.add(part(sphere(0.035, 6, 5), mat(COLOR.hand, { flat: true }), [0.205, 0.49, 0.1]))
  fig.add(rod([0.2, 0.02, 0.12], [0.215, 1.1, 0.09], 0.016, 0.02, mat(COLOR.wood, { flat: true })))
  fig.add(rod([0.215, 1.1, 0.09], [0.3, 1.13, 0.1], 0.015, 0.012, metal))
  fig.add(rod([0.3, 1.13, 0.1], [0.33, 1.08, 0.1], 0.012, 0.01, metal))
  // The satchel and its strap, and the boots.
  fig.add(part(box(0.09, 0.1, 0.05), leather, [-0.19, 0.34, 0.04], [0, 0, 0.15]))
  fig.add(rod([-0.17, 0.4, 0.05], [0.1, 0.66, 0.08], 0.008, 0.008, leather))
  for (const s of [-1, 1]) fig.add(part(box(0.07, 0.06, 0.12), mat(COLOR.boot, { flat: true }), [s * 0.07, 0.03, 0.05]))

  // The hood over a dark void of a face, its point falling behind.
  const head = new THREE.Group()
  head.position.y = 0.8
  head.add(part(sphere(0.1, 9, 7), cloth, [0, 0, 0], [0, 0, 0], [1, 1.18, 1.08]))
  head.add(part(cone(0.06, 0.14, 6), cloth, [0, 0.06, -0.08], [-1.1, 0, 0]))
  head.add(part(sphere(0.07, 8, 6), mat(COLOR.void, { flat: true, rough: 1 }), [0, -0.01, 0.055], [0, 0, 0], [1, 1.15, 0.7]))
  fig.add(head)

  // The lantern hanging from the hook: an iron cap and foot round panes the ember lights from inside, a halo and the
  // light itself.
  const lantern = new THREE.Group()
  lantern.position.set(0.33, 1.08, 0.1)
  lantern.add(rod([0, 0, 0], [0, -0.06, 0], 0.004, 0.004, metal))
  lantern.add(part(cone(0.05, 0.04, 6), metal, [0, -0.045, 0]))
  lantern.add(part(geo('hero-panes', () => new THREE.CylinderGeometry(0.036, 0.042, 0.085, 6)), mat('#ffb45a', { emissive: '#ff8a32', glow: 3, rough: 0.4, flat: true }), [0, -0.105, 0]))
  lantern.add(part(geo('hero-foot', () => new THREE.CylinderGeometry(0.046, 0.04, 0.014, 6)), metal, [0, -0.152, 0]))
  const halo = glow('#ff9a4a', HALO, 0.7)
  halo.position.y = -0.105
  lantern.add(halo)
  const light = new THREE.PointLight(LIGHT.color, LIGHT.intensity, LIGHT.distance, LIGHT.decay)
  light.position.y = -0.105
  lantern.add(light)
  fig.add(lantern)

  // The concept's motion: every period divides 4 s. `w(k)` is k cycles per 4 s.
  const w = (k: number) => (Math.PI * 2 * k) / 4
  return rig(root, (pick) => {
    const r = pick(root)
    const f = pick(fig)
    const h = pick(head)
    const l = pick(lantern)
    const glowing = pick(halo)
    const lamp = pick(light)
    let walk = 0
    let stride = 0
    return (t, dt) => {
      // The walk eases in and out over about a tenth of a second.
      walk += ((r.userData.moving ? 1 : 0) - walk) * Math.min(1, dt * 10)
      if (walk > 0.001) stride += dt * 17
      const breath = Math.sin(t * w(2))
      f.scale.set(K, K * (1 + breath * 0.012), K)
      f.position.y = Math.abs(Math.sin(stride)) * 0.035 * walk
      f.rotation.x = 0.08 * walk
      f.rotation.z = Math.sin(stride) * 0.03 * walk
      h.position.y = 0.8 + breath * 0.006
      h.rotation.y = Math.sin(t * w(1)) * 0.12 * (1 - walk)
      l.rotation.z = Math.sin(t * w(2)) * 0.18 + Math.sin(stride) * 0.3 * walk
      l.rotation.x = Math.sin(t * w(1) + 1) * 0.08 - 0.25 * walk + Math.cos(stride) * 0.12 * walk
      const flicker = 1 + Math.sin(t * w(7)) * 0.08 + Math.sin(t * w(11)) * 0.05
      lamp.intensity = LIGHT.intensity * flicker
      glowing.scale.setScalar(HALO * (0.9 + 0.1 * flicker))
    }
  })
}

/** The cloak's edge: a cool, faint rim where its surfaces turn away from the camera, so the figure reads on dark ground. */
const RIM = { color: new THREE.Color('#8fa0b8'), strength: 0.2, power: 4 }
/** The see-through silhouette: an additive ember glow where the ground or a Landmark hides the hero. */
const SILHOUETTE = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#ff8a3a').multiplyScalar(0.45),
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthFunc: THREE.GreaterDepth,
  fog: false,
})

const rims = new Map<THREE.Material, THREE.Material>()

/** `m` with the cloak's rim added (its own program, shared by every hero copy); a lit surface's colour is unchanged. */
function rimOf(m: THREE.MeshStandardMaterial): THREE.Material {
  const had = rims.get(m)
  if (had) return had
  const out = m.clone()
  out.onBeforeCompile = (shader, renderer) => {
    m.onBeforeCompile(shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
// The rim: grazing surfaces light up a little (not the void of the face, nor the near-black boots).
float td_rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), ${RIM.power.toFixed(2)});
totalEmissiveRadiance += vec3(${RIM.color.r.toFixed(4)}, ${RIM.color.g.toFixed(4)}, ${RIM.color.b.toFixed(4)}) * ${RIM.strength.toFixed(3)} * td_rim * step(0.02, max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b));`,
    )
  }
  out.customProgramCacheKey = () => `${m.customProgramCacheKey()}|td-hero-rim`
  rims.set(m, out)
  return out
}

/**
 * Dresses a copy of the hero (kit `copyModel`) for the world: its lit parts take the cloak's rim, and each gets a
 * see-through twin drawn just before it (SILHOUETTE, depth test reversed), so wherever terrain, plants or a Landmark
 * stand between the camera and the hero an ember outline shows through. The twins draw after the rest of the scene's
 * solid things (render order 1) and the hero after them (2), so the hero never shows through itself.
 */
export function dressHero(copy: THREE.Group): THREE.Group {
  const meshes: THREE.Mesh[] = []
  copy.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  for (const m of meshes) {
    const own = m.material as THREE.MeshStandardMaterial
    if (own.isMeshStandardMaterial) m.material = rimOf(own)
    m.renderOrder = 2
    const twin = new THREE.Mesh(m.geometry, SILHOUETTE)
    twin.position.copy(m.position)
    twin.quaternion.copy(m.quaternion)
    twin.scale.copy(m.scale)
    twin.matrix.copy(m.matrix)
    twin.matrixAutoUpdate = m.matrixAutoUpdate
    twin.renderOrder = 1
    twin.castShadow = twin.receiveShadow = false
    m.parent!.add(twin)
  }
  return copy
}
