import { describe, expect, it } from "vitest";
import { applyAction, createInitialGameState, type RunEvent, type RunState } from "../game";
import { lineForEvent } from "./RunConsole";

type WorkSiteT = RunState["sites"][number];
type PayloadT = RunState["payloads"][number];

const site = (patch: Partial<WorkSiteT> & Pick<WorkSiteT, "id" | "kind">): WorkSiteT => ({
  x: 1,
  y: 1,
  totalUnits: 4,
  remainingUnits: 4,
  yieldData: 4,
  payoutCredits: "12" as WorkSiteT["payoutCredits"],
  corrupted: 0,
  squattedBy: null,
  resolved: false,
  ...patch,
});

const runFixture = (): RunState => {
  const state = applyAction(createInitialGameState(), { type: "deploy" });
  if (!state.run) throw new Error("deploy did not start a run");
  return {
    ...state.run,
    sites: [
      site({ id: 7, kind: "dataNode" }),
      site({ id: 8, kind: "jobStation" }),
      site({ id: 9, kind: "ioPort" }),
    ],
    payloads: [
      { id: 31, x: 2, y: 2, portId: 9, payoutCredits: "13" as PayloadT["payoutCredits"], heldBy: "hero" } as PayloadT,
    ],
    leaks: [],
    quota: { required: 4, done: 3 },
  };
};

const ev = (body: Record<string, unknown>): RunEvent => ({ seq: 1, turn: 5, ...body }) as RunEvent;

describe("lineForEvent — v2 syslog lines", () => {
  const run = runFixture();

  it("prints mining payouts in Data", () => {
    const line = lineForEvent(ev({ kind: "siteCompleted", siteId: 7, siteKind: "dataNode", credits: "0", data: 4 }), run);
    expect(line).toMatchObject({ tone: "data", text: "sector 1 mined: +4 D" });
  });

  it("prints job payouts in credits", () => {
    const line = lineForEvent(ev({ kind: "siteCompleted", siteId: 8, siteKind: "jobStation", credits: "12", data: 0 }), run);
    expect(line!.text).toBe("job 1 done: +12 cr");
    expect(line!.tone).toBe("ok");
  });

  it("names the destination port on delivery", () => {
    const line = lineForEvent(ev({ kind: "payloadDelivered", id: 31, credits: "13" }), run);
    expect(line!.text).toBe("payload delivered to port 1: +13 cr");
  });

  it("covers corruption, squats, steals and leaks", () => {
    expect(lineForEvent(ev({ kind: "siteCorrupted", siteId: 7 }), run)!.text).toContain("sector 1 corrupted");
    expect(lineForEvent(ev({ kind: "siteSquatted", siteId: 8, byId: 2 }), run)!.text).toContain("job 1 squatted");
    expect(lineForEvent(ev({ kind: "payloadStolen", id: 31, byId: 2 }), run)!.tone).toBe("danger");
    expect(lineForEvent(ev({ kind: "leakSpawned", index: 40 }), run)!.text).toContain("OOM");
    expect(lineForEvent(ev({ kind: "leakCollected", index: 40, credits: "2.4" }), run)!.text).toBe("leak GC'd: +2.4 cr");
  });

  it("tracks quota progress and announces the open gate", () => {
    expect(lineForEvent(ev({ kind: "quotaProgress", done: 3, required: 4 }), run)!.text).toBe("quota 3/4");
    const met = lineForEvent(ev({ kind: "quotaProgress", done: 4, required: 4 }), run)!;
    expect(met.text).toContain("flush ready");
    expect(met.tone).toBe("ok");
    expect(lineForEvent(ev({ kind: "stairsLocked" }), run)!.text).toContain("BUS GATE LATCHED");
    expect(lineForEvent(ev({ kind: "stairsUnlocked" }), run)!.text).toContain("BUS GATE OPEN");
  });

  it("covers overclock and the kernel scramble", () => {
    expect(lineForEvent(ev({ kind: "overclocked", on: true }), run)!.tone).toBe("warn");
    expect(lineForEvent(ev({ kind: "overclocked", on: false }), run)!.tone).toBe("muted");
    expect(lineForEvent(ev({ kind: "floorScrambled" }), run)!.text).toContain("KERNEL PANIC");
  });

  it("names the failure on death", () => {
    const line = lineForEvent(ev({ kind: "heroDied", cause: "Thermal shutdown" }), run)!;
    expect(line.text).toBe("FATAL — Thermal shutdown");
    expect(line.tone).toBe("danger");
  });
});
