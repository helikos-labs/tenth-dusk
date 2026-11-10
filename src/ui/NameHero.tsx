// Naming the hero (§3): a name of 1 to 16 characters (trimmed), "Wren" unless the player changes it.
import { useState } from 'react'
import { DEFAULT_NAME, NAME_MAX, type GameAction } from './useGame.ts'

export default function NameHero({ act }: { act: (a: GameAction) => void }) {
  const [name, setName] = useState(DEFAULT_NAME)
  const ok = name.trim().length >= 1 && name.trim().length <= NAME_MAX
  return (
    <main className="td-layer td-screen">
      <form
        className="td-screen-body td-fade"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) act({ t: 'name', name })
        }}
      >
        <h1 id="td-name-heading" className="td-heading">
          Name your Lampwright
        </h1>
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
        <button type="submit" className="td-primary" disabled={!ok}>
          Take up the lantern
        </button>
      </form>
    </main>
  )
}
