# BitRouge redesign v2: the run is a workload

The current build is Rogue with compute nouns. Kills pay, stairs are the goal, and nothing on the
floor does anything a goblin couldn't. This redesign makes the run layer IdleBit's core loop
(accept jobs, hardware processes work volumes, get paid) made spatial. The hero is a process
dispatched into the memory hierarchy to complete work; faults are failures that interfere with
that work; the exit is a buffer flush that only opens when the floor's quota is done.

Everything below fits the existing engine: same grid, same `resolveTurn`, same event ring, same
snapshot pattern, same watchdog/offline machinery. This is an evolution of `src/game`, not a rewrite.

## 1. Design pillars

1. **Work pays, combat defends.** Credits come from executing jobs, hauling payloads, and
   garbage-collecting leaks. Data comes only from mining data nodes. Kills pay pocket change.
   You fight to protect work in progress, not because fighting is the game.
2. **The map is the machine.** Floor topology, turn latency, and yields come from the real memory
   hierarchy: cache floors are small, fast, and poor; disk floors are big, slow, and rich.
   Corridors are buses, doors are gates, the exit is a flush. Deeper is not "harder", it is
   higher-latency and higher-value, which is exactly what clock upgrades trade against.
3. **Attention is the scarce resource.** Every fault is an interruption with a cost curve:
   a forkBomb doubles if ignored, a bitFlip erases mining progress if it arrives, a leak walls
   off a corridor. The turn-to-turn question is never "what do I kill", it is "what do I let slide".

## 2. Floor anatomy and generation per tier

Depth bands become memory tiers (replacing biomes). `getTier(depth)`:

| Tier | Depths | Latency (cycles/turn) | Layout | Controller (boss) floor |
|---|---|---|---|---|
| cache | 1-3 | 2 | bank lattice | 3 |
| ram | 4-7 | 5 | parallel banks + channels | 7 |
| disk | 8-11 | 12 | concentric ring sectors | 11 |
| kernel | 12+ | 8 | corrupted rooms | 15, 19, 23, ... |

`msPerTurn = 1000 * cyclesPerTurn(tier) / clockHz`, replacing the current
`1000 * (2 * 1.35^(depth-1)) / clockHz`. At stock clock (2 Hz): cache 1.0 s, ram 2.5 s, disk
6.0 s, kernel 4.0 s per turn. Slower turns on rich floors means every clock level is felt most
exactly where the money is. Kernel is faster than disk on purpose: it is dangerous, not laggy.

All four generators emit the existing `FloorState` (tiles array, one spawn, one exit tile,
connected by construction). Only the carving differs. Legend: `#` wall, `.` floor, `+` gate
(door), `>` bus gate (exit, keeps TileKind 3), `N` data node, `J` job station, `P` payload,
`O` I/O port, `V` vent, `~` corruption hazard.

**cache (1-3)**: 4x3 lattice of 4x3 banks, straight bus corridors, gates at every bank mouth.
Small (32x20 used area), dense, fully visible fast. Teaches the loop.

    ##########################
    #.N.+....+.J.#....#.P..#
    #...#....#...+....+....#
    ####+####+###+####+#####
    #...#.V..#...#.O..#..>.#
    #.J.+....+.N.+....+....#
    ##########################

**ram (4-7)**: 3-4 long horizontal banks (rows of 30x4) joined by 2-3 vertical channel
corridors. Long sightlines, long hauls; payloads spawn far from their ports.

    ############################
    #.N....J.......P.....N.....#
    ####+#####+###########+#####
    #.....V......O......J...>..#
    ####+#####+###########+#####
    #..P........N........J.....#
    ############################

**disk (8-11)**: 2-3 concentric ring corridors with radial spokes; sectors (rooms) between
rings. The hub cell holds the bus gate; the outer ring holds the richest nodes. Route
planning is the whole floor: going around a ring the wrong way costs 20+ slow turns.

    ##########################
    ##....N....####....J....##
    #..########....########..#
    #.+#..P...+....+..N...#+.#
    #..#...####.>..####.V.#..#
    #.+#..J...+....+..O...#+.#
    #..########....########..#
    ##....V....####....N....##
    ##########################

**kernel (12+)**: current rejection-sampled rooms, then a corruption pass eats 8% of wall
cells and converts 5% of floor cells to `~` hazards. Irregular, unreliable, fault-heavy.

