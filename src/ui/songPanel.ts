// Song panel: Pattern/Song play mode, follow, and the ordered list of song entries.

import type { App } from "../app";
import { findPattern, newId } from "../model";
import { button, checkbox, numberInput } from "./controls";
import { cls, h } from "./dom";

export function songPanelView(app: App): HTMLElement {
  const { project, ui } = app;
  const totalBars = project.song.reduce(
    (sum, e) => sum + e.repeats * (findPattern(project, e.patternId)?.bars ?? 0),
    0,
  );
  const options = project.patterns.map((p) => h("option", { value: p.id }, p.name));

  const move = (i: number, delta: number) =>
    app.update((p) => {
      const j = i + delta;
      if (j < 0 || j >= p.song.length) return;
      [p.song[i], p.song[j]] = [p.song[j], p.song[i]];
    });

  const entries = project.song.map((entry, i) =>
    h(
      "li",
      {
        class: cls("entry", ui.playing && ui.playingEntry === i && "playing"),
        "data-key": `entry-${entry.id}`,
      },
      h("span", { class: "entry-index", "aria-hidden": "true" }, i + 1),
      h(
        "div",
        { class: "field" },
        h(
          "label",
          { for: `song-pattern-${i}`, class: "visually-hidden" },
          `Entry ${i + 1} pattern`,
        ),
        h(
          "select",
          {
            id: `song-pattern-${i}`,
            value: entry.patternId,
            onchange: (e: Event) => {
              const id = (e.target as HTMLSelectElement).value;
              app.update((p) => (p.song[i].patternId = id));
            },
          },
          options.map((o) => o.cloneNode(true)),
        ),
      ),
      h("span", { class: "times", "aria-hidden": "true" }, "×"),
      numberInput({
        id: `song-repeats-${i}`,
        label: `Entry ${i + 1} repeats`,
        hideLabel: true,
        min: 1,
        max: 64,
        value: entry.repeats,
        set: (v) => app.update((p) => (p.song[i].repeats = v)),
      }),
      h(
        "div",
        { class: "group" },
        button({
          id: `song-up-${i}`,
          label: "↑",
          className: "icon",
          ariaLabel: `Move entry ${i + 1} up`,
          disabled: i === 0,
          onClick: () => move(i, -1),
        }),
        button({
          id: `song-down-${i}`,
          label: "↓",
          className: "icon",
          ariaLabel: `Move entry ${i + 1} down`,
          disabled: i === project.song.length - 1,
          onClick: () => move(i, 1),
        }),
        button({
          id: `song-remove-${i}`,
          label: "×",
          className: "icon",
          ariaLabel: `Remove entry ${i + 1}`,
          onClick: () => app.update((p) => p.song.splice(i, 1)),
        }),
      ),
    ),
  );

  return h(
    "section",
    { class: "panel song-panel", "aria-labelledby": "song-heading" },
    h("h2", { id: "song-heading" }, "Song", h("span", { class: "sub" }, ` ${totalBars} bars`)),
    h(
      "div",
      { class: "toolbar" },
      h(
        "div",
        { class: "group", role: "group", "aria-label": "Play mode" },
        button({
          id: "mode-pattern",
          label: "Pattern",
          pressed: project.playMode === "pattern",
          onClick: () => app.update((p) => (p.playMode = "pattern")),
        }),
        button({
          id: "mode-song",
          label: "Song",
          pressed: project.playMode === "song",
          onClick: () => app.update((p) => (p.playMode = "song")),
        }),
      ),
      checkbox({
        id: "song-follow",
        label: "Follow",
        checked: ui.follow,
        set: (v) => app.setUi((u) => (u.follow = v)),
      }),
    ),
    project.playMode === "song" && !project.song.length
      ? h("p", { class: "hint" }, "The song is empty, so the current pattern loops.")
      : null,
    h("ol", { class: "entries" }, entries),
    button({
      id: "song-add",
      label: `Add "${app.pattern.name}"`,
      disabled: project.song.length >= 256,
      onClick: () =>
        app.update((p) => p.song.push({ id: newId(), patternId: app.pattern.id, repeats: 1 })),
    }),
  );
}
