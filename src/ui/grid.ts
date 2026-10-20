// Step grid: one row per track on a shared time axis (cell width ∝ step duration), a bar/beat
// ruler, the parameter lane under the selected track, painting, selection and keyboard moves.

import { TRACK_KEYS, cellId, type App, type LaneParam } from "../app";
import { SOUNDS } from "../kit";
import {
  MAX_RATCHET,
  barBeats,
  loopBeats,
  patternBeats,
  stepBeats,
  type Pattern,
  type Step,
  type Track,
} from "../model";
import { rateLabel } from "../presets";
import { pct, signed } from "./controls";
import { cls, h } from "./dom";

const ZOOMS = [32, 48, 64, 96, 128, 192, 256];
const MAX_GHOSTS = 600;
const LONG_PRESS_MS = 450;

interface LaneSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  centered: boolean;
  get: (s: Step) => number;
  set: (s: Step, v: number) => void;
  format: (v: number) => string;
}

const LANES: Record<LaneParam, LaneSpec> = {
  velocity: {
    label: "Velocity",
    min: 0,
    max: 1,
    step: 0.01,
    centered: false,
    get: (s) => s.velocity,
    set: (s, v) => (s.velocity = v),
    format: pct,
  },
  probability: {
    label: "Probability",
    min: 0,
    max: 1,
    step: 0.01,
    centered: false,
    get: (s) => s.probability,
    set: (s, v) => (s.probability = v),
    format: pct,
  },
  ratchet: {
    label: "Ratchet",
    min: 1,
    max: MAX_RATCHET,
    step: 1,
    centered: false,
    get: (s) => s.ratchet,
    set: (s, v) => (s.ratchet = v),
    format: (v) => `×${v}`,
  },
  nudge: {
    label: "Nudge",
    min: -0.5,
    max: 0.5,
    step: 0.01,
    centered: true,
    get: (s) => s.nudge,
    set: (s, v) => (s.nudge = v),
    format: (v) => `${signed(Math.round(v * 100))}%`,
  },
  pitch: {
    label: "Pitch",
    min: -24,
    max: 24,
    step: 1,
    centered: true,
    get: (s) => s.pitch,
    set: (s, v) => (s.pitch = v),
    format: (v) => `${signed(v)} st`,
  },
};

// ---- pointer state shared by cell handlers ----

interface Paint {
  value: boolean;
  accent: boolean;
  visited: Set<string>;
}

let paint: Paint | null = null;
/** Lane drag: last step index drawn and the undo gesture key. */
let laneDrag: { last: number | null; key: string } | null = null;
let pressTimer: number | undefined;
let longPressed = false;

function stepLabel(track: Track, i: number, s: Step): string {
  const parts = [`${track.name} step ${i + 1}`, s.on ? "on" : "off"];
  if (s.on) {
    parts.push(`velocity ${pct(s.velocity)}`);
    if (s.probability < 1) parts.push(`probability ${pct(s.probability)}`);
    if (s.ratchet > 1) parts.push(`ratchet ${s.ratchet}`);
    if (s.nudge) parts.push(`nudge ${Math.round(s.nudge * 100)}%`);
    if (s.flam) parts.push("flam");
    if (s.pitch) parts.push(`pitch ${signed(s.pitch)}`);
    if (s.condition.b > 1) parts.push(`condition ${s.condition.a} of ${s.condition.b}`);
  }
  return parts.join(", ");
}

function select(app: App, trackId: string, step: number) {
  app.setUi((ui) => {
    ui.trackId = trackId;
    ui.step = step;
  });
}

/** Set a step on/off or toggle it (accent = velocity 1.0); turning a step on also selects it. */
function setCell(
  app: App,
  trackId: string,
  step: number,
  on: boolean | "toggle",
  accent: boolean,
  key: string | null,
) {
  let turnedOn = false;
  app.updateTrack(
    trackId,
    (t) => {
      const s = t.steps[step];
      if (!s) return;
      const next = on === "toggle" ? !s.on : on;
      turnedOn = next;
      t.steps[step] = { ...s, on: next, velocity: accent ? 1 : s.velocity };
    },
    key,
  );
  if (turnedOn) select(app, trackId, step);
}

/** Live step state (handlers may run before the next render). */
function liveStep(app: App, trackId: string, step: number): Step | undefined {
  return app.pattern.tracks.find((t) => t.id === trackId)?.steps[step];
}

let paintCount = 0;

