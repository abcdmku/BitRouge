# BitRouge Game Spec

## Overview

BitRouge is a hybrid idle roguelike. A hero process auto-explores dungeon floors in real time, so the game idles; the player can take control turn-by-turn at any time. Death is permanent for the run, and runs are the prestige layer.

Theme: IdleBit's compute world. The dungeon is a corrupted data-center stack, the hero is a process/bit, enemies are bugs, daemons, deadlocks, and leaks. Currencies are **Credits** (spend) and **Data** (unlock). Hardware is the idle layer and derives the hero's stats.

Invariants carried over from IdleBit:

- Pure simulation in `src/game` with no React, Phaser, or browser imports.
- Exact decimal `Amount` currencies.
- Deterministic seeded RNG (xoshiro128**), threaded explicitly.
- Hardware-derived timing: no wall-clock timers; duration = work / throughput.
- Data = floor(credits / 10) on bank.
- Offline buffer whose capacity-at-departure is authoritative.
- `applyAction(state, action)` reducer plus selector pattern.

## Two layers

**Hub (persistent)**: Credits, Data, hardware levels, research, watchdog.

**Run (volatile)**: hero deployed with stats derived from hardware, auto-explores, dies, then **banks**:

```
hub.credits += run.credits
hub.data    += floor(banked / 10) + run.salvageData + 5 × (each new max depth reached)
```

If Watchdog is at least L1, a reboot countdown of `16 bits / clockHz` seconds runs, then the hero auto-redeploys. Idle income exists only through runs, so faster hardware means more turns per second means more credits per second. This keeps IdleBit's throughput invariant.

## Hardware → hero

All costs are `base × growth^n` Credits (n = current level).

Display names echo IdleBit's rack vocabulary: **CPU Clock**, **CPU Cores**, **Cache**, **RAM**, **PSU**, **Cooling**, **Scheduler**. The hub UI renders the clock effect IdleBit-style ("2.3 Hz = 0.87s/turn").

| Hardware | Display | Cost | Effect |
|---|---|---|---|
| clock | CPU Clock | 20 × 1.6^n | `clockHz = 2 × 1.15^n`; auto-turn `msPerTurn = 1000 × (2 × 1.35^(depth-1)) / clockHz`; reboot time |
| cores | CPU Cores | 140 × 2.05^n Credits + 2 × 1.3^n Data | daemon (passive) slots |
| cache | Cache | 30 × 1.8^n | `attack = 1 + level` |
| ram | RAM | 35 × 1.7^n | `maxHp = 8 + 6 × level` |
| psu | PSU | 60 × 1.7^n | `powerBudget = 10 × 1.7^(level-1)`; items and daemons draw watts; over budget → lose a turn (trip) |
| cooling | Cooling | 45 × 1.75^n | heat dissipated per turn; attacks add heat; heat ≥ 10 → throttled (enemies act twice) |
| scheduler | Scheduler | 80 × 2^n | auto-explore AI level |

Base costs of clock/ram/cooling were tuned (25→20, 40→35, 50→45) so a greedy player affords the first hardware after 1–3 runs and a second within ~3 more — IdleBit's "always about to afford something" cadence. See `balance.test.ts` for the loose guard.

## Research (Data)

Fifteen starters. Cost in Data unless noted. Ids are stable; display labels echo IdleBit's research ladder, and every definition carries a one-line `flavor` in the transmission voice (exposed on `VisibleResearchRow.flavor`).

| Id | Display label | Cost | Effect |
|---|---|---|---|
| watchdogTimer | Local Scheduler | 5 | Watchdog L1: auto-redeploy, 2 h offline buffer |
| cacheMapping | Cache Mapping | 6 | +2 sight radius |
| prefetchDaemon | Prefetch Daemon | 8 | daemon: reveal floor items |
| thermalSensors | Thermal Sensors | 10 | daemon: -1 heat/turn |
| redundantRail | Redundant Rail | 10 | +50% PSU budget |
| garbageCollector | Garbage Collector | 10 | daemon: +1 HP / 4 turns |
| priorityScheduler | Priority Scheduler | 12 | +1 scheduler AI level |
| multiCore | Multi-Core Control | 15 | +1 daemon slot |
| bugBounty | Bug Bounty | 20 | +25% kill credits |
| coreDumpAnalysis | Core Dump Analysis | 25 | double core-dump Data |
| checkpointing | Checkpointing | 30 | 1 revive per run |
| processReaper | Process Reaper | 35 | daemon: zombies stay dead |
| cronRuntime | CRON Scheduler | 40 | Watchdog L2: 8 h |
| deepScan | Deep Scan | 60 | start at `floor(maxDepth / 2)` |
| systemScheduler | System Scheduler | 150 | Watchdog L3: 24 h |

