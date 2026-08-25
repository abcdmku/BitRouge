import { describe, expect, it } from "vitest";
import { applyAction } from "./actions";
import { createInitialGameState } from "./initialState";
import { deriveInteractLabel, deriveTaskRows, deriveVisibleState, siteLabelById } from "./selectors";
import type { GameState, RunState } from "./types";

type WorkSiteT = RunState["sites"][number];
type PayloadT = RunState["payloads"][number];

const site = (patch: Partial<WorkSiteT> & Pick<WorkSiteT, "id" | "kind" | "x" | "y">): WorkSiteT => ({
  totalUnits: 4,
  remainingUnits: 4,
  yieldData: 0,
  payoutCredits: "12" as WorkSiteT["payoutCredits"],
  corrupted: 0,
  squattedBy: null,
  resolved: false,
  ...patch,
});

const payload = (patch: Partial<PayloadT> & Pick<PayloadT, "id" | "portId">): PayloadT => ({
  x: 0,
  y: 0,
  payoutCredits: "10" as PayloadT["payoutCredits"],
  heldBy: "floor",
  ...patch,
});

/** A real deployed run with the work fields swapped for a controlled fixture. */
const fixture = (): { state: GameState; run: RunState } => {
  const state = applyAction(createInitialGameState(), { type: "deploy" });
  if (!state.run) throw new Error("deploy did not start a run");
  const hero = { ...state.run.hero, x: 5, y: 5, channelSiteId: null, carryingPayloadId: null };
  const run: RunState = {
    ...state.run,
    hero,
    sites: [
      site({ id: 1, kind: "dataNode", x: 6, y: 5, totalUnits: 4, remainingUnits: 2, yieldData: 3 }),
      site({ id: 2, kind: "dataNode", x: 20, y: 5, corrupted: 2, yieldData: 2 }),
      site({ id: 3, kind: "jobStation", x: 10, y: 10, totalUnits: 12, remainingUnits: 6 }),
      site({ id: 4, kind: "jobStation", x: 12, y: 10, squattedBy: 99 }),
      site({ id: 5, kind: "ioPort", x: 22, y: 12 }),
    ],
    payloads: [payload({ id: 51, portId: 5, x: 8, y: 5 })],
    leaks: [],
    quota: { required: 4, done: 2 },
    overclockTurns: 0,
    dataMined: 3,
  };
  return { state: { ...state, run }, run };
};

describe("deriveTaskRows", () => {
  it("maps data nodes to MINE rows with progress and data payout", () => {
    const { run } = fixture();
    const rows = deriveTaskRows(run);
    const mine = rows.find((r) => r.id === 1);
    expect(mine).toMatchObject({ kind: "dataNode", verb: "MINE", name: "sector 1", payoutLabel: "+3 D", done: false });
    expect(mine!.progress).toBeCloseTo(0.5);
    expect(mine!.blockedReason).toBeNull();
  });

  it("labels corruption as a blocked reason in 25% steps", () => {
    const { run } = fixture();
    const corrupted = deriveTaskRows(run).find((r) => r.id === 2);
    expect(corrupted!.blockedReason).toBe("corrupted 50%");
    expect(corrupted!.name).toBe("sector 2");
  });

  it("labels squatted stations and keeps job progress resumable", () => {
    const { run } = fixture();
    const rows = deriveTaskRows(run);
    expect(rows.find((r) => r.id === 3)).toMatchObject({ verb: "EXEC", name: "job 1", payoutLabel: "+12 cr" });
    expect(rows.find((r) => r.id === 3)!.progress).toBeCloseTo(0.5);
    expect(rows.find((r) => r.id === 4)!.blockedReason).toBe("squatted by zombie");
  });

  it("derives haul rows from ports: floor→0, carried→0.5+active, stolen/lost→blocked", () => {
    const { run } = fixture();
    expect(deriveTaskRows(run).find((r) => r.id === 5)).toMatchObject({
      verb: "HAUL",
      name: "haul → port 1",
      progress: 0,
      blockedReason: null,
      done: false,
    });

    const carried = { ...run, payloads: [payload({ id: 51, portId: 5, heldBy: "hero" })] };
    const carriedRow = deriveTaskRows(carried).find((r) => r.id === 5)!;
    expect(carriedRow.progress).toBeCloseTo(0.5);
    expect(carriedRow.active).toBe(true);

    const stolen = { ...run, payloads: [payload({ id: 51, portId: 5, heldBy: 7 })] };
    expect(deriveTaskRows(stolen).find((r) => r.id === 5)!.blockedReason).toBe("stolen by daemon");

    const lost = { ...run, payloads: [payload({ id: 51, portId: 5, heldBy: "lost" })] };
    const lostRow = deriveTaskRows(lost).find((r) => r.id === 5)!;
    expect(lostRow.blockedReason).toBe("payload lost");
    expect(lostRow.done).toBe(true);

    const delivered = {
      ...run,
      payloads: [],
      sites: run.sites.map((s) => (s.id === 5 ? { ...s, resolved: true } : s)),
    };
    const deliveredRow = deriveTaskRows(delivered).find((r) => r.id === 5)!;
    expect(deliveredRow.progress).toBe(1);
    expect(deliveredRow.done).toBe(true);
  });
});

