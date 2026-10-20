// Application state and controller: project + UI state, undo history, autosave,
// playback (engine → audio) and the playhead queue read by requestAnimationFrame.

import { AudioOut } from "./audio";
import { demoProject } from "./demo";
import { Player, effectiveMode, type BeatEvent, type TimedEvent } from "./engine";
import { History } from "./history";
import type { SoundKey } from "./kit";
import {
  DEFAULT_VELOCITY,
  currentPattern,
  findPattern,
  parseProjectText,
  serializeProject,
  type Pattern,
  type Project,
  type Track,
} from "./model";
import { loadSavedProject, loadTheme, saveProjectSoon, saveTheme, type Theme } from "./storage";
import { createTicker } from "./timer";

export type LaneParam = "velocity" | "probability" | "ratchet" | "nudge" | "pitch";

/** Keys for live record and audition, mapped to tracks in order. */
export const TRACK_KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "q",
  "w",
  "e",
  "r",
  "t",
  "y",
  "u",
  "i",
  "o",
  "p",
];

export interface UiState {
  trackId: string | null; // selected track of the current pattern
  step: number | null; // selected step of that track
  zoom: number; // pixels per beat
  lane: LaneParam;
  follow: boolean;
  record: boolean;
  playing: boolean;
  dialog: "export" | "import" | null;
  importText: string;
  message: { text: string; error: boolean } | null;
  confirm: string | null; // key of the two-step button waiting for its second click
  theme: Theme;
  position: string;
  playingPatternId: string | null;
  playingEntryId: string | null; // song entry id, null in pattern mode
  playhead: Map<string, number>; // trackId → current step
  euclid: { hits: number; steps: number; rotation: number };
  tuplet: { trackId: string; steps: number; beats: number } | null;
  addSound: SoundKey;
}

export class App {
  project: Project;
  readonly ui: UiState;
  readonly audio = new AudioOut();
  private readonly history = new History<Project>();
  private player: Player | null = null;
  private queue: TimedEvent[] = [];
  /** Last beat shown; the position text is recomputed from it on every render, so song edits update it at once. */
  private lastBeat: BeatEvent | null = null;
  private renderQueued = false;
  private confirmTimer: number | undefined;
  private readonly ticker = createTicker(() => this.tick());
  /** Element id to focus after the next render (keyboard navigation in the grid). */
  focusId: string | null = null;

  private readonly renderView: (app: App) => void;

  constructor(renderView: (app: App) => void) {
    this.renderView = renderView;
    const saved = loadSavedProject();
    const parsed = saved ? parseProjectText(saved) : null;
    this.project = parsed?.ok ? parsed.project : demoProject();
    this.ui = {
      trackId: null,
      step: null,
      zoom: 96,
      lane: "velocity",
      follow: true,
      record: false,
      playing: false,
      dialog: null,
      importText: "",
      message:
        parsed && !parsed.ok
          ? {
              text: `Saved project could not be loaded (${parsed.error}); the demo is open.`,
              error: true,
            }
          : null,
      confirm: null,
      theme: loadTheme(),
      position: "1.1",
      playingPatternId: null,
      playingEntryId: null,
      playhead: new Map(),
      euclid: { hits: 4, steps: 16, rotation: 0 },
      tuplet: null,
      addSound: "kick",
    };
    this.applyTheme();
    this.selectFirstTrack();
  }

  // ---- state changes ----

  get pattern(): Pattern {
    return currentPattern(this.project);
  }