Site placement: nodes go in dead-end banks (risk: one way out), job stations near corridors,
payload/port pairs at least 12 BFS steps apart, 1-2 vents per floor near job stations.

## 3. Work sites: mechanics and numbers

New floor entities in `RunState.sites` and `RunState.payloads`. Three site kinds, three
distinct risk textures. `tierIndex` is 0..3, `d` is depth. A new `interact` hero action
(context-sensitive: start/continue channel, pick up, deliver, collect leak) drives all of them.

**Data node (mine).** Stand adjacent, `interact` each turn to channel.
- Channel turns: `max(2, (4 + 2*tierIndex) - floor(cacheLevel / 2))`. Cache is bandwidth now.
- Yield: `tierBase + (depthInTier - 1)` Data, tierBase = cache 1, ram 4, disk 10, kernel 18.
- Taking any damage mid-channel resets the node to full turns (mining is not resumable).
- A bitFlip reaching the node corrupts it: yield drops 25% of original (floor), channel
  resets. Four unanswered flips zero a node; a zeroed node counts as resolved for quota.
- This is the only Data source in the game besides the first-scan bonus. "Mining for data"
  is now literal.

**Job station (execute).** Stand on the station tile, `interact` to process.
- Work volume: `W = 12 * 1.25^(d-1)` units. Processed at `1 + cacheLevel` units per turn.
- Payout on completion: `W` credits. One credit per work unit, IdleBit's exact base rate.
- Resumable: interruptions keep completed units. The safe, slow earner.
- A zombieProcess can squat a station (holds the resource); unusable until it dies.

**Payload haul (deliver).** Pick up `P`, walk it to its `O`, `interact` to deliver.
- Payout: `10 * 1.3^(d-1)` credits on delivery.
- While carrying: cannot channel, fault alert radius doubles, +1 W power draw, and a rogue
  daemon adjacent to you steals it. The risky, travel-shaped earner.

**Heat and overclock.** Channeling or executing adds +2 heat per turn (same as `ATTACK_HEAT`);
throttle thresholds unchanged (on at 10, off at 4). Standing on a vent tile adds +3 dissipation.
New `overclock` action: for 10 turns, `msPerTurn * 0.5`, +2 heat per turn, +4 W draw. Trip and
throttle rules already in the sim make this a real decision, not a free button.

**Quota and the flush.** Each floor rolls a task list; the bus gate reuses `stairsLocked`
(with its existing events and auto-explore handling) until `quota.done >= quota.required`:

| Tier | Sites per floor | Quota | Mix (nodes / jobs / hauls) |
|---|---|---|---|
| cache | 5 | 3 | 2 / 2 / 1 |
| ram | 6 | 4 | 2 / 2 / 2 |
| disk | 6 | 4 | 3 / 2 / 1 |
| kernel | 7 | 5 | 3 / 2 / 2 |

Controller floors additionally require the kernelPanic dead (both conditions gate the flush).
Corrupted-to-zero nodes and stolen-then-lost payloads still count as "resolved" for quota so a
floor can never become uncompletable; `forceDescend` (renamed `forceFlush` in intent only)
remains the anti-stall guarantee.

**Economy summary.**
- Kill credits: `1 * 1.15^(d-1)` (down from `2 * 1.2^(d-1)`). Bounty exceptions: daemon
  carrying a stolen payload pays 5x, kernelPanic bounty multiplier stays 20.
- GC a leak cell: `2 * 1.2^(d-1)` credits per cell, 2-turn channel per cell.
- Banking: `hub.data += run.dataMined + 5 * newMaxDepths`. The `floor(credits/10)` conversion
  is removed (deliberate break with the IdleBit invariant; see section 8).
- First-floor income check: quota on depth 1 = one job (12 cr) + one haul (10 cr) + one node
  (1 Data) plus ~5 cr of GC and kills. Roughly 27 cr per floor, in line with today's kill
  income, so hardware costs and the "afford something every 1-3 runs" cadence hold.
- Run length: cache floors are 60-90 turns at 1 s per turn; 2-3 floors per early run puts a
  run at 2-4.5 minutes, inside the 2-5 minute target.

## 4. Fault roster rework

