// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/useWorld.ts, adapted for Tenth Dusk.
// The 3D board's world on the main thread. The terrain mesh, water and plants are built in the world worker
// (world.worker.ts, worldBuild.ts): in full when the board mounts, while the scene's backdrop already shows, then only
// what changed when hexes change terrain or a Landmark comes or goes. `useWorldClient` sends the boards from outside
// the canvas, so the first build starts before the scene is set up; `useWorld` swaps the results into the meshes in
// place, so no frame waits on a build.
import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { TEST, hooks } from '../testHooks.ts'
import type { WorldCell } from './adapter.ts'
import { makeWarpTexture, warpBoxUniform, type FogUniforms } from './materials.ts'
import { applyTerrain, type TerrainGeometry } from './terrainMesh.ts'
import { PlantMeshes } from './vegetation.ts'
import type { WorldUpdate } from './worldBuild.ts'
import { WorldClient } from './worldClient.ts'

/** A phone, a small screen or a device with few cores: lower mesh detail (`detailFor`) and a lighter render. */
export const SMALL_SCREEN = typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 700px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4)

/**
 * Mesh and plant density for this device: 1 on desktops; 0.75 on phones and small or few-core screens (`small`,
 * SMALL_SCREEN); 0.6 on weak phones, told apart cheaply: a small screen with at most 4 cores and a pixel
 * ratio of at most 2 (budget hardware), or a browser that reports 2 GB of memory or less. `?detail=` (0.5 to 1)
 * overrides it, to look at a tier on a desktop.
 */
export function detailFor(small: boolean): number {
  if (typeof window === 'undefined') return 1
  const asked = Number(new URLSearchParams(window.location.search).get('detail'))
  if (asked >= 0.5 && asked <= 1) return asked
  if (!small) return 1
  const nav = navigator as Navigator & { deviceMemory?: number }
  const phone = window.matchMedia?.('(max-width: 700px)').matches ?? false
  const weak = (phone && (nav.hardwareConcurrency ?? 8) <= 4 && (window.devicePixelRatio ?? 1) <= 2) || (nav.deviceMemory ?? 8) <= 2
  return weak ? 0.6 : 0.75
}

/** What the world shows of a board: each hex's terrain, and whether a Landmark keeps a clearing there. */
const worldKey = (board: Record<string, WorldCell>) =>
  Object.values(board)
    .map((c) => `${c.q},${c.r}${c.terrain[0]}${c.landmark ? '+' : ''}`)
    .sort()
    .join(' ')

/**
 * The world worker's client for a board view: it sends the board when the view mounts and again whenever the ground
 * or a clearing changes (not for every step the hero takes), and closes with the view. Call it outside the canvas.
 */
export function useWorldClient(board: Record<string, WorldCell>, detail: number): WorldClient {
  const [client] = useState(() => new WorldClient())
  const key = useMemo(() => worldKey(board), [board])
  useLayoutEffect(() => {
    client.start(detail)
    return () => client.close()
  }, [client, detail])
  useLayoutEffect(() => {
    client.send(board)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, detail, key])
  return client
}

/** One applied update, for browser checks: the builder's time, the main thread's, and how much was redone. */
interface Timing {
  full: boolean
  workerMs: number
  applyMs: number
  verts: number
  probed: number
  provinces: number
}

/** What the board shows of the world: from `useWorld`. */
export interface World {
  /** The terrain and water geometry: null until the first build lands. */
  terrain: TerrainGeometry | null
  /** The plants' instanced meshes (made once; each update refills them). */
  plants: PlantMeshes
  /** The seed of the warp in `uniforms.uWarp` (the world worker sends it with a world's first build): null till then. */
  warp: number | null
}

/**
 * The world from `client`'s updates: each is swapped into the meshes in place (or the first one wrapped), the warp the
 * worker baked goes into `uniforms.uWarp`, and `changed` is called after each. Timings go to `window.__world3d` for
 * browser checks: when the first board went to the worker and when its world was applied (performance.now()), and
 * each update's cost (with ?test=1 only, R6); the scene adds when the world first showed (`revealed`).
 */
export function useWorld(
  client: WorldClient,
  uniforms: { uTime: { value: number }; uWarp: { value: THREE.DataTexture }; uWarpBox: { value: THREE.Vector4 } } & Partial<FogUniforms>,
  changed: () => void,
): World {
  const invalidate = useThree((st) => st.invalidate)
  const [plants] = useState(() => new PlantMeshes(uniforms))
  const [terrain, setTerrain] = useState<TerrainGeometry | null>(null)
  const [warp, setWarp] = useState<number | null>(null)
  const live = useRef<TerrainGeometry | null>(null)
  const [timings] = useState(() => ({ sent: 0, shown: 0, revealed: 0, updates: [] as Timing[] }))
  useEffect(() => {
    if (TEST) hooks.__world3d = timings
  }, [timings])
  const apply = useRef<(u: WorldUpdate) => void>(() => {})
  useLayoutEffect(() => {
    apply.current = (u) => {
      const t0 = performance.now()
      if (u.warp) {
        uniforms.uWarp.value = makeWarpTexture(u.warp.seed, u.warp.data, u.warp.box)
        warpBoxUniform(uniforms.uWarp.value, uniforms.uWarpBox.value)
        setWarp(u.warp.seed)
      }
      if (u.terrain) {
        const g = applyTerrain(live.current, u.terrain)
        if (g !== live.current) {
          live.current = g
          setTerrain(g)
        }
      }
      if (u.plants) plants.set(u.plants)
      changed()
      invalidate()
      const s = u.stats
      timings.updates.push({ full: u.full, workerMs: s.ms, applyMs: performance.now() - t0, verts: s.verts, probed: s.probed, provinces: s.provinces })
      if (timings.updates.length > 40) timings.updates.shift()
      timings.sent ||= client.sentAt
      timings.shown ||= performance.now()
    }
  })
  useLayoutEffect(() => client.listen((u) => apply.current(u)), [client])
  useEffect(
    () => () => {
      terrain?.surface.dispose()
      terrain?.water?.dispose()
    },
    [terrain],
  )
  useEffect(() => () => plants.dispose(), [plants])
  return { terrain, plants, warp }
}