  get track(): Track | undefined {
    return this.pattern.tracks.find((t) => t.id === this.ui.trackId);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /**
   * Change the project as one undo step. Calls with the same `key` coalesce until
   * `endGesture()` (drags, slider movements).
   */
  update(change: (p: Project) => void, key: string | null = null): void {
    if (!this.history.continues(key)) this.history.record(structuredClone(this.project), key);
    change(this.project);
    this.changed();
  }

  /** Change one track (looked up by id in the live project) as an undo step. */
  updateTrack(
    trackId: string,
    change: (t: Track, p: Pattern) => void,
    key: string | null = null,
  ): void {
    this.update((proj) => {
      for (const p of proj.patterns) {
        const t = p.tracks.find((x) => x.id === trackId);
        if (t) return change(t, p);
      }
    }, key);
  }

  /** Change one pattern (looked up by id in the live project) as an undo step. */
  updatePattern(patternId: string, change: (p: Pattern) => void, key: string | null = null): void {
    this.update((proj) => {
      const p = findPattern(proj, patternId);
      if (p) change(p);
    }, key);
  }

  /** Change that is not an undo step (navigation such as the current pattern). */
  navigate(change: (p: Project) => void): void {
    change(this.project);
    this.changed();
  }

  endGesture(): void {
    this.history.endGesture();
  }

  setUi(change: (ui: UiState) => void): void {
    change(this.ui);
    this.render();
  }

  undo(): void {
    const prev = this.history.undo(structuredClone(this.project));
    if (prev) this.replace(keepCurrentPattern(prev, this.project));
  }

  redo(): void {
    const next = this.history.redo(structuredClone(this.project));
    if (next) this.replace(keepCurrentPattern(next, this.project));
  }

  /** Load a whole project (import, demo, new) as one undo step. */
  load(project: Project, message: string): void {
    this.history.record(structuredClone(this.project));
    this.history.endGesture();
    this.replace(project);
    this.ui.message = { text: message, error: false };
    this.render();
  }

  private replace(project: Project) {
    this.project = project;
    if (!this.track) this.selectFirstTrack();
    this.changed();
  }

  private changed() {
    const track = this.track;
    if (!track) this.selectFirstTrack();
    else if (this.ui.step !== null && this.ui.step >= track.steps.length)
      this.ui.step = track.steps.length - 1;
    this.audio.updateMix(this.project);
    saveProjectSoon(() => serializeProject(this.project));
    this.render();
  }

  selectFirstTrack(): void {
    const first = this.pattern.tracks[0];
    this.ui.trackId = first?.id ?? null;
    this.ui.step = first ? 0 : null;
  }

  showMessage(text: string, error = false): void {
    this.setUi((ui) => (ui.message = { text, error }));
  }

  /** Two-step confirmation: the first call arms `key`, a second call within 4 s returns true. */
  confirm(key: string): boolean {
    clearTimeout(this.confirmTimer);
    if (this.ui.confirm === key) {
      this.ui.confirm = null;
      return true;
    }
    this.ui.confirm = key;
    this.confirmTimer = window.setTimeout(() => this.setUi((ui) => (ui.confirm = null)), 4000);
    this.render();
    return false;
  }

  setTheme(theme: Theme): void {
    this.ui.theme = theme;
    saveTheme(theme);
    this.applyTheme();
    this.render();
  }

  private applyTheme() {
    const root = document.documentElement;
    if (this.ui.theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = this.ui.theme;
  }

  render(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.lastBeat) this.ui.position = positionText(this.project, this.lastBeat);
      this.renderView(this);
      if (this.focusId) {
        document.getElementById(this.focusId)?.focus();
        this.focusId = null;
      }
    });
  }

  // ---- playback ----

  /** Create or resume audio; call inside a user gesture. */
  ensureAudio(): void {
    this.audio.ensure();
    this.audio.updateMix(this.project);
  }

  togglePlay(): void {
    if (this.ui.playing) this.stop();
    else this.play();
  }

  play(): void {
    const ctx = this.audio.ensure();
    this.audio.updateMix(this.project);
    this.player = Player.start(this.project, ctx.currentTime);
    this.queue = [];
    this.lastBeat = null;
    this.ui.playing = true;
    this.ui.playingEntryId = null;
    this.ticker.start();
    this.tick();
    requestAnimationFrame(this.frame);
    this.render();
  }

  stop(): void {
    this.ticker.stop();
    this.audio.silence();
    this.player = null;
    this.queue = [];
    this.lastBeat = null;
    this.ui.playing = false;
    this.ui.playhead.clear();
    this.ui.playingPatternId = null;
    this.ui.playingEntryId = null;
    this.ui.position = "1.1";
    this.endGesture();
    this.render();
  }

  private tick() {
    const ctx = this.audio.ctx;
    if (!this.player || !ctx) return;
    for (const e of this.player.tick(this.project, ctx.currentTime, Math.random)) {
      if (e.type === "hit") this.audio.hit(e);
      else {
        if (e.type === "beat" && this.project.metronome)
          this.audio.click(e.time, e.beatInBar === 0);
        this.queue.push(e);
      }
    }
    this.queue = pruneQueue(this.queue, ctx.currentTime - this.audio.latency);
  }

  /** Apply queued step and beat events that are now audible: playhead, position, follow. */
  private readonly frame = () => {
    const ctx = this.audio.ctx;
    if (!this.ui.playing || !ctx) return;
    const now = ctx.currentTime - this.audio.latency;
    const due = this.queue.filter((e) => e.time <= now);
    if (due.length) {
      this.queue = this.queue.filter((e) => e.time > now);
      for (const e of due) {
        if (e.type === "step") this.moveStepHighlight(e.trackId, e.step);
        else if (e.type === "beat") this.showBeat(e);
      }
    }
    requestAnimationFrame(this.frame);
  };

  private moveStepHighlight(trackId: string, step: number) {
    const prev = this.ui.playhead.get(trackId);
    if (prev === step) return;
    this.ui.playhead.set(trackId, step);
    document.getElementById(cellId(trackId, prev ?? -1))?.classList.remove("now");
    document.getElementById(cellId(trackId, step))?.classList.add("now");
  }

  private showBeat(e: BeatEvent) {
    this.lastBeat = e;
    this.ui.position = positionText(this.project, e);
    const out = document.getElementById("position");
    if (out) out.textContent = this.ui.position;
    if (e.patternId !== this.ui.playingPatternId || e.entryId !== this.ui.playingEntryId) {
      this.ui.playingPatternId = e.patternId;
      this.ui.playingEntryId = e.entryId;
      const follow =
        this.ui.follow &&
        effectiveMode(this.project) === "song" &&
        e.patternId !== this.project.currentPatternId;
      if (follow) {
        this.navigate((proj) => (proj.currentPatternId = e.patternId));
        this.selectFirstTrack();
      }
      this.render();
    }
  }

  // ---- sound ----

  audition(track: Track): void {
    const ctx = this.audio.ensure();
    this.audio.hit({
      time: ctx.currentTime,
      trackId: track.id,
      sound: track.sound,
      velocity: DEFAULT_VELOCITY,
      semitones: track.tune,
      decay: track.decay,
      choke: track.choke,
      order: this.pattern.tracks.indexOf(track),
    });
  }

  /**
   * Audition the track; when recording during playback, write a hit at its nearest step so
   * that the hit sounds once (see `recordPlan`).
   */
  recordHit(track: Track): void {
    const ctx = this.audio.ctx;
    const live = this.pattern.tracks.find((t) => t.id === track.id);
    const near =
      this.ui.record && this.player && ctx && live
        ? this.player.nearestStep(live, ctx.currentTime - this.audio.latency)
        : undefined;
    if (!this.player || !live || !near || near.segment.patternId !== this.pattern.id) {
      this.audition(track);
      return;
    }
    const { index } = near;
    const plan = recordPlan(near.upcoming, live.steps[index].on);
    if (plan.audition) this.audition(live);
    if (plan.skip) this.player.skipOnce(near.segment, track.id, near.k);
    this.updateTrack(
      track.id,
      (t) => (t.steps[index] = { ...t.steps[index], on: true, velocity: DEFAULT_VELOCITY }),
      "record",
    );
  }
}

