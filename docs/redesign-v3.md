# BitRouge v3 — SOLDER

The pixel art IS the machine. No hero, no floors, no dungeon. You build a living
motherboard that must survive a stream of auto-assigned tasks. Packets crawl
along traces you draw; heat spreads; faults glitch; the load escalates until the
system crashes. **Uptime is the score.** Automation drinks from a finite power
reserve; your hands are free. One screen, five tap types, deterministic tick.

---

## 1. Three concepts, judged

**A. SOLDER — motherboard as game board.** 5×7 socket grid. Buy chips, place
them, draw flow with tap-to-rotate trace arrows. Tasks arrive on their own;
cores turn them into packets that crawl one socket per tick, multiply through
CACHEs, and pay on delivery at the PORT. Heat diffuses; faults spread; imbalance
crashes the system. Depth: routing geometry, power budgeting, backlog triage.
Watchable: dots flowing, shimmer, glitches, a queue filling. Can't be boring:
the board is always moving and always one purchase or one crisis from changing.

**B. SWAPFILE — the screen is a RAM map.** Defrag aesthetic: process colonies
allocate colored blocks, fragment, pay on completion; tap to compact, evict,
wall off; corruption creeps through free space. Hypnotic, but interactions are
janitorial, decisions don't compound, all maps converge — and "compacting pays
money" invites the exact "makes no sense" reaction.

**C. PIPELINE — conduct an instruction pipeline.** 5-stage pixel conveyor;
instruction tiles stream in; tap to fuse, reorder, branch-predict; combos pay.
Unique but a timing game: violates no-precision-input, and idles badly — the
stream with the player gone is just a worse game.

**Verdict:** A — the only one where a 30-second glance shows a machine *you*
built fighting for its life, with something worth tapping, and mastery visible
in the artifact itself. Honest caveat: adjacency-grid idles exist (Reactor
Idle); SOLDER differs where it counts — player-drawn visible flow, load pushed
at you, survival as the goal, hands as a resource.

---

## 2. SOLDER — the design

### Goal and the loop of loops
**In-run:** tasks are auto-assigned to the system at an escalating rate. Keep it
alive — balanced across throughput, heat, power, and backlog — as long as you
can. Task payouts (Credits) buy chips, sockets, rails, and firmware *during*
the run; income and load both escalate, so mid-run building never stops.
**Meta:** crash pays Silicon, superlinear in uptime. Silicon buys permanent
capacity, resilience, and **complexity as a reward**: bigger boards, new chip
types, and the richer task types that come with them. Longer runs -> more
currency -> a machine that runs longer against a more interesting load.

### Pillars
1. **The board is the truth.** Every number has a pixel cause you can point at.
2. **Value is a path.** A packet is worth what it traveled through. Geometry is
   the strategy.
3. **Imbalance kills — and death pays.** Drops, expiries, fault spreads, and
   heat runaway all drain one visible INTEGRITY meter. Crash ends the run,
   prints a report that names the killer, and pays Silicon.
4. **Hands beat watts.** Manual work costs zero power, pays more per packet,
   and is limited only by attention. Power is what you buy so the machine runs
   without you. Rescuing a struggling board by hand is the hero moment.

### One-screen anatomy (mobile portrait)

```
+--------------------------------------+
| UP 12:41  INTEG ####._ 82  CR 1,204  |  HUD strip: uptime, integrity,
| DA 18   PWR ###._ 62J -3W   T 74C    |  credits/data, reserve + net watts
+--------------------------------------+
| BACKLOG [b][b][c][c][h][ ][ ]  7/12  |  inbound task queue (tinted chips)
+--------------------------------------+
|   [CORE]->-  .    .    .             |
|     |                                |
|    -v-  [CACHE]  .    .    .         |  Phaser canvas, 5 cols x 7 rows
|     |     ^~heat shimmer             |  16px sprites scaled to fit width
|    -v-   -<-  [CORE]  .    .         |
|     |     |     |                    |
|    -v-  [COOL] -v- [%FAULT%]  .      |  fault = glitch sprite, WORK to patch
|     |          |                     |
|    -v-  .    [MINER]  .    .         |  packets = fx_spark dots on traces
|     |                                |
|  [PORT]  .    .    .    .            |  delivery burst + floating "+8"
+--------------------------------------+
| BUILD | SYSTEM | ARCH                |  bottom sheet tabs (IdleBit rows)
|  CORE   L1  15 cr   [BUY]  (glow)    |
|  RAIL   II  50 cr   [BUY]            |
+--------------------------------------+
```

