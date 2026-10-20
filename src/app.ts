// Application state and controller: project + UI state, undo history, autosave,
// playback (engine → audio) and the playhead queue read by requestAnimationFrame.

import { AudioOut } from "./audio";
import { demoProject } from "./demo";
import { Player, effectiveMode, type TimedEvent } from "./engine";
import { History } from "./history";
import type { SoundKey } from "./kit";
import {
  DEFAULT_VELOCITY,
  currentPattern,
  findPattern,
  parseProjectText,
  serializeProject,
  stepBeats,
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
  playingEntry: number;
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
      playingEntry: -1,
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
    if (prev) this.replace(prev);
  }

  redo(): void {
    const next = this.history.redo(structuredClone(this.project));
    if (next) this.replace(next);
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
    this.ui.playing = true;
    this.ui.playingEntry = -1;
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
    this.ui.playing = false;
    this.ui.playhead.clear();
    this.ui.playingPatternId = null;
    this.ui.playingEntry = -1;
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

  private showBeat(e: Extract<TimedEvent, { type: "beat" }>) {
    const p = findPattern(this.project, e.patternId);
    const bars = p?.bars ?? 1;
    const pos = `${(e.bar % bars) + 1}.${e.beatInBar + 1}`;
    this.ui.position = e.entry >= 0 ? `${e.entry + 1}:${Math.floor(e.bar / bars) + 1} ${pos}` : pos;
    const out = document.getElementById("position");
    if (out) out.textContent = this.ui.position;
    if (e.patternId !== this.ui.playingPatternId || e.entry !== this.ui.playingEntry) {
      this.ui.playingPatternId = e.patternId;
      this.ui.playingEntry = e.entry;
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
    });
  }

  /** Audition the track; when recording during playback, write a hit at its nearest step. */
  recordHit(track: Track): void {
    this.audition(track);
    const ctx = this.audio.ctx;
    if (!this.ui.record || !this.player || !ctx) return;
    const at = this.player.locate(ctx.currentTime - this.audio.latency);
    if (!at || at.segment.patternId !== this.pattern.id) return;
    const n = track.steps.length;
    const k = Math.round((at.beat - at.segment.start) / stepBeats(track));
    const index = ((k % n) + n) % n;
    this.updateTrack(
      track.id,
      (t) => (t.steps[index] = { ...t.steps[index], on: true, velocity: DEFAULT_VELOCITY }),
      "record",
    );
  }
}

export function cellId(trackId: string, step: number): string {
  return `cell-${trackId}-${step}`;
}
