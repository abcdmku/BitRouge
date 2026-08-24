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

| Hardware | Cost | Effect |
|---|---|---|
| clock | 25 × 1.6^n | `clockHz = 2 × 1.15^n`; auto-turn `msPerTurn = 1000 × (2 × 1.35^(depth-1)) / clockHz`; reboot time |
| cores | 140 × 2.05^n Credits + 2 × 1.3^n Data | daemon (passive) slots |
| cache | 30 × 1.8^n | `attack = 1 + level` |
| ram | 40 × 1.7^n | `maxHp = 8 + 6 × level` |
| psu | 60 × 1.7^n | `powerBudget = 10 × 1.7^(level-1)`; items and daemons draw watts; over budget → lose a turn (trip) |
| cooling | 50 × 1.75^n | heat dissipated per turn; attacks add heat; heat ≥ 10 → throttled (enemies act twice) |
| scheduler | 80 × 2^n | auto-explore AI level |

## Research (Data)

Fifteen starters. Cost in Data unless noted.

| Id | Cost | Effect |
|---|---|---|
| watchdogTimer | 5 D + 50 cr | Watchdog L1: auto-redeploy, 2 h offline buffer |
| cacheMapping | 6 | |
| prefetchDaemon | 8 | |
| thermalSensors | 10 | |
| redundantRail | 10 | |
| garbageCollector | 10 | |
| priorityScheduler | 12 | |
| multiCore | 15 | |
| bugBounty | 20 | +25% kill credits |
| coreDumpAnalysis | 25 | |
| checkpointing | 30 | 1 revive per run |
| processReaper | 35 | |
| cronRuntime | 40 | Watchdog L2: 8 h |
| deepScan | 60 | start at `floor(maxDepth / 2)` |
| systemScheduler | 150 | Watchdog L3: 24 h |

Watchdog growth beyond starters: L4 48 h, L5 168 h.

## Dungeon

Grid 48 × 32. Tiles: `wall | floor | door | stairsDown | hazard`.

Generation:

1. Place 8–12 non-overlapping random rectangles (rejection sampling, at most 200 tries).
2. Sort rooms by x.
3. Carve L-shaped corridors between consecutive rooms, so the floor is connected by construction.
4. Spawn in room 0; stairs in the BFS-farthest room.
5. Enemies `4 + 2 × depth`, items `3 + floor(depth / 2)`, hazards `2 × depth`.

All draws go through `run.rng`, which is forked from the hub rng per run.

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

Scaling per depth: `hp × 1.15^depth`, `dmg + floor(depth / 3)`, kill credits `2 × 1.2^depth`.

**Hazards**: hotTile (+heat), overloadPlate (PSU trip), corruptedSector (2 dmg), brownout (0 credits → lose turn).

**Items**: patch, hotfix, cacheLine, heatsink, checkpoint, coreDump.

Post-MVP growth: kernelPanic boss every 5 floors, biomes, persistent "flash" gear slot.

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
}

HubState {
  credits: Amount;
  data: Amount;
  hardware: Record<HardwareKind, number>;
  research: { completed: ResearchId[] };
  stats: { runs; maxDepth; totalKills; lifetimeCredits };
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
}
```

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
}
```

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
