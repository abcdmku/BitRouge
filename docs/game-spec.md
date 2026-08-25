# BitRouge Game Spec

## One sentence

BitRouge is an interactive idle game about building a computer that can stay online under an escalating workload.

## Player fantasy

The player is the operator of a small compute node. Jobs enter a queue, move through installed hardware, and pay Credits at the output. Faster hardware clears more work, but draws more power, produces more heat, and exposes the node to longer and harder load tests.

The target feel combines three things:

- IdleBit's clean computer vocabulary, Credits and Data economy, research names, automation tiers, and Hz to GHz scale.
- The Tower's long survival runs, mounting pressure, post-run diagnosis, and permanent prestige choices.
- Idle Brick Breaker's readable machine-in-motion, direct interventions, and frequent upgrade decisions.

There is no dungeon, hero, or arbitrary socket editor in the primary game. The computer is the game.

## Core loop

1. Jobs arrive automatically.
2. The CPU pulls jobs from the queue and sends them across the job bus.
3. Installed Cache, RAM, GPU, and Cooling modules change value, Data yield, heat, and capacity.
4. Completed jobs pay Credits and advance the active research project.
5. The player upgrades the current bottleneck while watching power, heat, faults, queue pressure, and integrity.
6. Foreground load rises over time. A run eventually becomes difficult to sustain.
7. The player can Reflow after 10 minutes, or after a crash, to earn Silicon for permanent architecture.
8. Hardware, Credits, Data, firmware, and research persist through Reflow. Uptime, heat, faults, integrity, and the queue reset.

## The first five minutes

The opening should teach the whole game without a tutorial modal.

- The starting CPU is powered by PSU Capacity I and processes queued jobs automatically at 100% duty.
- A job arrives every 6 seconds at the first pressure level.
- RUN TASK NOW is an optional intervention. It carries one waiting job through the current route with no power cost and pays a 1.5x manual bonus.
- A brand-new save cannot take backlog-overflow damage until its first completed job. The player can safely inspect the screen.
- Three automatic base jobs pay enough to begin Decode Logic.
- The first screen states whether automatic processing is running and gives one explicit next target with progress.
- The next PSU purchase is Capacity II. It raises the power budget for additional hardware.
- VENT HEAT removes 25 heat and has an 8 second hardware cooldown.
- SHED LOAD discards the three oldest queued jobs to protect integrity.

The player should understand the immediate objective from the first screen: let the CPU earn 3 Credits, begin Decode Logic, and upgrade the first bottleneck that turns amber.

## Workload and failure

Foreground pressure rises continuously. Arrival interval is:

```text
6000 ms * 0.97 ^ foregroundMinutes * 0.9 ^ (generation - 1)
```

The interval never drops below 250 ms. Later architecture introduces CRUNCH, HOT, and PRIORITY work.

Integrity starts at 100. It falls from:

- queue overflow: 2 damage per dropped job;
- expired PRIORITY work: 5 damage;
- fault spread: 5 damage;
- raw CRUNCH output: damage when it skips processing;
- sustained 100 heat: 1 damage per second.

Integrity regenerates at 1 per 30 seconds while fewer than 6 jobs are queued and no fault is active. At 0 integrity, the node freezes and the crash report ranks the damage sources. The report must tell the player why the run ended.

## Hardware

Hardware is installed into fixed, readable blueprint positions. The primary UI does not ask the player to route an abstract grid.

| Part | First cost | Draw | Effect |
|---|---:|---:|---|
| CPU Core | 15 CR for the second core | 4 W | Pulls one job. Output doubles per level. Extra cores require Multi-Core Control. |
| Cache | 40 CR | 3 W | Doubles each job once. Requires Cache Mapping. |
| RAM | 100 CR | 3 W | Stages work and recovers `floor(job value / 4)` Data. Requires RAM Control. |
| Cooling Loop | 25 CR | 2 W | Removes 12 heat per second from itself and adjacent hardware. |
| GPU | 500 CR | 10 W | Multiplies routed value by four. Requires Specialized Compute and Gen 3. |

System upgrades:

| System | First cost | Growth | Effect |
|---|---:|---:|---|
| PSU Capacity II | 50 CR | doubles after Capacity II | Adds 6 W generation per level. The node starts at Capacity I. |
| Power Reserve | 40 CR | 1.9x | Stores 1.6x more energy per level. |
| CPU Clock | 30 CR | 1.8x | Shortens each hardware cycle. Tier boundaries require research. |

Upgrading a component costs `0.6 * base cost * 1.15 ^ (level - 1)`. A powered system above its generation budget drains the reserve, then runs at partial duty instead of stopping completely.

## Currencies

- Credits buy hardware, system levels, and research starts.
- Data buys firmware and pays the Data part of research costs. Every fifth lifetime completion also yields 1 Data, so the opening research path cannot deadlock before RAM.
- Silicon comes from long runs and buys permanent architecture.

All Credits and Data are exact decimal `Amount` strings. Simulation code never uses floating-point currency balances.

## Research