Five tap types, and WORK is primary: **(1) tap anything lit = WORK it** — a
socket holding a packet advances it one hop instantly; a ready core pulls a task
from the backlog by hand; a fault patches. Zero power, always. **(2) tap empty
socket** = rotate its trace arrow 90 degrees. **(3) tap locked socket** = unlock
(cost printed on the socket). **(4) long-press component** = popover (upgrade /
sell 50% / POWER on-off). **(5) tap shop row then socket** = place. No drag.

### First 10 minutes, beat by beat — hands first, power second
- **0:00** Boot: dead board, uptime 00:00 ticking. 3 sockets unlocked above
  PORT, free CORE L1 on top, arrows preset. Reserve 0 J, generation 0 W. A task
  drops into the backlog. The core pulses: "TAP TO RUN".
- **0:05** Hand-pull the task, tap the packet down the trace: three taps,
  +1.5 cr. Emit, route, deliver — the whole game learned by hand, free.
- **0:45** ~15 cr hand-earned: RAIL I glows (12 cr, +6 W). Buy it. The reserve
  fills, the core pulls tasks by itself, packets crawl unaided: "it's alive" at
  minute one, and the player's hands paid for it.
- **1:30** Tasks now arrive every ~6 s. Unlock a side socket (4 cr), buy CACHE
  (12 cr), detour two arrows through it. Next packet pays 2 — 3 if hand-carried.
- **2:30** Second CORE (15 cr). Draw 7 W > 6 W generation: reserve visibly
  drains. Natural choice: RAIL II, power a chip off (long-press), or keep
  hand-working the second core for free.
- **3:30** CACHE hits 70 heat: shimmer + slowdown, backlog creeps to 5/12.
  COOLER (25 cr) fixes it on screen (+2 W — heat and power pull against each
  other now).
- **5:00** Scripted first fault on the hottest socket: "TAP TO PATCH". One tap.
  Meanwhile the backlog brushed 10/12 — first INTEGRITY dip (-2 drop), meter
  flashes. Stakes understood without a single death.
- **6:30** Reserve empties; board drops to trickle duty, flicker. Buy CAPACITOR
  I (40 cr) and RAIL II (50 cr). MINER (100 cr) next; Data starts; firmware.
- **10:00** Heat Pipes firmware (10 Data). ~9 purchases, 3 routing edits, 1
  patch, ~30 hand-worked packets, integrity 96.
- **~18:00 (gen 1)** Arrival rate finally outruns the board; backlog floods,
  integrity bleeds, the player hand-carries a last frantic minute — crash.
  CRASH REPORT: "UPTIME 18:22 — killed by BACKLOG OVERFLOW (61% of damage).
  +7 SILICON." The ARCH tab opens with something affordable.

### Idle loop and offline story
Foreground: hands are free fuel — tap-work the premium path, patch, re-route,
buy the afford-glow. A 30-second session = one purchase, one rescue. Offline:
**powered automation only** — income and survival are generation-limited, so
pre-departure budgeting (long-press chips off until draw <= generation, keeping
completion rate >= arrival rate) is the idle player's skill. Kindness rules:
escalation freezes at the departure rate while away, and offline integrity
damage floors at 25 — the system never dies alone; you return to a critical
board and save it by hand. Watchdog firmware auto-patches faults after 90 s but
draws 2 W while pending — watchdog capacity is a power decision. Return dialog:
"Away 6h 12m — 2,140 tasks done at 71% duty, +5,320 cr, +148 data, backlog
11/12, integrity 44. It needs you." Full-fidelity deterministic advance (35
sockets is cheap; the engine already event-steps 500k turns), 12 h cap.

### Where depth comes from
Balance is the game: throughput vs value vs heat vs watts vs backlog, under an
escalating clock. Boards diverge permanently (moving a chip refunds 50%).
1. **Snake vs sprint under load.** A 14-hop route through 4 CACHEs pays x16 but
   completes tasks slowly — backlog math decides, not greed. Early game the
   sprint survives; late game only snake income affords the rails you need.
   Mastery is re-routing as the arrival curve steepens.
