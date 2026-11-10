// The zone's world: the world core's terrain, water, plants and roads (src/world/) under a dusk sky, seen from a
// portrait camera that fits the zone's width (§15.3, §15.5). Beyond the wall ring lies the Hush, dark slate in fog;
// there is no tray. Task 11 adds the hero, Landmarks, the follow camera and tapping.
// oxlint-disable react/immutability -- three.js objects (the camera, fog, lights, uniforms and shadow map) change in place.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { WorldCell } from '../world/adapter.ts'
import { buildField, type Field } from '../world/field.ts'
import { SLOTS, TEXELS, boardShape, makeStateTexture, makeTerrainMaterial, makeWaterMaterial, noWarpTexture } from '../world/materials.ts'
import { buildRoads } from '../world/roads.ts'
import { SMALL_SCREEN, useWorld, useWorldClient } from '../world/useWorld.ts'
import type { WorldClient } from '../world/worldClient.ts'

export interface WorldSceneProps {
  world: Record<string, WorldCell>
  /** Mesh and plant density (useWorld.ts detailFor). */
  detail: number
}

/** The Hush beyond the walls: the fog's colour and the sky's. */
export const DUSK = '#141a24'
/** The camera looks down at this pitch (degrees below the horizon), with this vertical field of view. */
const PITCH = 55
const FOV = 35
/** Fog from this share of the camera's distance to its target to this share (none nearer, all beyond). */
const FOG = { near: 1.2, far: 2.2 }
/** The low warm sun: the direction it shines from, its colour and strength. */
const SUN = new THREE.Vector3(-9, 12, 5)
const SUN_COLOR = 0xffe0c0
const SUN_INTENSITY = 2.1
/** Sky and ground of the hemisphere light. */
const HEMI = { sky: 0x8ea3c2, ground: 0x2a221d, intensity: 0.75 }
/** Test hooks (window.__worldReady) only with ?test=1 in the URL (R6). */
const TEST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1'

export default function WorldScene({ world, detail }: WorldSceneProps) {
  // The world worker gets the board at once, so the first build runs while the canvas is set up.
  const client = useWorldClient(world, detail)
  return (
    <div style={{ position: 'fixed', inset: 0, background: DUSK, touchAction: 'none' }} role="img" aria-label="The zone">
      <Canvas
        // PCF soft shadows: three.js r186 removed PCFSoftShadowMap (it falls back with a warning); its PCF is the soft
        // one. They redraw only when the world changes (ShadowRefresh).
        shadows={{ type: THREE.PCFShadowMap, autoUpdate: false }}
        dpr={[1, SMALL_SCREEN ? 1.6 : 2]}
        camera={{ fov: FOV, near: 0.5, far: 400 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
        }}
      >
        <Scene world={world} client={client} />
      </Canvas>
    </div>
  )
}

function Scene({ world, client }: { world: Record<string, WorldCell>; client: WorldClient }) {
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
    }),
    [],
  )
  useLayoutEffect(() => {
    const { rect, rim } = boardShape(world, field.bounds)
    uniforms.uRect.value.copy(rect)
    uniforms.uRim.value.copy(rim)
  }, [world, field, uniforms])

  const shadows = useRef(true)
  const { terrain, plants } = useWorld(client, uniforms, () => (shadows.current = true))
  const roads = useMemo(() => buildRoads(field, world), [field, world])
  useEffect(() => {
    shadows.current = true
    return () => (roads.userData.dispose as () => void)()
  }, [roads])
  const materials = useMemo(() => ({ terrain: makeTerrainMaterial(uniforms), water: makeWaterMaterial(uniforms) }), [uniforms])
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials])

  // The first frame with the world in it, then the next: the world has been drawn (R4).
  const drawn = useRef(0)
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
    if (!terrain || drawn.current > 1) return
    if (++drawn.current > 1 && TEST) (window as unknown as { __worldReady?: boolean }).__worldReady = true
  })

  return (
    <>
      <Dusk field={field} />
      <Lights field={field} />
      {terrain && <mesh geometry={terrain.surface} material={materials.terrain} receiveShadow castShadow matrixAutoUpdate={false} />}
      {terrain?.water && <mesh geometry={terrain.water} material={materials.water} renderOrder={2} matrixAutoUpdate={false} />}
      <primitive object={plants.group} dispose={null} />
      <primitive object={roads} dispose={null} />
      <ShadowRefresh need={shadows} />
    </>
  )
}

/**
 * The portrait camera, the sky and the fog: the camera looks down at PITCH onto the middle of the zone, from as far as
 * makes the zone's width (its non-wall hexes, `bounds.inner`) span the screen; the fog runs from FOG.near to FOG.far
 * of that distance, in the Hush's colour.
 */
function Dusk({ field }: { field: Field }) {
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera
  const scene = useThree((st) => st.scene)
  const size = useThree((st) => st.size)
  const invalidate = useThree((st) => st.invalidate)
  useLayoutEffect(() => {
    const inner = field.bounds.inner
    const target = new THREE.Vector3((inner.minX + inner.maxX) / 2, 0, (inner.minZ + inner.maxZ) / 2)
    const aspect = size.width / Math.max(1, size.height)
    const halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect
    const dist = (inner.maxX - inner.minX) / 2 / halfH
    const pitch = THREE.MathUtils.degToRad(PITCH)
    camera.position.set(target.x, target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(pitch))
    camera.up.set(0, 1, 0)
    camera.lookAt(target)
    camera.far = dist * FOG.far + 50
    camera.updateProjectionMatrix()
    scene.background = new THREE.Color(DUSK)
    scene.fog = new THREE.Fog(DUSK, dist * FOG.near, dist * FOG.far)
    invalidate()
  }, [field, camera, scene, size, invalidate])
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

/** Shadows redraw (three.js renders the shadow map) only when the world changed, not every frame. */
function ShadowRefresh({ need }: { need: { current: boolean } }) {
  useFrame(({ gl }) => {
    if (!need.current) return
    need.current = false
    gl.shadowMap.needsUpdate = true
  })
  return null
}