There is one active R&D slot. Starting a project pays its resource cost immediately. Completed jobs provide the work units, so better throughput completes research sooner. Research is persistent.

| Research | Cost | Work | Requires | Unlock |
|---|---:|---:|---|---|
| Decode Logic | 3 CR | 4 jobs | none | Opens the compute tree. |
| Cache Mapping | 6 CR + 2 Data | 6 jobs | Decode Logic | Cache modules. |
| Benchmark Harness | 28 CR + 1 Data | 10 jobs | Decode Logic | Multi-core path. |
| Multi-Core Control | 56 CR + 6 Data | 16 jobs | Benchmark Harness | Additional CPU cores. |
| Local Scheduler | 80 CR + 6 Data | 24 jobs | Multi-Core Control | 2 hour Automation Buffer. |
| RAM Control | 260 CR + 3 Data | 30 jobs | Local Scheduler | RAM modules. |
| System Bus | 520 CR + 10 Data | 80 jobs | Local Scheduler | Scheduler and package path. |
| CRON Scheduler | 360 CR + 10 Data | 80 jobs | System Bus | 8 hour Automation Buffer. |
| System Scheduler | 320 CR + 8 Data | 50 jobs | CRON Scheduler | 12 hour Automation Buffer and system policies. |
| Thermal Control | 5,000 CR + 24 Data | 180 jobs | RAM Control | Thermal firmware path. |
| Specialized Compute | 25,000 CR + 40 Data | 300 jobs | Thermal Control | GPU and Hot-Swap path. |
| kHz CPU Research | 2,000,000 CR | 600 jobs | System Scheduler | kHz CPU and RAM tier. |
| MHz CPU Research | 20,000,000,000 CR | 1,800 jobs | kHz research | MHz CPU and RAM tier. |
| GHz CPU Research | 200,000,000,000,000 CR | 5,400 jobs | MHz research | GHz CPU and RAM tier. |

The names and major cost scale mirror IdleBit. Job work replaces disconnected countdown timers.

## CPU tiers

The clock has 12 levels in each visible tier:

```text
Hz 1-12 -> kHz 1-12 -> MHz 1-12 -> GHz 1-12
```

Within Hz, kHz, and MHz, the display rate begins at 1.0 and grows by 1.5x per level, capped for readable display. GHz grows by 1.18x and caps at 6.0 GHz. The next tier cannot be purchased until its research is complete.

## Automation and offline play

Foreground task processing is automatic from boot. Offline simulation time must be earned through scheduler research.

| Tier | Offline cap | Capability |
|---|---:|---|
| Starting Node | 0 | Closing freezes simulation. |
| Local Scheduler | 2 hours | The node can continue queued work. |
| CRON Runtime | 8 hours | Longer unattended operation. |
| System Scheduler | 12 hours | System policies and projects can run unattended. |

Offline time increases recorded uptime but does not raise the saved foreground pressure clock. Offline failure floors integrity at 25, so the game can return in trouble but never die while the player is absent.

## Firmware

- Heat Pipes, 10 Data: triples ambient cooling. Requires Thermal Control.
- Watchdog, 25 Data: patches faults after 90 seconds and draws 2 W per pending fault. Requires Local Scheduler.
- QoS, 60 Data: CPU cores pull PRIORITY jobs first. Requires System Scheduler.
- Hot-Swap, 150 Data: selling returns full value. Requires Specialized Compute.

## Reflow and architecture

Silicon payout is:

```text
floor(uptimeMinutes ^ 1.8 / 40) + floor(completedJobs / 200)
```

Longer runs are disproportionately valuable. This creates the central decision: Reflow safely now, or hold the node together for a better permanent payout.

Architecture purchases include one extra starting PSU level, more integrity, more job value, larger reserve, a larger board, additional output, dual rails, and Gen 2 to Gen 4 workload unlocks.

## Interface

Desktop uses a stable two-column screen:

- top: uptime, integrity, Credits, Data, reserve, and peak temperature;
- left: active node, queue, installed modules, moving job bus, active R&D, and three interventions;
- right: Hardware, Research, and Evolution tabs.

Mobile keeps the same fixed viewport and provides four stable views: Node, Hardware, Research, and Evolution. The bottom navigation swaps views instead of stacking them into a page. Only the active panel may scroll. Controls never move because of runtime state. Status changes update color, labels, meters, and progress in place.

The visual language is a dark compute console with warm amber actions, cool cyan telemetry, compact cards, and restrained pixel art. Pixel sprites support the machine instead of turning the entire interface into a low-resolution mock terminal.

## Simulation rules

- `src/game` remains pure and imports no React, Phaser, or browser globals.
- `advanceGame(state, elapsedMs)` is delta-invariant, including RNG draws.
- Hardware rate owns work duration. Research uses completed jobs, and cooling and intervention cooldowns use hardware ticks.
- Foreground uptime and load pressure are separate explicit clocks.
- Randomness threads through `src/game/rng.ts`.
- Saves contain serializable game state only.

The old Phaser socket board remains available only at `#/dev/render` for renderer diagnostics. It is not part of the primary game experience.
