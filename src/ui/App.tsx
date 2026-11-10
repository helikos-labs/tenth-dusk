// Temporary (Task 8): shows the world of chapter 1 for seed REACH1. Task 13 replaces it with the game's screens.
import { useMemo } from 'react'
import { CHAPTER1 } from '../data/book1.ts'
import { generateZone } from '../rules/gen.ts'
import WorldScene from '../scenes/WorldScene.tsx'
import { zoneToWorld } from '../world/adapter.ts'
import { SMALL_SCREEN, detailFor } from '../world/useWorld.ts'

export default function App() {
  const world = useMemo(() => zoneToWorld(generateZone(CHAPTER1, 'REACH1')), [])
  const detail = useMemo(() => detailFor(SMALL_SCREEN), [])
  return <WorldScene world={world} detail={detail} />
}