Each fault maps to a real failure, disrupts work specifically, and has stated counterplay.
Combat stats and depth scaling carry over; behaviors change. `hp` reads as "integrity" in UI.

| Fault | Real failure | How it disrupts work | Counterplay |
|---|---|---|---|
| bitFlip | cosmic-ray bit flip | Ignores the hero; paths to the nearest uncompleted data node (prefers ones in progress). On arrival: node yield -25%, channel reset, flip despawns. | Intercept it in the corridor; body-block the bank mouth; finish the node first. |
| memoryLeak | unfreed allocation | Stationary allocator. Every 8 turns converts one adjacent free cell to a leak cell (impassable, stored in `run.leaks`). Left alone it walls off corridors and eventually banks. | Kill the allocator to stop growth; GC leak cells (2-turn channel each) for credits. GC is gameplay, not chore text. |
| deadlock | lock cycle | Spawns on a gate (door) tile and latches it shut; the existing "adjacent = attack or wait only" rule stays. High HP, deals no damage. It costs turns, not blood. | Kill it (gate reopens, small bounty) or route around. The 10-turn credit-loss penalty is cut. |
| daemon (rogue daemon) | runaway background process | Keeps distance as today; if adjacent while you carry a payload, steals it and flees toward its spawn. 20 turns to catch it or the payload resolves as lost. | Don't haul past it; kill it first (5x bounty while it carries). |
| forkBomb | fork bomb | Splits on hit (existing) and now also duplicates every 12 turns if no copy has been damaged in that window. `MAX_FORK_BOMBS` cap stays. | Pay attention early or pay in turns later. The purest attention tax. |
| nullPointer | wild pointer dereference | Random walk + lunge (existing). Its hit cancels any channel (all damage does) and its kill-you cause is "Segmentation fault". | Screen it away from banks; it is the reason mining near open corridors is risky. |
| zombieProcess | defunct process holding a resource | Walks to the nearest job station and squats it (station unusable). Revives once (existing dormant machinery). | Kill it twice or eat the station loss. processReaper research ends the squat for good. |
| kernelPanic | kernel panic | Controller-floor boss, guards the gate. Below 50% HP: on cache/ram/disk it sheds 2 bitFlips (existing split); on kernel tier it scrambles the floor instead: walls re-carve with a fresh rng draw, entities and sites re-place on nearest walkable, progress preserved. | Manual takeover moment. Burst it past 50% near a vent, or clear adds first. |

Death causes are named failures so death reads fairly: "Segmentation fault", "Thermal
shutdown" (died while throttled), "Power trip cascade", "Corrupted sector", "Kernel panic".
`RunSummary.cause` already carries the string; only the strings change.

## 5. Turn texture and auto-explore

What makes turn N interesting: you are usually mid-task, and every fault on screen has a
countdown you can estimate. Continue the channel (2 more turns, but the bitFlip is 3 away)?
Drop the haul to GC the leak before it seals the ring spoke? Overclock through the job and
eat the heat, or walk to the vent first? The decisions are scheduling decisions, which is
the fantasy.

Auto-explore priority (replaces the current table; scheduler level unlocks rows marked L1+):

| # | Rule | Level |
|---|---|---|
| 1 | Survival: patch below threshold, retreat as today | L0 (L1 retreat) |
| 2 | Adjacent fault: attack (deadlock only if it blocks the current plan) | L0 |
| 3 | Continue an in-progress channel if no fault within 2 cells | L0 |
| 4 | Carrying: deliver by shortest route; L1+ re-routes around fault-adjacent cells | L0 |
| 5 | Intercept: bitFlip within 6 of an in-progress node; forkBomb past turn 8 of its window | L2 |
| 6 | Start next task: L0 nearest site; L2 best credits-or-data per turn; default order mine > execute > haul | L0 |
| 7 | GC leak cells that block the current path (always) or pay well (L1) | L0/L1 |
| 8 | Explore nearest frontier (unchanged BFS) | L0 |
| 9 | Quota met: path to bus gate, flush | L0 |
| 10 | Anti-stall: forceFlush, unchanged semantics | L0 |

L3 (new top scheduler level) uses overclock automatically when heat < 4 and a job is in
progress. Manual takeover moments the design plans for: controller floors, disk-ring haul
routing, overclock timing, and picking which 3-of-5 tasks fill quota (auto picks greedily;
a human can pick the safe three). Existing plan caching and `searchWithFallback` carry over;
sites become goal sets exactly like items are today.

