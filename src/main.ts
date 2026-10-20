// Entry point: mounts the app and installs page-wide keyboard and gesture handlers.

import "./style.css";
import { App, TRACK_KEYS } from "./app";
import { renderInto } from "./ui/view";

const root =
  document.getElementById("app") ?? document.body.appendChild(document.createElement("div"));
root.id = "app";

const app = new App((a) => renderInto(root, a));
app.render();

// Audio may only start inside a user gesture: create or resume it on the first one.
const unlock = () => {
  app.ensureAudio();
  window.removeEventListener("pointerdown", unlock, true);
  window.removeEventListener("keydown", unlock, true);
};
window.addEventListener("pointerdown", unlock, true);
window.addEventListener("keydown", unlock, true);

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement)
    return !["range", "checkbox", "radio", "button"].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

window.addEventListener("keydown", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const typing = isTextEntry(target);
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && !e.altKey && !typing && (key === "z" || key === "y")) {
    e.preventDefault();
    if (key === "y" || e.shiftKey) app.redo();
    else app.undo();
    return;
  }
  if (e.key === "Escape") {
    app.setUi((ui) => {
      ui.confirm = null;
      ui.dialog = null;
    });
    return;
  }
  // Space plays/stops unless a control has focus (buttons and inputs use Space themselves).
  if (e.key === " " && !target?.closest("input, select, textarea, button, a, [contenteditable]")) {
    e.preventDefault();
    app.togglePlay();
    return;
  }
  if (mod || e.altKey || typing || e.repeat) return;
  const index = TRACK_KEYS.indexOf(key);
  const track = index >= 0 ? app.pattern.tracks[index] : undefined;
  if (track) {
    e.preventDefault();
    app.recordHit(track);
  }
});
