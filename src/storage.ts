// localStorage persistence. Every access is wrapped: the app works when storage is blocked or full.

const PROJECT_KEY = "polymeter-drum-machine:project";
const THEME_KEY = "polymeter-drum-machine:theme";
const SAVE_DELAY_MS = 500;

export type Theme = "auto" | "light" | "dark";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadSavedProject(): string | null {
  return read(PROJECT_KEY);
}

let timer: number | undefined;

/** Save after changes stop for SAVE_DELAY_MS. */
export function saveProjectSoon(serialise: () => string): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => write(PROJECT_KEY, serialise()), SAVE_DELAY_MS);
}

export function loadTheme(): Theme {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "auto";
}

export function saveTheme(theme: Theme): void {
  write(THEME_KEY, theme);
}
