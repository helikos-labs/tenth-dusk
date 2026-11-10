// The zone's world: the world core's terrain, water, plants and roads (src/world/) under a dusk sky, the Lampwright and
// the Landmarks in it, seen from a portrait camera that follows the hero (§4, §15.3, §15.5). Beyond the wall ring lies
// the Hush, dark slate in fog; there is no tray. The fog of war (§15.4) dims what the hero hasn't seen, under a mist;
// Landmarks show once seen, dimmed while only remembered. Wherever the ground or a Landmark stands between the camera
// and the hero, an ember silhouette of the hero shows through (hero.ts `dressHero`). A tap on the ground names a hex
// (`onTap`); the hexes the steps left can reach glow, and a path preview runs as a thin lantern-coloured tube; the
// hero walks each move the run makes, 0.35 s a hex.
//
// Nothing is drawn before its shaders are compiled (materials.ts warmUp): the world shows once every program it draws
// with (ground, its shadow depth, water, plants and theirs, fog-patched roads, mist, Landmarks lit and remembered, the
// hero's rim and silhouette, the path) is compiled on stand-ins, so neither the first frame nor the first tap stops to
// compile. The lantern is the scene's one point light, there from the start, so the programs compiled ahead are the
// ones drawn.
//
// On phones (SMALL_SCREEN) the scene draws on demand: 30 frames a second while only idle animation runs, every frame
// while the hero walks, the camera eases or a pinch zooms; the shadows redraw only when something changes.
// oxlint-disable react/immutability -- three.js objects (the camera, fog, lights, uniforms and shadow map) change in place.
import { Canvas, addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { distance, toAxial, toOffset, type Off } from '../rules/hex.ts'
import type { RunState } from '../rules/run.ts'
import type { LandmarkKind } from '../rules/zone.ts'
import { PERF, PERF_DPR, PERF_OFF, TEST, hooks, perfStats } from '../testHooks.ts'
import type { WorldCell } from '../world/adapter.ts'
import { SQRT3, WATER_LEVEL, buildField, hexAt, hexCenter, type Field, type Pt } from '../world/field.ts'
import { writeFog } from '../world/fog.ts'
import { dryInside, placeInside } from '../world/layout.ts'
import {
  DEPTH,
  SLOTS,
  TEXELS,
  boardShape,
  castShadows,
  fogPatch,
  makeStateTexture,
  makeTerrainDepthMaterial,
  makeTerrainMaterial,
  makeWaterMaterial,
  noWarpTexture,
  warmDepth,
  warmUp,
} from '../world/materials.ts'
import { makeMist } from '../world/mist.ts'
import { copyModel, prepareNow, prepared, templateOf, ticksOf } from '../world/models/kit.ts'
import { ROAD, buildRoads } from '../world/roads.ts'
import { hexIndex, writeCells } from '../world/terrainMesh.ts'
import { SMALL_SCREEN, useWorld, useWorldClient } from '../world/useWorld.ts'
import type { WorldClient } from '../world/worldClient.ts'
import ContextWatch from './ContextWatch.tsx'
import { HERO_HEIGHT, dressHero, makeHero } from './models/hero.ts'
import { dimLandmark, makeLandmark } from './models/landmarks.ts'
import { reachable } from './reach.ts'

export interface WorldSceneProps {
  /** The run: the hero's hex, the steps left, the fog of war (`run.fog`), the lit beacons. */
  run: RunState
  world: Record<string, WorldCell>
  /** The path preview, the hero's hex first (rules/run.ts `path`), or none. */
  preview: Off[] | null
  /** A tap on the ground: the hex under it (offset coordinates). */
  onTap: (o: Off) => void
  /** Mesh and plant density (useWorld.ts detailFor). */
  detail: number
  /**
   * Called once the world has been drawn (when `window.__worldReady` is set, R4), with when this view mounted and
   * began to build it (performance.now() ms): for the performance overlay, and to end "Restoring the world…".
   */
  onReady?: (startedAt: number) => void
  /** The WebGL context was lost (ContextWatch.tsx). */
  onLost?: () => void
  /** The lost context is back: remount the scene to rebuild it (§16). */
  onRestored?: () => void
}

/** The Hush beyond the walls: the fog's colour and the sky's. */
export const DUSK = '#141a24'
/**
 * The follow camera (§4): it looks down at `pitch` degrees with a vertical field of view of `fov`, at the hero kept
 * `heroAt` of the way down the screen, easing after them with a half-life of `halfLife` seconds. At the default zoom
 * a hex at the hero is `hexPx` CSS pixels wide (at least 44 pt, §1 S4), so a phone shows about 8 hexes across, and
 * never more than `across` on a wide screen; pinching zooms between `zoom[0]` and `zoom[1]` times that.
 */
const CAMERA = { pitch: 60, fov: 35, heroAt: 0.62, halfLife: 0.25, hexPx: 50, across: 9, zoom: [0.7, 2] as const }
/** Fog from this share of the camera's distance to the hero to this share (none nearer, all beyond). */
const FOG = { near: 1.2, far: 2.2 }
/** The low warm sun: the direction it shines from, its colour and strength. */
const SUN = new THREE.Vector3(-9, 12, 5)
const SUN_COLOR = 0xffe0c0
const SUN_INTENSITY = 2.1
/** Sky and ground of the hemisphere light. */
const HEMI = { sky: 0x8ea3c2, ground: 0x2a221d, intensity: 0.75 }
/** The models' sizes in the world (the hero is HERO_HEIGHT tall before it; a hex has circumradius 1). */
const SCALE = { hero: 2.4, landmark: 1 }
/** The hero's walk: seconds per hex. */
export const STEP_SECONDS = 0.35
/** Where the hero stands on a Landmark's hex (offset from its centre, to its right), clear of the Landmark. */
const BESIDE: Pt = { x: 0.5, z: 0.18 }
/** The path preview: a tube this far above the ground, this thick, glowing the lantern's colour. */
const TUBE = { lift: 0.25, radius: 0.028, color: '#ffcf8a', glow: '#ff9a40', intensity: 1.8 }
/** On phones the scene draws on demand, at this rate while only idle animation runs (Throttle), and every frame
 * while the hero walks or the camera eases after them. */
const IDLE_FPS = 30
/** Stand-ins compiled per task while compiling ahead (each may be a new program). */
const COMPILE_BATCH = 4
/** A pointer that moves less than this (CSS px) and lifts within TAP_MS is a tap. */
const TAP_PX = 10
const TAP_MS = 600

/** The model kinds the scene shows: the hero, and each Landmark kind (a beacon lit and dead). */
const LANDMARK_KINDS: LandmarkKind[] = ['start', 'hearth', 'beacon', 'camp', 'hamlet', 'cave', 'ruins', 'pass']
const landmarkKey = (kind: LandmarkKind, lit: boolean) => `td-landmark-${kind}${lit ? '-lit' : ''}`
const HERO_KEY = 'td-hero'

/** Prepares (builds and bakes, kit `prepare`) every model kind the scene shows, once. */
function prepareModels() {
  const kinds: [string, () => THREE.Group][] = [[HERO_KEY, makeHero]]
  for (const k of LANDMARK_KINDS) {
    kinds.push([landmarkKey(k, false), () => makeLandmark(k)])
    if (k === 'beacon') kinds.push([landmarkKey(k, true), () => makeLandmark(k, true)])
  }
  for (const [key, make] of kinds) {
    if (prepared(key)) continue
    prepareNow(key, make)
    // Copies share the template's shadow depth materials.
    castShadows(templateOf(key)!)
  }
  return kinds.map(([key]) => key)
}

export default function WorldScene({ run, world, preview, onTap, detail, onReady, onLost, onRestored }: WorldSceneProps) {
  // The world worker gets the board at once, so the first build runs while the canvas is set up.
  const client = useWorldClient(world, detail)
  const [startedAt] = useState(() => performance.now())
  return (
    <div style={{ position: 'fixed', inset: 0, background: DUSK, touchAction: 'none' }} role="img" aria-label="The zone">
      <Canvas
        frameloop={SMALL_SCREEN ? 'demand' : 'always'}
        // PCF soft shadows: three.js r186 removed PCFSoftShadowMap (it falls back with a warning); its PCF is the soft
        // one. They redraw only when something changes (ShadowRefresh).
        shadows={PERF_OFF.has('shadows') ? false : { type: THREE.PCFShadowMap, autoUpdate: false }}
        dpr={PERF_DPR ?? [1, SMALL_SCREEN ? 1.6 : 2]}
        camera={{ fov: CAMERA.fov, near: 0.5, far: 400 }}
        gl={{ antialias: !PERF_OFF.has('aa'), powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
        }}
      >
        <Scene world={world} client={client} run={run} preview={preview} onTap={onTap} onReady={onReady && (() => onReady(startedAt))} />
        {SMALL_SCREEN && <Throttle fps={IDLE_FPS} />}
        <ContextWatch onLost={onLost} onRestored={onRestored} />
        {PERF && <PerfProbe />}
      </Canvas>
    </div>
  )
}

interface SceneProps {
  world: Record<string, WorldCell>
  client: WorldClient
  run: RunState
  preview: Off[] | null
  onTap: (o: Off) => void
  onReady?: () => void
}

function Scene({ world, client, run, preview, onTap, onReady }: SceneProps) {
  const gl = useThree((st) => st.gl)
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera
  const scene = useThree((st) => st.scene)
  const size = useThree((st) => st.size)
  const invalidate = useThree((st) => st.invalidate)
  const field = useMemo(() => buildField(world), [world])
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uState: { value: makeStateTexture(SLOTS) },
      uStateSize: { value: SLOTS * TEXELS },
      uHint: { value: new THREE.Color('#e8c56a') },
      uSun: { value: SUN.clone().normalize() },
      uRect: { value: new THREE.Vector4() },
      uRim: { value: new THREE.Vector4() },
      // The world's warp comes with the world worker's first build (useWorld); none until then.
      uWarp: { value: noWarpTexture() },
      uWarpBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      uInner: { value: new THREE.Vector4() },
      uBounds: { value: new THREE.Vector4() },
    }),
    [],
  )
  useLayoutEffect(() => {
    const { rect, rim } = boardShape(world, field.bounds)
    uniforms.uRect.value.copy(rect)
    uniforms.uRim.value.copy(rim)
    const { inner: i, ...b } = field.bounds
    uniforms.uInner.value.set(i.minX, i.minZ, i.maxX, i.maxZ)
    uniforms.uBounds.value.set(b.minX, b.minZ, b.maxX, b.maxZ)
  }, [world, field, uniforms])

  // Per-hex state for the shaders: each hex's terrain and Landmark (texel 1), then its fog and whether the steps left
  // reach it (texel 2), rewritten whenever the run changes; nothing is rebuilt, but the shadows redraw (hidden ground
  // and plants cast none). Only in-sight hexes are ever reachable (reach.ts), so no highlight falls on the unseen.
  const shadows = useRef(true)
  const slots = useMemo(() => hexIndex(world), [world])
  const walls = useMemo(() => new Set(Object.values(world).filter((c) => c.wall).map((c) => offKey(c))), [world])
  const reach = useMemo(() => new Set(reachable(run).keys()), [run])
  useLayoutEffect(() => writeCells(uniforms.uState.value, slots, world), [uniforms, slots, world])
  useLayoutEffect(() => {
    writeFog(uniforms.uState.value, slots, run.fog, walls, reach)
    shadows.current = true
    invalidate()
  }, [uniforms, slots, walls, run.fog, reach, invalidate])

  const { terrain, plants } = useWorld(client, uniforms, () => (shadows.current = true))
  // The roads take the fog too: their shared materials, cloned once per scene and patched (materials.ts fogPatch).
  const roadMaterials = useMemo(() => new Map<THREE.Material, THREE.Material>(), [])
  useEffect(() => () => roadMaterials.forEach((m) => m.dispose()), [roadMaterials])
  const roads = useMemo(() => {
    const g = buildRoads(field, world)
    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const shared = mesh.material as THREE.Material
      let m = roadMaterials.get(shared)
      if (!m) {
        m = shared.clone()
        fogPatch(m, uniforms, 'road')
        roadMaterials.set(shared, m)
      }
      mesh.material = m
    })
    return g
  }, [field, world, uniforms, roadMaterials])
  useEffect(() => {
    shadows.current = true
    return () => (roads.userData.dispose as () => void)()
  }, [roads])
  const materials = useMemo(
    () => ({
      terrain: makeTerrainMaterial(uniforms),
      terrainDepth: makeTerrainDepthMaterial(uniforms),
      water: makeWaterMaterial(uniforms),
      tube: new THREE.MeshStandardMaterial({ color: TUBE.color, emissive: TUBE.glow, emissiveIntensity: TUBE.intensity, roughness: 0.6 }),
    }),
    [uniforms],
  )
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials])
  const mist = useMemo(() => makeMist(uniforms), [uniforms])
  useEffect(
    () => () => {
      mist.geometry.dispose()
      ;(mist.material as THREE.Material).dispose()
    },
    [mist],
  )

  // The models: every kind prepared once; the hero is one copy, each Landmark another.
  const modelKeys = useMemo(() => prepareModels(), [])
  const hero = useMemo(() => dressHero(copyModel(HERO_KEY)), [])
  const ground = useMemo(() => groundOf(field, world), [field, world])
  const spotOf = useMemo(() => {
    return (o: Off): THREE.Vector3 => {
      const { q, r } = toAxial(o)
      const cell = world[`${q},${r}`]
      const p = cell?.landmark ? placeInside(field, { q, r }, BESIDE) : dryInside(field, { q, r })
      return new THREE.Vector3(p.x, ground(p.x, p.z), p.z)
    }
  }, [field, world, ground])
  const landmarks = useMemo(
    () =>
      Object.values(world)
        .filter((c) => c.landmark && !c.wall)
        .map((c) => {
          const p = hexCenter(c.q, c.r)
          return { key: offKey(c), kind: c.landmark as LandmarkKind, at: new THREE.Vector3(p.x, ground(p.x, p.z), p.z) }
        }),
    [world, ground],
  )
  // A Landmark shows once its hex has been seen (remembered or in sight); hidden in the unseen and the sunk (§15.4).
  const shownKey = landmarks
    .filter((l) => (run.fog.get(l.key) ?? 0) >= 2)
    .map((l) => l.key + (run.lit.includes(l.key) ? '*' : '') + (run.fog.get(l.key) === 2 ? '~' : ''))
    .join(' ')
  useLayoutEffect(() => {
    shadows.current = true
  }, [shownKey])

  // Compiling ahead (see the top of this file), a few programs per task, from the task after the mount.
  const [compiled, setCompiled] = useState(false)
  useEffect(() => {
    let live = true
    const go = async () => {
      await nextTask()
      if (!live) return
      // Shadow depth: the shared casters', the ground's (sunk by the fog) and the plants' (hidden by it).
      const depth: THREE.Mesh[] = [standIn(materials.terrainDepth, ['normal', 'aCoast'])]
      for (const o of plants.standIns().children) {
        const m = o as THREE.InstancedMesh
        const d = m.customDepthMaterial
        if (!m.castShadow || !d || Object.values(DEPTH).includes(d as THREE.MeshDepthMaterial)) continue
        const s = new THREE.InstancedMesh(m.geometry, d, 1)
        if (m.instanceColor) s.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3)
        depth.push(s)
      }
      const waits: Promise<unknown>[] = [warmDepth(gl, camera, scene, depth)]
      const tube = standIn(materials.tube, ['normal'])
      tube.castShadow = tube.receiveShadow = false
      const stands: THREE.Object3D[] = [
        standIn(materials.terrain, ['normal', 'color', 'aRock', 'aCoast']),
        noShadows(standIn(materials.water, ['aDepth'])),
        ...plants.standIns().children,
        ...[...roadMaterials.values()].map((m) => noCast(standIn(m, ['normal']))),
        mist,
        tube,
        // Every model kind as built, and dimmed as remembered (the Landmarks).
        ...modelKeys.map((k) => (k === HERO_KEY ? lightsOff(dressHero(copyModel(k))) : copyModel(k))),
        ...modelKeys.filter((k) => k !== HERO_KEY).map((k) => {
          const c = copyModel(k)
          dimLandmark(c, true)
          return c
        }),
      ]
      for (let i = 0; i < stands.length; i += COMPILE_BATCH) {
        await nextTask()
        if (!live) return
        for (const s of stands.slice(i, i + COMPILE_BATCH)) waits.push(warmUp(gl, s, camera, scene))
      }
      await Promise.all(waits)
      // Each program's first use, a program a task: three.js reads its link status and uniforms then, which waits for
      // the driver to finish linking it; without KHR_parallel_shader_compile (SwiftShader, some phones) compileAsync
      // can't wait for that, and the first frame to draw with a program (the path preview, a Landmark first seen)
      // stalled in play.
      for (const p of gl.info.programs ?? []) {
        await nextTask()
        if (!live) return
        p.getUniforms()
      }
      if (live) setCompiled(true)
    }
    go()
    return () => {
      live = false
    }
  }, [gl, camera, scene, materials, plants, roadMaterials, mist, modelKeys])
  const shown = !!terrain && compiled
  // The hero shows with the world. Its light stays on from the start (a hidden parent would hide it from the light
  // set, and every program would recompile when it came back): only its meshes and halo hide.
  useLayoutEffect(() => {
    hero.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) o.visible = shown
    })
  }, [hero, shown])
  useLayoutEffect(() => {
    if (!shown) return
    shadows.current = true
    const timings = hooks.__world3d as { revealed: number } | undefined
    if (timings && !timings.revealed) timings.revealed = performance.now()
  }, [shown])

  // The path preview: a tube through each hex's spot, sampled along the ground so it follows hills and dips.
  const tube = useMemo(() => {
    if (!preview || preview.length < 2) return null
    const spots = preview.map(spotOf)
    const pts: THREE.Vector3[] = []
    const SUB = 6
    for (let i = 0; i < spots.length - 1; i++)
      for (let j = 0; j < SUB || (i === spots.length - 2 && j === SUB); j++) {
        const p = spots[i].clone().lerp(spots[i + 1], j / SUB)
        p.y = ground(p.x, p.z) + TUBE.lift
        pts.push(p)
      }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, TUBE.radius, 6, false)
  }, [preview, spotOf, ground])
  useEffect(() => () => tube?.dispose(), [tube])

  // The hero walks to each hex the run moves to, STEP_SECONDS a hex; a jump of more than one hex (a fall, a push at
  // dawn) is a cut. The camera follows (`follow`).
  const walk = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null)
  const lastAt = useRef<Off | null>(null)
  useLayoutEffect(() => {
    const to = spotOf(run.at)
    const was = lastAt.current
    lastAt.current = run.at
    if (!was || distance(was, run.at) > 1) {
      walk.current = null
      hero.position.copy(to)
      if (!was) hero.rotation.y = 0.4
      return
    }
    if (distance(was, run.at) === 0) return
    walk.current = { from: hero.position.clone(), to, t: 0 }
    hero.rotation.y = Math.atan2(to.x - hero.position.x, to.z - hero.position.z)
    invalidate()
  }, [run.at, spotOf, hero, invalidate])

  const zoom = useRef(1)
  const focus = useRef<THREE.Vector3 | null>(null)
  const target = useMemo(() => new THREE.Vector3(), [])
  const drawn = useRef(0)
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    uniforms.uTime.value = t
    const w = walk.current
    if (w) {
      w.t = Math.min(1, w.t + dt / STEP_SECONDS)
      hero.position.lerpVectors(w.from, w.to, w.t)
      hero.position.y = ground(hero.position.x, hero.position.z)
      if (w.t >= 1) walk.current = null
      shadows.current = true
    }
    hero.userData.moving = !!walk.current
    for (const tick of ticksOf(hero)) tick(t, dt)
    // The camera eases after the hero (its middle), with a half-life of CAMERA.halfLife.
    target.copy(hero.position)
    target.y += (HERO_HEIGHT * SCALE.hero) / 2
    if (!focus.current) focus.current = target.clone()
    else focus.current.lerp(target, 1 - Math.pow(2, -dt / CAMERA.halfLife))
    follow(camera, scene, focus.current, state.size, zoom.current)
    // The first frame with the world in it, then the next: the world has been drawn (R4).
    if (shown && drawn.current < 2 && ++drawn.current === 2) {
      if (TEST) hooks.__worldReady = true
      onReady?.()
    }
    // While the hero walks or the camera eases, every frame is drawn (on phones the scene draws on demand).
    if (w || focus.current.distanceToSquared(target) > 1e-4) invalidate()
  })

  // Taps and pinches on the canvas. A tap raycasts to the ground, finds the province under the point through the warp
  // (`hexAt(warp(point))`) and reports its hex; two fingers pinch the zoom (the wheel too, on a desktop).
  const terrainMesh = useRef<THREE.Mesh>(null)
  /** The Landmark copies the scene shows, each with its hex: a tap on one names its hex, not the ground behind it. */
  const picks = useMemo(() => new Map<THREE.Object3D, Off>(), [])
  const tapRef = useRef(onTap)
  useLayoutEffect(() => {
    tapRef.current = onTap
  }, [onTap])
  useEffect(() => {
    const el = gl.domElement
    const down = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>()
    let pinch: { d0: number; z0: number } | null = null
    let pinched = false
    const spread = () => {
      const [a, b] = [...down.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const clampZoom = (z: number) => Math.min(CAMERA.zoom[1], Math.max(CAMERA.zoom[0], z))
    const ray = new THREE.Raycaster()
    let t0 = 0
    const tap = (x: number, y: number) => {
      t0 = performance.now()
      const mesh = terrainMesh.current
      if (!mesh) return
      const r = el.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera)
      const ground = ray.intersectObject(mesh, false)[0]
      // A Landmark in front of the ground there (one that shows; its solid parts, not a fire's halo) names its hex.
      const shownLandmarks = [...picks.keys()].filter((o) => o.visible)
      const mark = ray.intersectObjects(shownLandmarks, true).find((h) => (h.object as THREE.Mesh).isMesh)
      if (mark && (!ground || mark.distance < ground.distance)) {
        let o: THREE.Object3D | null = mark.object
        while (o && !picks.has(o)) o = o.parent
        if (o) return report(picks.get(o)!, 'landmark')
      }
      if (!ground) return
      const w = field.warp(ground.point.x, ground.point.z)
      report(toOffset(hexAt(w.x, w.z)), 'ground')
    }
    const report = (o: Off, via: 'landmark' | 'ground') => {
      // With the time the raycast and pick took (ms).
      if (TEST) hooks.__lastTap = { ...o, via, ms: performance.now() - t0 }
      tapRef.current(o)
    }
    const onDown = (e: PointerEvent) => {
      down.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() })
      if (down.size === 1) pinched = false
      if (down.size === 2) {
        pinch = { d0: Math.max(1, spread()), z0: zoom.current }
        pinched = true
      }
    }
    const onMove = (e: PointerEvent) => {
      const p = down.get(e.pointerId)
      if (!p) return
      p.x = e.clientX
      p.y = e.clientY
      if (pinch && down.size === 2) {
        zoom.current = clampZoom((pinch.z0 * spread()) / pinch.d0)
        invalidate()
      }
    }
    const onUp = (e: PointerEvent) => {
      const p = down.get(e.pointerId)
      down.delete(e.pointerId)
      if (down.size < 2) pinch = null
      if (!p || pinched || e.type === 'pointercancel') return
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_PX && performance.now() - p.t0 < TAP_MS) tap(e.clientX, e.clientY)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoom.current = clampZoom(zoom.current * Math.exp(-e.deltaY * 0.0015))
      invalidate()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, camera, field, picks, invalidate])

  // Test hooks (?test=1, R6): tap a hex, read the run, the preview, the reachable hexes, the hex the last real tap
  // named and whether a Landmark or the ground named it (`__lastTap`), and the hero's place, and project a point at the height of a hex's centre (offset dx, dz from
  // it, dy above it) to the screen (CSS px), to measure hexes there or tap them.
  useLayoutEffect(() => {
    if (!TEST) return
    hooks.__run = run
    hooks.__preview = preview
    hooks.__reach = [...reach]
  }, [run, preview, reach])
  useEffect(() => {
    if (!TEST) return
    hooks.__tap = (row: number, col: number) => tapRef.current({ row, col })
    hooks.__heroAt = () => hero.position.toArray()
    // The shader programs compiled so far (none should be added in play).
    hooks.__programs = () => gl.info.programs?.length ?? 0
    hooks.__project = (row: number, col: number, dx = 0, dz = 0, dy = 0) => {
      const { q, r } = toAxial({ row, col })
      const c = hexCenter(q, r)
      const v = new THREE.Vector3(c.x + dx, ground(c.x, c.z) + dy, c.z + dz).project(camera)
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height]
    }
  }, [hero, ground, camera, size, gl])

  return (
    <>
      <Sky />
      <Lights field={field} />
      <primitive object={hero} scale={SCALE.hero} dispose={null} />
      <group visible={shown}>
        {terrain && (
          <mesh
            ref={terrainMesh}
            geometry={terrain.surface}
            material={materials.terrain}
            customDepthMaterial={materials.terrainDepth}
            receiveShadow
            castShadow
            matrixAutoUpdate={false}
          />
        )}
        {terrain?.water && <mesh geometry={terrain.water} material={materials.water} renderOrder={2} visible={!PERF_OFF.has('water')} matrixAutoUpdate={false} />}
        <primitive object={plants.group} visible={!PERF_OFF.has('plants')} dispose={null} />
        <primitive object={roads} dispose={null} />
        {landmarks.map((l) => (
          <Landmark key={l.key} hex={l.key} kind={l.kind} lit={run.lit.includes(l.key)} at={l.at} fog={run.fog.get(l.key) ?? 0} picks={picks} />
        ))}
        {tube && <mesh geometry={tube} material={materials.tube} />}
        {terrain && <primitive object={mist} visible={!PERF_OFF.has('mist')} dispose={null} />}
      </group>
      <ShadowRefresh need={shadows} />
    </>
  )
}

