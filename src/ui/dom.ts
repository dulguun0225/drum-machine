// DOM helpers: `h` builds elements; `morph` patches a live tree to match a newly built one,
// reusing existing nodes so focus, scroll position and in-progress input survive a re-render.

export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown>;

const HANDLERS = [
  "onclick",
  "oninput",
  "onchange",
  "onkeydown",
  "onpointerdown",
  "onpointermove",
  "onpointerup",
  "onpointercancel",
  "oncontextmenu",
  "onlostpointercapture",
] as const;

type HandlerName = (typeof HANDLERS)[number];

function append(el: Element, child: Child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) for (const c of child) append(el, c);
  else el.append(child instanceof Node ? child : String(child));
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  let value: unknown;
  for (const [key, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (key.startsWith("on")) (el as unknown as Record<string, unknown>)[key] = v;
    else if (key === "value") value = v;
    else if (key === "checked") (el as HTMLInputElement).checked = Boolean(v);
    else
      el.setAttribute(
        key === "className" ? "class" : key,
        v === true ? "" : String(v as string | number),
      );
  }
  append(el, children);
  // Set after the options exist, so a <select> can take its value.
  if (value !== undefined) (el as HTMLInputElement).value = String(value as string | number);
  return el;
}

/** Class list from conditional parts. */
export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function keyOf(node: ChildNode): string | null {
  if (!(node instanceof Element)) return null;
  return node.getAttribute("data-key") ?? (node.id || null);
}

function patchAttributes(from: Element, to: Element) {
  for (const { name } of Array.from(from.attributes)) {
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
  for (const { name, value } of Array.from(to.attributes)) {
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !["range", "checkbox", "radio", "button", "file"].includes(el.type);
}

function patchFormState(from: Element, to: Element) {
  if (from instanceof HTMLInputElement && to instanceof HTMLInputElement) {
    if (from.checked !== to.checked) from.checked = to.checked;
    if (from.type === "file") return;
  }
  if (
    from instanceof HTMLInputElement ||
    from instanceof HTMLTextAreaElement ||
    from instanceof HTMLSelectElement
  ) {
    const next = (to as HTMLInputElement).value;
    // Leave text the user is typing alone; it is committed on change.
    if (isTextEntry(from) && document.activeElement === from) return;
    if (from.value !== next) from.value = next;
  }
}

function patch(from: ChildNode, to: ChildNode) {
  if (!(from instanceof Element) || !(to instanceof Element)) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  patchAttributes(from, to);
  const f = from as unknown as Record<HandlerName, unknown>;
  const t = to as unknown as Record<HandlerName, unknown>;
  for (const name of HANDLERS) if (f[name] !== t[name]) f[name] = t[name] ?? null;
  morphChildren(from, to);
  patchFormState(from, to);
}

function morphChildren(parent: Element, next: Element) {
  const keyed = new Map<string, ChildNode>();
  for (const c of Array.from(parent.childNodes)) {
    const k = keyOf(c);
    if (k) keyed.set(k, c);
  }
  let cursor: ChildNode | null = parent.firstChild;
  for (const n of Array.from(next.childNodes)) {
    const k = keyOf(n);
    let match: ChildNode | null = null;
    if (k) {
      const old = keyed.get(k);
      if (old && old.nodeName === n.nodeName) {
        match = old;
        keyed.delete(k);
      }
    } else if (cursor && !keyOf(cursor) && cursor.nodeName === n.nodeName) {
      match = cursor;
    }
    if (!match) {
      parent.insertBefore(n, cursor);
      continue;
    }
    if (match === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(match, cursor);
    patch(match, n);
  }
  while (cursor) {
    const nextSibling: ChildNode | null = cursor.nextSibling;
    cursor.remove();
    cursor = nextSibling;
  }
}

/** Make `root` match `next` (same tag), keeping matched nodes. */
export function morph(root: Element, next: Element): void {
  patch(root, next);
}
