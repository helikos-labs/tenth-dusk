# Tenth Dusk M1 "walkable zone": final whole-branch review

Range: 65b7950..12b189a (branch ccr-17a9ac4d-3z2shs). Spec: apps/tenth-dusk/docs/DESIGN.md. Plan: docs/superpowers/plans/2026-11-09-tenth-dusk-m1-walkable-zone.md. Rulings R1 to R21, global-constraints.md, task-6-rulings.md.

Passes done, in order: rules (rng, hex, zone, sight, gen, run, save, data); world integration (adapter, palette, fog, mist, useWorld, the slot grid in materials, provenance headers); scene (WorldScene.tsx, reach.ts); UI (useGame, App, Hud, CampSheet, Pack, Title, NameHero, ChapterIntro, ChapterEnd, Upright, screens.css, testHooks); tests (unit list and coverage; e2e scripts read, not run). I skipped package-lock.json and judged the copied Rift & Root files only on how they integrate.

Verification run here:
- `npm test`: 90 pass, 0 fail, 22 s.
- `npm run build`: passes. The only warning is chunk size (1.37 MB, 397 KB gzip).
- No path outside `apps/tenth-dusk/` changed, apart from the spec moving into it. Every copied world file has the provenance header.
- Scratch simulations, in the scratchpad and not in the repo:
  - 40 greedy playthroughs reach the hearth on day 3 to 5, and every save round-trips.
  - `generateZone` takes 7 to 24 ms on this machine.
  - `reachable()` averages 5.4 ms.
  - A sweep of the dawn push over 300 seeds (see I1).

---

## Strengths

- **The rules core is clean and pure.**
  - Every rules function returns new state (`move` and `camp` copy what they change).
  - No three.js, React or DOM imports, and no `Math.random`.
  - The Dijkstra uses a deterministic heap tie-break, so paths and generation replay exactly from the seed (R3).
  - `canMove` orders its reasons exactly as R11 says, and the UI's chip copy maps from those reasons rather than re-deriving them.
- **The rules and the UI share one source of truth for movement.**
  - The preview, the highlight, the Move button and the walk all go through `path`, `reachable`, `canMove` and `move`.
  - `canPressOn` is defined as "pressOn changes the run", so the Press on button can't drift from R13b.
  - The walk re-validates every step with `move()` and stops cleanly on a fall, at the hearth or on a refusal.
- **The saves are defensive where it matters.**
  - They are versioned and run a migration loop.
  - `Object.hasOwn` guards the chapter lookup.
  - Fog keys are checked with a regex and against the zone, and `at` and `lastCamp` must be in the zone.
  - A throwing `generateZone` counts as corrupt.
  - Corrupt and newer saves are set aside under `.corrupt` and never silently dropped.
  - Storage access is wrapped, so private mode or a full quota can't crash the app.
- **Fog never leaks.**
  - The scene reads only `run.fog`.
  - Landmarks are hidden below "remembered", unseen relief is flattened in both the colour and depth passes (R16), and highlights are limited to in-sight hexes.
  - The world integration stays narrow: `adapter.ts`, `fog.ts`, `palette.ts` and `mist.ts` are small and well documented, and the engine knows nothing of the rules beyond `WorldCell`.
- **The performance work is real and evidence-based.**
  - Shaders are compiled ahead, and each program's first use is forced during warm-up.
  - The perf run shows zero long tasks in play and no new programs after world-ready.
  - Phones draw on demand.
- **Test hooks are cleanly gated** behind `?test=1` (R6), and `?perf=1` only shows an overlay. `?detail=` is clamped, and `?seed=` is honoured only with `test=1`.
- **The process was disciplined.** Every plan defect was ruled on in writing (R1 to R21), DESIGN.md was updated to match each ruling, and the deferred items were logged rather than lost.

---

## Issues

### Critical (must fix)

None.

### Important (should fix)

**I1. The dawn push can strand the hero in a pocket cut off from the hearth (soft lock until the clock runs out).**
- **Where:** `src/rules/run.ts:180-189`.
- **What's wrong:** the push destination is the nearest unsunk cell that isn't a wall and is passable, by hex distance. Nothing checks that the cell connects to the rest of the zone once the rows behind it sink.
- **Repro:** `generateZone(CHAPTER1,'H1')`, with the hero at (6,1), `furthestRow` 11, then `camp(['rest'])`.
  - The hero is pushed to (7,0).
  - That cell sits in a heath pocket bounded by the river (row 9), cliffs down from the mountain cluster at (7,1) to (8,2), and the newly sunk row 6.
  - `path(after, hearth)` is `null`. The hero can never leave the pocket; they can only camp until day 10 expires the chapter.