/**
 * A Landmark: a copy of its kind, shown once its hex has been seen (§15.4), dimmed while only remembered (§5.2), and
 * ticking (a fire's flicker) while it shows.
 */
function Landmark(props: { hex: string; kind: LandmarkKind; lit: boolean; at: THREE.Vector3; fog: number; picks: Map<THREE.Object3D, Off> }) {
  const { hex, kind, lit, at, fog, picks } = props
  const model = useMemo(() => copyModel(landmarkKey(kind, kind === 'beacon' && lit)), [kind, lit])
  const shown = fog >= 2
  useLayoutEffect(() => {
    const [row, col] = hex.split(',').map(Number)
    picks.set(model, { row, col })
    return () => {
      picks.delete(model)
    }
  }, [picks, model, hex])
  useLayoutEffect(() => dimLandmark(model, fog === 2), [model, fog])
  useFrame((state, dt) => {
    if (!shown) return
    for (const tick of ticksOf(model)) tick(state.clock.elapsedTime, dt)
  })
  return <primitive object={model} position={at} scale={SCALE.landmark} visible={shown} dispose={null} />
}

/** A world cell's rules key, offset "row,col" (rules/hex.ts). */
const offKey = (c: WorldCell) => {
  const o = toOffset(c)
  return `${o.row},${o.col}`
}

