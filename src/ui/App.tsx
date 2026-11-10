// The game's screens (§16): title → name the hero → chapter intro → the world with its HUD, the camp sheet and the
// pack over it → chapter end, and the portrait guard over everything. useGame holds the state; the world shows from
// the chapter intro on (so it builds while the intro is read), keyed by the zone, and stays behind the overlays.
// ?perf=1 adds the performance overlay (PerfOverlay.tsx).
import { useCallback, useMemo, useState } from 'react'
import type { Off } from '../rules/hex.ts'
import WorldScene from '../scenes/WorldScene.tsx'
import { PERF } from '../testHooks.ts'
import { zoneToWorld } from '../world/adapter.ts'
import { SMALL_SCREEN, detailFor } from '../world/useWorld.ts'
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
import './screens.css'

export default function App() {
  const { run, screen, act, blocked, blockedN, notice, noticeN, preview, walking, canContinue } = useGame()
  const zone = run?.zone
  const world = useMemo(() => (zone ? zoneToWorld(zone) : null), [zone])
  const detail = useMemo(() => detailFor(SMALL_SCREEN), [])
  const onTap = useCallback((at: Off) => act({ t: 'tap', at }), [act])
  const showWorld = run && world && screen !== 'title' && screen !== 'name'
  // For the overlay: when the first world began to build and when it was ready (performance.now() ms).
  const [worldTimes, setWorldTimes] = useState<{ start: number; ready: number } | null>(null)
  const onReady = useCallback((start: number) => setWorldTimes((t) => t ?? { start, ready: performance.now() }), [])

  return (
    <>
      {showWorld && <WorldScene key={`${run.zone.chapter}:${run.zone.seed}`} run={run} world={world} preview={preview} onTap={onTap} detail={detail} onReady={PERF ? onReady : undefined} />}
      {screen === 'title' && <Title canContinue={canContinue} act={act} />}
      {screen === 'name' && <NameHero act={act} />}
      {screen === 'intro' && <ChapterIntro act={act} />}
      {screen === 'world' && run && <Hud run={run} preview={preview} walking={walking} blocked={blocked} blockedN={blockedN} notice={notice} noticeN={noticeN} act={act} />}
      {screen === 'camp' && run && <CampSheet run={run} act={act} />}
      {screen === 'pack' && run && <Pack run={run} act={act} />}
      {screen === 'end' && run && <ChapterEnd run={run} act={act} />}
      {PERF && <PerfOverlay startAt={worldTimes?.start ?? null} readyAt={worldTimes?.ready ?? null} />}
      <Upright />
    </>
  )
}