## 6. Hub tie-ins: what each hardware line means now

| Hardware | Old effect | New meaning |
|---|---|---|
| CPU Clock | turn speed | Unchanged, but now visibly worth more on deep floors (latency model). |
| CPU Cores | daemon slots | Unchanged. |
| Cache | attack | Bandwidth: attack `1 + level` stays, plus `+1` job units/turn and `-floor(level/2)` mine channel turns. |
| RAM | maxHp | Process integrity, unchanged numbers. |
| PSU | power budget | Unchanged; hauling (+1 W) and overclock (+4 W) now draw against it. |
| Cooling | heat dissipation | Unchanged; channeling generates heat, so cooling is now a work stat, not a combat stat. |
| Scheduler | AI level | Rows in the table above; the upgrade you literally watch get smarter. |

Research repurposes (ids stable, descriptions change): prefetchDaemon reveals sites instead
of items; bugBounty becomes "+25% work payouts" (rename label "Piecework Rates");
garbageCollector daemon auto-GCs one adjacent leak cell per 4 turns (its heal moves to
patch items only); coreDumpAnalysis doubles controller-floor Data. New research (3 slots on
the existing ladder): "DMA Controller" 20 Data (hauling no longer doubles alert radius),
"Branch Predictor" 25 Data (first hit during a channel does not reset it), "ECC Memory"
30 Data (bitFlip corruption halved). The hub run panel gains a task queue: the floor's
sites listed as IdleBit job rows with live progress bars. That one panel is the loudest
"same universe" signal in the game.

## 7. Exact delta vs current sim

State (all additive to `types.ts` unless flagged):
- `RunState`: `sites: WorkSite[]`, `payloads: Payload[]`, `leaks: number[]` (cell indices),
  `quota: { required: number; done: number }`, `dataMined: number` (replaces salvageData's
  role; keep the field, rename usage), `overclockTurns: number`.
- `WorkSite { id; kind: "dataNode" | "jobStation" | "ioPort"; x; y; totalUnits;
  remainingUnits; yieldData: number; payoutCredits: Amount; corrupted: number;
  squattedBy: number | null; resolved: boolean }`.
- `Payload { id; x; y; portId; payoutCredits: Amount; heldBy: "floor" | "hero" | number
  (daemon id) | "lost" }`.
- `HeroState`: `channelSiteId: number | null`, `carryingPayloadId: number | null`.
- `HeroAction`: `+ interact`, `+ overclock`. `descend`/`forceDescend` semantics unchanged.
- `HubStats` (campaign fuel, additive): `sitesCompleted`, `dataMined`, `payloadsDelivered`,
  `leaksCollected`.
- Enemy: `targetSiteId: number | null` (bitFlip/zombie pathing), `stolenPayloadId`,
  `stealTimer` (daemon).

Events (additive `RunEvent` kinds; ring and seq unchanged): `siteChanneled {siteId,
remaining}`, `siteCompleted {siteId, siteKind, credits, data}`, `siteCorrupted {siteId}`,
`siteSquatted {siteId, byId}`, `payloadTaken {id}`, `payloadStolen {id, byId}`,
`payloadDelivered {id, credits}`, `payloadLost {id}`, `leakSpawned {index}`,
`leakCollected {index, credits}`, `overclocked {on}`, `quotaProgress {done, required}`,
`floorScrambled`. `stairsLocked`/`stairsUnlocked` are reused verbatim for the quota gate.

Snapshot (`RenderSnapshot`, additive): `sites`, `payloads` (with heldBy so the renderer can
attach the sprite to a carrier), `leaks`, `quota`, `hero.channeling: number | null`,
`hero.carrying: number | null`, `overclockTurns`, `tier`. Tile values: `vent = 4` added
(additive; existing values keep their numbers, exit keeps 3 with new art).
**Breaking changes, flagged:** (1) `biome: "network" | "storage" | "kernel"` is replaced by
`tier: "cache" | "ram" | "disk" | "kernel"`; cheap because per-tile tinting was never wired.
(2) Data banking drops `floor(credits/10)`; economy tests and the spec invariant list must
update. (3) `RenderCommand` gains `interact` and `overclock`. Nothing else in the contract
moves.

