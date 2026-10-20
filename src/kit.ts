// Sound catalogue: keys, display names and families. Shared by the model, the synth and the UI.

export const SOUND_KEYS = [
  "kick",
  "snare",
  "clap",
  "rim",
  "closedHat",
  "openHat",
  "crash",
  "ride",
  "shaker",
  "lowTom",
  "midTom",
  "highTom",
  "conga",
  "cowbell",
  "woodblock",
  "claves",
  "marimba",
  "glockenspiel",
] as const;

export type SoundKey = (typeof SOUND_KEYS)[number];

/** Sound family; selects the color of the track chip. */
export type Family = "low" | "snare" | "metal" | "tom" | "tuned";

export const SOUNDS: Record<SoundKey, { name: string; family: Family }> = {
  kick: { name: "Kick", family: "low" },
  snare: { name: "Snare", family: "snare" },
  clap: { name: "Clap", family: "snare" },
  rim: { name: "Rim click", family: "snare" },
  closedHat: { name: "Closed hat", family: "metal" },
  openHat: { name: "Open hat", family: "metal" },
  crash: { name: "Crash", family: "metal" },
  ride: { name: "Ride", family: "metal" },
  shaker: { name: "Shaker", family: "metal" },
  lowTom: { name: "Low tom", family: "tom" },
  midTom: { name: "Mid tom", family: "tom" },
  highTom: { name: "High tom", family: "tom" },
  conga: { name: "Conga", family: "tom" },
  cowbell: { name: "Cowbell", family: "tuned" },
  woodblock: { name: "Woodblock", family: "tuned" },
  claves: { name: "Claves", family: "tuned" },
  marimba: { name: "Marimba", family: "tuned" },
  glockenspiel: { name: "Glockenspiel", family: "tuned" },
};

export function isSoundKey(value: unknown): value is SoundKey {
  return typeof value === "string" && (SOUND_KEYS as readonly string[]).includes(value);
}
