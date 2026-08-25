import { Fragment, type ReactNode } from "react";
import { TileKind, type RunState } from "../game";

const ENEMY_GLYPH: Record<string, string> = {
  bitFlip: "b",
  nullPointer: "n",
  memoryLeak: "m",
  deadlock: "D",
  forkBomb: "f",
  daemon: "d",
  zombieProcess: "z",
};

const SITE_GLYPH: Record<string, string> = {
  dataNode: "N",
  jobStation: "J",
  ioPort: "O",
};

/** Debug overlay (`?ascii=1`): the whole floor as text, drawn from the sim, not the renderer. */
export function AsciiFloor({ run }: { run: RunState }) {
  const { width, height, tiles, explored, visible } = run.floor;
  const enemies = new Map<number, string>();
  for (const e of run.enemies) enemies.set(e.y * width + e.x, e.dormantTurns > 0 ? "x" : (ENEMY_GLYPH[e.kind] ?? "?"));
  const items = new Set(run.items.map((i) => i.y * width + i.x));
  const hazards = new Set(run.floor.hazards.map((h) => h.index));
  const sites = new Map<number, string>();
  for (const s of run.sites) sites.set(s.y * width + s.x, s.resolved ? "·" : (SITE_GLYPH[s.kind] ?? "?"));
  const payloads = new Set(run.payloads.filter((p) => p.heldBy === "floor").map((p) => p.y * width + p.x));
  const leaks = new Set(run.leaks);

  const rows: ReactNode[] = [];
  for (let y = 0; y < height; y++) {
    const cells: ReactNode[] = [];
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let ch: ReactNode = " ";
      if (x === run.hero.x && y === run.hero.y) ch = <b>@</b>;
      else if (visible[i] && enemies.has(i)) ch = <i>{enemies.get(i)}</i>;
      else if (explored[i]) {
        const t = tiles[i];
        if (t === TileKind.wall) ch = "#";
        else if (leaks.has(i)) ch = <i>≈</i>;
        else if (t === TileKind.door) ch = "+";
        else if (t === TileKind.stairsDown) ch = <u>&gt;</u>;
        else if (t === TileKind.vent) ch = <b>v</b>;
        else if (sites.has(i)) ch = <u>{sites.get(i)}</u>;
        else if (payloads.has(i)) ch = <u>P</u>;
        else if (items.has(i)) ch = <u>!</u>;
        else if (hazards.has(i)) ch = "~";
        else ch = visible[i] ? "." : ",";
      }
      cells.push(<Fragment key={x}>{ch}</Fragment>);
    }
    rows.push(
      <Fragment key={y}>
        {cells}
        {"\n"}
      </Fragment>,
    );
  }
  return <pre className="ascii">{rows}</pre>;
}
