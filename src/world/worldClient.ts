// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/worldClient.ts, adapted for Tenth Dusk.
// The main thread's end of the world worker (world.worker.ts): it sends boards and hands back updates (worldBuild.ts),
// one build at a time. No React or three.js here, so tests can drive it (where there are no workers, it builds on
// this thread).
import type { WorldCell } from './adapter.ts'
import { WorldBuilder, mergeUpdates, type WorldReply, type WorldRequest, type WorldUpdate } from './worldBuild.ts'

type Board = Record<string, WorldCell>

interface Port {
  post(req: WorldRequest): void
  close(): void
}

/** The world worker, or null where workers can't start. */
function workerPort(receive: (r: WorldReply) => void, fail: () => void): Port | null {
  if (typeof Worker === 'undefined') return null
  let worker: Worker
  try {
    worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  worker.onmessage = (e: MessageEvent<WorldReply>) => receive(e.data)
  worker.onerror = (e) => {
    e.preventDefault()
    fail()
  }
  worker.onmessageerror = () => fail()
  return { post: (req) => worker.postMessage(req), close: () => worker.terminate() }
}

/** The same builder on this thread, a task later (so the table and tray draw first). */
function localPort(receive: (r: WorldReply) => void): Port {
  let builder: WorldBuilder | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    post(req) {
      timer = setTimeout(() => {
        if (!builder || builder.detail !== req.detail) builder = new WorldBuilder(req.detail)
        try {
          receive({ id: req.id, update: builder.build(req.board) })
        } catch (err) {
          builder = null
          receive({ id: req.id, error: String(err) })
        }
      })
    },
    close: () => clearTimeout(timer),
  }
}

/**
 * Sends boards to the world worker with one build in flight at a time. Boards that come in meanwhile wait, and only
 * the latest goes next; a result that a newer board has overtaken is stale, so it is held back and folded into the
 * next one (mergeUpdates) rather than shown. Results wait for a listener, so the first build can start before the
 * scene that shows it is up. If the worker can't start or fails, it builds on this thread from then on (`local`
 * starts it there).
 */
export class WorldClient {
  /** When the current world's first board was sent (performance.now()), for timings. */
  sentAt = 0
  private port: Port | null = null
  private local: boolean
  private detail = 1
  private listener: ((u: WorldUpdate) => void) | null = null
  private delivered = false
  private id = 0
  private busy = false
  private next: Board | null = null
  private held: WorldUpdate | null = null
  private last: Board | null = null

  constructor(local = false) {
    this.local = local
  }

  /** The mesh detail to build at (send boards after). */
  start(detail: number) {
    this.detail = detail
  }

  /**
   * Where updates go; returns the way to stop listening. Updates that land before anyone listens wait. A listener that
   * comes after updates went to another (a scene mounted again) has no world yet, so it gets the world rebuilt in full,
   * never an update held for the last one (an update patches the meshes it was built against).
   */
  listen(fn: (u: WorldUpdate) => void): () => void {
    this.listener = fn
    if (this.delivered) this.rebuild()
    else this.flush()
    return () => {
      if (this.listener === fn) this.listener = null
    }
  }

  /** Shows `board`: a full build first, then updates. */
  send(board: Board) {
    if (board === this.last) return
    this.last = board
    if (this.busy) this.next = board
    else this.post(board)
  }

  /** Stops building and drops whatever is in flight; the next board sent starts afresh. */
  close() {
    this.port?.close()
    this.port = null
    this.busy = false
    this.next = null
    this.held = null
    this.last = null
    this.delivered = false
    this.sentAt = 0
  }

  private post(board: Board) {
    this.port ??= (!this.local && workerPort(this.receive, this.fail)) || localPort(this.receive)
    this.sentAt ||= performance.now()
    this.busy = true
    this.port.post({ id: ++this.id, board, detail: this.detail })
  }

  private receive = (reply: WorldReply) => {
    if (reply.id !== this.id || !this.busy) return
    this.busy = false
    if (reply.update) this.held = this.held ? mergeUpdates(this.held, reply.update) : reply.update
    else console.error('3D board: building the world failed', reply.error)
    if (this.next) {
      const board = this.next
      this.next = null
      this.post(board)
      return
    }
    this.flush()
  }

  /** Hands what is held to the listener, once nothing newer is being built. */
  private flush() {
    if (!this.listener || this.busy || !this.held) return
    const u = this.held
    this.held = null
    this.delivered = true
    this.listener(u)
  }

  /** Starts the world afresh from the latest board: a full build. */
  private rebuild() {
    const board = this.last
    this.close()
    if (board) this.send(board)
  }

  private fail = () => {
    this.port?.close()
    this.port = null
    this.local = true
    // The local builder starts from scratch, with a full build of the latest board.
    this.held = null
    this.busy = false
    const board = this.next ?? this.last
    this.next = null
    if (board) this.post(board)
  }
}
