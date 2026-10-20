// Transport bar (sticky top): play/stop, record, tempo with tap tempo, metronome, master volume,
// position, undo/redo and project actions.

import type { App } from "../app";
import { demoProject } from "../demo";
import { makeProject } from "../model";
import type { Theme } from "../storage";
import { button, confirmButton, numberInput, pct, range, select } from "./controls";
import { h } from "./dom";

const taps: number[] = [];

/** Tap tempo: average of the intervals between the last taps (reset after a 2 s pause). */
function tap(app: App) {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 5) taps.shift();
  if (taps.length < 2) return;
  const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
  const bpm = Math.min(300, Math.max(20, Math.round(600000 / avg) / 10));
  app.update((p) => (p.bpm = bpm), "tap");
}

export function transportView(app: App): HTMLElement {
  const { project, ui } = app;
  return h(
    "header",
    { class: "transport", "aria-label": "Transport" },
    h(
      "div",
      { class: "transport-main" },
      button({
        id: "play",
        label: ui.playing ? "Stop" : "Play",
        pressed: ui.playing,
        className: "play",
        title: "Play / stop (Space)",
        onClick: () => app.togglePlay(),
      }),
      button({
        id: "record",
        label: "Rec",
        pressed: ui.record,
        className: "rec",
        title: "Record: with playback running, keys 1–9, 0, Q–P write hits on tracks in order",
        onClick: () => app.setUi((u) => (u.record = !u.record)),
      }),
      h(
        "div",
        { class: "readout" },
        h(
          "span",
          { class: "label", id: "position-label" },
          ui.playingEntryId !== null ? "Entry:rep bar.beat" : "Bar.beat",
        ),
        h(
          "output",
          { id: "position", class: "big", "aria-labelledby": "position-label" },
          ui.position,
        ),
      ),
      h(
        "div",
        { class: "bpm" },
        numberInput({
          id: "bpm",
          label: "BPM",
          min: 20,
          max: 300,
          step: 0.1,
          value: project.bpm,
          set: (v) => app.update((p) => (p.bpm = v)),
        }),
        button({ id: "tap", label: "Tap", onClick: () => tap(app), title: "Tap tempo" }),
      ),
      button({
        id: "metronome",
        label: "Click",
        pressed: project.metronome,
        title: "Metronome",
        onClick: () => app.update((p) => (p.metronome = !p.metronome)),
      }),
      range(app, {
        id: "master-volume",
        label: "Master",
        min: 0,
        max: 1,
        step: 0.01,
        value: project.masterVolume,
        format: pct,
        set: (v, key) => app.update((p) => (p.masterVolume = v), key),
      }),
      h(
        "div",
        { class: "group" },
        button({
          id: "undo",
          label: "Undo",
          disabled: !app.canUndo,
          title: "Undo (Ctrl/Cmd+Z)",
          onClick: () => app.undo(),
        }),
        button({
          id: "redo",
          label: "Redo",
          disabled: !app.canRedo,
          title: "Redo (Ctrl/Cmd+Shift+Z)",
          onClick: () => app.redo(),
        }),
      ),
    ),
  );
}

/** Project actions: name, export/import, new project, demo, theme. */
export function projectBarView(app: App): HTMLElement {
  const { project, ui } = app;
  return h(
    "div",
    { class: "project-bar", role: "group", "aria-label": "Project" },
    h(
      "div",
      { class: "field project-name" },
      h("label", { for: "project-name" }, "Project"),
      h("input", {
        id: "project-name",
        type: "text",
        maxlength: 60,
        value: project.name,
        onchange: (e: Event) => {
          const name = (e.target as HTMLInputElement).value.trim() || "Untitled";
          app.update((p) => (p.name = name));
        },
      }),
    ),
    button({
      id: "export-open",
      label: "Export",
      pressed: ui.dialog === "export",
      onClick: () => app.setUi((u) => (u.dialog = u.dialog === "export" ? null : "export")),
    }),
    button({
      id: "import-open",
      label: "Import",
      pressed: ui.dialog === "import",
      onClick: () => app.setUi((u) => (u.dialog = u.dialog === "import" ? null : "import")),
    }),
    confirmButton(app, {
      id: "new-project",
      label: "New",
      confirmLabel: "Confirm new",
      action: () => app.load(makeProject(), "New project created. Undo restores the previous one."),
    }),
    confirmButton(app, {
      id: "load-demo",
      label: "Demo",
      confirmLabel: "Confirm demo",
      action: () => app.load(demoProject(), "Demo project loaded. Undo restores the previous one."),
    }),
    select({
      id: "theme",
      label: "Theme",
      value: ui.theme,
      options: [
        ["auto", "Auto"],
        ["light", "Light"],
        ["dark", "Dark"],
      ],
      set: (v) => app.setTheme(v as Theme),
    }),
  );
}