Watchdog level names mirror IdleBit's Automation Buffer tiers exactly: L0 **Starting Node**, L1 **Local Scheduler** (2 h), L2 **CRON Runtime** (8 h), L3 **System Scheduler** (24 h), L4 **Cluster Controller** (48 h), L5 **Global Scheduler** (168 h).

## Dungeon

Grid 48 × 32. Tiles: `wall | floor | door | stairsDown | hazard`.

Generation:

1. Place 8–12 non-overlapping random rectangles (rejection sampling, at most 200 tries).
2. Sort rooms by x.
3. Carve L-shaped corridors between consecutive rooms, so the floor is connected by construction.
4. Spawn in room 0; stairs in the BFS-farthest room.
5. Enemies `4 + 2 × depth` (+1 kernelPanic on boss floors), items `3 + floor(depth / 2)`, hazards `2 × depth` (biome-weighted kinds).

All draws go through `run.rng`, which is forked from the hub rng per run. Enemy kind rolls are weighted by the depth's biome (see Biomes).

## Turn resolution

`resolveTurn(run, heroAction): run` — the hero acts, each enemy acts (twice if the hero is throttled), hazards and daemons tick, statuses update.

Auto cadence:

```
acc += step
while (acc >= msPerTurn) resolveTurn(run, chooseAutoAction(run))
```

Manual control: `takeControl` freezes the accumulator. `heroMove(dir)` (bump = attack), `heroWait`, `useItem`, `descend`. `releaseControl` resumes auto. `recordDeparture` forces auto so an idle session never hangs in manual mode.

## Auto-explore priority

Scheduler level unlocks lower rows.

1. Adjacent enemy → attack. L1: retreat under 30% HP. L2: use patch first.
2. Visible item → pick up.
3. Nearest unexplored frontier via BFS.
4. Stairs → descend.
5. Unreachable stairs → `forceDescend` (anti-stall guarantee).

## Enemies

| Enemy | Behaviour |
|---|---|
| bitFlip | chase |
| nullPointer | random walk + lunge |
| memoryLeak | slow; each hit lowers maxHp for the floor |
| deadlock | stationary; while adjacent the hero can only attack or wait; 10 locked turns → lose 25% run credits |
| forkBomb | splits on hit |
| daemon | ranged, keeps distance |
| zombieProcess | revives once |
| kernelPanic | boss (see below); never in the random pool |

Scaling per depth: `hp × 1.15^depth`, `dmg + floor(depth / 3)`, kill credits `2 × 1.2^depth`.

## Kernel Panic boss (every 5th floor)

`isBossDepth(depth) = depth % 5 === 0`. On boss floors `generateFloor` places one **kernelPanic** on a floor cell adjacent to the stairs and sets `floor.stairsLocked = true`.