function startPaint(app: App, e: PointerEvent, track: Track, i: number) {
  const accent = e.shiftKey;
  const value = accent ? true : !liveStep(app, track.id, i)?.on;
  paint = { value, accent, visited: new Set([`${track.id}:${i}`]) };
  const key = `paint-${++paintCount}`;
  setCell(app, track.id, i, value, accent, key);
  if (!value) select(app, track.id, i);

  const move = (ev: PointerEvent) => {
    if (!paint) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".cell");
    const trackId = el?.dataset.track;
    const step = Number(el?.dataset.step);
    if (!trackId || !Number.isInteger(step)) return;
    const id = `${trackId}:${step}`;
    if (paint.visited.has(id)) return;
    paint.visited.add(id);
    setCell(app, trackId, step, paint.value, paint.accent, key);
  };
  const end = () => {
    paint = null;
    app.endGesture();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function cellPointerDown(app: App, e: PointerEvent, track: Track, i: number) {
  if (e.pointerType === "touch") {
    // Touch: tap toggles, long press selects; dragging scrolls the grid.
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      longPressed = true;
      select(app, track.id, i);
    }, LONG_PRESS_MS);
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault(); // keep text selection from starting during a drag
  (e.currentTarget as HTMLElement).focus();
  startPaint(app, e, track, i);
}

function cellPointerUp(app: App, e: PointerEvent, track: Track, i: number) {
  if (e.pointerType !== "touch") return;
  clearTimeout(pressTimer);
  if (!longPressed) setCell(app, track.id, i, "toggle", false, null);
  longPressed = false;
}

/** Arrow keys move between cells; Up/Down keep the time position across rows. */
function cellKey(app: App, e: KeyboardEvent, pattern: Pattern, row: number, i: number) {
  const track = pattern.tracks[row];
  let targetRow = row;
  let target = i;
  if (e.key === "ArrowLeft") target = Math.max(0, i - 1);
  else if (e.key === "ArrowRight") target = Math.min(track.steps.length - 1, i + 1);
  else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    targetRow = Math.min(
      pattern.tracks.length - 1,
      Math.max(0, row + (e.key === "ArrowUp" ? -1 : 1)),
    );
    const other = pattern.tracks[targetRow];
    const time = (i + 0.5) * stepBeats(track);
    target = Math.min(other.steps.length - 1, Math.floor(time / stepBeats(other)));
  } else if (e.key === "Home") target = 0;
  else if (e.key === "End") target = track.steps.length - 1;
  else return;
  e.preventDefault();
  const id = pattern.tracks[targetRow].id;
  app.focusId = cellId(id, target);
  select(app, id, target);
}

function cellView(
  app: App,
  pattern: Pattern,
  row: number,
  track: Track,
  i: number,
  px: number,
  tabbable: boolean,
) {
  const s = track.steps[i];
  const w = stepBeats(track) * px;
  const selected = app.ui.trackId === track.id && app.ui.step === i;
  const deco = s.on
    ? [
        h("span", {
          class: "fill",
          style: `height:${Math.max(8, s.velocity * 100)}%;transform:translateX(${s.nudge * 100}%)`,
        }),
        s.ratchet > 1
          ? h(
              "span",
              { class: "ticks" },
              Array.from({ length: s.ratchet }, () => h("i")),
            )
          : null,
        s.condition.b > 1
          ? h("span", { class: "cond" }, `${s.condition.a}:${s.condition.b}`)
          : null,
        s.pitch ? h("span", { class: "pitch" }, signed(s.pitch)) : null,
      ]
    : null;
  return h(
    "button",
    {
      type: "button",
      id: cellId(track.id, i),
      class: cls(
        "cell",
        s.on && "on",
        s.on && s.probability < 1 && "maybe",
        s.on && s.flam && "flam",
        selected && "selected",
        app.ui.playhead.get(track.id) === i && "now",
        i % 2 === 1 && "odd",
      ),
      style: `left:${i * w}px;width:${Math.max(3, w - 2)}px`,
      "data-track": track.id,
      "data-step": i,
      "aria-pressed": String(s.on),
      "aria-label": stepLabel(track, i, s),
      tabindex: tabbable ? 0 : -1,
      onpointerdown: (e: PointerEvent) => cellPointerDown(app, e, track, i),
      onpointerup: (e: PointerEvent) => cellPointerUp(app, e, track, i),
      onpointercancel: () => clearTimeout(pressTimer),
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        select(app, track.id, i);
      },
      onclick: (e: MouseEvent) => {
        // Pointer input is handled on pointerdown/up; detail 0 means Enter or Space.
        if (e.detail === 0) setCell(app, track.id, i, e.shiftKey || "toggle", e.shiftKey, null);
      },
      onkeydown: (e: KeyboardEvent) => cellKey(app, e, pattern, row, i),
    },
    deco,
  );
}