/**
 * Live record of a key press at its nearest step. An upcoming step that is already on plays
 * anyway, so the press is not auditioned. An upcoming step that was off is auditioned now and
 * skipped once when playback reaches it. A step that has passed is auditioned and plays from
 * the next loop on.
 */
export function recordPlan(
  upcoming: boolean,
  wasOn: boolean,
): { audition: boolean; skip: boolean } {
  return { audition: !(upcoming && wasOn), skip: upcoming && !wasOn };
}

/** Undo/redo snapshot with the live current pattern kept when it still exists (it may be playing). */
export function keepCurrentPattern(snapshot: Project, live: Project): Project {
  if (findPattern(snapshot, live.currentPatternId))
    snapshot.currentPatternId = live.currentPatternId;
  return snapshot;
}

/**
 * Playhead events still worth applying at `now`: all future ones, and of the due ones only the
 * last step per track and the last beat, which is all the next frame would leave visible. This
 * bounds the queue while requestAnimationFrame does not run (hidden tab).
 */
export function pruneQueue(queue: TimedEvent[], now: number): TimedEvent[] {
  const seen = new Set<string>();
  const out: TimedEvent[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    const e = queue[i];
    if (e.time <= now) {
      const key = e.type === "step" ? `step|${e.trackId}` : e.type;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(e);
  }
  return out.reverse();
}

/** Position readout "bar.beat"; song mode adds "entry:repeat" with the entry's current number. */
export function positionText(project: Project, e: BeatEvent): string {
  const bars = findPattern(project, e.patternId)?.bars ?? 1;
  const pos = `${(e.bar % bars) + 1}.${e.beatInBar + 1}`;
  if (e.entryId === null) return pos;
  const i = project.song.findIndex((x) => x.id === e.entryId);
  return `${i >= 0 ? i + 1 : "–"}:${Math.floor(e.bar / bars) + 1} ${pos}`;
}

export function cellId(trackId: string, step: number): string {
  return `cell-${trackId}-${step}`;
}
