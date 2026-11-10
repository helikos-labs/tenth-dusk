// Temporary (Task 8): shows the world of chapter 1 for seed REACH1, under the fog of a new run's start (Task 10).
// Task 13 replaces it with the game's screens.
import { useMemo } from 'react'
import { CHAPTER1 } from '../data/book1.ts'
import { generateZone } from '../rules/gen.ts'
import { newRun } from '../rules/run.ts'
import WorldScene from '../scenes/WorldScene.tsx'
import { zoneToWorld } from '../world/adapter.ts'
import { SMALL_SCREEN, detailFor } from '../world/useWorld.ts'

export default function App() {
  const { world, fog } = useMemo(() => {
    const zone = generateZone(CHAPTER1, 'REACH1')
    return { world: zoneToWorld(zone), fog: newRun(zone, 'Wren').fog }
  }, [])
  const detail = useMemo(() => detailFor(SMALL_SCREEN), [])
  return <WorldScene world={world} detail={detail} fog={fog} />
}
