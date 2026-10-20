// Demo project: eight patterns covering backbeat, fills, clave, 12/8, cross-rhythms,
// polymeter, odd meter and trap rolls, plus a song that chains them.

import type { SoundKey } from "./kit";
import {
  makePattern,
  newId,
  makeStep,
  makeTrack,
  type Pattern,
  type Project,
  type Step,
  type Track,
} from "./model";
import { tuplet } from "./presets";
import type { Ratio } from "./ratio";

const S16: Ratio = { num: 1, den: 4 };
const S8: Ratio = { num: 1, den: 2 };
const S4: Ratio = { num: 1, den: 1 };

const LEVELS: Record<string, number> = { X: 1, x: 0.8, g: 0.3 };

/**
 * Steps from text: "X" accent (1.0), "x" normal (0.8), "g" ghost (0.3), "." off; spaces are ignored.
 * `mods` overrides settings of individual steps by index.
 */
function steps(cells: string, mods: Record<number, Partial<Step>> = {}): Step[] {
  return cells
    .replaceAll(" ", "")
    .split("")
    .map((c, i) => {
      const on = c in LEVELS;
      return makeStep({ on, velocity: on ? LEVELS[c] : 0.8, ...mods[i] });
    });
}

function track(
  sound: SoundKey,
  cells: string,
  stepDur: Ratio,
  over: Partial<Track> & { mods?: Record<number, Partial<Step>> } = {},
): Track {
  const { mods, ...rest } = over;
  return makeTrack(sound, { steps: steps(cells, mods), stepDur, ...rest });
}

function pattern(name: string, over: Partial<Pattern>, tracks: Track[]): Pattern {
  return { ...makePattern(name, tracks), ...over };
}

function backbeat(): Pattern {
  return pattern("Backbeat", { swing: 54 }, [
    track("kick", "X... .... X.x. ....", S16),
    track("snare", "...g X..g .g.. X..g", S16),
    track("closedHat", "X.x. X.x. X.x. X...", S16, { choke: 1 }),
    track("openHat", ".... .... .... ..x.", S16, { choke: 1 }),
  ]);
}

/** Bar 1: groove, then a descending tom fill with snare ratchets; bar 2: crash on the downbeat. */
function backbeatFill(): Pattern {
  const toms = (from: number) => ({ [from]: { pitch: 2 }, [from + 1]: { pitch: 0 } });
  return pattern("Backbeat fill", { swing: 54, bars: 2 }, [
    track("kick", "X... .... X... .... X... .... X.x. ....", S16),
    track("snare", "...g X..g .... ..xX ...g X..g .g.. X..g", S16, {
      mods: { 14: { ratchet: 2, velocity: 0.7 }, 15: { ratchet: 4 } },
    }),
    track("closedHat", "X.x. X.x. .... .... X.x. X.x. X.x. X...", S16, { choke: 1 }),
    track("openHat", ".... .... .... .... .... .... .... ..x.", S16, { choke: 1 }),
    track("highTom", ".... .... xx.. .... .... .... .... ....", S16, { mods: toms(8) }),
    track("midTom", ".... .... ..xx .... .... .... .... ....", S16, { mods: toms(10) }),
    track("lowTom", ".... .... .... xX.. .... .... .... ....", S16, { mods: toms(12) }),
    track("crash", ".... .... .... .... X... .... .... ....", S16),
  ]);
}

/** Son clave 3-2 over two bars of 8th-note pulses, with conga tumbao, bell and bass anticipations. */
function sonClave(): Pattern {
  // Tumbao per bar: heel, toe, slap, toe, heel, toe, open, open (second open tone on the low drum).
  const tumbao = (o: number) => ({
    [o]: { velocity: 0.35 },
    [o + 1]: { velocity: 0.25 },
    [o + 2]: { velocity: 0.85, pitch: 7 },
    [o + 3]: { velocity: 0.25 },
    [o + 4]: { velocity: 0.35 },
    [o + 5]: { velocity: 0.25 },
    [o + 6]: { velocity: 0.9 },
    [o + 7]: { velocity: 0.9, pitch: -5 },
  });
  return pattern("Son clave 3-2", { bars: 2 }, [
    track("claves", "x..x ..x. ..x. x...", S8),
    track("conga", "xxxx xxxx xxxx xxxx", S8, { mods: { ...tumbao(0), ...tumbao(8) } }),
    track("cowbell", "X.x. X.x. X.x. X.x.", S8, { volume: 0.6 }),
    track("kick", "...x ..x. ...x ..x.", S8, { volume: 0.7 }),
  ]);
}