2. **The overnight budget.** Leaving for 8 h at 14 W draw / 10 W generation:
  71% duty and a flooding backlog — or power off the GPU corridor (10 W) for
  100% duty on a cheaper board that safely outpaces arrivals. Idle survival is
  a loadout decision made in four long-presses.
3. **Run it hot with your hands on it.** Ride 75-heat throttle one cooler short
  because the throttled x16 path still out-earns cool x4 — but only while you
  watch, hand-patching faults and hand-carrying past jams. Walk away and it
  bleeds. Choosing when a build requires your presence is the skill ceiling.

### Prestige — REFLOW (crash-driven)
Crash (integrity 0) triggers REFLOW; voluntary reflow allowed after 10 min
uptime. **Silicon = floor(U^1.8 / 40) + floor(W / 200)** where U = uptime
minutes, W = tasks completed. Superlinear on purpose: two 20-min runs pay ~10
Si; one 40-min run pays ~19 Si + work bonus — pushing a struggling run is
always tempting versus crashing early and rebuying. Resets: board, credits,
data, chips, rails, firmware. Keeps: Silicon, architecture, stats.
**ARCH shop (Si):** Start Kit 3 (begin with RAIL I + 6 sockets), +Integrity 25
-> 5, Base value +20% -> 8 (repeatable x1.6 cost), Reserve x1.5 -> 8, Board 5x8
-> 12, **Gen 2: CACHE tier II + CRUNCH tasks** -> 15, East Port 20, Gen 3: GPU
+ HOT tasks -> 30, Dual Rail 40, Gen 4: QoS junctions + PRIORITY tasks -> 50.
Generations deliberately bundle a new toy with a new threat: complexity is a
reward you buy, and each gen re-tints the silkscreen. The ARCH ladder is priced
so every crash affords something (3-5 Si minimum payout by minute 12).

---

## 3. Mechanics — exact, on the deterministic tick

**Tick.** Base tick 500 ms; effective tick = 500 / (1 + 0.25 * clockLevel) ms,
via `normalizeAdvanceTimeMs`. `advanceGame(state, elapsedMs, mode)` event-steps
to the next boundary exactly as today (timeGrid.ts unchanged). Fixed order per
tick: (1) task arrivals; (2) packet moves, oldest first; (3) core pulls, socket
index ascending; (4) heat; (5) fault rolls (one rng stream); (6) payouts and
integrity. Manual WORK taps are timestamped actions between ticks. Delta
invariance and offline-equivalence tests port directly.

**Tasks and escalation.** Arrival interval = 6,000 ms * 0.97^U * 0.9^(gen-1)
(U = uptime minutes; compounding ~3%/min — every board's throughput is finite,
so every run ends). Backlog cap 12 (+4 per East Port/arch perk). Task base
value = 1.05^U credits (income also compounds — late-run purchases stay live).
Types: **BULK** (gen 1, x1, no requirement) - **CRUNCH** (gen 2, x3, must pass
a CACHE/GPU; delivered raw = drop) - **HOT** (gen 3, x2, double heat per pass)
- **PRIORITY** (gen 4, x5, 45 s deadline). Mix per gen: 100/0/0/0 -> 70/30 ->
55/30/15 -> 45/30/15/10.

**Integrity and crash.** Meter 0-100. Damage: dropped task (backlog full or
raw CRUNCH) -2; expired PRIORITY -5; fault spreading to a chip -5; any socket
at 100 heat -1/s. Regen +1 per 30 s while backlog < 6 and no active fault.
At 0: crash -> CRASH REPORT (damage by source, ranked; uptime; Si payout) ->
REFLOW. The report is the teacher: it names what to fix.

**Power.** Reserve starts 100 J, x1.6 per CAPACITOR level (40 * 1.9^(n-1) cr).
Generation = 6 W per RAIL level tier (RAIL I 12 cr, then 50 * 2.0^(n-1)).
Powered chips draw their W each second; reserve gains (G - draw) J/s, clamped
to [0, max]. Reserve > 0: full speed. Reserve 0 and draw > G: **crawl, not
halt** — the whole board duty-cycles at G/draw speed with brownout flicker
(halting would zero offline play; crawling makes the deficit legible and
survivable). Long-press powers a chip off: draws 0, no effect, conducts as
bare trace x1.