/** Faded copies of the loop after its end, so shorter tracks show where they repeat. */
function ghosts(track: Track, px: number, span: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  const dur = stepBeats(track);
  const w = dur * px;
  const n = track.steps.length;
  for (let k = n; k * dur < span - 1e-9 && out.length < MAX_GHOSTS; k++) {
    const on = track.steps[k % n].on;
    out.push(
      h("span", {
        class: cls("ghost", on && "on", k % n === 0 && "loop-start"),
        style: `left:${k * w}px;width:${Math.max(2, w - 2)}px`,
        "aria-hidden": "true",
      }),
    );
  }
  return out;
}

function headView(app: App, track: Track, row: number): HTMLElement {
  const key = TRACK_KEYS[row];
  const info = SOUNDS[track.sound];
  return h(
    "div",
    { class: cls("head", app.ui.trackId === track.id && "selected") },
    h("span", { class: `chip fam-${info.family}`, "aria-hidden": "true" }),
    h(
      "button",
      {
        type: "button",
        id: `name-${track.id}`,
        class: "name",
        title: `${info.name}, ${rateLabel(track.stepDur)}, ${track.steps.length} steps. Click to hear${key ? `; key ${key.toUpperCase()}` : ""}.`,
        onclick: () => {
          app.recordHit(track);
          app.setUi((ui) => {
            if (ui.trackId !== track.id) ui.step = 0;
            ui.trackId = track.id;
          });
        },
      },
      track.name,
    ),
    key ? h("kbd", { class: "key", "aria-hidden": "true" }, key.toUpperCase()) : null,
    h(
      "button",
      {
        type: "button",
        id: `mute-${track.id}`,
        class: "mini mute",
        "aria-pressed": String(track.mute),
        "aria-label": `Mute ${track.name}`,
        onclick: () => app.updateTrack(track.id, (t) => (t.mute = !t.mute)),
      },
      "M",
    ),
    h(
      "button",
      {
        type: "button",
        id: `solo-${track.id}`,
        class: "mini solo",
        "aria-pressed": String(track.solo),
        "aria-label": `Solo ${track.name}`,
        onclick: () => app.updateTrack(track.id, (t) => (t.solo = !t.solo)),
      },
      "S",
    ),
  );
}

function laneView(app: App, track: Track, px: number, width: number): HTMLElement {
  const spec = LANES[app.ui.lane];
  const w = stepBeats(track) * px;

  const apply = (e: PointerEvent, area: HTMLElement) => {
    if (!laneDrag) return;
    const rect = area.getBoundingClientRect();
    const index = Math.floor((e.clientX - rect.left) / w);
    const f = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const raw = spec.min + f * (spec.max - spec.min);
    const value = Math.round(raw / spec.step) * spec.step;
    const v = Number(Math.min(spec.max, Math.max(spec.min, value)).toFixed(2));
    const { last, key } = laneDrag;
    // Fill the steps skipped between two pointer events.
    const from = last === null ? index : Math.min(last, index);
    const to = last === null ? index : Math.max(last, index);
    laneDrag.last = index;
    app.updateTrack(
      track.id,
      (t) => {
        for (let i = Math.max(0, from); i <= Math.min(t.steps.length - 1, to); i++)
          spec.set(t.steps[i], v);
      },
      key,
    );
  };

  const bars = track.steps.map((s, i) => {
    const v = spec.get(s);
    const f = (v - spec.min) / (spec.max - spec.min);
    const style = spec.centered
      ? `left:${i * w}px;width:${Math.max(2, w - 2)}px;bottom:${Math.min(f, 0.5) * 100}%;height:${Math.abs(f - 0.5) * 100}%`
      : `left:${i * w}px;width:${Math.max(2, w - 2)}px;height:${Math.max(2, f * 100)}%`;
    return h("span", { class: cls("lane-bar", s.on && "on"), style, title: spec.format(v) });
  });

  return h(
    "div",
    { class: "row lane-row", "data-key": `lane-${track.id}` },
    h(
      "div",
      { class: "head lane-head" },
      h("label", { for: "lane-param" }, "Lane"),
      h(
        "select",
        {
          id: "lane-param",
          value: app.ui.lane,
          onchange: (e: Event) =>
            app.setUi((ui) => (ui.lane = (e.target as HTMLSelectElement).value as LaneParam)),
        },
        Object.entries(LANES).map(([k, l]) => h("option", { value: k }, l.label)),
      ),
    ),
    h(
      "div",
      {
        class: cls("area lane", spec.centered && "centered"),
        style: `width:${width}px`,
        role: "group",
        "aria-label": `${spec.label} lane for ${track.name}; drag to draw values, or use the step inspector`,
        onpointerdown: (e: PointerEvent) => {
          if (e.button !== 0) return;
          const area = e.currentTarget as HTMLElement;
          area.setPointerCapture(e.pointerId);
          laneDrag = { last: null, key: `lane-${++paintCount}` };
          apply(e, area);
        },
        onpointermove: (e: PointerEvent) => {
          const area = e.currentTarget as HTMLElement;
          if (area.hasPointerCapture(e.pointerId)) apply(e, area);
        },
        onpointerup: () => {
          laneDrag = null;
          app.endGesture();
        },
        onlostpointercapture: () => {
          laneDrag = null;
          app.endGesture();
        },
      },
      bars,
    ),
  );
}

