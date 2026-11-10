// Whether this browser can create a WebGL 2 context, which three.js r186 needs (§15.3, R25). Asked once, before the
// world is mounted; the probe's context is released at once.
export function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}