**Manual (zero power, always).** WORK a packet: one hop instantly, half heat,
and x1.5 value if the delivery hop is manual. WORK a core: pull + emit now
(needs a backlog task and an empty socket). WORK a fault: patch, heat -> 50.
Strictly better per packet than automation; throughput-capped by tapping
(~3/s), so hands dominate early game and rescues, watts dominate scale.

**Components** (draw W while powered; costs reset each run):

| kind   | cost (cr)            | effect                                   | heat | W  |
|--------|----------------------|------------------------------------------|------|----|
| CORE   | 15 * 3^(owned-1)     | pulls task -> packet, value x2^(level-1) | +2/emit | 4 |
| CACHE  | 40 * 1.9^(owned-1)   | x2 value per pass (once per distinct)    | +8/pass | 3 |
| COOLER | 25 * 1.7^(owned-1)   | -12 heat/s to self + 4 neighbors         | 0    | 2  |
| MINER  | 100 * 2.2^(owned-1)  | terminal: Data = floor(value/4)          | +4   | 3  |
| GPU    | gen 3, 500 * 2.5^(owned-1) | x4 value per pass                  | +20  | 10 |

Chip upgrade: purchase-cost * 0.6 * 1.15^(level-1); CORE doubles, CACHE/GPU
+25% multiplier. Sell refunds 50%. Socket unlock 4 * 1.35^(n-3) cr. Clock
30 * 1.8^(level-1) cr. PORT fixed bottom-center. In-run curves reset at reflow,
so each run replays the afford ladder — faster every generation thanks to ARCH
multipliers — while the Si ladder paces affordability across runs.

**Packets.** One per socket; each tick a packet moves along its socket's arrow
into an unlocked empty socket, else waits (visible jam). Drop after 32 hops
(+10 heat — loops self-punish). Live cap 48.

**Heat.** Per-socket 0-100. Per second: ambient -1; diffusion h += 0.08 *
sum(neighbor - self); cooler aura -12. >= 70: throttled (half rate, shimmer).
>= 90: fault roll p = 0.02 * (heat - 90) / 10 per second, from the rng stream.

**Faults.** Faulted chip stops working and conducting. Spreads to one adjacent
chip per 30 s unpatched (-5 integrity per spread). Firmware (Data, in-run):
Heat Pipes 10, Watchdog 25, QoS 60 (gen 4: junctions alternate), Hot-Swap 150
(move chips free).

**GameState (save v3):**
```ts
interface GameState {
  rng: Xoshiro128State;                      // rng.ts unchanged
  run: {
    uptimeMs: number; integrity: number;      // 0..100
    credits: Amount; data: Amount;
    backlog: TaskState[];                     // <= cap
    board: { width: number; height: number; sockets: SocketState[];
             packets: PacketState[]; nextId: number };
    system: { railLevel: number; capacitorLevel: number; clockLevel: number;
              reserveJ: number; firmware: FirmwareId[] };
    arrivalAccumMs: number; tickAccumMs: number;
    damageLog: Record<DamageSource, number>;  // feeds the crash report
  };
  meta: { silicon: number; gen: number; architecture: ArchPerkId[];
          bestUptimeMs: number; totalTasks: number; reflows: number };
  savedAtMs: number | null; departedAtMs: number | null;
}
interface TaskState { id: number; kind: "bulk"|"crunch"|"hot"|"priority";
                      value: Amount; deadlineMs: number | null }
interface SocketState { unlocked: boolean; dir: "N"|"E"|"S"|"W"; heat: number;
  component: { kind: ComponentKind; level: number; powered: boolean;
               faulted: boolean; faultAgeMs: number } | null; }
interface PacketState { id: number; taskKind: TaskState["kind"];
  socketIndex: number; value: Amount; visitedMask: number; hops: number }
```
All currency is `Amount` (amount.ts unchanged). `SAVE_VERSION = 3`; v1/v2
migration converts old credits to Silicon at floor(sqrt(credits)/10), fresh run.

---

## 4. Pixel art scope (small)

**Reused from `public/assets/gen`:** tile_floor / tile_floor_cable (board),
port_down (PORT), hazard_corruptedSector (fault), hazard_brownout (flicker),
hazard_hotTile (heat shimmer), fx_spark (packet), fx_hit (delivery), fx_bolt
(crash flash), font.png. Backlog chips are 8 px tinted squares from fx_spark
frames — no new art. **New via the existing pipeline (16x16, 2-frame anims):**
chip_core, chip_cache, chip_cooler, chip_miner, chip_gpu, trace_arrow (rotated
at render), socket_locked. Seven sprites; palette.generated.css unchanged.

