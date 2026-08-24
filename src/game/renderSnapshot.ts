/**
 * Renderer contract. `src/render` (Phaser) reads ONLY this shape and dispatches
 * ONLY `RenderCommand`s. The sim owns `deriveRenderSnapshot`; the renderer must
 * never import anything else from `src/game`.
 */
export type Dir = "n" | "s" | "e" | "w";
export type Facing = "l" | "r";

export const TileKind = {
  wall: 0,
  floor: 1,
  door: 2,
  stairsDown: 3,
} as const;
export type TileKindValue = (typeof TileKind)[keyof typeof TileKind];

export type HazardKind = "hotTile" | "overloadPlate" | "corruptedSector" | "brownout";

export type EnemyKind =
  | "bitFlip"
  | "nullPointer"
  | "memoryLeak"
  | "deadlock"
  | "forkBomb"
  | "daemon"
  | "zombieProcess";

export type ItemKind = "patch" | "hotfix" | "cacheLine" | "heatsink" | "checkpoint" | "coreDump";

export type EntityAnim = "idle" | "walk" | "attack" | "hurt" | "dead";

export interface RenderHero {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
  maxHp: number;
  heat: number;
  throttled: boolean;
  anim: EntityAnim;
}

export interface RenderEntity {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: Facing;
  anim: EntityAnim;
}

export interface RenderItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
}

/** Events are appended with a monotonically increasing `seq`; the renderer keeps `lastSeq`. */
export type RunEvent =
  | { seq: number; turn: number; kind: "heroMoved"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { seq: number; turn: number; kind: "heroAttacked"; targetId: number; damage: number }
  | { seq: number; turn: number; kind: "heroHurt"; sourceId: number | null; damage: number; hp: number }
  | { seq: number; turn: number; kind: "heroDied"; cause: string }
  | { seq: number; turn: number; kind: "heroRevived" }
  | { seq: number; turn: number; kind: "enemyMoved"; id: number; from: { x: number; y: number }; to: { x: number; y: number } }
  | { seq: number; turn: number; kind: "enemyHurt"; id: number; damage: number; hp: number }
  | { seq: number; turn: number; kind: "enemyDied"; id: number; enemyKind: EnemyKind; x: number; y: number; credits: string }
  | { seq: number; turn: number; kind: "enemySpawned"; id: number; enemyKind: EnemyKind; x: number; y: number }
  | { seq: number; turn: number; kind: "projectile"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { seq: number; turn: number; kind: "itemPicked"; id: number; itemKind: ItemKind; x: number; y: number }
  | { seq: number; turn: number; kind: "itemUsed"; itemKind: ItemKind }
  | { seq: number; turn: number; kind: "hazardTriggered"; hazard: HazardKind; x: number; y: number }
  | { seq: number; turn: number; kind: "throttled"; on: boolean }
  | { seq: number; turn: number; kind: "tripped" }
  | { seq: number; turn: number; kind: "deadlockPenalty"; creditsLost: string }
  | { seq: number; turn: number; kind: "descended"; depth: number }
  | { seq: number; turn: number; kind: "controlChanged"; control: "auto" | "manual" };

export interface RenderSnapshot {
  /** run seed; the scene rebuilds its tilemap when runId or depth changes */
  runId: number;
  depth: number;
  width: number;
  height: number;
  /** row-major, index = y * width + x */
  tiles: readonly TileKindValue[];
  explored: readonly boolean[];
  visible: readonly boolean[];
  hazards: readonly { index: number; kind: HazardKind }[];
  hero: RenderHero;
  entities: readonly RenderEntity[];
  items: readonly RenderItem[];
  control: "auto" | "manual";
  turn: number;
  msPerTurn: number;
  /** 0..1 fraction of the current auto-turn elapsed */
  turnProgress: number;
  /** ring buffer of the most recent events (≤ 64), ascending seq */
  events: readonly RunEvent[];
}

/** Commands the renderer / input layer may dispatch. The sim's GameAction is a superset. */
export type RenderCommand =
  | { type: "takeControl" }
  | { type: "releaseControl" }
  | { type: "heroMove"; dir: Dir }
  | { type: "heroWait" }
  | { type: "useItem"; slot: number }
  | { type: "descend" }
  | { type: "heroPathTo"; x: number; y: number };
