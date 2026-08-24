import { useEffect } from "react";
import type { Dir, RenderCommand } from "../../game/renderSnapshot";

const MOVE_KEYS: Record<string, Dir> = {
  ArrowUp: "n",
  ArrowDown: "s",
  ArrowLeft: "w",
  ArrowRight: "e",
  w: "n",
  s: "s",
  a: "w",
  d: "e",
  k: "n",
  j: "s",
  h: "w",
  l: "e",
};

export interface KeyboardOptions {
  /** Current control mode from the snapshot; movement in auto mode takes control first. */
  control: "auto" | "manual" | null;
  enabled?: boolean;
}

/** Pure key -> command mapping. Exported for tests. */
export function commandsForKey(key: string, control: "auto" | "manual" | null): RenderCommand[] {
  const dir = MOVE_KEYS[key];
  const needsControl = control === "auto";
  if (dir) {
    return needsControl ? [{ type: "takeControl" }, { type: "heroMove", dir }] : [{ type: "heroMove", dir }];
  }
  if (key === "." || key === " ") return needsControl ? [{ type: "takeControl" }, { type: "heroWait" }] : [{ type: "heroWait" }];
  if (key >= "1" && key <= "6") return [{ type: "useItem", slot: Number(key) - 1 }];
  if (key === ">" || key === "Enter") return needsControl ? [{ type: "takeControl" }, { type: "descend" }] : [{ type: "descend" }];
  if (key === "Tab" || key === "m" || key === "M") {
    return [{ type: control === "manual" ? "releaseControl" : "takeControl" }];
  }
  return [];
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

/** Window keydown -> RenderCommands. React owns the keyboard; Phaser's is disabled. */
export function useKeyboard(onCommand: (cmd: RenderCommand) => void, opts: KeyboardOptions): void {
  const { control, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.repeat && e.key === "Tab")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const cmds = commandsForKey(e.key, control);
      if (cmds.length === 0) return;
      e.preventDefault();
      for (const c of cmds) onCommand(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCommand, control, enabled]);
}
