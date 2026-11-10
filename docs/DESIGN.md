# Tenth Dusk: design spec

Status: **approved direction, v0.4 (9 Nov 2026).** It covers the concept, the adventure layer (round 2), walled regions with height, caves and books (round 3), and the reuse of the Rift & Root map engine. Concept page with renders: https://claude.ai/artifact/Vxp6LUpSGKamzYwA5crNAY

---

## 1. What it is

A single-player 3D hex adventure for phones, played in portrait with one thumb. The player names the hero, the Lampwright, who carries the last ember of the Dawnspire through a fog-drowned land. The ember lasts ten dusks before it must be rekindled at a hearth, so each **chapter** is a race of up to 10 days to the next hearth. Chapters take place in **zones** of a large **region** walled in by ranges, lakes, dune seas and chasms. Relics are keys: they open quests, story choices, caves and whole zones. The story is released **book by book**, and one hero carries through the series.

### Success criteria

| # | Criterion | How it's measured |
|---|---|---|
| S1 | One chapter takes 10 to 15 minutes | Median of 5 timed playthroughs of Book I chapter 1 by Asvin |
| S2 | Every zone is fair | The generator's checks (§14.2) pass on 1,000 seeds per Book I chapter, never needing more than 5 rerolls |
| S3 | Smooth on a phone | At least 30 fps on a three-year-old mid-range Android and an iPhone 12. First zone in under 3 s. No main-thread task over 100 ms in play |
| S4 | Readable on a phone | Each hex is at least 44 pt at the default zoom, measured at the hero's row. Text is 12 px or larger |
| S5 | Adult and sleek | Asvin signs off the look against the concept renders |

---

## 2. Decisions

| Date | Decision | By |
|---|---|---|
| 9 Nov 2026 | Concept: portrait, ten-dusk clock, fog of war, timed combat, forgiving rules | Asvin |
| 9 Nov 2026 | Adventure: items unlock quests; three inventories (gear, satchel, relics); the hero can be named | Asvin (round 2) |
| 9 Nov 2026 | Map tiles reuse the Rift & Root map engine (§15) | Asvin (asked), Claude (spike) |
| 9 Nov 2026 | No islands as the default board: walled regions with more terrain types, zones opened by the mission, caves, height ("vertical"), a port and voyages later, released book by book | Asvin (round 3) |
| 9 Nov 2026 | The ember lasts ten dusks between hearths, so the clock resets each chapter | Proposed by Claude in v0.4, approved with "Go" |
| 9 Nov 2026 | Portrait-only; 6 steps a day; an expired clock leaves a scar and never ends the game; hamlet trade uses coin | Assumptions stated in v0.2 to v0.4, approved with "Go" |

---

## 3. Story frame

- **The Dawnspire went dark.** Its last ember lives in the Lampwright's lantern. An ember lasts ten dusks unless it is rekindled at a **hearth**: an old shrine-fire on the way to the Dawnspire.
- **The Hush** is a fog that eats memory. Each night it swallows the land behind the hero, so a chapter's road only runs forward.
- **Beacons** are the old relay that once carried the dawn's flame. Each one lit pushes back the Hush around it, and the series keeps count. In Book V that count sets the ending.
- **The hero** is named by the player at the start (default: Wren) and referred to as "they" in all text.
- **Story delivery:** landmark cards with 2 to 4 sentences of second-person prose and 2 to 4 choices. A choice can need a key. Such a choice stays visible but greyed out without the key, and names the key once the hero has seen it. Story flags persist across books.

---

## 4. Structure: series, books, chapters, zones

| Level | What it is | Size |
|---|---|---|
| Series | Books I to V, one hero and one save | — |
| Book | One region with its own story, released as a content update | Region about 20 × 48 hexes (Book I) |
| Chapter | One run: one zone, one ten-dusk clock, ending at a hearth | 10 to 15 min |
| Zone | The playable part of the region for that chapter, enclosed by impassable terrain and closed gates | About 8 to 10 wide × 15 to 18 long playable hexes |

