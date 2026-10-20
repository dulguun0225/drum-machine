// Track panel: sound and mix settings, step count and rate (presets or any tuplet),
// swing, choke group, Euclidean fill, rotate, clear, duplicate, delete, reorder, add.

import type { App } from "../app";
import { SOUNDS, SOUND_KEYS, type SoundKey } from "../kit";
import {
  MAX_STEPS,
  MAX_TRACKS,
  cloneTrack,
  makeStep,
  makeTrack,
  resizeSteps,
  type Track,
} from "../model";
import { applyOnOff, euclid, rotate } from "../patternTools";
import { RATE_PRESETS, presetFor, rateLabel, tuplet } from "../presets";
import {
  button,
  checkbox,
  confirmButton,
  field,
  numberInput,
  pct,
  range,
  select,
  signed,
} from "./controls";
import { h } from "./dom";

const SOUND_OPTIONS: [string, string][] = SOUND_KEYS.map((k) => [k, SOUNDS[k].name]);

export function trackPanelView(app: App): HTMLElement {
  const track = app.track;
  const pattern = app.pattern;
  return h(
    "section",
    { class: "panel track-panel", "aria-labelledby": "track-heading" },
    h(
      "h2",
      { id: "track-heading" },
      "Track",
      track ? h("span", { class: "sub" }, ` ${track.name}`) : null,
    ),
    track ? trackFields(app, track) : h("p", { class: "hint" }, "This pattern has no tracks."),
    h(
      "div",
      { class: "add-track" },
      select({
        id: "add-sound",
        label: "New track sound",
        value: app.ui.addSound,
        options: SOUND_OPTIONS,
        set: (v) => app.setUi((ui) => (ui.addSound = v as SoundKey)),
      }),
      button({
        id: "track-add",
        label: "Add track",
        disabled: pattern.tracks.length >= MAX_TRACKS,
        onClick: () => {
          const t = makeTrack(app.ui.addSound);
          app.updatePattern(pattern.id, (p) => p.tracks.push(t));
          app.setUi((ui) => {
            ui.trackId = t.id;
            ui.step = 0;
          });
        },
      }),
    ),
  );
}