---

## 5. Reuse map

**Survives as-is:** `src/game/amount.ts`, `rng.ts`, `timeGrid.ts`, `format.ts`;
`src/platform/*` (persistence, offlineAdvance + worker + handler);
`src/ui/styles/theme.css`, `palette.generated.css`, `Layout.tsx`,
`ResourceHud.tsx` (relabel), `OfflineReturnDialog.tsx` (new copy),
`DeathReport.tsx` (becomes the CRASH REPORT — layout survives, content is the
ranked damage log); `src/render/phaserConfig.ts`, `bridge.ts`,
`assets/manifest.ts` + `preload.ts`, the snapshot/diff/EventPlayer pattern.

**Rewritten around the board:** `advance.ts` (same event-stepped skeleton),
`types.ts`, `initialState.ts`, `actions.ts`, `selectors.ts`, `save.ts` (v3 +
migration), `renderSnapshot.ts`, `watchdog.ts` (fault auto-patch + power draw),
`economy.ts` (curves above), `HubPanel/HardwarePanel` row styling ->
`BuildSheet/SystemSheet/ArchSheet`.

**Dies (with tests):** `src/game/dungeon/**`, `hero.ts`, `run.ts`,
`campaign.ts`, `hardware.ts`, `research.ts`; `src/render/` DungeonScene,
EntityView, SiteView, TileLayer; `src/ui/` DungeonView, RunConsole, RunHud,
RunSummary, TouchControls, AsciiFloor, TaskQueue, SystemPanel.

---

## 6. Implementation plan — one wave, three workstreams, disjoint files

Contract first: this doc's GameState, the action list (`workSocket`,
`rotateSocket`, `unlockSocket`, `placeComponent`, `upgradeComponent`,
`sellComponent`, `togglePower`, `buySystem`, `buyFirmware`, `buyArch`,
`reflow`, `recordSave/Departure`) and the RenderSnapshot fields (sockets,
packets, heat, faults, backlog, integrity, reserve, fx events, crash payload)
are the interfaces; WS1 lands `types.ts` + `renderSnapshot.ts` first.

- **WS1 — sim core** (owns `src/game/**`): board tick, tasks/escalation,
  integrity/crash + damage log, power reserve/duty, heat/faults, manual WORK,
  economy curves, reflow/silicon, save v3; port delta-invariance, offline,
  purity, save tests.
- **WS2 — renderer + art** (owns `src/render/**`, `public/assets/**`,
  `tools/**`): BoardScene (chips, arrows, tweened packets, heat overlay, fault
  glitch, brownout, backlog strip, integrity/reserve flashes), 7 sprites,
  manifest, tap + long-press hit areas -> bridge events.
- **WS3 — UI shell** (owns `src/ui/**`): HUD (uptime/integrity/power), bottom
  sheet (BUILD / SYSTEM / ARCH rows with afford-glow), popover, place-mode,
  crash report from DeathReport, offline dialog copy, delete dead panels,
  mobile QA.

---

## 7. Success criteria

1. **The glance test:** any 30-second look shows packets moving, the backlog
   breathing, and something worth tapping (afford-glow, fault, jam, or a
   hand-carry worth x1.5). Verified on a phone, portrait, one hand.
2. Cold boot to first hand-earned credit: under 10 seconds, three taps.
3. Zero-watt play works: a fresh player reaches 20 cr and buys RAIL I entirely
   by hand; manual is >= 3x automation's per-packet rate in minute one.
4. **The autopsy test:** after any crash, the report's top damage source lets a
   player state in one sentence why they died and what to change ("backlog
   overflow — I needed a second core, not a fourth cache"). Playtest-verified.
5. Gen-1 first crash lands in 12-25 min; each ARCH purchase measurably extends
   scripted-bot uptime; pushing a run 2x longer pays ~3.5x Silicon (U^1.8).
6. **Divergence:** snake-policy vs sprint-policy bots on the same seed differ
   >= 30% in uptime by gen 2.
7. `advanceGame` delta-invariance and offline-equivalence pass; 6 h offline
   advance < 200 ms in the worker; offline never crashes the system (floor 25).
8. 60 fps mid-range phone, 48 packets + full overlays; taps >= 44 px logical.