function rulerView(pattern: Pattern, px: number, span: number, width: number): HTMLElement {
  const bar = barBeats(pattern);
  const unit = 4 / pattern.sigDen;
  const marks: HTMLElement[] = [];
  for (let b = 0; b * bar < span - 1e-9; b++) {
    marks.push(h("span", { class: "bar-num", style: `left:${b * bar * px}px` }, b + 1));
    for (let j = 1; j < pattern.sigNum && b * bar + j * unit < span - 1e-9; j++) {
      marks.push(
        h("span", { class: "beat-num", style: `left:${(b * bar + j * unit) * px}px` }, `.${j + 1}`),
      );
    }
  }
  const end = patternBeats(pattern) * px;
  return h(
    "div",
    { class: "row ruler", "aria-hidden": "true" },
    h("div", { class: "head" }, "Bar"),
    h(
      "div",
      { class: "area", style: `width:${width}px` },
      marks,
      h("span", { class: "pattern-end", style: `left:${end}px` }),
    ),
  );
}

export function gridView(app: App): HTMLElement {
  const pattern = app.pattern;
  const px = app.ui.zoom;
  const bar = barBeats(pattern);
  const span = Math.max(patternBeats(pattern), ...pattern.tracks.map(loopBeats));
  const width = Math.ceil(span * px) + 2;
  const sel = app.track;
  const rows: HTMLElement[] = [];
  pattern.tracks.forEach((track, row) => {
    const cells = track.steps.map((_, i) => {
      const tabbable = sel ? sel.id === track.id && app.ui.step === i : row === 0 && i === 0;
      return cellView(app, pattern, row, track, i, px, tabbable);
    });
    rows.push(
      h(
        "div",
        { class: cls("row track-row", track.mute && "muted"), "data-key": `row-${track.id}` },
        headView(app, track, row),
        h(
          "div",
          {
            class: "area",
            style: `width:${width}px`,
            role: "group",
            "aria-label": `${track.name} steps`,
          },
          cells,
          ghosts(track, px, span),
          h("span", {
            class: "loop-end",
            style: `left:${loopBeats(track) * px}px`,
            "aria-hidden": "true",
          }),
        ),
      ),
    );
    if (sel?.id === track.id) rows.push(laneView(app, track, px, width));
  });

  return h(
    "section",
    { class: "grid-section", "aria-labelledby": "grid-heading" },
    h(
      "div",
      { class: "section-head" },
      h("h2", { id: "grid-heading" }, "Steps"),
      h(
        "div",
        { class: "field inline" },
        h("label", { for: "zoom" }, "Zoom"),
        h(
          "select",
          {
            id: "zoom",
            value: String(px),
            onchange: (e: Event) =>
              app.setUi((ui) => (ui.zoom = Number((e.target as HTMLSelectElement).value))),
          },
          ZOOMS.map((z) => h("option", { value: String(z) }, `${z} px/beat`)),
        ),
      ),
      h(
        "p",
        { class: "hint" },
        "Click toggles, Shift+click accents, drag paints, right-click or long-press selects. Arrows move, Enter toggles.",
      ),
    ),
    h(
      "div",
      { class: "grid-scroll", id: "grid-scroll" },
      h(
        "div",
        {
          class: "grid",
          style: `--beat:${px}px;--bar:${bar * px}px;width:calc(var(--head) + ${width}px)`,
        },
        rulerView(pattern, px, span, width),
        rows,
        pattern.tracks.length
          ? null
          : h("p", { class: "empty" }, "No tracks. Add one in the track panel."),
      ),
    ),
  );
}