/** The height things stand at on the ground: on the water's surface over water, on the deck on a crossing. */
function groundOf(field: Field, world: Record<string, WorldCell>) {
  return (x: number, z: number) => {
    const h = Math.max(field.height(x, z), WATER_LEVEL)
    const { q, r } = hexAt(x, z)
    return world[`${q},${r}`]?.road === 'bridge' ? Math.max(h, ROAD.deck) : h
  }
}

const tmpEuler = new THREE.Euler()

/**
 * Places the follow camera: pitched CAMERA.pitch down, with `focus` CAMERA.heroAt of the way down the screen, from as
 * far as makes a hex there CAMERA.hexPx wide (at most CAMERA.across hexes across the screen) at zoom 1; the fog runs
 * from FOG.near to FOG.far of that distance, in the Hush's colour.
 */
function follow(camera: THREE.PerspectiveCamera, scene: THREE.Scene, focus: THREE.Vector3, size: { width: number; height: number }, zoom: number) {
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const tanX = tanY * (size.width / Math.max(1, size.height))
  const across = Math.min(CAMERA.across, size.width / CAMERA.hexPx) / zoom
  // The view depth at which `across` hexes (√3 wide each) span the screen, and the focus's angle below the view axis.
  const depth = (across * SQRT3) / (2 * tanX)
  const below = Math.atan((2 * CAMERA.heroAt - 1) * tanY)
  const down = THREE.MathUtils.degToRad(CAMERA.pitch) + below
  const dist = depth / Math.cos(below)
  camera.position.set(focus.x, focus.y + dist * Math.sin(down), focus.z + dist * Math.cos(down))
  camera.quaternion.setFromEuler(tmpEuler.set(-THREE.MathUtils.degToRad(CAMERA.pitch), 0, 0))
  const far = dist * FOG.far + 50
  if (Math.abs(camera.far - far) > 0.5) {
    camera.far = far
    camera.updateProjectionMatrix()
  }
  const fog = scene.fog as THREE.Fog | null
  if (fog) {
    fog.near = dist * FOG.near
    fog.far = dist * FOG.far
  }
}

