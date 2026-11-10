// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/models/slices.ts, adapted for Tenth Dusk.
// The 3D board's background work, in slices between frames: Slicer runs jobs (generators that stop once their slice is
// up, as kit.ts `prepare` does) a few milliseconds at a time, and ModelQueue prepares the model kinds through it, the
// ones the board shows first. No React or DOM beyond MessageChannel, so tests run it under Node.
import type * as THREE from 'three'
import { prepare, prepared, type Slice } from './kit.ts'

/** A model as the board keys it: the key it is cached by, and its maker. */
export interface ModelSpec {
  key: string
  make: () => THREE.Group
}

/** How long one slice of background work runs before it gives the thread back (milliseconds). */
export const SLICE_MS = 8

/**
 * Background work in slices: queued jobs (generators that yield once the slice is up) run for up to `ms` at a time,
 * the urgent ones first, each to its end before the next starts; then the thread is given back for a task (a
 * MessageChannel message), so frames, input and the world worker's updates go on between slices and no task runs long.
 * Stopped, it keeps its jobs until it is started again. A job that throws is dropped (and the error logged).
 */
export class Slicer {
  /** The current slice: jobs stop once its end has passed. */
  readonly slice: Slice = { end: 0 }
  private readonly ms: number
  private readonly urgent: Iterator<unknown>[] = []
  private readonly later: Iterator<unknown>[] = []
  private posted = false
  /** The channel a slice's task comes through, while the slicer runs. */
  private channel: MessageChannel | null = null

  constructor(ms = SLICE_MS) {
    this.ms = ms
  }

  /** Queues a job; an urgent one goes ahead of every job that is not. */
  add(job: Iterator<unknown>, urgent: boolean) {
    ;(urgent ? this.urgent : this.later).push(job)
    this.post()
  }

  /** Moves a job queued as not urgent ahead of those. */
  hurry(job: Iterator<unknown>) {
    const i = this.later.indexOf(job)
    if (i < 0) return
    this.later.splice(i, 1)
    this.urgent.push(job)
  }

  /** Whether any job is queued. */
  get busy(): boolean {
    return this.urgent.length + this.later.length > 0
  }

  start() {
    if (this.channel) return
    const channel = (this.channel = new MessageChannel())
    channel.port1.onmessage = () => {
      this.posted = false
      if (this.channel === channel) this.run()
    }
    this.posted = false
    this.post()
  }

  /** Stops after the current slice; the jobs wait for `start`. */
  stop() {
    this.channel?.port1.close()
    this.channel = null
  }

  private post() {
    if (!this.channel || this.posted || !this.busy) return
    this.posted = true
    this.channel.port2.postMessage(0)
  }

  private run() {
    this.slice.end = performance.now() + this.ms
    while (performance.now() < this.slice.end) {
      const list = this.urgent.length ? this.urgent : this.later
      const job = list[0]
      if (!job) break
      let done = true
      try {
        done = !!job.next().done
      } catch (e) {
        console.error(e)
      }
      if (done) list.shift()
    }
    this.post()
  }
}

/**
 * The model kinds a board prepares (kit.ts templates) through a Slicer: the kinds the board shows as soon as it wants
 * them (`want`), then every other kind it is given (`specs`, in the order given, by `all`), so a piece turning up in
 * play finds its kind ready.
 * `onReady` is called as each kind becomes ready, with whether the board wants it. A kind whose maker throws is
 * `failed` (logged): settled, but never ready, so the board shows without its pieces rather than not at all.
 */
export class ModelQueue {
  private readonly jobs = new Map<string, Iterator<unknown>>()
  private readonly wanted = new Set<string>()
  private readonly failures = new Set<string>()
  private readonly slicer: Slicer
  private readonly specs: ModelSpec[]
  private readonly onReady: (key: string, wanted: boolean) => void

  constructor(slicer: Slicer, specs: ModelSpec[], onReady: (key: string, wanted: boolean) => void) {
    this.slicer = slicer
    this.specs = specs
    this.onReady = onReady
  }

  /** The kinds the board shows: prepared ahead of every other kind. */
  want(specs: ModelSpec[]) {
    for (const s of specs) {
      if (prepared(s.key) || this.wanted.has(s.key)) continue
      this.wanted.add(s.key)
      const job = this.jobs.get(s.key)
      if (job) this.slicer.hurry(job)
      else this.queue(s, true)
    }
  }

  /** Every kind the queue was given, behind the ones the board wants. */
  all() {
    for (const s of this.specs) if (!prepared(s.key) && !this.jobs.has(s.key)) this.queue(s, false)
  }

  /** Whether a kind's preparation failed. */
  failed(key: string): boolean {
    return this.failures.has(key)
  }

  private queue(spec: ModelSpec, urgent: boolean) {
    const { slicer, wanted, failures, onReady } = this
    const job = (function* () {
      try {
        yield* prepare(spec.key, spec.make, slicer.slice)
      } catch (e) {
        console.error(e)
        failures.add(spec.key)
      }
      onReady(spec.key, wanted.has(spec.key))
    })()
    this.jobs.set(spec.key, job)
    slicer.add(job, urgent)
  }
}
