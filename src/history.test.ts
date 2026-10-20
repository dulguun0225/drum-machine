import { describe, expect, it } from "vite-plus/test";
import { HISTORY_LIMIT, History } from "./history";

describe("history", () => {
  it("undoes and redoes snapshots", () => {
    const h = new History<number>();
    h.record(1);
    h.record(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBe(3);
    expect(h.canRedo).toBe(false);
  });

  it("coalesces changes of one gesture into one step", () => {
    const h = new History<number>();
    h.record(1, "drag");
    h.record(2, "drag");
    h.record(3, "drag");
    h.endGesture();
    h.record(4, "drag");
    expect(h.undo(5)).toBe(4);
    expect(h.undo(4)).toBe(1);
  });

  it("caps the stack and clears redo on a new change", () => {
    const h = new History<number>();
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) h.record(i);
    let count = 0;
    let cur = -1;
    for (let v = h.undo(cur); v !== undefined; v = h.undo(cur)) {
      cur = v;
      count++;
    }
    expect(count).toBe(HISTORY_LIMIT);
    expect(cur).toBe(50);
    h.record(99);
    expect(h.canRedo).toBe(false);
  });
});
