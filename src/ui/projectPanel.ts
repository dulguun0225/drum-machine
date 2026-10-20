// Export / import panel: project JSON with Copy and Download; import from a file or pasted text.

import type { App } from "../app";
import { parseProjectText, serializeProject } from "../model";
import { button } from "./controls";
import { h } from "./dom";

function copy(app: App, text: string) {
  const fallback = () => {
    const area = document.getElementById("export-json") as HTMLTextAreaElement | null;
    area?.focus();
    area?.select();
    app.showMessage("Copying is not available here; the text is selected, press Ctrl+C or Cmd+C.");
  };
  try {
    if (!navigator.clipboard) return fallback();
    navigator.clipboard
      .writeText(text)
      .then(() => app.showMessage("Project JSON copied."), fallback);
  } catch {
    fallback();
  }
}

function download(app: App, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = h("a", {
      href: url,
      download: `${app.project.name.replace(/[^\w-]+/g, "-") || "project"}.json`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    app.showMessage("Download is not available here; use Copy instead.", true);
  }
}

function importText(app: App, text: string, source: string) {
  const result = parseProjectText(text);
  if (!result.ok) {
    app.showMessage(`Import failed: ${result.error}`, true);
    return;
  }
  app.load(result.project, `Imported ${source}. Undo restores the previous project.`);
  app.setUi((ui) => {
    ui.dialog = null;
    ui.importText = "";
  });
}

export function projectPanelView(app: App): HTMLElement | null {
  const { ui } = app;
  if (ui.dialog === null) return null;
  const close = button({
    id: "dialog-close",
    label: "Close",
    onClick: () => app.setUi((u) => (u.dialog = null)),
  });

  if (ui.dialog === "export") {
    const json = serializeProject(app.project, true);
    return h(
      "section",
      { class: "panel project-panel", "aria-labelledby": "export-heading" },
      h("h2", { id: "export-heading" }, "Export project"),
      h(
        "div",
        { class: "field wide" },
        h("label", { for: "export-json" }, "Project JSON"),
        h("textarea", {
          id: "export-json",
          rows: 10,
          readonly: true,
          spellcheck: "false",
          value: json,
        }),
      ),
      h(
        "div",
        { class: "toolbar" },
        button({ id: "export-copy", label: "Copy", onClick: () => copy(app, json) }),
        button({ id: "export-download", label: "Download", onClick: () => download(app, json) }),
        close,
      ),
    );
  }

  return h(
    "section",
    { class: "panel project-panel", "aria-labelledby": "import-heading" },
    h("h2", { id: "import-heading" }, "Import project"),
    h(
      "div",
      { class: "field" },
      h("label", { for: "import-file" }, "JSON file"),
      h("input", {
        id: "import-file",
        type: "file",
        accept: ".json,application/json",
        onchange: (e: Event) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          if (!file) return;
          file.text().then(
            (text) => importText(app, text, file.name),
            () => app.showMessage("The file could not be read.", true),
          );
          input.value = "";
        },
      }),
    ),
    h(
      "div",
      { class: "field wide" },
      h("label", { for: "import-json" }, "Or paste JSON"),
      h("textarea", {
        id: "import-json",
        rows: 8,
        spellcheck: "false",
        value: ui.importText,
        oninput: (e: Event) => (ui.importText = (e.target as HTMLTextAreaElement).value),
      }),
    ),
    h(
      "div",
      { class: "toolbar" },
      button({
        id: "import-load",
        label: "Load pasted JSON",
        onClick: () => importText(app, ui.importText, "pasted JSON"),
      }),
      close,
    ),
  );
}
