// Undo/redo of whole-project snapshots. Changes that share a gesture key (one drag, one slider
// movement) are stored as a single undo step.

export const HISTORY_LIMIT = 200;

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private key: string | null = null;

  /** Store the state from before a change. Skipped while the same gesture key continues. */
  record(before: T, key: string | null = null): void {
    if (key !== null && key === this.key) return;
    this.key = key;
    this.past.push(before);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  /** True while changes with `key` continue the current gesture (no new snapshot needed). */
  continues(key: string | null): boolean {
    return key !== null && key === this.key;
  }

  /** End the current gesture; the next change starts a new undo step. */
  endGesture(): void {
    this.key = null;
  }

  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    this.key = null;
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.key = null;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
