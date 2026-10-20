// Page layout: transport, messages, project panel, pattern bar, grid and the editing panels.

import type { App } from "../app";
import { button } from "./controls";
import { h, morph } from "./dom";
import { gridView } from "./grid";
import { inspectorView } from "./inspector";
import { patternBarView } from "./patternBar";
import { projectPanelView } from "./projectPanel";
import { songPanelView } from "./songPanel";
import { trackPanelView } from "./trackPanel";
import { projectBarView, transportView } from "./transport";

function messageView(app: App): HTMLElement | null {
  const msg = app.ui.message;
  if (!msg) return null;
  return h(
    "div",
    { class: msg.error ? "message error" : "message", role: msg.error ? "alert" : "status" },
    h("p", null, msg.text),
    button({
      id: "message-close",
      label: "Dismiss",
      onClick: () => app.setUi((ui) => (ui.message = null)),
    }),
  );
}

export function view(app: App): HTMLElement {
  return h(
    "div",
    { id: "app", class: "app" },
    transportView(app),
    h(
      "main",
      { class: "main" },
      h("h1", { class: "visually-hidden" }, "Polymeter Drum Machine"),
      projectBarView(app),
      messageView(app),
      projectPanelView(app),
      patternBarView(app),
      gridView(app),
      h("div", { class: "panels" }, inspectorView(app), trackPanelView(app), songPanelView(app)),
    ),
  );
}

export function renderInto(root: HTMLElement, app: App): void {
  morph(root, view(app));
}
