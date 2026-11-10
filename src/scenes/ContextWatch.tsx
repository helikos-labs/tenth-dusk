// A lost WebGL context (§16, R25): the scene reports the loss (and keeps the browser's default, which would give up on
// the context, from happening) and the context's return, when the app remounts the scene to rebuild it from the run.
// With ?test=1, window.__loseContext() loses the context through WEBGL_lose_context and restores it TEST_RESTORE_MS
// later, so the e2e can check the scene comes back (it clears window.__worldReady, set again once the new scene draws).
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { TEST, hooks } from '../testHooks.ts'

const TEST_RESTORE_MS = 600

export default function ContextWatch({ onLost, onRestored }: { onLost?: () => void; onRestored?: () => void }) {
  const gl = useThree((st) => st.gl)
  useEffect(() => {
    const el = gl.domElement
    const lost = (e: Event) => {
      e.preventDefault()
      onLost?.()
    }
    const restored = () => onRestored?.()
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restored)
    if (TEST) {
      hooks.__loseContext = () => {
        const ext = gl.getContext().getExtension('WEBGL_lose_context')
        if (!ext) return false
        hooks.__worldReady = false
        ext.loseContext()
        window.setTimeout(() => ext.restoreContext(), TEST_RESTORE_MS)
        return true
      }
    }
    return () => {
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', restored)
    }
  }, [gl, onLost, onRestored])
  return null
}