function trackFields(app: App, track: Track): HTMLElement {
  const pattern = app.pattern;
  const id = track.id;
  const row = pattern.tracks.findIndex((t) => t.id === id);
  const set = (change: (t: Track) => void, key: string | null = null) =>
    app.updateTrack(id, change, key);
  const preset = presetFor(track.stepDur);
  const tup =
    app.ui.tuplet?.trackId === id
      ? app.ui.tuplet
      : { trackId: id, steps: track.stepDur.den, beats: track.stepDur.num };
  const { euclid: e } = app.ui;

  const move = (delta: number) =>
    app.updatePattern(pattern.id, (p) => {
      const i = p.tracks.findIndex((t) => t.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= p.tracks.length) return;
      [p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]];
    });

  return h(
    "div",
    { class: "track-fields" },
    h(
      "div",
      { class: "fields" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "track-name" }, "Name"),
        h("input", {
          id: "track-name",
          type: "text",
          maxlength: 40,
          value: track.name,
          onchange: (ev: Event) => {
            const name = (ev.target as HTMLInputElement).value.trim();
            if (name) set((t) => (t.name = name));
          },
        }),
      ),
      select({
        id: "track-sound",
        label: "Sound",
        value: track.sound,
        options: SOUND_OPTIONS,
        set: (v) =>
          set((t) => {
            // Keep a custom name; follow the sound when the name was the old sound's name.
            if (t.name === SOUNDS[t.sound].name) t.name = SOUNDS[v as SoundKey].name;
            t.sound = v as SoundKey;
          }),
      }),
      range(app, {
        id: "track-volume",
        label: "Volume",
        min: 0,
        max: 1,
        step: 0.01,
        value: track.volume,
        format: pct,
        set: (v, key) => set((t) => (t.volume = v), key),
      }),
      range(app, {
        id: "track-pan",
        label: "Pan",
        min: -1,
        max: 1,
        step: 0.01,
        value: track.pan,
        format: (v) => (v === 0 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`),
        set: (v, key) => set((t) => (t.pan = v), key),
      }),
      range(app, {
        id: "track-tune",
        label: "Tune",
        min: -24,
        max: 24,
        step: 1,
        value: track.tune,
        format: (v) => `${signed(v)} st`,
        set: (v, key) => set((t) => (t.tune = v), key),
      }),
      range(app, {
        id: "track-decay",
        label: "Decay",
        // Logarithmic slider: −2..+2 → ×0.25..×4.
        min: -2,
        max: 2,
        step: 0.05,
        value: Math.log2(track.decay),
        format: (v) => `×${(2 ** v).toFixed(2)}`,
        set: (v, key) => set((t) => (t.decay = Number((2 ** v).toFixed(3))), key),
      }),
    ),
    h(
      "div",
      { class: "fields" },
      numberInput({
        id: "track-steps",
        label: "Steps",
        min: 1,
        max: MAX_STEPS,
        value: track.steps.length,
        set: (v) => set((t) => (t.steps = resizeSteps(t.steps, v))),
      }),
      select({
        id: "track-rate",
        label: "Rate",
        value: preset?.id ?? "custom",
        options: [
          ...RATE_PRESETS.map((p): [string, string] => [p.id, p.label]),
          ["custom", preset ? "Custom tuplet" : `Custom: ${rateLabel(track.stepDur)}`],
        ],
        set: (v) => {
          const p = RATE_PRESETS.find((x) => x.id === v);
          if (p) set((t) => (t.stepDur = { ...p.dur }));
        },
      }),
      h(
        "div",
        { class: "tuplet" },
        numberInput({
          id: "tuplet-steps",
          label: "Tuplet: steps",
          min: 1,
          max: 64,
          value: tup.steps,
          set: (v) => app.setUi((ui) => (ui.tuplet = { ...tup, steps: v })),
        }),
        numberInput({
          id: "tuplet-beats",
          label: "in beats",
          min: 1,
          max: 64,
          value: tup.beats,
          set: (v) => app.setUi((ui) => (ui.tuplet = { ...tup, beats: v })),
        }),
        button({
          id: "tuplet-apply",
          label: "Apply",
          onClick: () => {
            set((t) => (t.stepDur = tuplet(tup.steps, tup.beats)));
            app.setUi((ui) => (ui.tuplet = null));
          },
        }),
      ),
      checkbox({
        id: "track-swing",
        label: "Swing",
        checked: track.swing,
        set: (v) => set((t) => (t.swing = v)),
      }),
      select({
        id: "track-choke",
        label: "Choke group",
        value: String(track.choke),
        options: [
          ["0", "None"],
          ["1", "1"],
          ["2", "2"],
          ["3", "3"],
          ["4", "4"],
        ],
        set: (v) => set((t) => (t.choke = Number(v))),
      }),
      h(
        "div",
        { class: "group" },
        button({
          id: "track-mute",
          label: "Mute",
          pressed: track.mute,
          onClick: () => set((t) => (t.mute = !t.mute)),
        }),
        button({
          id: "track-solo",
          label: "Solo",
          pressed: track.solo,
          onClick: () => set((t) => (t.solo = !t.solo)),
        }),
      ),
    ),
    h(
      "fieldset",
      { class: "euclid" },
      h("legend", null, "Euclidean fill"),
      numberInput({
        id: "euclid-hits",
        label: "Hits",
        min: 0,
        max: MAX_STEPS,
        value: e.hits,
        set: (v) => app.setUi((ui) => (ui.euclid = { ...ui.euclid, hits: v })),
      }),
      numberInput({
        id: "euclid-steps",
        label: "Steps",
        min: 1,
        max: MAX_STEPS,
        value: e.steps,
        set: (v) => app.setUi((ui) => (ui.euclid = { ...ui.euclid, steps: v })),
      }),
      numberInput({
        id: "euclid-rotation",
        label: "Rotation",
        min: -63,
        max: 63,
        value: e.rotation,
        set: (v) => app.setUi((ui) => (ui.euclid = { ...ui.euclid, rotation: v })),
      }),
      button({
        id: "euclid-apply",
        label: "Fill",
        onClick: () =>
          set((t) => {
            t.steps = applyOnOff(
              resizeSteps(t.steps, e.steps),
              euclid(e.hits, e.steps, e.rotation),
            );
          }),
      }),
    ),
    h(
      "div",
      { class: "toolbar" },
      button({
        id: "track-rotate-left",
        label: "Rotate left",
        onClick: () => set((t) => (t.steps = rotate(t.steps, -1))),
      }),
      button({
        id: "track-rotate-right",
        label: "Rotate right",
        onClick: () => set((t) => (t.steps = rotate(t.steps, 1))),
      }),
      button({
        id: "track-clear",
        label: "Clear",
        onClick: () => set((t) => (t.steps = t.steps.map(() => makeStep()))),
      }),
      button({
        id: "track-duplicate",
        label: "Duplicate",
        disabled: pattern.tracks.length >= MAX_TRACKS,
        onClick: () => {
          const copy = cloneTrack(track);
          copy.name = `${track.name} copy`.slice(0, 40);
          app.updatePattern(pattern.id, (p) => p.tracks.splice(row + 1, 0, copy));
          app.setUi((ui) => (ui.trackId = copy.id));
        },
      }),
      button({ id: "track-up", label: "Move up", disabled: row <= 0, onClick: () => move(-1) }),
      button({
        id: "track-down",
        label: "Move down",
        disabled: row >= pattern.tracks.length - 1,
        onClick: () => move(1),
      }),
      confirmButton(app, {
        id: "track-delete",
        label: "Delete",
        confirmLabel: "Confirm delete",
        action: () => {
          app.updatePattern(pattern.id, (p) => (p.tracks = p.tracks.filter((t) => t.id !== id)));
          app.selectFirstTrack();
        },
      }),
    ),
    field(
      "track-info",
      "Loop",
      h(
        "output",
        { id: "track-info" },
        `${track.steps.length} × ${rateLabel(track.stepDur)} = ${trimBeats((track.steps.length * track.stepDur.num) / track.stepDur.den)} beats`,
      ),
    ),
  );
}

function trimBeats(v: number): string {
  return Number(v.toFixed(3)).toString();
}