- Stats: baseHp 20 (≈40 at depth 5 after scaling), baseDamage 2, **slow** (acts every other turn), chases and melees like a bitFlip.
- Crossing 50% HP once (`splitTriggered`): spawns 2 alerted bitFlips in free neighbouring cells.
- On death: kill credits × `KERNEL_PANIC_BOUNTY_MULTIPLIER` (20) — a jackpot worth roughly a full run — plus a guaranteed **coreDump** dropped on its tile, `run.bossKills += 1`, `stairsLocked = false`, and a `stairsUnlocked` event.
- While locked, `descend` on the stairs is refused and emits a `stairsLocked` event.
- Auto-explore: after frontier exploration, a locked floor targets the boss with an *unlimited* BFS (the normal chase limit is 8). If the boss is unreachable, `forceDescend` fires anyway — the anti-stall guarantee always wins; `forceDescend` ignores the lock by design.
- Items can stack (a boss can die on a spawned item's cell); stepping on a cell picks up **all** items there.

## Biomes (per 5 depths)

`getBiome(depth)`: floors 1–5 **network**, 6–10 **storage**, 11+ **kernel**. Exposed additively as `RenderSnapshot.biome` and `VisibleRun.biome`.

- Enemy mix (`BIOME_ENEMY_WEIGHTS`, multipliers on base weights): network favours bitFlip/daemon ×2; storage favours memoryLeak ×3, zombieProcess ×2.5 (bitFlip ×0.6); kernel favours deadlock ×2.5, forkBomb ×2, nullPointer ×2 (bitFlip ×0.5).
- Hazard weights (`BIOME_HAZARD_WEIGHTS`): network leans brownout/overloadPlate, storage leans corruptedSector, kernel leans hotTile.
- Renderer: `BIOME_TINTS` in `src/render/assets/manifest.ts` holds per-biome floor/wall multiply tints; TileLayer does not yet apply per-tile tints, so wiring is left to the render integrator.

## Campaign transmissions

IdleBit's signature progression frame: 3 chapters × 4 objectives (`src/game/campaign.ts`). Objectives are **monotone predicates** over persisted state (stats counters such as `deadlocksSurvived`, `bossKills`, `offlineRuns`), so completion is delta-invariant across any advance-step split. The chronological transmission log (`CampaignState.log`, ring of 32 with monotonic `seq`) is the only stored campaign state; the console prints new entries by tracking `lastSeq`, prefixing "Transmission:".

| Chapter | Objective id | Label | Transmission |
|---|---|---|---|
| 1 Bootstrap Process | boot:first-deploy | Deploy a process | "First process deployed. The stack notices." |
| | boot:first-kill | Terminate a fault | "One fault terminated. The heap breathes easier." |
| | boot:first-bank | Bank a run | "First core dumped and banked. Death is a billing event." |
| | boot:first-hardware | Buy hardware | "New silicon seated. The node is no longer stock." |
| 2 Coherent Machine | coherent:cache-mapping | Research Cache Mapping | "Cache mapped. The process sees two tiles further." |
| | coherent:depth-3 | Reach depth 3 | "Depth 3. The storage layer answers slowly." |
| | coherent:survive-deadlock | Survive a deadlock | "Deadlock cleared. The scheduler keeps its promise." |
| | coherent:bank-100 | Bank 100 lifetime credits | "One hundred credits on the ledger. Compound interest begins." |
| 3 Standing Orders | orders:watchdog | Arm the watchdog | "Watchdog armed. The machine can keep a promise while unattended." |
| | orders:offline-run | Complete an offline run | "The node worked while you were gone. Standing orders hold." |
| | orders:depth-5 | Reach depth 5 | "Depth 5. Kernel space. Tread carefully." |
| | orders:kernel-panic | Defeat a Kernel Panic | "Kernel Panic contained. The stack reboots around you." |

Each objective also carries a `blockedReason` shown while incomplete. Exposed via `deriveVisibleState().campaign` (chapters, current objective) and `deriveVisibleState().campaignTransmissions` (the log).

## IdleBit alignment table

| IdleBit concept | BitRouge counterpart |
|---|---|
| Credits / Data currencies | Credits (spend) / Data (unlock) — unchanged |
| K/M/B stack formatting (exact < 100 K, "230 K") | `formatAmount` ports IdleBit's bands and spacing: K M B T Q Qn S Sp |
| Automation Buffer tiers (Starting Node → Local Scheduler → CRON Runtime → System Scheduler → …) | Watchdog levels, named identically |
| Research ladder (Decode Logic → Cache Mapping → Local Scheduler → CRON Scheduler → System Scheduler) | Research labels: Cache Mapping, Local Scheduler, CRON Scheduler, System Scheduler, Multi-Core Control |
| Campaign chapters + transmissions ("Coherent Machine") | 3 chapters × 4 objectives; chapter 2 is literally "Coherent Machine" |
| "2.3 GHz" hardware effect strings | "2.3 Hz = 0.87s/turn" clock rows, "5.9 W budget" PSU rows |
| Jobs/tasks produce currency | Runs produce currency; kill credits ≈ task payouts |
| Offline buffer, capacity-at-departure authoritative | Same invariant, same `departureLevelId` mechanism |
| Standing orders renew while away | Watchdog auto-redeploys runs while away |
| Contracts / SLA windows | (out of scope for now — noted for a later milestone) |

**Hazards**: hotTile (+heat), overloadPlate (PSU trip), corruptedSector (2 dmg), brownout (0 credits → lose turn).

**Items**: patch, hotfix, cacheLine, heatsink, checkpoint, coreDump.

Post-MVP growth: persistent "flash" gear slot. (kernelPanic boss and biomes shipped — see sections above.)

## State model (`src/game/types.ts`)

```ts
GameState {
  version: 1;
  hub: HubState;
  run: RunState | null;
  rng: Xoshiro128State;
  watchdog: { ownedLevelId; departureLevelId; offlineProcessedMs };
  time: { lastSavedAtMs; departedAtMs };
  lastAdvanceReport: AdvanceReport | null;
  campaign: { completedObjectiveIds; log; nextLogSeq };   // additive
}

HubState {
  credits: Amount;
  data: Amount;
  hardware: Record<HardwareKind, number>;
  research: { completed: ResearchId[] };
  stats: { runs; maxDepth; totalKills; lifetimeCredits;
           deadlocksSurvived; bossKills; offlineRuns };   // last three additive
  rebootRemainingBits: number | null;
  lastRunSummary: RunSummary | null;
}

RunState {
  seed; rng; depth; turn;
  control: "auto" | "manual";
  turnAccumulatorMs;
  credits: Amount;
  salvageData; kills;
  hero: { x, y, facing, hp, maxHp, heat, throttled, lockedTurns, items, buffs, checkpoint };
  floor: { width, height, tiles, explored, visible, stairs, hazards };
  enemies: Enemy[];
  items: FloorItem[];
  events: RunEvent[];   // ring of 64, monotonic seq
  nextEventSeq: number;
}

GameAction =
  | buyHardware | buyResearch | purchaseWatchdog
  | deploy | abortRun
  | takeControl | releaseControl | heroMove | heroWait | useItem | descend
  | recordSave | recordDeparture | reset
```

### `advanceGame(state, elapsedMs, mode)`

1. Normalize time to the ns grid.
2. Offline: clamp to `watchdog capacity − offlineProcessedMs`; the remainder is `overflowMs`.
3. Step to the next event boundary (next auto-turn or reboot completion, at most `MAX_ADVANCE_STEP_MS`) so `advance(100)∘advance(100) ≡ advance(200)`.
4. Each tick handles reboot countdown, auto turns, and death → bank.

Offline bound: after `OFFLINE_MAX_SIMULATED_RUNS = 12` full runs (or `OFFLINE_MAX_TURNS = 500k`), extrapolate the remaining time from mean run duration and bank, and report `extrapolatedRuns`.

```ts
AdvanceReport {
  mode; elapsedMs; simulatedMs; overflowMs;
  runsCompleted; extrapolatedRuns;
  creditsBanked; dataBanked;
  bufferLevelId; bufferCapacityMs;
  turnsSimulated; extrapolatedMs;   // additive diagnostics
  hadActivity;                      // additive: gate the offline-return dialog
}
```

Offline runs (simulated + extrapolated) also increment `hub.stats.offlineRuns` for the campaign. `hadActivity` is false when a Starting Node save reloads with zero capacity, so the UI shows the "while you were away" dialog only when something happened.

Planned `src/game/` files: `amount.ts rng.ts types.ts index.ts initialState.ts economy.ts hardware.ts research.ts watchdog.ts hero.ts run.ts advance.ts actions.ts selectors.ts renderSnapshot.ts save.ts dungeon/{grid,generate,fov,path,enemies,items,hazards,turn,autoExplore}.ts`, each with colocated tests.

## Renderer contract (`src/game/renderSnapshot.ts`)

`deriveRenderSnapshot(state): RenderSnapshot | null`

```ts
RenderSnapshot {
  runId (seed); depth; width; height;
  tiles; explored; visible; hazards;
  hero: { x, y, facing, hp, maxHp, heat, throttled, anim };
  entities: { id, kind, x, y, hp, maxHp, facing, anim }[];
  items;
  control; turn; msPerTurn; turnProgress;
  events: RunEvent[];
  biome: "network" | "storage" | "kernel";   // additive
  stairsLocked: boolean;                      // additive (boss floors)
}
```

Additive `RunEvent` kinds: `stairsLocked` (descend refused on a boss floor), `stairsUnlocked` (boss died). The `descended` event is no longer emitted for the turn-0 initial deploy.

The renderer keeps `lastSeq` and plays only new events, so it is idempotent on remount and dropped frames. `RenderCommand` is the hero/control subset of `GameAction`.

### Phaser side (`src/render/`)

- `DungeonScene` has zero game logic.
- `applySnapshot()` rebuilds the tilemap when `runId` or `depth` change.
- Visibility is a black overlay layer with per-tile alpha (0 / 0.6 / 1).
- Entity id → sprite map; moves tween over `min(msPerTurn × 0.8, 120)` ms; `setFlipX(facing === "l")`; depth-sort by y.
- `EventPlayer` maps hit → tint flash + camera shake + damage text, death → fade, pickup → particle burst, descend → camera fade.
- Camera follows the hero. Viewport 12 × 9 tiles (192 × 144) with integer zoom from a `ResizeObserver`. `pixelArt: true`, `roundPixels`, `input.keyboard: false`.
- Prefer the Phaser 4 `TilemapGPULayer` for the floor if it supports per-tile alpha; otherwise use the classic layer for the fog overlay.
- Pure helpers `diffEntities` and `selectNewEvents` live in `src/render/diff.ts` and are unit-tested without Phaser.

### React wrapper (`src/ui/DungeonView.tsx`)

Creates `Phaser.Game` in `useEffect` and destroys it with `game.destroy(true)` on cleanup (StrictMode-safe; the bridge queues the latest snapshot until the scene's `create`). Keyboard is owned by React (`useKeyboard`, window `keydown` → `applyAction`) because the sim is the single source of truth and overlays steal canvas focus.
