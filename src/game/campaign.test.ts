import { advanceGame } from "./advance";
import { applyAction } from "./actions";
import { amount } from "./amount";
import {
  campaignChapterDefinitions,
  campaignObjectiveDefinitions,
  getVisibleCampaign,
  normalizeCampaignState,
  updateCampaignProgress,
} from "./campaign";
import { createInitialGameState } from "./initialState";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import type { GameState } from "./types";

const withWatchdog = (state: GameState): GameState => ({
  ...state,
  hub: { ...state.hub, research: { completed: ["watchdogTimer"] } },
  watchdog: { ...state.watchdog, ownedLevelId: "watchdogTimer", departureLevelId: "watchdogTimer" },
});

describe("campaign", () => {
  it("defines 3 chapters × 4 objectives with transmissions and blocked reasons", () => {
    expect(campaignChapterDefinitions).toHaveLength(3);
    expect(campaignObjectiveDefinitions).toHaveLength(12);
    const ids = new Set(campaignObjectiveDefinitions.map((definition) => definition.id));
    for (const chapter of campaignChapterDefinitions) {
      expect(chapter.objectiveIds).toHaveLength(4);
      for (const id of chapter.objectiveIds) expect(ids.has(id)).toBe(true);
    }
    for (const definition of campaignObjectiveDefinitions) {
      expect(definition.transmission.length).toBeGreaterThan(10);
      expect(definition.blockedReason.length).toBeGreaterThan(5);
    }
  });

  it("starts empty and completes first-deploy on deploy, logging a transmission", () => {
    const initial = createInitialGameState(1);
    expect(initial.campaign.completedObjectiveIds).toEqual([]);
    const deployed = applyAction(initial, { type: "deploy" });
    expect(deployed.campaign.completedObjectiveIds).toEqual(["boot:first-deploy"]);
    expect(deployed.campaign.log).toEqual([
      {
        seq: 1,
        objectiveId: "boot:first-deploy",
        label: "Deploy a process",
        text: "First process deployed. The stack notices.",
      },
    ]);
  });

  it("completes kill and bank objectives from simulated play, in chronological order", () => {
    let state = applyAction(createInitialGameState(3), { type: "deploy" });
    let guard = 0;
    while (state.run && guard++ < 400) state = advanceGame(state, 60_000, "foreground").state;
    expect(state.run).toBeNull();
    const done = state.campaign.completedObjectiveIds;
    expect(done).toContain("boot:first-deploy");
    expect(done).toContain("boot:first-kill");
    expect(done).toContain("boot:first-bank");
    const seqs = state.campaign.log.map((entry) => entry.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("buying hardware completes boot:first-hardware", () => {
    let state = createInitialGameState(2);
    state = { ...state, hub: { ...state.hub, credits: amount(100) } };
    state = applyAction(state, { type: "buyHardware", kind: "cache" });
    expect(state.campaign.completedObjectiveIds).toContain("boot:first-hardware");
  });

  it("watchdog purchase completes orders:watchdog", () => {
    let state = withWatchdog(createInitialGameState(4));
    state = { ...state, hub: { ...state.hub, credits: amount(100) } };
    // withWatchdog sets the owned level directly; the sweep still sees it
    const updated = updateCampaignProgress(state);
    expect(updated.campaign.completedObjectiveIds).toContain("orders:watchdog");
  });

  it("an offline advance that completes runs satisfies orders:offline-run", () => {
    const start = applyAction(withWatchdog(createInitialGameState(5)), { type: "deploy" });
    const { state, report } = advanceGame(start, 2 * 60 * 60 * 1000, "offline");
    expect(report.runsCompleted + report.extrapolatedRuns).toBeGreaterThan(0);
    expect(state.hub.stats.offlineRuns).toBe(report.runsCompleted + report.extrapolatedRuns);
    expect(state.campaign.completedObjectiveIds).toContain("orders:offline-run");
    expect(report.hadActivity).toBe(true);
  });

  it("an idle offline advance reports no activity", () => {
    const idle = createInitialGameState(6);
    const { report } = advanceGame(idle, 60 * 60 * 1000, "offline");
    expect(report.hadActivity).toBe(false);
    expect(report.runsCompleted).toBe(0);
  });

  it("updateCampaignProgress is a no-op (same reference) when nothing completes", () => {
    const initial = createInitialGameState(7);
    expect(updateCampaignProgress(initial)).toBe(initial);
  });

  it("exposes campaign, transmissions and credits/s through deriveVisibleState", () => {
    const initial = createInitialGameState(8);
    const visibleFresh = deriveVisibleState(initial);
    expect(visibleFresh.campaign.currentChapterId).toBe("bootstrapProcess");
    expect(visibleFresh.campaign.currentObjective?.id).toBe("boot:first-deploy");
    expect(visibleFresh.campaign.currentObjective?.blockedReason).toBe("Press Deploy.");
    expect(visibleFresh.campaign.completedCount).toBe(0);
    expect(visibleFresh.campaign.totalCount).toBe(12);
    expect(visibleFresh.campaignTransmissions).toEqual([]);
    expect(visibleFresh.creditsPerSecond).toBe(0);

    let state = applyAction(initial, { type: "deploy" });
    let guard = 0;
    while (state.run && guard++ < 400) state = advanceGame(state, 60_000, "foreground").state;
    const visible = deriveVisibleState(state);
    expect(visible.campaign.completedCount).toBeGreaterThanOrEqual(3);
    expect(visible.campaignTransmissions.length).toBe(state.campaign.log.length);
    expect(visible.creditsPerSecond).toBeGreaterThan(0);
    expect(visible.creditsPerSecondLabel.length).toBeGreaterThan(0);
  });

  it("persists through save round-trips and collapses garbage", () => {
    let state = applyAction(createInitialGameState(9), { type: "deploy" });
    state = advanceGame(state, 30_000, "foreground").state;
    const loaded = deserializeSave(serializeSave(state, 1_000));
    expect(loaded.state.campaign).toEqual({ ...state.campaign, log: state.campaign.log });

    const garbage = normalizeCampaignState({
      completedObjectiveIds: ["boot:first-deploy", "nope", "boot:first-deploy", 42 as unknown as string],
      log: [
        { seq: 2, objectiveId: "boot:first-kill", label: "x", text: "y" },
        { seq: 1, objectiveId: "bogus", label: "x", text: "y" },
      ],
      nextLogSeq: -5,
    });
    expect(garbage.completedObjectiveIds).toEqual(["boot:first-deploy"]);
    expect(garbage.log).toHaveLength(1);
    expect(garbage.log[0]!.objectiveId).toBe("boot:first-kill");
    // labels/text are re-derived from definitions, seq order enforced
    expect(garbage.log[0]!.label).toBe("Terminate a fault");
    expect(garbage.nextLogSeq).toBe(3);
  });

  it("getVisibleCampaign marks chapters complete only when all objectives are", () => {
    let state = createInitialGameState(10);
    state = {
      ...state,
      campaign: {
        completedObjectiveIds: ["boot:first-deploy", "boot:first-kill", "boot:first-bank", "boot:first-hardware"],
        log: [],
        nextLogSeq: 1,
      },
    };
    const visible = getVisibleCampaign(state);
    expect(visible.chapters[0]!.completed).toBe(true);
    expect(visible.currentChapterId).toBe("coherentMachine");
    expect(visible.currentObjective?.id).toBe("coherent:cache-mapping");
  });
});
