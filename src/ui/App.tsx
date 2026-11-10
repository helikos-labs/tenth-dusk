// Temporary (Tasks 8 to 11): chapter 1 for seed REACH1 with a run of its own, so the hero can walk. A first tap on a
// reachable hex previews its path; a second tap on the same hex walks it, a move every STEP_SECONDS, until it arrives
// or the run refuses a move; a tap anywhere else replaces the preview (or clears it). Task 13's useGame replaces this.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHAPTER1 } from '../data/book1.ts'
import { generateZone } from '../rules/gen.ts'
import { key, type Off } from '../rules/hex.ts'
import { move, newRun, type RunState } from '../rules/run.ts'
import WorldScene, { STEP_SECONDS } from '../scenes/WorldScene.tsx'
import { reachable } from '../scenes/reach.ts'
import { zoneToWorld } from '../world/adapter.ts'
import { SMALL_SCREEN, detailFor } from '../world/useWorld.ts'

export default function App() {
  const zone = useMemo(() => generateZone(CHAPTER1, 'REACH1'), [])
  const world = useMemo(() => zoneToWorld(zone), [zone])
  const detail = useMemo(() => detailFor(SMALL_SCREEN), [])
  const [run, setRun] = useState<RunState>(() => newRun(zone, 'Wren'))
  const [preview, setPreview] = useState<Off[] | null>(null)
  const walking = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(walking.current ?? undefined), [])

  const walk = useCallback((from: RunState, path: Off[]) => {
    let s = from
    let i = 1
    const next = () => {
      const after = move(s, path[i])
      if (after === s) {
        walking.current = null
        setPreview(null)
        return
      }
      s = after
      setRun(s)
      i++
      if (i >= path.length) {
        walking.current = null
        setPreview(null)
        return
      }
      setPreview(path.slice(i - 1))
      walking.current = window.setTimeout(next, STEP_SECONDS * 1000)
    }
    next()
  }, [])

  const onTap = useCallback(
    (o: Off) => {
      if (walking.current !== null) return
      const end = preview?.[preview.length - 1]
      if (preview && end && key(end) === key(o)) walk(run, preview)
      else setPreview(reachable(run).get(key(o)) ?? null)
    },
    [run, preview, walk],
  )

  return <WorldScene run={run} world={world} preview={preview} onTap={onTap} detail={detail} />
}
