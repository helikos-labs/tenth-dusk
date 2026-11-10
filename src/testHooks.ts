// Test hooks (window.__worldReady, __tap, __run, __world3d and the like) are exposed only when the URL has ?test=1,
// in any build (R6): every e2e script loads its page with it.
export const TEST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1'

/** ?perf=1 shows the performance overlay (ui/PerfOverlay.tsx), in any build. */
export const PERF = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1'

/** The window as the test hooks see it. */
export const hooks = (typeof window !== 'undefined' ? window : {}) as unknown as Record<string, unknown>

/**
 * With ?perf=1, `&off=` switches render features off to find a slow phone's bottleneck (aa, shadows, plants, mist, water,
 * and the shader parts in PERF_GLSL: border, blend, grain;
 * comma-separated) and `&dpr=` caps the pixel ratio (0.5 to 2). Without ?perf=1 both are ignored.
 */
const perfParams = typeof window !== 'undefined' && PERF ? new URLSearchParams(window.location.search) : null
export const PERF_OFF: ReadonlySet<string> = new Set((perfParams?.get('off') ?? '').split(',').filter(Boolean))
const askedDpr = Number(perfParams?.get('dpr'))
export const PERF_DPR: number | null = askedDpr >= 0.5 && askedDpr <= 2 ? askedDpr : null

/** What the overlay shows about the renderer, written by the scene's probe (?perf=1 only). */
export const perfStats = { gpu: '', triangles: 0, calls: 0, width: 0, height: 0, ratio: 0 }

/**
 * GLSL defines for the shader switches in `&off=` (?perf=1 only): border (a province's six border distances and the
 * rim), blend (the fog's blend with the neighbours' states) and grain (cloud shade, rock grain and snow ripples).
 * Guarded, so a shader that includes it twice compiles.
 */
export const PERF_GLSL = ['border', 'blend', 'grain']
  .filter((k) => PERF_OFF.has(k))
  .map((k) => `#ifndef TD_OFF_${k.toUpperCase()}\n#define TD_OFF_${k.toUpperCase()}\n#endif`)
  .join('\n')
