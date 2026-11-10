// The performance overlay (?perf=1, §1 S3): frames per second (a 1-second average), the worst frame in the last 10 s
// (the longest gap between two drawn frames), the long tasks (main-thread tasks over 100 ms, from
// PerformanceObserver('longtask')) in all and since the world was ready, and the time from navigation to the world
// being ready (and from the world's start, which leaves out the time spent on the title screens). For the phone check:
// open https://tenth-dusk.helikos.dev/?perf=1 and walk. The numbers are also on the element's data attributes, for
// tests/e2e/perf.mjs.
import { addAfterEffect } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { PERF_DPR, PERF_OFF, perfStats } from '../testHooks.ts'

/** A long task is a main-thread task over this (ms). */
const LONG_MS = 100
/** The worst frame is the worst in this window (ms). */
const WORST_WINDOW_MS = 10_000
/** The overlay redraws this often (ms). */
const REFRESH_MS = 500

interface Numbers {
  fps: number
  worst: number
  long: number
  longInPlay: number
}

/**
 * `startAt` is when the world began to build and `readyAt` when it was ready (performance.now() ms, null until
 * then); navigation is performance.now() 0.
 */
export default function PerfOverlay({ startAt, readyAt }: { startAt: number | null; readyAt: number | null }) {
  const [n, setN] = useState<Numbers>({ fps: 0, worst: 0, long: 0, longInPlay: 0 })
  const ready = useRef(readyAt)
  useEffect(() => {
    ready.current = readyAt
  }, [readyAt])
  useEffect(() => {
    // Each drawn frame's time (the canvas draws after every R3F frame callback has run).
    const frames: number[] = []
    const off = addAfterEffect((t) => {
      frames.push(t)
      while (frames.length && frames[0] < t - WORST_WINDOW_MS) frames.shift()
    })
    const longs: number[] = []
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration > LONG_MS) longs.push(e.startTime)
      })
      observer.observe({ type: 'longtask', buffered: true })
    } catch {
      // No long-task timing in this browser (Safari): the count stays 0.
    }
    const id = setInterval(() => {
      const now = performance.now()
      let worst = 0
      for (let i = 1; i < frames.length; i++) worst = Math.max(worst, frames[i] - frames[i - 1])
      const fps = frames.filter((t) => t > now - 1000).length
      const r = ready.current
      setN({ fps, worst, long: longs.length, longInPlay: r === null ? 0 : longs.filter((s) => s >= r).length })
    }, REFRESH_MS)
    return () => {
      off()
      observer?.disconnect()
      clearInterval(id)
    }
  }, [])

  const fromStart = readyAt === null || startAt === null ? null : readyAt - startAt
  return (
    <div
      className="td-perf"
      data-perf=""
      data-fps={n.fps}
      data-worst={n.worst.toFixed(0)}
      data-long={n.long}
      data-long-in-play={n.longInPlay}
      data-world={readyAt === null ? undefined : readyAt.toFixed(0)}
      data-world-from-start={fromStart === null ? undefined : fromStart.toFixed(0)}
      aria-hidden="true"
    >
      <span>{n.fps} fps</span>
      <span>worst {n.worst.toFixed(0)} ms</span>
      <span>
        long {n.long} ({n.longInPlay} in play)
      </span>
      <span>{readyAt === null ? 'world …' : `world ${(readyAt / 1000).toFixed(1)} s (${((fromStart ?? 0) / 1000).toFixed(1)} s)`}</span>
      <span>
        {(perfStats.triangles / 1000).toFixed(0)}k tris · {perfStats.calls} calls
      </span>
      <span>
        {perfStats.width}×{perfStats.height} @{perfStats.ratio.toFixed(2)}
        {PERF_DPR === null ? '' : ' (dpr set)'}
      </span>
      <span>off: {PERF_OFF.size ? [...PERF_OFF].join(',') : 'none'}</span>
      <span className="td-perf-gpu">{perfStats.gpu || 'gpu …'}</span>
    </div>
  )
}
