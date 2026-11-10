// Temporary (Task 8): shows the world of chapter 1 for seed REACH1. Task 13 replaces it with the game's screens.
import { useMemo } from 'react'
import { CHAPTER1 } from '../data/book1.ts'
import { generateZone } from '../rules/gen.ts'
import WorldScene from '../scenes/WorldScene.tsx'
import { zoneToWorld } from '../world/adapter.ts'
import { detailFor } from '../world/useWorld.ts'

const SMALL_SCREEN = typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 700px)').matches || (navigator.hardwareConcurrency ?? 8) <= 4)

export default function App() {
  const world = useMemo(() => zoneToWorld(generateZone(CHAPTER1, 'REACH1')), [])
  const detail = useMemo(() => detailFor(SMALL_SCREEN), [])
  return <WorldScene world={world} detail={detail} />
}
