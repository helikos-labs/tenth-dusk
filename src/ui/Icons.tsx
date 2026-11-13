// The four woodcut icons (ART-DIRECTION §4.4): one inline SVG sprite, mounted once in App, and `Icon` to use one.
// 32-unit viewBox, stroke 1.8, round joins, in the plate's pale ink; ember only on the tent's smoke.
export type IconName = 'boot' | 'tent' | 'satchel' | 'book'

const INK = '#e3d3b0'

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <symbol id="td-i-boot" viewBox="0 0 32 32">
        <path d="M10 4h8v12l7 4c2 1 3 3 3 5v2H5v-6l2-3V8z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M5 25h23M10 10h6M10 14h6" stroke={INK} strokeWidth="1.3" />
      </symbol>
      <symbol id="td-i-tent" viewBox="0 0 32 32">
        <path d="M16 4 4 27h24z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 4v23M16 16l-4 11M16 16l4 11M2 27h28" stroke={INK} strokeWidth="1.3" />
        <path d="M22 6c1 2-1 3 0 5" stroke="#ff9a4a" strokeWidth="1.3" fill="none" />
      </symbol>
      <symbol id="td-i-satchel" viewBox="0 0 32 32">
        <path d="M6 12h20v14H6z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6 12c0-4 4-7 10-7s10 3 10 7M6 16h20M16 16v5" stroke={INK} strokeWidth="1.3" fill="none" />
        <circle cx="16" cy="21" r="1.4" fill={INK} />
      </symbol>
      <symbol id="td-i-book" viewBox="0 0 32 32">
        <path d="M16 8c-3-2-7-3-11-2v19c4-1 8 0 11 2 3-2 7-3 11-2V6c-4-1-8 0-11 2z" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M16 8v19M8 11h5M8 15h5M19 11h5M19 15h5" stroke={INK} strokeWidth="1.1" />
      </symbol>
    </svg>
  )
}

export function Icon({ name, size = 32 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <use href={`#td-i-${name}`} />
    </svg>
  )
}
