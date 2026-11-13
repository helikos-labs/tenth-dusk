// The printed page the title, naming, chapter and notice screens are set on (ART-DIRECTION §4.3): a vellum leaf with a
// double rubric rule frame, and the rubric ornament that divides its parts.
import type { ReactNode } from 'react'

export function Ornament() {
  return (
    <svg className="td-orn" viewBox="0 0 120 16" aria-hidden="true" focusable="false">
      <path d="M2 8h44M74 8h44" stroke="currentColor" strokeWidth="1" />
      <path d="M60 2l6 6-6 6-6-6z" fill="currentColor" />
      <circle cx="50" cy="8" r="1.5" fill="currentColor" />
      <circle cx="70" cy="8" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** `small` is the notice size: the page shrinks to its content and sits in the middle of the screen. */
export function Page({ small, children }: { small?: boolean; children: ReactNode }) {
  return (
    <section className={small ? 'td-page td-page-small td-vellum td-fade' : 'td-page td-vellum td-fade'}>
      <div className="td-page-frame" aria-hidden="true" />
      {children}
    </section>
  )
}

/** A heading or line whose first letter is a rubric drop cap; the accessible text stays the whole word. */
export function DropCap({ text }: { text: string }) {
  return (
    <>
      <span className="td-cap">{text.charAt(0)}</span>
      <span>{text.slice(1)}</span>
    </>
  )
}
