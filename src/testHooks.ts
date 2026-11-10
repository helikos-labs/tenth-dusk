// Test hooks (window.__worldReady, __tap, __run, __world3d and the like) are exposed only when the URL has ?test=1,
// in any build (R6): every e2e script loads its page with it.
export const TEST = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1'

/** The window as the test hooks see it. */
export const hooks = (typeof window !== 'undefined' ? window : {}) as unknown as Record<string, unknown>
