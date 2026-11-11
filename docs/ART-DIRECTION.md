# Tenth Dusk — art direction v0.5: ashen blight, iron and vellum

Status: design approved in chat on 2026-11-11 (world section, HUD section, approach 1). This spec replaces DESIGN.md §15.5 "Look" for the world, and sets the look for every screen in `src/ui/`. Game rules, layout positions and the accessible names of controls do not change.

Sample images are on the concept page (section "New in v0.5 · Art direction"). The world image there is a rough render from a throwaway copy; this spec, not that image, is the target.

## 1. Intent

- **What Asvin asked for:** more atmosphere; duller trees that read as a dying world; components that look polished and individual rather than like a generic AI-built game.
- **The world is dying, not resting.** Ash and dead wood everywhere. Warm colour is rare and therefore meaningful: the hero's lantern, campfires and lit beacons.
- **The interface is a set of objects on a table:** worn vellum, blackened iron and dark wood, inked by hand. Never a floating app card.

## 2. Hard constraints

- **C1, phone budget.** S3 holds: at least 30 fps while walking on the Adreno 740 phone that measured 30+ fps on 2026-11-11, and no long task over 100 ms in play (`tests/e2e/perf.mjs`). The restyle adds no full-screen render pass and no post-processing pass.
- **C2, triangle budget.** Tree models have no more triangles than today's `conifer()` and `broadleaf()` in `src/world/vegetation.ts`.
- **C3, no shader patterns that are slow on Adreno.** Do not index local arrays with computed indices in GLSL (see commit "unroll the province border code for Adreno GPUs").
- **C4, accessible names unchanged.** Every button keeps its current accessible name ("Start a new journey", "Continue", "Take up the lantern", "Begin", "Move", "Camp", "Pack", "Journal", "Sleep until dawn", and so on), so the e2e scripts keep working.
- **C5, legibility.** Text on vellum has at least 4.5:1 contrast. Text is at least 12 px. Every number keeps tabular lining figures where it changes in place (vigour, steps). The ember count, the day and the steps stay readable at 360 × 640.
- **C6, no `backdrop-filter`.** It is costly on phones. The current HUD's glass blur goes.
- **C7, the fog of war stays honest** (R16): nothing in this pass may reveal unseen terrain, including ash, haze, warmth or particles.

## 3. The world: ashen blight

### 3.1 Palette (`src/world/palette.ts`)

- Ground colours move toward **ash-olive, peat and slate**: about 40–50% of today's saturation, hue pulled slightly toward ochre, lightness about today's. Grass reads grey-olive, not green.
- Snow stays near-white but greyer (`#cfd2d6`, shade `#9ea6b0`). Water becomes an oily slate (`#252f33`, deep `#151c20`).
- Values are set by hand in the table, not computed at run time. The throwaway's `ash()` helper is only the starting point.

### 3.2 Trees and ground cover (`src/world/vegetation.ts`)

- **Dead pine** (`conifer`): a taller pale ash-grey trunk (about `#b3ac9f`); three sparse, ragged, drooping tiers of dark grey-green needles (about `#5b5c52` to `#737266`); some instances with a snapped crown (a second geometry or a per-instance top scale of 0).
- **Blighted broadleaf** (`oak`): a pale grey-brown trunk and 4–5 bare tapering limbs (about `#bab2a4`); one small clump of dead rust-brown leaves (about `#8e6440`) on some instances only.
- **About 70% of broadleaves are fully bare.** Each tree's shade varies per instance from ash-grey to dead brown (instance colour, as today).
- Dead trees must read as **pale silhouettes against the darker ground** at the default zoom on a 390 px phone. This is checked on a screenshot (§6).
- **Grass tufts** turn dry straw-grey (base about `#4a4635`, tip about `#8f8768`).
- **Flowers** thin to about a third of today's count, in withered bone, dull mauve and rust. No bright reds or blues.
- **Reeds** go grey-ochre. **Rocks** are unchanged.

### 3.3 Ground detail (`src/world/materials.ts`)

