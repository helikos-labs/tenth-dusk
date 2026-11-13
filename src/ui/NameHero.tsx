// Naming the hero (§3): a name of 1 to 16 characters (trimmed), "Wren" unless the player changes it. The name is written
// on a pen line.
import { useState } from 'react'
import { DEFAULT_NAME, NAME_MAX, type GameAction } from './useGame.ts'
import { Ornament, Page } from './Page.tsx'

export default function NameHero({ act }: { act: (a: GameAction) => void }) {
  const [name, setName] = useState(DEFAULT_NAME)
  const ok = name.trim().length >= 1 && name.trim().length <= NAME_MAX
  return (
    <main className="td-layer td-book">
      <Page>
        <form
          className="td-page-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) act({ t: 'name', name })
          }}
        >
          <p className="td-over">The First Book</p>
          <h1 id="td-name-heading" className="td-heading">
            Name your Lampwright
          </h1>
          <Ornament />
          <input
            className="td-field"
            aria-labelledby="td-name-heading"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="td-menu">
            <button type="submit" className="td-seal" disabled={!ok}>
              <span>Take up the lantern</span>
            </button>
          </div>
        </form>
      </Page>
    </main>
  )
}