/** The sky and the fog, in the Hush's colour (`follow` sets the fog's range). */
function Sky() {
  const scene = useThree((st) => st.scene)
  useLayoutEffect(() => {
    scene.background = new THREE.Color(DUSK)
    scene.fog = new THREE.Fog(DUSK, 40, 80)
  }, [scene])
  return null
}

/** The low warm sun (with soft shadows over the whole board) and the cool hemisphere light. */
function Lights({ field }: { field: Field }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const b = field.bounds
  const centre = useMemo(() => new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), [b])
  const reach = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 1
  useLayoutEffect(() => {
    const s = sun.current
    if (!s) return
    s.position.copy(centre).addScaledVector(SUN.clone().normalize(), reach + 10)
    s.target.position.copy(centre)
    s.target.updateMatrixWorld()
    const size = SMALL_SCREEN ? 1024 : 2048
    s.shadow.mapSize.set(size, size)
    const cam = s.shadow.camera as THREE.OrthographicCamera
    cam.left = -reach
    cam.right = reach
    cam.top = reach
    cam.bottom = -reach
    cam.near = 1
    cam.far = 2 * reach + 20
    cam.updateProjectionMatrix()
    s.shadow.bias = -0.0004
    s.shadow.normalBias = 0.025
  }, [centre, reach])
  return (
    <>
      <hemisphereLight args={[HEMI.sky, HEMI.ground, HEMI.intensity]} />
      <directionalLight ref={sun} color={SUN_COLOR} intensity={SUN_INTENSITY} castShadow />
    </>
  )
}