Selectors/UI surfaces: `VisibleRun` adds `quota`, `tasks: VisibleTaskRow[]` (name, kind,
progress 0..1, payout label, blocked reason like "squatted by zombie"), `carrying`,
`channeling`, `overclockTurns`, `dataMined`. Hub console prints site events as syslog lines
("sector 7 mined: +4 D", "payload delivered to port 2: +13 cr").

## 8. Migration and cut list

Dies outright: find-the-stairs as the goal (gate is quota-locked); kill credits as primary
income; deadlock's 25% credit-loss timer (`DEADLOCK_PENALTY_FRACTION`, `lockedTurns` UI);
memoryLeak's maxHp drain; biome enemy/hazard weight tables (replaced by per-tier fault
mixes: cache = bitFlip/forkBomb, ram = memoryLeak/nullPointer/zombie, disk =
daemon/deadlock/zombie, kernel = everything, hot); the smooth `1.35^depth` latency curve;
`salvageData`'s coreDump-only meaning; the Data-from-credits conversion (the one IdleBit
invariant we break, and it is worth breaking: it is what made Data feel like a rebate
instead of a thing you mine). Keeps unchanged: watchdog/offline/advance, amount/rng, reboot,
hazards (rethemed per tier), items, checkpoint revives, campaign machinery (three
transmission strings mention depth-5/kernel-space and need retext; objective predicates gain
work-stat variants like "mine 10 Data in one run"). Old saves: version bump to 2, migrate by
banking any live run and zeroing it; hub state maps 1:1.

## 9. Implementation plan: three parallel workstreams

Sequencing: workstream A lands the contract commit first (types.ts + renderSnapshot.ts type
shapes only, no behavior), then all three run in parallel with disjoint files.

**A. Sim mechanics** (owns `types.ts`, `renderSnapshot.ts`, `hero.ts`, `economy.ts`, `run.ts`,
`dungeon/turn.ts`, `dungeon/enemies.ts`, new `dungeon/worksites.ts` + tests): interact and
overclock actions, channel/haul/execute resolution, quota + gate reuse of stairsLocked, new
fault behaviors, heat/vent/power hooks, banking change, death-cause strings. Delivers a
headless sim where a scripted hero can complete a quota floor.

**B. Generation and auto-explore** (owns `dungeon/generate.ts`, new `dungeon/tiers.ts`
replacing `biomes.ts`, `dungeon/autoExplore.ts`, `dungeon/grid.ts` + tests): four tier
carvers emitting current FloorState, site/payload/vent placement rules, latency table, the
priority table in section 5 including intercept and task-value scoring. Delivers auto runs
that clear quotas unattended and never stall (property test: 200 seeded runs, zero stalls).

**C. Render and UI** (owns `src/render/*`, `selectors.ts`, `src/ui/*`): site sprites with
progress rings, carried-payload attachment, leak overlay cells, quota HUD, task queue panel
in the hub console, overclock/interact buttons (mobile), tier palettes, syslog event lines,
death report screen. Delivers the visible machine; consumes only the frozen contract from A.

## 10. Success criteria: "you are inside a machine"

1. Balance-sim proof: over 50 seeded auto runs, work sites + deliveries + GC produce >= 70%
   of credits and kills <= 15%; 100% of Data comes from mining and first-scan.
2. Watch any auto run for 60 seconds: you see the hero channel a node with a progress bar,
   haul something, and collect a leak, without a single fight being required to understand it.
3. Killing every fault on a floor while doing no work never opens the gate; the quota HUD
   says why; forceFlush still guarantees no stall.
4. A disk floor's turn is >= 4x a cache floor's turn and its median node yields >= 8x, and a
   player who buys two clock levels can state where that purchase paid off.
5. Every death screen names a real failure mode, and the event log of the last 10 turns reads
   as a plausible syslog.
6. The hub task queue panel is visually interchangeable with an IdleBit job list.
7. Early runs land in 2-5 minutes; existing offline extrapolation still validates against
   foreground simulation within its current tolerance.
8. Playtest phrasing check: testers describe floors by machine names ("the ring floor",
   "the RAM banks") unprompted. If they say "dungeon level", section 2 failed.