- **Region map:** each book has a hand-shaped skeleton with its ranges, lakes, deserts, coast, the zones, the gates between them, hearths, the port and story landmarks. Hex detail inside each zone is generated from a seed (§14).
- **Zone edges:** every hex outside the zone is either impassable terrain (peaks, lake, sea, dune sea, chasm) or behind a closed **gate**. The world beyond the zone shows as walls fading into the Hush. There is no visible map edge and no island unless the book has a coast.
- **Coordinates:** the rules use offset coordinates `(row, col)` with odd rows shifted right, and row numbers rising forward (up the screen). The renderer converts to axial coordinates centred on the zone.
- **Camera:** portrait, following the hero, about 8 hexes across at the default zoom. Pinch zooms between 0.7× and 2×.

### 4.1 Book I: The Saltreach (the launch book)

- **Region:** a marsh coast and river valley walled in by the Teeth (peaks) to the west and north, by the Grey Sound (sea) to the east, and by Hush-shrouded water to the south. The sea can't be crossed in Book I.
- **Prologue:** a short tutorial zone covering moving, sight, camp, one fight and one relic.
- **Chapter 1, The Reach Road:** the river valley. Gate: the Ford (the Ferryman).
- **Chapter 2, Ammer Fen:** marsh and old wood. A side gate leads to the Old Wood (needs the warden's token). There is one cave.
- **Chapter 3, Under the Teeth:** hills to the mountain foot. The main gate is a snowed pass, or a tunnel cave under the range. The chapter ends at the hearth of Orrin, where the book ends.
- **Book I terrain set:** road, meadow, heath, forest, old wood, hills, mountain, peaks, marsh, river, lake, sea, chasm.

---

## 5. The chapter run

### 5.1 Days and steps

- A day has **6 steps**. Entering a hex costs its terrain's steps (§7) plus 1 for each level climbed (§6). A move costs at least 1. A move the hero can't afford with the steps left isn't allowed.
- **Camp** ends the day. The hero can camp on any hex. A camp-site landmark, or a cave, is safe and grants a third night action.
- **Night actions** (choose 2, or 3 when safe): Rest (+10 vigour), Tend the ember (+2 ember), Forage (gain a ration; ambush 1 in 4; not possible on badlands), Read the stars (reveal one rumour).
- **Pressing on:** after the 6th step, up to 2 night steps. Sight is 1 less, and each night step has a 1-in-3 ambush.
- **Dawn:** steps refill. Then **the Hush** sinks every row more than 4 below the furthest row the hero has reached in this zone. A hero standing on a sunk row moves to the nearest unsunk hex they can stand on that still has a path to the hearth (the nearest they can stand on, if none has).
- **The clock:** the ember dies at the 10th dusk unless the hero reaches the zone's hearth. Some relics add a day (for example, the Hourglass of Ammer: +1).
- **When the clock runs out:** the chapter ends where the hero stands, the book records a **scar** (§13.3), and the next chapter starts at its own start. The game never ends this way.
- **Falling in battle:** the hero wakes at their last camp with every item. Falling costs 1 day and resets vigour to half.

### 5.2 Fog states

Every hex is in one of four states:

- **Unseen:** shown as fog.
- **Remembered:** seen before. Terrain and landmarks show dimmed; enemies don't show.
- **In sight:** full colour, with enemies.
- **Sunk:** lost to the Hush.

A lit beacon marks every hex within 2 of it as remembered and adds one rumour pin. A **rumour pin** is a dashed marker on an unseen hex that names a landmark kind but not exactly what is there.

---

## 6. Height, sight and line of sight

- **Levels:** every hex has a level: 0 lowland, 1 hills, 2 mountain, 3 peaks (impassable). Some terrain has a range (§7). The generator fixes each hex's level within that range.
- **Climbing:** +1 step for each level gained. Going down costs nothing extra.
- **Cliffs:** two neighbouring hexes whose levels differ by 2 or more are **not connected**, unless a link joins that pair: a path, stair or rope (a key, §11). The renderer draws a sheer face there.
- **Sight radius:** 3 + the hero's level, −1 when standing in forest or old wood, and −1 at night. So hills give 4, a mountain 5, and forest 2, as in the concept.
- **Line of sight:** a target hex within the radius is seen unless a hex on the line between has a **blocking height** at or above the hero's eye. Blocking height is the hex's level, plus 0.5 for forest or old wood. The hero's eye is at their level + 0.5. Lines are traced through hex centres with the standard hex line algorithm, nudged by ε to break ties consistently. The target hex itself never blocks.
- **Caves** use the lantern for sight instead (§9).

---

## 7. Terrain

| Terrain | Level | Steps | Crossing | Rule | Books |
|---|---|---|---|---|---|
| Road (overlay) | 0–1 | 1 | Open | Patrols use roads. Roads have gaps | All |
| Meadow | 0 | 2 | Open | Open ground: foes see you from 3 hexes away | All |
| Heath | 0–1 | 2 | Open | Forage +1 | All |
| Forest | 0 | 3 | Open | Hides you from wandering foes. Blocks line of sight. Herbs | All |
| Old wood | 0 | 4 | Key: warden's token | Without the token, entering ends your steps for the day and puts you on a random edge hex of the wood | I, II |
| Hills | 1 | 3 | Open | Cave mouths, watchtowers | All |
| Mountain | 2 | 4 | Open | Cold: −2 vigour on entry unless wearing the fur cloak | All |
| Peaks | 3 | — | Never | Range walls. Crossed only at a pass hex or through a tunnel cave | All |
| Snowfield | 1–2 | 4 | Key: fur cloak | Foes leave tracks | II |
| Marsh | 0 | 4 | Open | Ambush 1 in 3. −2 vigour unless wearing waxed boots | I, IV |
| Desert | 0 | 3 | Open | Each step uses 1 water. With no water left, −3 vigour per step | II |
| Dune sea | 0 | — | Key: water-skins and a guide | Buried ruins | II |
| Badlands | 0–1 | 3 | Open | No foraging. Hush spirits are twice as common | IV |
| River | 0 | — | Ford (2 steps), bridge (1), ferry (event) | | All |
| Lake | 0 | — | Key: boat | | I to IV |
| Sea | 0 | — | Key: ship (§10) | | III, IV |
| Chasm | — | — | Key: rope, stair or rebuilt bridge on a marked crossing | | II, IV |

### 7.1 Landmarks

| Landmark | Placement | What it does |
|---|---|---|
| Hearth | The zone's far end | Ends the chapter: rekindles the ember and resets the clock |
| Beacon | Zone flanks, 2 or 3 per zone | Visit to light it: radius-2 reveal, +1 max ember, +1 to the series beacon count |
| Camp site | At least 1 per 5 rows | Safe camp |
| Hamlet | 1 or 2 per zone | Trade (coin), identify relics, jobs and bounties, claim rewards |
| Port | Book III onward | Passage and ship charters |
| Wayshrine | 0 or 1 per zone | Puzzle: teaches or upgrades a sigil, or gives gear |
| Obelisk | 1 or 2 per book | Lock (needs Grammar of Stones). Teaches a sigil and reveals the next obelisk |
| Ruins or barrow | 1 or 2 per zone | A fight or a card, then a relic or gear |
| Cave mouth | On hills, mountain or cliffs, about 1 per 15 hexes, and at least 1 per zone | Opens a cave map (§9) |
| Lair | 1 per zone, in the far third | Optional elite fight with a guaranteed gear tier-up |
| Pass | A peaks hex marked as a pass | Counts as mountain while open. A gate (§8) |
| Dig site | Placed by a treasure map | Hidden until its map is found |

---

## 8. Zones and gates

- A **gate** is a lock (§11.2) on a hex or edge that joins two zones, or a zone and an optional side zone. Examples: a snowed pass (fur cloak plus the guide's flag), the Ford (the Ferryman's coin or his story choice), a dune-sea crossing (water-skins plus guide), a sealed door (its key), the port (ship charter).
- **Main gate:** the mission always gives a way to open the main gate inside the same chapter, through at least one key the zone itself provides. Side gates may need keys from elsewhere, from earlier books, or from later ones (foreshadowing).
- **Side zones:** optional zones of 10 to 30 hexes (for example, the Old Wood) with their own relics. They share the chapter's clock.
- **Tunnel caves:** a cave can connect two zones under a range. It works as a second way through a gate.

---

## 9. Caves

- A **cave mouth** hex opens a cave map: about 6 × 8 hexes per level, with 1 to 3 levels joined by shafts, stairs or ropes.
- Hexes on a level have heights 0 to 2. The cliff and climbing rules from §6 apply.
- **Sight underground** = the lantern: 2, plus 1 per lantern-glass tier. Line of sight is blocked by any hex higher than the hero's eye. Unlit hexes are unseen.
- Entering or leaving costs 1 step. Moves inside cost 1 step per hex, plus climbing. The clock runs normally.
- **Contents** come from a template: barrow, mine, sea cave, lava tube or tunnel. They include relics, ore, sealed chests (locks), underground water, lurker enemies, a puzzle, and a safe camp. Caves are free of the Hush: the dawn sinking skips them.
- **The cave scene** is its own renderer: rock hex tiles with jittered edges, the lantern as the main light, glows from crystals and fungi, and enemies' eyes beyond the light (concept render: "The Lantern Deeps"). The Rift & Root engine isn't used underground.

---

## 10. Sea and voyages (Book III onward; not in v1)

- The port sells a **ship charter** (a key) once the story allows it.
- A **voyage chapter** plays on a sea map of hexes. The ship moves with the wind, which changes each dawn. A step costs 1 with the wind, 2 across it and 3 against it. Storms block sight.
- **Islands** have small maps of their own. Fights at sea take place on deck. The far island is a new region with its own book (Book IV).
- The sea renderer uses the engine's water material over a sea-only board, with island regions built as ordinary zones.

---

## 11. Adventure layer

### 11.1 Three inventories

| Inventory | Size | Contents | Rule |
|---|---|---|---|
| Gear | 6 slots: weapon, shield, lantern, cloak, boots, charm | Items of tier I to IV, each with one perk | The hero model wears equipped gear. Gear never comes from a shop alone |
| Satchel | 8 slots, stacks of up to 3 | Healing draught, ember oil, herbs, rations, water, smoke, antidote | Consumables. Never a key |
| Relics | Unlimited | Books, maps, coins, instruments, seals, letters, tools (rope, water-skins, boat) | Keys. Each shows what it unlocks once known. Unknown relics show "?" until identified |

Coin is a counter, not a satchel item. Human foes drop it, bounties and jobs pay it, and hamlets spend it.

### 11.2 Keys and locks

Locks and keys are data, so a new book needs no code changes:

```ts
type Key = { relic: RelicId } | { sigil: SigilId } | { flag: FlagId } | { gear: GearId }
interface Lock { id: LockId; needs: Key[]; opens: Outcome[] }       // every key in needs must be held
type Outcome = { gain: ItemId } | { learn: SigilId } | { quest: QuestId } | { reveal: RevealSpec }
  | { flag: FlagId } | { card: CardId } | { open: GateId } | { link: LinkId }  // open a gate; add a path, stair or rope link
```

Book I set:

| Key | Lock | Outcome |
|---|---|---|
| Torn sea-chart (Gravewolf alpha drop, scripted in chapter 1) | Dig site | Quest "The Drowned Cache", then a gear tier-up |
| Grammar of Stones (barrow, chapter 2) | Obelisk | Learn the Unbind sigil, and reveal the next obelisk |
| Ferryman's coin (a choice on the Ford card) | The Ford gate | Opens the chapter 1 main gate. Sets a flag that Book III reads |
| Warden's token (a hamlet job in chapter 2) | The Old Wood side gate | A side zone with a relic and a lair |
| Climbing rope (cave chest or hamlet, 30 coin) | Rope links (marked cliffs, cave ledges) | Adds a link |
| Fur cloak (a gear drop in chapter 3) plus the guide flag | The snowed pass (chapter 3 main gate) | Opens it. The tunnel cave is the other way through |
| Cracked bell-clapper (marsh ruins) | Drowned belfry (Book III) | Unknown until identified |

### 11.3 Quests and markers

- A quest has an id, a title, an origin (drop, card or hamlet), its steps and a marker.
- **Marker kinds:**
  - main: an ember diamond;
  - side, exact: a parchment diamond;
  - side, approximate: a dashed ink circle of radius 1 drawn over fog, which shrinks to one hex when that hex comes into sight;
  - locked: a dashed outline reading "needs a key";
  - rumour: a dashed pin.
- A drop or card that starts a quest shows a notice ("New side quest · …"), adds the quest to the tracker and places its marker.
- **Lodge network:** a job or bounty taken at one hamlet pays out at any later hamlet in the series.

### 11.4 Puzzles

There are four touch puzzle kinds. Each takes 30 to 60 s, is seeded per site, and can always be retried for 1 step.

1. **Stone rings:** rotate three rings to match a mural.
2. **Bell tones:** repeat a sequence of 4 to 6 tones.
3. **Mural sigil:** trace a shape (uses the sigil stroke recogniser).
4. **Mirror hexes:** turn mirrors on a 3 × 3 hex grid to bounce light to a target.

Book I ships stone rings and mural sigil.

### 11.5 Growth

- **Gear sets power.** Gear tiers set attack, guard and vigour. Perks change rules.
- **Deeds set level.** A deed is a quest done, an obelisk woken, a lair cleared, a beacon lit or a cave fully explored. Each level gives +2 max vigour, and every third level offers a choice of 2 perks.
- A journal of deeds ends each chapter.

---

## 12. Combat

- **The scene:** a separate 3D scene on an arena plinth of the terrain where the fight started (cave fights use cave rock). The hero is lower left, seen over the shoulder; the foe is upper right. Turn-based, with a turn-order strip.
- **Strike:** a ring closes on the target. Tap on the ring. A **perfect** tap (120 ms window) deals ×1.5 and chains another strike, up to 3. A **good** tap (260 ms) deals ×1.0. A **miss** deals ×0.5. Assist mode doubles both windows.
- **Guard:** each attack flashes 600 ms before impact. Tap at impact: a perfect tap takes 0 damage and counters; a good tap halves the damage. Choosing Guard as your action widens both windows by 50% until your next turn.
- **Sigils:** spend ember, then draw the stroke. The recogniser scores it from 0 to 1, which maps to 60% to 120% power.

  | Sigil | Stroke | Ember | Effect |
  |---|---|---|---|
  | Flare | Line up | 1 | Fire damage |
  | Ward | Circle | 1 | Shield |
  | Kindle | V | 2 | Heal |
  | Unbind | Zigzag | 2 | The only thing that wounds Hush spirits |

- **Satchel:** use one item. This takes your turn.
- **Book I foes:**
  - Gravewolf: a pack of 1 or 2, weak to flame.
  - Hushwraith: only sigils wound it, and it drains ember.
  - Bandit lamplord: drops coin.
  - Cave lurker: ambushes in the dark and flees from light.
  - The Antlered Hollow: elite. Charges every third turn and telegraphs the charge a turn ahead.
- **Loot:** loot tables per foe, which can include relics.
- **Fleeing:** allowed from regular fights. It costs 1 step and the foe stays on the board.

---

## 13. Books, release and carry-over

### 13.1 Books

| Book | Region | New systems |
|---|---|---|
| I · The Saltreach | Marsh coast, river valley, the Teeth | Everything in M1 to M3 |
| II · The Teeth and the Glass Waste | Passes, tunnel caves, desert | Snowfield, desert, dune sea, chasm, water |
| III · Drownbell | Flooded city, port | Port, ship charter, first voyage |
| IV · The Isle of Ash | A new island | Badlands, sea caves, island zones |
| V · The Dawnspire | The ascent | The ending, set by the beacon count |

A book ships as content (data, models, cards and story) on the same engine. A release that adds a book never breaks existing saves.

### 13.2 Carry-over

The hero's name, level, gear, every relic, coin, sigils, max ember, flags, the beacon count, scars and the journal carry over between chapters and books. The satchel resets to a starting kit at the start of each book.

### 13.3 Scars

An expired clock records a scar for that chapter. A scar is a flag that later content reads: for example, an extra Hushwraith, a closed hamlet, or a harsher card variant. Scars never block finishing a book.

### 13.4 Modes

| Mode | What it is |
|---|---|
| Chapter (default) | One zone, one ten-dusk clock |
| Long Road | All of a book's chapters as one run with an 18-dusk clock. The hearths on the way rekindle nothing |
| Pilgrimage | Every released book on one save, with no satchel resets |

---

## 14. Generation

### 14.1 Authored skeleton, generated interior

- **Each book's region skeleton is authored data:** a coarse map with each zone's outline, the walls (peaks, lakes, sea, dune sea, chasms), gates, hearths, the port, fixed story landmarks, and per-zone biome weights.
- **The generator fills each zone from a 6-character seed:**
  1. Terrain from ranked noise using the zone's biome weights.
  2. Levels from a smoothed height field clamped to each terrain's level range.
  3. Cliffs where neighbouring levels jump by 2.
  4. Rivers and lakes from the skeleton, with 1 or 2 crossings per river.
  5. A road from start to hearth along the cheapest path, with 25 to 40% of it removed as gaps.
  6. Landmarks (§7.1).
  7. The quest graph: the zone's authored story landmarks, 2 or 3 side quests and 1 or 2 foreshadow locks. Each lock is placed first, then its key earlier on the board: a lower row, a cave, or a drop from a foe placed lower.
- **Caves** are generated from their template and a seed derived from the zone seed and the cave's hex.

### 14.2 Fairness checks

The generator rerolls with the next seed if any check fails:

- The hearth can be reached in 7 days or less by the cheapest path, after opening the main gate with keys the zone itself provides.
- Every beacon plus the hearth can be reached in 10 days, counting 8 steps a day (the 6 day steps plus the 2 pressing-on night steps, §5.1), but not in under 9.5 days at 6 steps a day: possible, but tight, and only by pressing on.
- No landmark is cut off. Every one can be reached through open hexes, links, or locks whose keys can be reached earlier.
- Every non-foreshadow lock has its key reachable before the lock. No main-gate key can be missed.
- Each 5-row band has at least one camp site, and each zone has at least one cave.

Tests run 1,000 seeds per Book I chapter and assert that every check passes (S2).

---

## 15. World rendering: the Rift & Root map engine

### 15.1 What it is

`helikos-labs/rift-and-root` at commit `7f00e23`, folder `src/board3d/`, draws a hex board as one organic landscape with no visible hexes. Its parts:

- **Seeded warp:** a domain warp of up to 0.46 hex units, so province borders wander.
- **Field probe:** for each point it gives the province, the distance to each terrain's border, coast, lake and height. Neighbouring mountains merge into ranges, and the coast is a blurred contour with capes and bays.
- **One triangle-lattice mesh**, with the palette in a single table.
- **Patched shaders:** a `MeshStandardMaterial` that finds each pixel's province through a warp texture and reads per-hex state from a small state texture, drawing faint ink borders between provinces.
- **Water:** its own material.
- **Instanced plants** that sway in wind.
- **Curved roads** with bridges.
- **A Web Worker build** that rebuilds only what changed.
- **A procedural model kit:** `rough`, `bake`, `prepare` and `rig`.

The world core imports only the `Cell`, `Terrain` and `Hex` types from the game.

### 15.2 Spike results (9 Nov 2026)

These ran in a scratch copy, with no change to the rift-and-root repo.

1. **The 8 × 15 concept map**, fed to `Board3D` with only `SEA_RADIUS` raised. It rendered as one organic island: the river row split it with a curved road and bridge, mountains merged into ranges, and the coast had beaches and islets.
2. **A 14 × 22 walled valley:** mountain cells on the rim, a lake block to the east, a central range with a one-hex pass. It rendered as a valley enclosed by snow ranges with a big lake and a road through the pass, with no coast in view. **Surrounding the zone with impassable cells is enough to get "not an island".** The coast only shows past the outermost wall cells, which the camera and fog keep out of view.
3. **What it showed must change:**
   - The round tray and round lattice waste portrait space.
   - The palette is too bright for dusk.
   - Mountains top out at 1.25 units, which reads as hills when they form walls.
   - There are no height levels or cliffs.
   - Fog of war is missing.
   - The new terrains are missing.

### 15.3 Decision: copy the world core into the app and adapt it

Copy the world core into `apps/tenth-dusk/src/world/`. Each file's header names the source repo and commit. The two games differ in palette, terrain set, board shape, height and fog, so a shared package would need to be configurable on every axis for little gain. Fixes found in either repo are ported by hand when they matter.

| File | Treatment |
|---|---|
| `field.ts` | Keep. Swap in a local `WorldCell { q, r, terrain, level, road?, landmark? }`. Board bounds replace `radius`. Add new profiles: a **terrace** term per level with sheer faces where levels jump by 2 or more; **peaks** at 3× mountain height; heath, old wood, snowfield, desert dunes, dune sea, badlands and chasm |
| `terrainMesh.ts` | Keep. Build the lattice over the zone's bounds plus a 4-hex wall ring, not a disc. **Detail rings:** full lattice step in the zone, 2.5× coarser in the wall ring. Add the Tenth Dusk palette. Extend `TERRAIN_ID` |
| `materials.ts` | Keep. Add a third state texel per hex (§15.4). Size `SLOT_OFFSET` from the region (about 26 for Book I) |
| `vegetation.ts`, `flora.ts` | Keep. Find the rim from the bounds. Plants read visibility (§15.4). Add marsh pools and reeds, heath, old-wood density, and desert scrub (Book II) |
| `roads.ts` | Keep. A ford uses the bridge kind with stepping stones |
| `worldBuild.ts`, `world.worker.ts`, `worldClient.ts`, `useWorld.ts` | Keep, with types swapped |
| `models/kit.ts`, `models/slices.ts` | Keep. Port the concept models (hero, Gravewolf, Hushwraith, Antlered Hollow, cave lurker, beacon, obelisk, hearth) onto them |
| `layout.ts` | Keep only "a spot on dry land inside the province" |
| `Board3D.tsx` | Don't copy. Write `WorldScene.tsx`: a portrait follow camera, no tray, fog, markers, tap-to-hex through the warp |
| `provinceShapes.ts`, the Rift & Root models | Don't copy. Without WebGL 2 the game shows a "needs WebGL 2" notice |

Where Book I's terrains map in the engine:

| Tenth Dusk terrain | Engine treatment |
|---|---|
| Meadow, heath | `grassland`, with heath as a palette variant |
| Forest | `forest` |
| Old wood | `forest`, at 1.6× density with a darker palette |
| Hills | New: a terrace at level 1 with heath colours |
| Mountain | `mountain`, at level 2 |
| Peaks | `mountain`, at 3× height with snow |
| Marsh | Reuses the `blight` sunken profile with marsh colours and reeds |
| River, lake, sea | `water` |
| Chasm | New, in Book II |

### 15.4 Fog of war in the engine

- **State texel 2 per hex:**
  - `r`: visibility (0 unseen, 0.33 sunk, 0.66 remembered, 1 in sight);
  - `g`: marker kind;
  - `b`: sight-ring highlight;
  - `a`: whether the hex lies outside the zone (wall).
- **Ground shader:**
  - unseen: dark slate with slow mist noise;
  - remembered: 30% saturation, darkened toward the fog colour;
  - in sight: full colour;
  - sunk: fades into the Hush colour;
  - wall hexes: always remembered, and darker the further they lie from the zone.

  The lookup goes through the warp, so fog edges follow the organic borders and blend over 0.12 hex units.
- **Plants** read the same lookup at each instance's origin. Unseen plants scale to 0, and remembered ones are desaturated.
- **Mist:** one plane over the zone whose shader reads fog density from the state texture plus animated noise. It is one draw call.
- **Pieces and landmarks** are shown or hidden from JavaScript.
- **Revealing hexes** only rewrites the state texture. There is no rebuild.

### 15.5 Look

- **Beyond the walls is the Hush:** dark slate and mist. No tray and no table. The coast shows only where a book has one.
- **Palette:** muted moss, ochre, slate and peat, in one table. Ink borders at 25% opacity.
- **Light:** a warm low sun whose angle follows the time of day, a cool rim light, and the lantern as a point light. Keep the engine's baked materials, compiled-ahead shaders, and shadows that redraw only when something changes.

### 15.6 Performance

- **Vertex budget:** keep about 46k vertices on desktop and 26k on phones by scaling the lattice step to the zone's area. The wall ring uses the coarse step.
- **Measure first:** Rift & Root hasn't yet passed its own phone gates, so Milestone 1 measures S3 on real phones before further scene work.

---

## 16. Architecture

```
apps/tenth-dusk/src/
  rules/      Pure TypeScript. No DOM or three.js. Seeded with mulberry32. Unit-tested.
    hex.ts        offset ↔ axial, neighbours, distance, hex line
    terrain.ts    reads data/terrain: steps, level range, crossing rules
    sight.ts      sight radius, line of sight, fog states
    zone.ts       Zone type, links, cliffs, passability
    gen.ts        §14 generator, fairness checks
    run.ts        RunState, move(), camp(), dawn(), the Hush, the clock
    quests.ts     keys, locks, gates, quests, markers, the lodge network
    cave.ts       cave maps, levels, lantern sight
    combat.ts     turn order, damage, timing grades, sigil scoring
    series.ts     books, chapters, carry-over, scars, beacon count, endings
    save.ts       versioned save format (JSON), migrations
  data/       Content as records: terrains, items, relics, locks, gates, quests, cards, foes, loot, book skeletons
  world/      Copied and adapted Rift & Root world core (§15.3)
  scenes/     WorldScene.tsx, CaveScene.tsx, BattleScene.tsx, CampScene.tsx, models/
  ui/         React + MUI HUD: top bar, quest tracker, action bar, pack, cards, puzzles, journal
  App.tsx     Screens: title → name hero → book → chapter intro → world ↔ cave ↔ battle ↔ camp → chapter end
```

- **Data flow:** UI intent → a pure `rules` function `(state, action) → state` → React state → scenes read state. Scenes never write rules state. Randomness comes only from the seeded RNG in state, so a run replays from its seed and action log.
- **Saves:** autosaved to `localStorage` after every action under the key `tenth-dusk.save.v1`. Settings offer export and import as a code. Saves are versioned, with a migration for each version.
- **Errors:** a save that fails to load is set aside as `…corrupt`, and the player is offered a new series. A lost WebGL context rebuilds the scene from state.
- **Ship:** `scripts/new-app.sh tenth-dusk --title "Tenth Dusk" --type "Game · Adventure" --realm town` (public, `tenth-dusk.helikos.dev`). Add `three` ^0.186 and `@react-three/fiber` ^9.8, the versions Rift & Root uses.

---

## 17. Testing

- **Rules (node:test):**
  - terrain costs and climbing;
  - cliffs and links;
  - sight radius and line-of-sight cases (ridge, forest, eye height);
  - fog states and the Hush;
  - the clock, falling, and the scar path;
  - every Book I lock and gate;
  - carry-over;
  - save round-trips and migrations.
- **Generator:** 1,000 seeds per Book I chapter with every fairness check, plus snapshots of 5 fixed seeds.
- **Caves:** level links, lantern sight, and each template's contents.
- **Combat:** damage tables, timing grades at the edges of each window, and the sigil recogniser on recorded strokes.
- **World:** port the core's own tests. A Playwright smoke test renders a zone at 390 × 844 and fails on a blank canvas or a console error.
- **Performance:** a trace of frame times and long tasks on a real phone at each milestone exit (S3).

---

## 18. Milestones

| Milestone | Scope | Exit test |
|---|---|---|
| **M1 Walkable zone** | Scaffold the app. Copy the world core and adapt it: bounds, wall ring, palette, levels and cliffs, peaks, hills, marsh, fog. Rules: hex, terrain, sight and line of sight, zone, run. Generator for chapter 1's zone, with fairness checks. Days, steps, camp, beacons, the Hush, the clock, the hearth. Naming the hero. Pack screen (read-only) | Chapter 1's zone can be walked on a phone from start to hearth or until the clock runs out. S2 and S3 pass |
| **M2 Keys, gates and caves** | Relics, locks, gates, links, quests and markers. Landmark cards with locked choices. Hamlets, coin and the lodge network. Stone rings and mural sigil. Cave maps and the cave scene. The Ford, Old Wood, obelisk, Drowned Cache and rope loops | Book I's quest loops work end to end on 20 seeds |
| **M3 Combat and Book I** | Battle scene, timing ring, guard, 4 sigils, Book I foes, loot. Prologue and chapters 1 to 3, with the snowed pass and the tunnel cave. Chapter and book endings. Journal, effects audio, polish | S1, S4 and S5 pass. Asvin plays Book I start to finish |

Books II to V, the sea and voyages, Long Road and Pilgrimage come after M3, as content on the same engine.

---

## 19. Not in v1

Multiplayer, accounts, cloud saves, a backend, landscape mode, localisation, hand-made model files, music (effects only), free 3D movement, the sea and voyages (Book III), and Book II's terrains (snowfield, desert, dune sea, chasm, badlands).

## 20. Open questions

None block M1.
