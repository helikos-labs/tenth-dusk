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

/**
 * `small` is the notice size: the page shrinks to its content and sits in the middle of the screen. `fit` is a chapter
 * page: full width, but only as tall as its text, in the middle of the screen (its layer is .td-book-fit).
 */
export function Page({ small, fit, children }: { small?: boolean; fit?: boolean; children: ReactNode }) {
  const size = small ? ' td-page-small' : fit ? ' td-page-fit' : ''
  return (
    <section className={`td-page${size} td-vellum td-fade`}>
      <div className="td-page-frame" aria-hidden="true" />
      {children}
    </section>
  )
}

/**
 * A heading or line whose first letter is a rubric drop cap; the accessible text stays the whole word. The letter is
 * also in data-cap, so a cap whose arm reaches over the next letters (T, F) can tuck them under it.
 */
export function DropCap({ text }: { text: string }) {
  const first = Array.from(text)[0] ?? ''
  return (
    <>
      <span className="td-cap" data-cap={first}>
        {first}
      </span>
      <span>{text.slice(first.length)}</span>
    </>
  )
}
