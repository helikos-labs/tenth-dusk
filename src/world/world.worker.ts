// Copied from helikos-labs/rift-and-root@7f00e23 src/board3d/world.worker.ts, adapted for Tenth Dusk.
// The world worker: builds the 3D board's terrain, water and plants off the main thread (worldBuild.ts). It keeps one
// builder, so each board after the first costs only what changed; the arrays go back to the main thread without a
// copy (useWorld.ts swaps them into the meshes).
import { WorldBuilder, transferables, type WorldReply, type WorldRequest } from './worldBuild.ts'

/** The worker's side of the channel (typed here, as the app's TypeScript setup has the DOM's types, not a worker's). */
const port = self as unknown as {
  onmessage: ((e: MessageEvent<WorldRequest>) => void) | null
  postMessage(message: WorldReply, transfer: Transferable[]): void
}

let builder: WorldBuilder | null = null

port.onmessage = (e) => {
  const { id, board, detail } = e.data
  if (!builder || builder.detail !== detail) builder = new WorldBuilder(detail)
  try {
    const update = builder.build(board)
    port.postMessage({ id, update }, transferables(update))
  } catch (err) {
    // Start afresh next time: the next board is built in full.
    builder = null
    port.postMessage({ id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) }, [])
  }
}