describe("siteLabelById", () => {
  it("numbers sites per kind in array order", () => {
    const { run } = fixture();
    expect(siteLabelById(run, 1)).toBe("sector 1");
    expect(siteLabelById(run, 2)).toBe("sector 2");
    expect(siteLabelById(run, 3)).toBe("job 1");
    expect(siteLabelById(run, 4)).toBe("job 2");
    expect(siteLabelById(run, 5)).toBe("port 1");
  });
});

describe("deriveInteractLabel", () => {
  it("offers MINE next to an unresolved node", () => {
    const { run } = fixture();
    expect(deriveInteractLabel(run)).toBe("MINE"); // hero at 5,5; node at 6,5
  });

  it("offers PICK UP when a loose payload is closer priority than nothing", () => {
    const { run } = fixture();
    const near = { ...run, hero: { ...run.hero, x: 8, y: 6 } };
    expect(deriveInteractLabel(near)).toBe("PICK UP");
  });

  it("offers EXECUTE on an unsquatted station and nothing on a squatted one", () => {
    const { run } = fixture();
    const onStation = { ...run, hero: { ...run.hero, x: 10, y: 10 } };
    expect(deriveInteractLabel(onStation)).toBe("EXECUTE");
    const onSquatted = { ...run, hero: { ...run.hero, x: 12, y: 11 }, sites: run.sites.filter((s) => s.id === 4) };
    expect(deriveInteractLabel({ ...onSquatted, payloads: [] })).toBeNull();
  });

  it("offers DELIVER when carrying next to the right port", () => {
    const { run } = fixture();
    const carrying = {
      ...run,
      hero: { ...run.hero, x: 21, y: 12, carryingPayloadId: 51 },
      payloads: [payload({ id: 51, portId: 5, heldBy: "hero" })],
    };
    expect(deriveInteractLabel(carrying)).toBe("DELIVER");
  });

  it("offers GC next to a leak cell", () => {
    const { run } = fixture();
    const width = run.floor.width;
    const leaky = { ...run, sites: [], payloads: [], leaks: [6 * width + 5] };
    expect(deriveInteractLabel(leaky)).toBe("GC");
  });
});

describe("deriveVisibleState run work fields", () => {
  it("exposes quota, tasks, channeling, carrying, overclock and dataMined", () => {
    const { state, run } = fixture();
    const patched: GameState = {
      ...state,
      run: {
        ...run,
        hero: { ...run.hero, channelSiteId: 1, carryingPayloadId: null },
        overclockTurns: 6,
      },
    };
    const visible = deriveVisibleState(patched);
    expect(visible.run).not.toBeNull();
    const vr = visible.run!;
    expect(vr.quota).toMatchObject({ done: 2, required: 4, met: false, label: "FLUSH 2/4" });
    expect(vr.tasks).toHaveLength(5);
    expect(vr.channeling).toMatchObject({ siteId: 1, name: "sector 1", remainingTurns: 2, totalTurns: 4 });
    expect(vr.carrying).toBeNull();
    expect(vr.overclockTurns).toBe(6);
    expect(vr.dataMined).toBe(3);
    expect(vr.interactLabel).toBe("MINE");
  });

  it("labels carrying with the destination port", () => {
    const { state, run } = fixture();
    const patched: GameState = {
      ...state,
      run: {
        ...run,
        hero: { ...run.hero, carryingPayloadId: 51 },
        payloads: [payload({ id: 51, portId: 5, heldBy: "hero" })],
      },
    };
    const vr = deriveVisibleState(patched).run!;
    expect(vr.carrying).toMatchObject({ payloadId: 51, portId: 5, label: "payload → port 1" });
  });
});