/** Draws the scene at `fps` on demand (phones): idle animation (the lantern's flicker, the wind) at a steady rate. */
function Throttle({ fps }: { fps: number }) {
  const invalidate = useThree((st) => st.invalidate)
  useEffect(() => {
    const id = setInterval(() => invalidate(), 1000 / fps)
    return () => clearInterval(id)
  }, [invalidate, fps])
  return null
}

/** ?perf=1: records the GPU's name and the last frame's triangles, draw calls and drawing size for the overlay. */
function PerfProbe() {
  const gl = useThree((st) => st.gl)
  useEffect(() => {
    const ctx = gl.getContext()
    const ext = ctx.getExtension('WEBGL_debug_renderer_info')
    perfStats.gpu = String(ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER))
  }, [gl])
  useEffect(
    () =>
      addAfterEffect(() => {
        perfStats.triangles = gl.info.render.triangles
        perfStats.calls = gl.info.render.calls
        perfStats.width = gl.domElement.width
        perfStats.height = gl.domElement.height
        perfStats.ratio = gl.getPixelRatio()
      }),
    [gl],
  )
  return null
}

/** Shadows redraw (three.js renders the shadow map) only when something changed, not every frame. */
function ShadowRefresh({ need }: { need: { current: boolean } }) {
  useFrame(({ gl }) => {
    if (!need.current) return
    need.current = false
    gl.shadowMap.needsUpdate = true
  })
  return null
}

/** Waits for the next task, so long work split into steps leaves frames room in between. */
const nextTask = () => new Promise<void>((done) => setTimeout(done, 0))

/** A one-triangle stand-in drawn with `material` and the attributes it reads, for compiling its program ahead. */
function standIn(material: THREE.Material, extra: string[]): THREE.Mesh {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  for (const name of extra) g.setAttribute(name, name === 'color' || name === 'normal' ? new THREE.BufferAttribute(new Float32Array(9), 3) : new THREE.BufferAttribute(new Float32Array(3), 1))
  const m = new THREE.Mesh(g, material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}
/** A stand-in with its own lights off: compiling gathers the lights of the scene and of the stand-in, and the scene
 * already holds the hero's lantern. */
const lightsOff = (o: THREE.Object3D) => {
  o.traverse((c) => {
    if ((c as THREE.Light).isLight) c.visible = false
  })
  return o
}
const noShadows = (m: THREE.Mesh) => {
  m.castShadow = m.receiveShadow = false
  return m
}
const noCast = (m: THREE.Mesh) => {
  m.castShadow = false
  return m
}
