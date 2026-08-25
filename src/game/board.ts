import type { ArchPerkId, BoardState, ComponentKind, Dir, GameState, PacketState } from "./types";

/** Board geometry helpers shared by the tick engine, actions, and snapshots. */

export const toIndex = (x: number, y: number, width: number) => y * width + x;
export const toXY = (index: number, width: number) => ({
  x: index % width,
  y: Math.floor(index / width),
});

export const DIR_DELTAS: Record<Dir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export const rotateDir = (dir: Dir): Dir =>
  dir === "N" ? "E" : dir === "E" ? "S" : dir === "S" ? "W" : "N";

/** Index one step from `index` along `dir`, or -1 when out of bounds. */
export const stepIndex = (index: number, dir: Dir, width: number, height: number) => {
  const { x, y } = toXY(index, width);
  const { dx, dy } = DIR_DELTAS[dir];
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= width || ny >= height) return -1;
  return toIndex(nx, ny, width);
};

/** In-bounds 4-neighborhood of `index`. */
export const neighborIndices = (index: number, width: number, height: number) => {
  const out: number[] = [];
  for (const dir of ["N", "E", "S", "W"] as const) {
    const next = stepIndex(index, dir, width, height);
    if (next >= 0) out.push(next);
  }
  return out;
};

export const hasArchPerk = (architecture: readonly ArchPerkId[], id: ArchPerkId) =>
  architecture.includes(id);

export const countArchPerk = (architecture: readonly ArchPerkId[], id: ArchPerkId) =>
  architecture.reduce((count, perk) => (perk === id ? count + 1 : count), 0);

/** South PORT: fixed bottom-center. East PORT (arch perk): middle of the east edge. */
export const getPortIndices = (width: number, height: number, hasEastPort: boolean) => {
  const ports = [toIndex(Math.floor(width / 2), height - 1, width)];
  if (hasEastPort) ports.push(toIndex(width - 1, Math.floor((height - 1) / 2), width));
  return ports;
};

export const getPortIndicesFor = (state: GameState) =>
  getPortIndices(
    state.run.board.width,
    state.run.board.height,
    hasArchPerk(state.meta.architecture, "eastPort"),
  );

export const isPortIndex = (state: GameState, index: number) =>
  getPortIndicesFor(state).includes(index);

// ---- visited mask (exact base-2 digits stored in a double, safe to 2^52) ----

export const maskHas = (mask: number, index: number) =>
  Math.floor(mask / Math.pow(2, index)) % 2 === 1;

export const maskAdd = (mask: number, index: number) =>
  maskHas(mask, index) ? mask : mask + Math.pow(2, index);

// ---- occupancy --------------------------------------------------------------

export const packetAt = (board: BoardState, index: number): PacketState | null => {
  for (const packet of board.packets) if (packet.socketIndex === index) return packet;
  return null;
};

/** Count of non-port unlocked sockets — the `n` of the socket-unlock cost curve. */
export const countUnlockedSockets = (
  board: BoardState,
  portIndices: readonly number[],
) => {
  let count = 0;
  for (let i = 0; i < board.sockets.length; i += 1) {
    if (board.sockets[i].unlocked && !portIndices.includes(i)) count += 1;
  }
  return count;
};

export const countComponents = (board: BoardState, kind: ComponentKind) => {
  let count = 0;
  for (const socket of board.sockets) if (socket.component?.kind === kind) count += 1;
  return count;
};
