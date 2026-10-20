// Labelled form controls. Every control has a stable id and a <label for>.
// Sliders record one undo step per drag (gesture key = control id, ended on change).

import type { App } from "../app";
import { cls, h, type Child } from "./dom";

export function field(
  id: string,
  label: string,
  control: HTMLElement,
  after?: Child,
  hideLabel = false,
): HTMLElement {
  return h(
    "div",
    { class: "field" },
    h("label", { for: id, class: hideLabel ? "visually-hidden" : undefined }, label),
    control,
    after,
  );
}

interface RangeOpts {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  /** Apply the value; `key` coalesces the drag into one undo step. */
  set: (v: number, key: string) => void;
  disabled?: boolean;
}

export function range(app: App, o: RangeOpts): HTMLElement {
  const input = h("input", {
    type: "range",
    id: o.id,
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    disabled: o.disabled,
    "aria-valuetext": o.format(o.value),
    oninput: (e: Event) => o.set(Number((e.target as HTMLInputElement).value), o.id),
    onchange: () => app.endGesture(),
  });
  return field(o.id, o.label, input, h("output", { for: o.id, class: "value" }, o.format(o.value)));
}

interface NumberOpts {
  id: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  set: (v: number) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}

/** Number input committed on change, clamped to [min, max]. */
export function numberInput(o: NumberOpts): HTMLElement {
  const input = h("input", {
    type: "number",
    id: o.id,
    min: o.min,
    max: o.max,
    step: o.step ?? 1,
    value: o.value,
    disabled: o.disabled,
    inputmode: (o.step ?? 1) < 1 ? "decimal" : "numeric",
    onchange: (e: Event) => {
      const el = e.target as HTMLInputElement;
      const n = Number(el.value);
      if (el.value.trim() === "" || !Number.isFinite(n)) {
        el.value = String(o.value);
        return;
      }
      const step = o.step ?? 1;
      const v = Math.min(o.max, Math.max(o.min, Math.round(n / step) * step));
      el.value = String(Number(v.toFixed(4)));
      o.set(Number(v.toFixed(4)));
    },
  });
  return field(o.id, o.label, input, undefined, o.hideLabel);
}

interface SelectOpts {
  id: string;
  label: string;
  value: string;
  options: [value: string, label: string][];
  set: (v: string) => void;
  disabled?: boolean;
}

export function select(o: SelectOpts): HTMLElement {
  const el = h(
    "select",
    {
      id: o.id,
      value: o.value,
      disabled: o.disabled,
      onchange: (e: Event) => o.set((e.target as HTMLSelectElement).value),
    },
    o.options.map(([value, label]) => h("option", { value }, label)),
  );
  return field(o.id, o.label, el);
}

interface CheckOpts {
  id: string;
  label: string;
  checked: boolean;
  set: (v: boolean) => void;
}

export function checkbox(o: CheckOpts): HTMLElement {
  return h(
    "div",
    { class: "field check" },
    h("input", {
      type: "checkbox",
      id: o.id,
      checked: o.checked,
      onchange: (e: Event) => o.set((e.target as HTMLInputElement).checked),
    }),
    h("label", { for: o.id }, o.label),
  );
}

interface ButtonOpts {
  id?: string;
  label: Child;
  onClick: (e: MouseEvent) => void;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
}

export function button(o: ButtonOpts): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      id: o.id,
      class: cls("btn", o.className),
      "aria-pressed": o.pressed === undefined ? undefined : String(o.pressed),
      "aria-label": o.ariaLabel,
      title: o.title,
      disabled: o.disabled,
      onclick: o.onClick,
    },
    o.label,
  );
}

/** Button that asks for a second click before running `action` (no browser dialogs). */
export function confirmButton(
  app: App,
  o: { id: string; label: string; confirmLabel: string; action: () => void; disabled?: boolean },
): HTMLButtonElement {
  const armed = app.ui.confirm === o.id;
  return button({
    id: o.id,
    label: armed ? o.confirmLabel : o.label,
    className: armed ? "danger armed" : undefined,
    disabled: o.disabled,
    onClick: () => {
      if (app.confirm(o.id)) o.action();
    },
  });
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