- **Ash drifts:** pale grey patches on land, driven by the noise the cloud shade already computes (`rr_cloud`). No new noise call per pixel.
- **Haze:** a low drifting haze over seen land, computed in the terrain fragment shader from height and the existing noise, so there is no extra pass. Slate-brown. It must not change what is visible (C7).
- **Distance fog** (`scene.fog`): thicker and slate-brown, matched to the Hush colour.

### 3.4 Light (`src/scenes/WorldScene.tsx`)

- **Sun:** lower, weaker and colder (about `0xd9c6b0`, intensity about 1.55), with warmth only along the skyline.
- **Fill:** hemisphere sky about `0x6c7684`, ground about `0x221d19`, intensity about 0.6.
- **Lantern:** stays the scene's one point light (no new programs). Its warm pool around the hero grows a little and warms the ground's colour inside it.

### 3.5 The grade (one change for every material)

- Append a grade to `THREE.ShaderChunk.tonemapping_fragment` once at startup, before any program compiles. That keeps it in every built-in and patched material with no extra pass.
- **The grade:** desaturate mid-tones (keep about 70% of the saturation); tint shadows toward slate and highlights slightly warm. Do not lift the blacks: the first throwaway's lift flattened the mist to pale grey.
- The warm-up program list (Task 14) is unchanged in count.

### 3.6 Falling ash

- About 150 ash flakes drift and fall through the view, as one `THREE.Points` object with a tiny shader: size by distance, slow sway, a pale grey colour.
- Hidden over unseen and sunk hexes (C7). On phones, drawn only when a frame is drawn anyway, and it does not keep the frame loop awake at idle beyond the existing 30 fps.

### 3.7 Warmth as progress

- Each lit beacon restores colour and warmth within about 2.5 hexes, on the ground and the plants. It works through a uniform holding up to three lit-beacon positions (`uLit[3]`, unused slots far away): a smoothstep falloff that blends the grade back toward the undrained palette plus a slight warm tint.
- Three distance checks per pixel, written out with constant indices (C3).

### 3.8 Vignette and grain (CSS)

- One fixed layer over the canvas and under the HUD: a radial dark vignette (about 55% at the corners) and fine film grain from inline SVG noise at about 9% opacity.
- Static, with `pointer-events: none`. The browser composites it, so the GPU does not redraw the world for it.

## 4. The HUD and screens: iron and vellum

### 4.1 Materials and craft rules (`src/ui/screens.css`)