function bembe(): Pattern {
  return pattern("Bembé 12/8", { sigNum: 12, sigDen: 8 }, [
    track("cowbell", "X.x.xx.x.x.x", S8, { name: "Bell", tune: 5 }),
    track("kick", "x..x..x..x..", S8),
    track("shaker", "XggXggXggXgg", S8),
    track("conga", "...x.....xx.", S8, { mods: { 9: { pitch: 7 }, 10: { pitch: -5 } } }),
  ]);
}

function threeFiveOverFour(): Pattern {
  return pattern("3 and 5 over 4", {}, [
    track("kick", "Xxxx", S4),
    track("marimba", "xxx", tuplet(3, 4), { mods: { 1: { pitch: 3 }, 2: { pitch: 7 } } }),
    track("glockenspiel", "xxxxx", tuplet(5, 4), {
      volume: 0.6,
      mods: { 1: { pitch: 2 }, 2: { pitch: 4 }, 3: { pitch: 7 }, 4: { pitch: 9 } },
    }),
    track("closedHat", "XxXxXxXx", S8, { choke: 1 }),
  ]);
}

/** Tracks of 16, 7, 5 and 3 sixteenths; they realign after 105 bars, so the length is capped at 4. */
function polymeter(): Pattern {
  return pattern("Polymeter 16:7:5:3", { bars: 4 }, [
    track("kick", "X...x...X...x...", S16),
    track("rim", "x.x.x..", S16),
    track("conga", "x.x..", S16, { mods: { 2: { pitch: 5 } } }),
    track("closedHat", "Xx.", S16),
  ]);
}

/** 7/8 grouped 2+2+3: group starts on sixteenths 0, 4 and 8. */
function sevenEight(): Pattern {
  return pattern("Seven-eight 2+2+3", { sigNum: 7, sigDen: 8 }, [
    track("kick", "X... .... X.x. ..", S16),
    track("snare", ".... X... .... X.", S16),
    track("closedHat", "X.x. X.x. X.x. x.", S16),
    track("cowbell", "x... x... x... ..", S16, { volume: 0.5 }),
  ]);
}

/** Half-time trap: hat rolls with ratchets and probability, pitched long kick, a fill every 4th loop. */
function trap(): Pattern {
  const fill = { condition: { a: 4, b: 4 } };
  return pattern("Trap rolls", { swing: 50 }, [
    track("kick", "X... ...x ..x. ..x.", S16, {
      decay: 2.5,
      mods: { 7: { pitch: -3 }, 10: { pitch: 2 }, 14: { pitch: -5 } },
    }),
    track("clap", ".... .... X... ....", S16),
    track("snare", ".... .... .... xxxX", S16, {
      mods: {
        12: { ...fill, ratchet: 2, velocity: 0.5 },
        13: { ...fill, ratchet: 3, velocity: 0.65 },
        14: { ...fill, ratchet: 4, velocity: 0.8 },
        15: { ...fill, ratchet: 4 },
      },
    }),
    track("closedHat", "x.xx x.x. x.xx x.xx", S16, {
      swing: false,
      mods: {
        3: { ratchet: 2, probability: 0.7, velocity: 0.6 },
        6: { ratchet: 3, velocity: 0.7 },
        10: { ratchet: 2, probability: 0.5 },
        14: { ratchet: 4, velocity: 0.6 },
        15: { ratchet: 3, probability: 0.6, velocity: 0.7 },
      },
    }),
  ]);
}

export function demoProject(): Project {
  const patterns = [
    backbeat(),
    backbeatFill(),
    sonClave(),
    bembe(),
    threeFiveOverFour(),
    polymeter(),
    sevenEight(),
    trap(),
  ];
  const [beat, fill, clave, bembePattern, cross, poly, seven, trapPattern] = patterns;
  const song = [
    { id: newId(), patternId: beat.id, repeats: 3 },
    { id: newId(), patternId: fill.id, repeats: 1 },
    { id: newId(), patternId: beat.id, repeats: 2 },
    { id: newId(), patternId: fill.id, repeats: 1 },
    { id: newId(), patternId: clave.id, repeats: 2 },
    { id: newId(), patternId: bembePattern.id, repeats: 4 },
    { id: newId(), patternId: cross.id, repeats: 4 },
    { id: newId(), patternId: poly.id, repeats: 1 },
    { id: newId(), patternId: seven.id, repeats: 4 },
    { id: newId(), patternId: trapPattern.id, repeats: 4 },
  ];
  return {
    version: 1,
    name: "Demo",
    bpm: 96,
    masterVolume: 0.8,
    metronome: false,
    playMode: "pattern",
    patterns,
    song,
    currentPatternId: beat.id,
  };
}
