// Pattern bar: tabs, new/duplicate/delete/clear, name, time signature, length, swing and the
// bar count after which all track loops realign.

import type { App } from "../app";
import {
  MAX_BARS,
  SIG_DENOMINATORS,
  clonePattern,
  defaultKitPattern,
  makeStep,
  type Project,
} from "../model";
import { realignBars } from "../patternTools";
import { button, confirmButton, numberInput, range, select } from "./controls";
import { cls, h } from "./dom";

function openPattern(app: App, id: string) {
  app.navigate((p) => (p.currentPatternId = id));
  app.selectFirstTrack();
}

function nextName(project: Project, base: string): string {
  const names = new Set(project.patterns.map((p) => p.name));
  for (let i = 1; ; i++) {
    const name = i === 1 && base !== "Pattern" ? base : `${base} ${i}`;
    if (!names.has(name)) return name;
  }
}

export function patternBarView(app: App): HTMLElement {
  const { project, ui } = app;
  const pattern = app.pattern;
  const realign = realignBars(pattern);
  const tabs = h(
    "div",
    { class: "tabs", role: "group", "aria-label": "Patterns" },
    project.patterns.map((p, i) =>
      h(
        "button",
        {
          type: "button",
          id: `tab-${p.id}`,
          class: cls(
            "tab",
            p.id === pattern.id && "current",
            ui.playing && p.id === ui.playingPatternId && "playing",
          ),
          "aria-pressed": String(p.id === pattern.id),
          title: ui.playing && p.id === ui.playingPatternId ? "Playing" : undefined,
          onclick: () => openPattern(app, p.id),
        },
        h("span", { class: "tab-index" }, i + 1),
        " ",
        p.name,
      ),
    ),
  );

  const queued =
    ui.playing &&
    project.playMode === "pattern" &&
    ui.playingPatternId &&
    ui.playingPatternId !== pattern.id;

  return h(
    "section",
    { class: "pattern-bar", "aria-labelledby": "pattern-heading" },
    h("h2", { id: "pattern-heading", class: "visually-hidden" }, "Pattern"),
    tabs,
    queued ? h("p", { class: "hint" }, "Switches at the end of the playing pattern.") : null,
    h(
      "div",
      { class: "toolbar" },
      button({
        id: "pattern-new",
        label: "New",
        disabled: project.patterns.length >= 64,
        onClick: () => {
          const p = defaultKitPattern(nextName(project, "Pattern"));
          app.update((proj) => {
            proj.patterns.push(p);
            proj.currentPatternId = p.id;
          });
          app.selectFirstTrack();
        },
      }),
      button({
        id: "pattern-duplicate",
        label: "Duplicate",
        disabled: project.patterns.length >= 64,
        onClick: () => {
          const copy = clonePattern(pattern, nextName(project, `${pattern.name} copy`));
          app.update((proj) => {
            proj.patterns.splice(proj.patterns.findIndex((p) => p.id === pattern.id) + 1, 0, copy);
            proj.currentPatternId = copy.id;
          });
          app.selectFirstTrack();
        },
      }),
      button({
        id: "pattern-clear",
        label: "Clear",
        onClick: () =>
          app.updatePattern(pattern.id, (p) => {
            for (const t of p.tracks) t.steps = t.steps.map(() => makeStep());
          }),
      }),
      confirmButton(app, {
        id: "pattern-delete",
        label: "Delete",
        confirmLabel: "Confirm delete",
        disabled: project.patterns.length <= 1,
        action: () => {
          app.update((proj) => {
            const index = proj.patterns.findIndex((p) => p.id === pattern.id);
            proj.patterns.splice(index, 1);
            proj.song = proj.song.filter((e) => e.patternId !== pattern.id);
            proj.currentPatternId = proj.patterns[Math.max(0, index - 1)].id;
          });
          app.selectFirstTrack();
        },
      }),
    ),
    h(
      "div",
      { class: "fields" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "pattern-name" }, "Name"),
        h("input", {
          id: "pattern-name",
          type: "text",
          maxlength: 40,
          value: pattern.name,
          onchange: (e: Event) => {
            const name = (e.target as HTMLInputElement).value.trim();
            if (name) app.updatePattern(pattern.id, (p) => (p.name = name));
          },
        }),
      ),
      h(
        "div",
        { class: "sig" },
        numberInput({
          id: "pattern-sig-num",
          label: "Beats",
          min: 1,
          max: 32,
          value: pattern.sigNum,
          set: (v) => app.updatePattern(pattern.id, (p) => (p.sigNum = v)),
        }),
        h("span", { class: "sig-slash", "aria-hidden": "true" }, "/"),
        select({
          id: "pattern-sig-den",
          label: "Unit",
          value: String(pattern.sigDen),
          options: SIG_DENOMINATORS.map((d) => [String(d), String(d)]),
          set: (v) => app.updatePattern(pattern.id, (p) => (p.sigDen = Number(v))),
        }),
      ),
      numberInput({
        id: "pattern-bars",
        label: "Bars",
        min: 1,
        max: MAX_BARS,
        value: pattern.bars,
        set: (v) => app.updatePattern(pattern.id, (p) => (p.bars = v)),
      }),
      range(app, {
        id: "pattern-swing",
        label: "Swing",
        min: 50,
        max: 75,
        step: 1,
        value: pattern.swing,
        format: (v) => `${v}%`,
        set: (v, key) => app.updatePattern(pattern.id, (p) => (p.swing = v), key),
      }),
      h(
        "div",
        { class: "realign" },
        h(
          "p",
          { id: "realign-text" },
          realign === null
            ? "Tracks realign after more bars than can be counted."
            : `Tracks realign every ${realign} ${realign === 1 ? "bar" : "bars"}.`,
        ),
        button({
          id: "realign-set",
          label:
            realign !== null && realign <= MAX_BARS
              ? `Set length to ${realign}`
              : "Too long to set",
          disabled: realign === null || realign > MAX_BARS || realign === pattern.bars,
          onClick: () =>
            realign !== null && app.updatePattern(pattern.id, (p) => (p.bars = realign)),
        }),
      ),
    ),
  );
}