- **How often:** in a sweep over 300 seeds, with the hero camping 5 or 6 rows behind their furthest row, 3.7% of pushes strand the hero (1,746 of 47,173), and 193 of the 300 seeds have at least one such spot.
- **Why it matters:** walking back for a missed beacon (rows 4, 8 and 12, on alternating flanks) and camping on the way is ordinary play. Review Focus #3 promises a move "to the nearest unsunk hex they can stand on" so play continues. A reasonable player would see the chapter as broken.
- **Fix:**
  1. Compute the set of unsunk cells connected to the hearth: one Dijkstra or BFS from the hearth over cells with `row ≥ sunkBelow`, using `stepCost` reversed or a symmetric connectivity check.
  2. Pick the nearest cell in that set (fall back to today's rule only if the set is empty).
  3. Add the H1 repro as a run test.
- **Also consider:** the same pocket can trap a hero who simply camps inside it while the Hush sinks the only way out. A cheap guard is to clamp `sunkBelow` so it never cuts the hero's own component off from the hearth. That is a rules decision for Asvin; the push fix is the minimum.

**I2. "Read the stars: reveal one rumour" and the beacon's rumour pin have no visible effect in M1.**
- **Where:** `src/ui/CampSheet.tsx:182`, `src/rules/run.ts:83-86 and 131`, `src/world/fog.ts:17` (g = 0 in M1).
- **What's wrong:** the rules add keys to `run.rumours`, but nothing in `src/ui` or `src/scenes` reads them, and the marker channel is always 0.
- **Why it matters:** the camp sheet offers a night action that does nothing the player can see, in place of +10 vigour or +2 ember. A reasonable player picks it, sees nothing, and feels cheated or assumes a bug. The spec says a lit beacon "adds one rumour pin" (§5.2), and that is invisible too.
- **Plan defect:** the plan kept the copy ("Reveal one rumour", Task 13) while deferring markers ("g = marker kind (0 in M1)", Task 10).
- **Fix, either of:**
  - (a) Draw a minimal rumour pin: write `g` for rumour hexes in `writeFog` and draw a dashed ring in the ground shader, or add a small sprite per rumour key, hidden once fog ≥ 2.
  - (b) Disable "Read the stars" in M1 with "Arrives in the next update", as the Journal and Relics already are.

**I3. Run events never reach the player: falls, pushes, cold, leeches, the Hush sinking and beacon lighting are all silent.**
- **Where:** `src/ui/useGame.ts` and `src/ui/Hud.tsx`. Nothing outside `src/rules` reads `run.events`.
- **What happens on screen:**
  - When vigour hits 0, the hero cuts to their last camp and the day jumps by one with no message.
  - At dawn a pushed hero cuts to a new hex with no message.
  - Vigour drops by 2 on mountain and marsh with no cause shown.
- **Why it matters:** a teleport plus a lost day with no explanation reads as a bug to a reasonable phone player. The rules behind it (§5.1 cold, §7 marsh, §5.1 falling) are invisible, so the player can't learn to avoid them.
- **Fix:** keep `run.events.length` from the last render. Show the newest notable event in the existing chip slot, with its own `key`, for example:
  - "The cold bites · −2 vigour"
  - "Leeches · −2 vigour"
  - "{name} collapses and wakes at their last camp"
  - "The Hush took the land behind; {name} moves on"
  - "Beacon lit · +1 ember"

**I4. There is no error boundary and no WebGL 2 notice: a device without WebGL 2 gets a blank page.**
- **Where:** `src/ui/App.tsx:298` and `src/main.tsx`.
- **What happens:** three r186 needs WebGL 2. If the context can't be created, R3F throws during commit. With no error boundary, React 19 unmounts the whole root at the chapter intro, including the HUD and the title, and the next Continue does the same.
- **Spec:** §15.3 says "Without WebGL 2 the game shows a 'needs WebGL 2' notice", and §16 says "A lost WebGL context rebuilds the scene from state". The plan dropped both, which is a plan gap.
- **Why it matters:** few phones are affected, but for them the failure is total and unexplained, and the fix is cheap.
- **Fix:**
  - Check `document.createElement('canvas').getContext('webgl2')` before mounting `WorldScene`, and show a styled notice ("This journey needs WebGL 2").
  - Wrap `WorldScene` in an error boundary that shows the same notice.
  - Let the boundary remount on `webglcontextrestored`, or key `WorldScene` on a context-loss counter.

### Minor

**M1. Remembered hexes, and in-sight hexes whose cheapest path crosses unseen ground, are never tap targets.**
- **Where:** `src/scenes/reach.ts:14-19`.
- **What's wrong:** an affordable walk to a remembered hex gives no preview, no highlight and no chip; a tap does nothing.
- **How often:** about 10% of affordable targets (670 of 6,449 samples in my simulation). Another 17 in-sight targets were excluded because the global cheapest path ran through unseen hexes.
- **Who notices:** most often a player standing in forest, where sight is 2.
- **Fix:** find the preview path with `avoid` = sunk plus unseen (fog < 2), so it runs only over known ground, and allow fog ≥ 2 targets. The remembered terrain is already shown, so this leaks nothing.

**M2. Taps pick the CPU terrain, not the drawn ground.**
- **Where:** `src/scenes/WorldScene.tsx:448`.
- **What's wrong:** under unseen or sunk hexes (flattened in the vertex shader, R16) and under water (a lake or river bed below the surface), the ray hits geometry the player doesn't see.
- **Effect:** small. Taps on unseen hexes do nothing anyway, and the shift on water is about 0.2 to 0.3 units at a 60° pitch. A tap on the far edge of the ford can name the bank beyond it.
- **Fix (M2):** intersect against `groundOf` (max of height and `WATER_LEVEL`), with unseen and sunk hexes clamped to `FOG_FLOOR`.

**M3. Sunk relief still blocks line of sight in the rules but is drawn flat.**
- **Where:** `src/rules/sight.ts:27` against R16a.
- **What's wrong:** a small rules and scene disagreement. Sunk rows lie behind the hero, so it rarely matters.
- **Fix:** skip blockers with `row < sunkBelow`, or accept it and document it.

**M4. Save validation has no upper bounds, and the expiry check uses `===`.**
- **Where:** `src/rules/save.ts:46` and `:62`, `src/ui/Hud.tsx:81`, `src/rules/run.ts:163`.
- **What's wrong:**
  - A hand-edited save with `maxEmber: 1e9` makes the HUD build a billion-element array and hangs the tab.
  - `day: 12` with status `walking` never expires, because `dawn` checks `day === LAST_DAY`.
  - Hero names longer than 16 characters are accepted.
- **Why it's minor:** only the device's owner can write localStorage, and M1 has no import code, so this is robustness, not security.
- **Fix:**
  - Bound `day` (1 to 11), `steps` (≤ 6), `nightSteps` (≤ 8), `ember` (≤ `maxEmber` ≤ about 20), `vigour` (≤ `maxVigour`) and the name length (1 to 16).
  - Use `s.day >= LAST_DAY` in `dawn`.

**M5. Forage with a full stack of rations does nothing, although the satchel has free slots.**
- **Where:** `src/rules/run.ts:206-208`.
- **What's wrong:** §11.1 gives 8 slots with stacks of up to 3. The pick is wasted silently.
- **Fix:** start a new stack when there is a free slot, and say so if the satchel is full.

**M6. Camping on day 10 ends the chapter at once, with no warning on the camp sheet.**
- **Where:** `src/ui/CampSheet.tsx`.
- **Fix:** on day 10, show "The ember dies at this dusk" above "Sleep until dawn".

**M7. The portrait guard keys on `orientation: landscape`.**
- **Where:** `src/ui/screens.css:677`.
- **What's wrong:** on browsers that shrink the layout viewport for the soft keyboard, a 360 × 640 phone can read as landscape while the name field has focus, and the overlay then covers the input. This is speculative: Chrome since v108 resizes the visual viewport only.
- **Fix:** add `and (max-height: 500px)`, or compare against `screen.width` and `screen.height`.

**M8. There is no way back from the Name screen, and "Start a new journey" overwrites a save without confirmation.**
- **Where:** `src/ui/NameHero.tsx` and `src/ui/Title.tsx:17`.
- **What's wrong:** once a run exists, a mistaken tap plus "Take up the lantern" loses the previous journey.

**M9. Constants and copy are duplicated.**
- `STEPS_PER_DAY` and `NIGHT_STEPS` are defined again in `src/rules/gen.ts:27-28`; import them from `run.ts`.
- `src/ui/Hud.tsx:75-76`, `ChapterIntro.tsx` and `ChapterEnd.tsx` hard-code "Chapter 1 · The Reach Road" instead of reading `CHAPTER1.name`.
- `useGame.ts:212` repeats `camp()`'s validation; it is needed to avoid the throw, but could share a helper.

**M10. There is dead or extra code.**
- The `pass` Landmark model is built, prepared and warmed up though M1 places no pass (`WorldScene.tsx:106`).
- The `.td-serif` CSS rule (`screens.css:44`) is unused.
- `kit.ts` still has the faction helpers (deferred, Task 7).

**M11. `WorldScene.tsx` is 723 lines and line 511 is over-long.**
- **Fix:** split input (pointer, pinch and pick) and warm-up into hooks (deferred, Task 11).

**M12. `blockedCopy` has no unit test.**
- **Where:** `src/ui/useGame.ts:73`.
- **What's wrong:** it is exported and pure, but only e2e covers it. It holds R19 and R20's chip rules.
- **Fix:** add a node test with `mk()` zones for each branch.

**M13. The slot grid is sized from CHAPTER1.**
- **Where:** `src/world/materials.ts:42` and `:47`; `slotOf` has no range check.
- **Fix:** before chapter 2, size the grid from the board passed in (deferred, Task 10).

---

## Deferred-item triage

### Must fix before M1 counts as done

- None of the deferred code items. One deferred note is an M1 exit step rather than a code fix:
  - **The S3 phone measurement** (Task 11 note "world-ready 5.2 s under SwiftShader; S3 target 3 s", and Task 14's "tell Asvin: read 'worst' after ≥ 10 s walking, judge fps while walking"). Asvin must open `?perf=1` on a three-year-old mid-range Android and an iPhone 12, as plan Task 14 step 3 says.
    - The bracketed time is the one to compare with 3 s.
    - Read "worst" only after 10 s or more of walking.
    - Safari reports no long tasks, so the iPhone's count of 0 proves nothing.
  - **Until that is done, S3, and with it M1, isn't passed.**
- The new Important issues I1 to I4 are must-fix (I1 at minimum) but were not in the deferred list.

### Fine to leave for M2

The rest of the list stays for M2:

- **Task 1:** rng test hygiene (`let t`, determinism checks only the first draw).
- **Task 2:** missing tests for -0, key/unkey, edge neighbours, line ties and `line(a,a)`.
- **Task 3:** missing tests for bridge cost and downward cliffs; `mk` has no bridge letter and a fixed wallDepth.
- **Task 4:** thin edge tests.
- **Task 5:**
  - name or document `tourDays` as 8 a day (the interface comment already does);
  - `cutGaps` percentage counts the ends and the ford;
  - CHAPTER1-only assumptions in `home()`, `roadDistance` and `daysFor`;
  - the throw path is untested;
  - cave and hamlet counts are fixed at 1.
- **Task 6:** test edges and hygiene, and the no-affordable test uses forest.
- **Task 7:** `kit.ts` dead code, the dropped warp-seed assertion, and no tests for `ModelQueue` specs or `dryInside`.
- **Task 8:**
  - the budget loop can exit over budget (bounds don't depend on the seed, so REACH1's test covers every seed);
  - the silent fine-sheet fallback;
  - `seaSides` corners;
  - stale comments.
- **Task 9:**
  - the 0→3 jump width;
  - the untested rebuild guard;
  - `Probe.terrace` and `top` on water;
  - duplicated test helpers and the edge loop;
  - no level-3 continuity test;
  - thin margins;
  - probe cost.
- **Task 10:**
  - the slot grid sized from CHAPTER1 with no `slotOf` range check (must fix before chapter 2, see M13);
  - `RR_DIRS` duplication and the hand-built mist vec3;
  - the one-cell lit slope at fog edges.
- **Task 11:**
  - **picking hits the CPU terrain, not the drawn ground** (M2 above: the effect is small, since unseen taps do nothing and the water offset is about 0.25);
  - **reachable excludes remembered hexes that `move()` allows** (M1 above: friction, not a block, since the highlight shows what can be tapped; fix it with the known-ground path);
  - shadow map redraws every frame while walking (conditional: it becomes must-fix only if the phone measurement shows under 30 fps while walking; it is the documented first lever after plant density);
  - O(triangles) raycast (6 to 20 ms measured);
  - halos draw before water;
  - `WorldScene` length;
  - thin silhouette and dim tests;
  - smoke flat/hill flake risk;
  - the long `__lastTap` line;
  - no case for a hex behind a landmark;
  - touch not exercised;
  - taps before the world shows (harmless: they preview hexes the player can't yet see, and the intro covers the canvas).
- **Task 12:** rng not checked as uint32, untested guards, and event `at` not zone-checked.
- **Task 13:**
  - dead CSS;
  - flow.mjs repeats the safe rule;
  - newer-save and throwing-storage paths untested;
  - the 360 screenshot is taken after the chip fades.
- **Task 14:**
  - `App.tsx` keeps only the first world's timing (the overlay is wrong after a second journey in the same tab);
  - warm-up uses one timer per program, which slows in a hidden tab (it resumes at full speed when the tab is visible);
  - perf.mjs hygiene (a rest-fps residual, the arrival radius, `tapPeaksWall` throwing, one seed aborting the rest).

### Not a real issue

- **Task 4:** forest −1 is keyed on `cover > 0` (only forest and old wood have cover), and off-board hexes on a line count as clear (the 4-deep wall ring outlasts any sight radius from inside the zone).
- **Task 5:** the reason strings changed wording; nothing reads them.
- **Task 6:**
  - "expired by a fall shows day 11 vs 10": no screen shows the day at the chapter end;
  - "no event when no push destination": every row at or above `sunkBelow` has passable cells, so it can't happen (I1 is the real push problem).
- **Task 8:** the warp texture cache is keyed by seed only (one zone per seed). The `useWorld.ts:21` comment naming Board3D is already fixed.
- **Task 10:**
  - "hint/hover emissive bypasses fog" is resolved: `reach.ts` restricts highlights to in-sight hexes;
  - "check warmUp precompiles new programs" is resolved in Task 14 (28 programs before and after the walk);
  - per-vertex and per-pixel fog cost was measured at 2 to 3% on SwiftShader;
  - the unseen coast outline only follows the zone's straight east edge, so it reveals nothing.
- **Task 11:** reachable is computed twice (about 5 ms each, once per run change).
- **Task 13:**
  - uppercase CSS (the DOM keeps the brief's strings verbatim);
  - **"`startRun` throw after 5 seeds is uncaught in the click handler":** each `generateZone` already makes 6 attempts and all 1,000 test seeds pass, so 5 fresh random seeds all failing has effectively zero probability. It can only happen with a pinned bad `?test=1&seed=`, which is a test-only path.
- **Task 14:**
  - **phone mode decided by `cores ≤ 4`:** this only lowers detail and shadow resolution, and switches to on-demand drawing, on low-core desktops. Weak laptops benefit, nothing breaks, and the "weak" tier still needs a ≤ 700 px screen.
  - The idle worst-frame floor is a measurement-reading note, carried in the must-do above.

---

## S1 to S4 status (DESIGN.md §1), and the M1 exit test (§18, plan Task 14)

| # | Status | Evidence |
|---|---|---|
| S1: a chapter takes 10 to 15 min | **Unverifiable here** (and an M3 exit, not M1) | Needs 5 timed playthroughs by Asvin. Note: in M1 the hearth is 3 to 5 days away by the straight road (my simulation), and only the optional beacon tour fills the 10 days, so M1 chapters will likely run short of 10 minutes. |
| S2: every zone is fair | **Met**, as restated by R9 and without the lock and gate checks (M2) | `1,000 seeds are all fair (S2)` passes; `ATTEMPTS = 6`, so at most 5 rerolls. |
| S3: smooth on a phone | **Unverifiable here** | SwiftShader evidence only: 0 long tasks over 100 ms in play, no programs compiled in play, world-ready 1.6 s from mount (3.2 s from navigation) on SwiftShader. Phone fps and time-to-world wait for Asvin's `?perf=1` run on a three-year-old Android and an iPhone 12. |
| S4: readable on a phone | **Met** at 390 × 844, by R17d's measure (at the hero's row) | smoke.mjs asserts the hero's hex is at least 44 CSS px at the default zoom (`hexPx` 50). Every CSS font-size is 12 px or larger. Not measured at 360 × 640, though `hexPx` doesn't depend on width below 450 px. |
| M1 exit: walk chapter 1 from start to the hearth or to expiry on a phone | **Met in rules and e2e; unverifiable on a phone** | flow.mjs walks, camps and reloads; my simulation reaches the hearth on 40 of 40 seeds. I1 can make the hearth unreachable after a push, though the chapter can still run out its clock. |
| Plan: the 1,000-seed test under 60 s | Met | The whole suite runs in 22 s. |

---

## Declined to judge

- **Settings export and import of a save as a code (§16):** not in the M1 plan; there is no import surface, so hostile imported saves aren't yet an attack vector.
- **The sun angle following the time of day, and a night look (§15.5):** the plan fixes the sun (Task 8) and doesn't schedule a day cycle. The HUD's sun arc and the "Night" counter carry it.
- **Ambush rolls (1 in 4 forage, 1 in 3 at night, 1 in 3 marsh):** M2 and M3 by the plan's Scope constraint, and `rng` is carried unchanged.
- **Old wood's warden's-token rule:** CHAPTER1 has no old wood, and keys are M2.
- **Hamlet, ruins and cave mouths being inert:** M1 scope by the plan ("cave mouths are inert landmarks").
- **The fairness tour ignoring the Hush:** the best tour is monotonic in rows in practice, and R9 owns the band. It is worth re-checking when M2 adds back-tracking content.
- **Falling advancing the day without a Hush dawn:** the spec says only "costs 1 day", so this is a reading, not a defect.
- **The bundle size (1.37 MB, 397 KB gzip):** not in the spec or the plan. S3's 3 s is measured from world mount, so it's left to Asvin's phone run.
- **The copied Rift & Root internals** (field.ts, terrainMesh.ts, materials.ts, vegetation.ts, roads.ts, kit.ts) line by line: excluded by the brief.
- **Whether the visuals meet S5:** an M3 sign-off by Asvin against the concept renders.

---

## Recommendations

1. **Fix I1** (push destination connected to the hearth) with the H1 test, then I2 (disable "Read the stars" or draw a pin) and I3 (event chip). All three are small, and I3 reuses the chip slot.
2. **Add I4's WebGL 2 check and error boundary** (about 30 lines).
3. **Then have Asvin run the S3 phone check** on the live site with `?perf=1`, using the reading guidance above. If walking fps is under 30, lower plant density first (it is −46% of frame time on SwiftShader), then redraw the walking shadows every other frame.
4. **Small polish for M2's first task:** fold M1 (preview over known ground) and M4 (save bounds, `>=` in dawn) in.
5. **Plan lessons:**
   - Don't ship copy for an effect a milestone can't show (I2).
   - Give every rule with an on-screen consequence a matching piece of feedback in the HUD task (I3).
   - Carry the spec's failure modes (no WebGL 2, context loss) into a task (I4).
   - Back push and teleport rules with a connectivity test (I1).

---

## Assessment

**Ready to merge? With fixes.**

The rules, world integration, scene and UI agree with each other and with the rulings. The tests and build pass, and the fog, save and performance work is careful. But a dawn push can strand the hero where the hearth can't be reached (I1, on 193 of 300 seeds), and the UI hides or fakes several rule outcomes (I2, I3). Fix those, and add the WebGL 2 notice. M1 then counts as done once Asvin's phone measurement passes S3.

## After the fix wave (12b189a..e20cdca)

The four Important issues above are fixed: the dawn push keeps a path to the hearth (R22), "Read the stars" is disabled until M2 (R23), the HUD shows what the rules did (R24), and an error boundary, a WebGL 2 notice and a context-loss remount are in place (R25). Open for M2:

- **Soft lock (needs a rules decision):** a hero who camps in a pocket can be cut off when the Hush sinks the pocket's only exit. It happened in 0.47% of samples, on 122 of 300 seeds. Options: cap how far the Hush sinks, or push the hero whenever no path to the hearth remains (R26).
- If a lost WebGL context never comes back, "Restoring the world…" stays up. Remount after about 5 s anyway (R27).
- Only one notice shows per change. When a move or camp causes several events, the vigour losses that the gauge already shows go untold (R27).
- The "no repeat after reload" e2e check runs after the chip has already faded, so it can't fail. Assert right after Continue instead.
- The calm error screen lacks the portrait guard.
- Phone check for S3, outstanding:
  - Open `?perf=1` on a three-year-old Android and on an iPhone 12.
  - Read the world time in brackets against 3 s.
  - Read "worst" only after at least 10 s of walking, and judge fps while walking.
  - Safari reports no long tasks.