- **Vellum:** layered inline SVG noise (fine paper fibre plus large soft blotches) over a warm gradient (`#e3d6b6` to `#bfae88`), with a soft inner burn at the edges. Tiles must not show seams: use `stitchTiles` and tiles of 800 px or more.
- **Iron:** fine noise over a dark gradient (`#3a3835` to `#1d1c1a`), a 1 px top highlight, a 1 px bottom shadow, and rivets as small radial-gradient circles.
- **Wood:** horizontal grain noise over `#3a2d23` to `#1e1712`.
- **Ink:** `#2a2118` for text, `#5a4a38` for soft text, rubric red `#8a2a1c` for chapter lines, initials and gains. Ember orange `#ff9a4a` appears only where something burns (ember stones, the dial's sun, hot plates).
- **One light, from the top-left,** for every highlight and shadow. No pure black or pure white. Every gap and padding is a multiple of 4 px.
- **Motion:** plates press 1 px down with a darker face (80 ms); sheets slide up (220 ms, ease-out); notes fade (existing timing). Nothing bounces or scales.
- **No `backdrop-filter`** (C6).

### 4.2 Type (`index.html`, `screens.css`)

- **IM Fell English** (regular and italic) for headings, names and numerals, and **IM Fell English SC** for small-caps labels, both from Google Fonts. **EB Garamond** for body text.
- Barlow Semi Condensed and Cormorant Garamond are removed. No spaced-out sans capitals anywhere.
- **Numerals:** the day reads in Roman numerals ("III of X") as a display; vigour and steps stay in Arabic lining figures.

### 4.3 Components

| Component | File | New look |
|---|---|---|
| Top bar | `Hud.tsx` | An iron plate with four rivets framing a vellum face. **Left:** a small arc dial whose ember-coloured fill drains across the ten days, with "III *of* X" beneath. **Centre:** "Chapter the First" in rubric small caps over the chapter name in Fell. **Right:** "Ember" in small caps over a row of ember stones set in an iron tray, lit stones glowing and spent ones dark. |
| Objectives | `Hud.tsx` | A torn vellum slip (`clip-path` edge), rotated about −1°, held by an iron nail. Goals are ink lines, and a done goal is struck through in rubric. The beacon count is a rubric tally ("I · III"). |
| Board | `Hud.tsx` | A dark wooden board. **Vigour:** an oxblood fill in a carved groove, labelled in small caps with a Fell number "24 / 30". **Steps:** six slanted notches that glow straw-gold while unspent and are burned dark when spent. |
| Action plates | `Hud.tsx` | Four stamped iron plates with rivets and hand-drawn woodcut-style SVG icons (boot, tent with a wisp of smoke, satchel, book), labels in Fell small caps. **Active** (Move with a preview, Press on): a faint ember edge glow. **Disabled:** dull and rusted (desaturated, darker). |
| Notices | `Hud.tsx`, `notices.ts` | A small torn vellum note in Fell italic. The lead words are in rubric ("The Hush rises · ash wakes further on"). |
| Blocked-tap chips | `Hud.tsx` | The same note style, in a smaller size. |
| Camp | `CampSheet.tsx` | A vellum folio sliding up under an iron bar. A rubric drop cap ("**M**ake camp") and an italic subtitle, then a ruled line. Each choice is an inked entry with a box that takes a rubric check, a Fell name, a Garamond description and a rubric gain. "Read the stars" stays disabled in faded italic. **Confirm:** a red wax seal, "Sleep until dawn". **Close:** an italic "Not yet". |
| Pack | `Pack.tsx` | The same folio. Slots are inked frames on the page, and the relics row is disabled in the same faded italic. |
| Title | `Title.tsx` | A framed book page (a double rule border) over the dimmed world: "The First Book" in rubric small caps, "Tenth Dusk" in large Fell, a rubric ornament, an italic line, a wax-seal "Start a new journey" and an italic "Continue". |
| Naming | `NameHero.tsx` | The same page. The name sits on an inked pen line, and "Take up the lantern" is a wax seal. |
| Chapter intro and end | `ChapterIntro.tsx`, `ChapterEnd.tsx` | Printed pages with a rubric drop cap, and a wax seal for the main action. |
| Turn upright, error and WebGL 2 notice | `Upright.tsx`, `Calm.tsx`, `Guard.tsx` | Vellum pages, using the same materials. |
| Perf overlay | `PerfOverlay.tsx` | Unchanged. It's a developer tool. |

### 4.4 Icons

- Four inline SVG symbols in one `<svg>` sprite: boot, tent, satchel, book. Stroke 1.8 px at 32-unit size, in the vellum ink colour, with round joins, and a little ember only on the tent's smoke.
- No icon library.

## 5. Out of scope

- New game rules, new screens, sound, the battle scene, the M2 rumour markers.
- Changing the camera or the layout positions of HUD blocks.
- Light theme or landscape layouts. Portrait stays the only layout.

## 6. Acceptance

1. `npm test`, `npm run build` and oxlint are clean. `smoke.mjs`, `flow.mjs` (pinned seeds) and `perf.mjs` pass unchanged, apart from screenshot names. `perf.mjs` asserts that the program count does not grow during the walk.
2. **Screenshots** at 360 × 640 and 390 × 844 of the HUD, camp, pack, title, naming, intro and chapter end are saved to `tests/e2e/out`. Each is checked by eye: no texture seams, no text overflow, no overlap, and contrast within C5.
3. **A world before-and-after pair** at the REACH1 start: dead trees read as pale silhouettes, the ground is ash-olive, and warm colour shows only at the lantern.
4. **A lit-beacon pair:** the land near a lit beacon is visibly warmer than the land away from it.
5. **Phone check by Asvin** (`?perf=1`, the same Adreno phone): at least 30 fps while walking. The iPhone 12 reading is still outstanding from M1, and he is asked for it again here.

## 7. Order of work

1. **World:** palette, trees and ground cover, light, grade, ash drifts and haze, vignette and grain, falling ash, warmth as progress. Ship, then phone check.
2. **HUD and screens:** materials and type, top bar, slip, board and plates, notes, sheets, pages. Ship, then phone check.
