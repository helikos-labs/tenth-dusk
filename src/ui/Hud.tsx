// The HUD over the world (§5, §16): the top bar (the day with the sun's arc across it, the chapter, the ember), the
// tracker, the chip (a blocked tap's, else what the rules just did, R24) and the bottom bar (vigour, the steps left,
// and Move · Camp · Pack · Journal). Move walks the path previewed (as a second tap on its end does), or presses on into
// the night when no move is left by day; Journal waits for a later milestone.
import { useMemo } from "react";
import {
  LAST_DAY,
  NIGHT_STEPS,
  STEPS_PER_DAY,
  type RunState,
} from "../rules/run.ts";
import type { Off } from "../rules/hex.ts";
import DayDial from "./DayDial.tsx";
import { roman } from "./roman.ts";
import { canPressOn, type GameAction } from "./useGame.ts";

interface HudProps {
  run: RunState;
  preview: Off[] | null;
  walking: boolean;
  blocked: string | null;
  blockedN: number;
  notice: string | null;
  noticeN: number;
  act: (a: GameAction) => void;
}

const ICON = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ORDINALS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
];
/** "Chapter the Third" from a zone's chapter id ("b1c3"). */
const chapterLine = (id: string): string => {
  const n = Number(/c(\d+)$/.exec(id)?.[1] ?? 1);
  return `Chapter the ${ORDINALS[n - 1] ?? roman(n)}`;
};

export default function Hud({
  run,
  preview,
  walking,
  blocked,
  blockedN,
  notice,
  noticeN,
  act,
}: HudProps) {
  const beacons = useMemo(
    () =>
      [...run.zone.cells.values()].filter((c) => c.landmark === "beacon")
        .length,
    [run.zone],
  );
  const end = preview?.at(-1);
  const night = !end && !walking && canPressOn(run);
  const left = run.night ? run.nightSteps : run.steps;
  const segs = run.night
    ? Math.max(NIGHT_STEPS, run.nightSteps)
    : STEPS_PER_DAY;
  return (
    <div className="td-layer td-hud">
      <div className="td-hud-head">
        <div className="td-top td-iron td-rivets" data-hud="top">
          <header className="td-face td-vellum">
            <div className="td-day">
              <span className="td-sr">
                DAY {run.day} / {LAST_DAY}
              </span>
              <DayDial day={run.day} days={LAST_DAY} />
            </div>
            <div className="td-chapter">
              <div className="td-chapter-line">
                {chapterLine(run.zone.chapter)}
              </div>
              <div className="td-chapter-name">The Reach Road</div>
            </div>
            <div
              className="td-ember"
              aria-label={`Ember ${run.hero.ember} of ${run.hero.maxEmber}`}
            >
              <span className="td-ember-label" aria-hidden="true">
                Ember
              </span>
              <span className="td-stones" aria-hidden="true">
                {Array.from({ length: run.hero.maxEmber }, (_, i) => (
                  <i
                    key={i}
                    className={
                      i < run.hero.ember ? "td-stone td-lit" : "td-stone"
                    }
                  />
                ))}
              </span>
            </div>
          </header>
        </div>
        <div className="td-slip-wrap">
          <span className="td-nail" aria-hidden="true" />
          <section
            className="td-slip td-vellum"
            data-hud="tracker"
            aria-label="Goals"
          >
            <div
              className={
                run.lit.length >= beacons ? "td-goal td-done" : "td-goal"
              }
            >
              <span className="td-sr">
                Light the beacons {run.lit.length}/{beacons}
              </span>
              <span aria-hidden="true">Light the beacons</span>
              <span className="td-tally" aria-hidden="true">
                {run.lit.length ? roman(run.lit.length) : "–"} ·{" "}
                {beacons ? roman(beacons) : "–"}
              </span>
            </div>
            <div
              className={
                run.status === "hearth" ? "td-goal td-done" : "td-goal"
              }
            >
              <span>Reach the hearth</span>
            </div>
          </section>
        </div>
      </div>
      <div className="td-hud-foot">
        <div className="td-chip-slot" aria-live="polite">
          {blocked ? (
            <span key={`blocked-${blockedN}`} className="td-chip">
              {blocked}
            </span>
          ) : (
            notice && (
              <span key={`notice-${noticeN}`} className="td-chip td-notice">
                {notice}
              </span>
            )
          )}
        </div>
        <footer className="td-bottom td-iron td-glass" data-hud="bottom">
          <div className="td-gauges">
            <div>
              <div className="td-gauge-head">
                <span className="td-label">Vigour</span>
                <span className="td-gauge-value">
                  {run.hero.vigour} / {run.hero.maxVigour}
                </span>
              </div>
              <div className="td-bar">
                <span
                  style={{
                    width: `${(100 * Math.max(0, run.hero.vigour)) / run.hero.maxVigour}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <div className="td-gauge-head">
                <span className="td-label">Steps</span>
                <span className="td-gauge-value">
                  {run.night
                    ? `Night ${run.nightSteps}`
                    : `${run.steps} / ${STEPS_PER_DAY}`}
                </span>
              </div>
              <div className={run.night ? "td-segs td-night" : "td-segs"}>
                {Array.from({ length: segs }, (_, i) => (
                  <span key={i} className={i < left ? "td-lit" : undefined} />
                ))}
              </div>
            </div>
          </div>
          <nav className="td-tools">
            <button
              type="button"
              className={end || night ? "td-tool td-ready" : "td-tool"}
              disabled={walking || (!end && !night)}
              onClick={() =>
                end ? act({ t: "tap", at: end }) : act({ t: "pressOn" })
              }
            >
              <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
                <path d="M12 2.8l7.8 4.5v9.4L12 21.2l-7.8-4.5V7.3z" />
                <path d="M12 16V8.5M8.8 11.5L12 8.3l3.2 3.2" />
              </svg>
              {night ? "Press on" : "Move"}
            </button>
            <button
              type="button"
              className="td-tool"
              disabled={walking}
              onClick={() => act({ t: "openCamp" })}
            >
              <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
                <path d="M12 4L3 20h18z" />
                <path d="M12 4v0M9 20l3-6 3 6" />
              </svg>
              Camp
            </button>
            <button
              type="button"
              className="td-tool"
              disabled={walking}
              onClick={() => act({ t: "pack" })}
            >
              <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
                <rect x="4" y="8" width="16" height="12" rx="2.5" />
                <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M4 13h16" />
              </svg>
              Pack
            </button>
            <button type="button" className="td-tool" disabled>
              <svg viewBox="0 0 24 24" {...ICON} aria-hidden="true">
                <path d="M6 3h8l4 4v14H6z" />
                <path d="M14 3v4h4M9 12h6M9 16h6" />
              </svg>
              Journal
            </button>
          </nav>
        </footer>
      </div>
    </div>
  );
}
