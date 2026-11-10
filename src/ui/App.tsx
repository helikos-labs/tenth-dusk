// The game's screens (§16): title → name the hero → chapter intro → the world with its HUD, the camp sheet and the
// pack over it → chapter end, and the portrait guard over everything. useGame holds the state; the world shows from
// the chapter intro on (so it builds while the intro is read), keyed by the zone, and stays behind the overlays.
// ?perf=1 adds the performance overlay (PerfOverlay.tsx).
//
// Failures (§15.3, §16, R25): without WebGL 2 the world is never mounted, and a calm notice takes the place of every
// screen past the naming; a lost WebGL context shows "Restoring the world…" until the context returns and the scene,
// remounted (its key bumped), has drawn the world again. main.tsx's Guard catches anything else.
import { useCallback, useMemo, useState } from 'react'
import type { Off } from '../rules/hex.ts'
import WorldScene from '../scenes/WorldScene.tsx'
import { PERF } from '../testHooks.ts'
import { zoneToWorld } from '../world/adapter.ts'
import { SMALL_SCREEN, detailFor } from '../world/useWorld.ts'
import Calm from './Calm.tsx'
import CampSheet from './CampSheet.tsx'
import ChapterEnd from './ChapterEnd.tsx'
import ChapterIntro from './ChapterIntro.tsx'
import Hud from './Hud.tsx'
import NameHero from './NameHero.tsx'
import Pack from './Pack.tsx'
import PerfOverlay from './PerfOverlay.tsx'
import Title from './Title.tsx'
import Upright from './Upright.tsx'
import { useGame } from './useGame.ts'
import { hasWebGL2 } from './webgl.ts'
import './screens.css'

export default function App() {
  const { run, screen, act, blocked, blockedN, notice, noticeN, preview, walking, canContinue } = useGame()
  // Asked once, before any world is mounted.
  const [gl2] = useState(hasWebGL2)
  const zone = run?.zone
  const world = useMemo(() => (zone ? zoneToWorld(zone) : null), [zone])
  const detail = useMemo(() => detailFor(SMALL_SCREEN), [])
  const onTap = useCallback((at: Off) => act({ t: 'tap', at }), [act])
  const showWorld = run && world && screen !== 'title' && screen !== 'name'
  // For the overlay: when the first world began to build and when it was ready (performance.now() ms).
  const [worldTimes, setWorldTimes] = useState<{ start: number; ready: number } | null>(null)
  // The scene's generation (bumped when a lost context returns) and whether it is being restored.
  const [scene, setScene] = useState({ n: 0, restoring: false })
  const onLost = useCallback(() => setScene((s) => ({ ...s, restoring: true })), [])
  const onRestored = useCallback(() => setScene((s) => ({ ...s, n: s.n + 1 })), [])
  const onReady = useCallback((start: number) => {
    setScene((s) => (s.restoring ? { ...s, restoring: false } : s))
    if (PERF) setWorldTimes((t) => t ?? { start, ready: performance.now() })
  }, [])

  if (!gl2 && screen !== 'title' && screen !== 'name') {
    return (
      <>
        <Calm
          heading="This journey needs WebGL 2"
          text="This browser can't draw the world. Try another browser, or turn on hardware acceleration. Your journey is kept."
          onReturn={() => act({ t: 'title' })}
        />
        <Upright />
      </>
    )
  }

  return (
    <>
      {showWorld && (
        <WorldScene
          key={`${run.zone.chapter}:${run.zone.seed}:${scene.n}`}
          run={run}
          world={world}
          preview={preview}
          onTap={onTap}
          detail={detail}
          onReady={onReady}
          onLost={onLost}
          onRestored={onRestored}
        />
      )}
      {screen === 'title' && <Title canContinue={canContinue} act={act} />}
      {screen === 'name' && <NameHero act={act} />}
      {screen === 'intro' && <ChapterIntro act={act} />}
      {screen === 'world' && run && <Hud run={run} preview={preview} walking={walking} blocked={blocked} blockedN={blockedN} notice={notice} noticeN={noticeN} act={act} />}
      {screen === 'camp' && run && <CampSheet run={run} act={act} />}
      {screen === 'pack' && run && <Pack run={run} act={act} />}
      {screen === 'end' && run && <ChapterEnd run={run} act={act} />}
      {showWorld && scene.restoring && (
        <div className="td-layer td-restoring" role="status">
          <span>Restoring the world…</span>
        </div>
      )}
      {PERF && <PerfOverlay startAt={worldTimes?.start ?? null} readyAt={worldTimes?.ready ?? null} />}
      <Upright />
    </>
  )
}
