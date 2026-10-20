# Handoff (2026-10-20)

Work in progress on the drum machine. Delete this file when the remaining items below are done.

## Goal

"Create a drum machine. It must be able to create any complicated drum patterns." The sound bank from an earlier session (marimba, woodblock, claves, rim click, cowbell, hi-hat, glockenspiel, conga, kick, snare) is the starter kit; its recipes are kept in `src/sounds.ts`.

Not a claude.ai artifact: the app lives only in this repo and builds to the single file `dist/index.html`.

## State

- Built and working: per-pattern tracks with rational step durations (tuplets, polyrhythms), polymeter, per-step velocity, probability, ratchet, nudge, flam, pitch and loop condition (a:b), parameter lane, Euclidean fill, choke groups, swing, metronome, song mode, live record, undo/redo, autosave, JSON export/import (compact form), demo project with 8 patterns and a song, light/dark theme, works at 400 px width.
- Gates pass at this commit: `vp check`, `vp test` (35 tests), `vp build` (only `dist/index.html`, no external URLs).
- Sound levels of the added sounds were measured (OfflineAudioContext in headless Chrome) and balanced against the starter sounds; nothing clips through the limiter.

## Remaining work (from an independent correctness review)

`src/engine.ts` was rewritten to fix items 1, 2, 3, 7 and 8 on the engine side, but no regression tests exist yet for any item.

1. Scan-ahead too long. Done in the engine: `earlyRoom()` reserves room only for steps that are on and use negative nudge or flam; `Player.start` uses it. Tests to write: a 1/1-rate track at 60 BPM starts within ~0.1 s of Play; a switch chosen at beat 2.05 of a 4-beat pattern with a 1/1 track lands at beat 4, not 8.
2. BPM change did not reach hits already given a time. Done in the engine: events wait in a pending buffer and get a time only inside the 100 ms lookahead. Test to write: 1/1 track, ratchet 4, 60 → 240 BPM at 2.2 s; the ratchets must stay in order before the next step.
3. Song entries tracked by index, so deleting or moving entries during playback skipped or repeated entries. Done in engine and model: entries have a stable `id`; a deleted playing entry continues with the entry now at its old position. Remaining: switch the song highlight in `src/app.ts` (`showBeat`, `playingEntry`) to the event's `entryId`; tests for delete, move and changed repeats during playback.
4. Not started. The playhead event queue in `src/app.ts` (`tick()` pushes, the requestAnimationFrame loop drains) grows without limit while the tab is hidden. Fix: drop events older than now in `tick()`, or keep only the latest step per track.
5. Not started. Undo/redo restores `currentPatternId` and so changes the playing pattern (`src/app.ts`, `replace()`). Fix: keep the live `currentPatternId` when that pattern still exists.
6. Not started. Two hits in the same choke group at the same time both play in full (`src/audio.ts`, choke comparison uses strict `<`/`>`). Decision: the hit on the later track in track order cuts the others. Hit events already carry `order` (track index).
7. Late hits when a step duration grows mid-playback. Done in the engine: a hit that would already be late is skipped. Needs a test.
8. Live record sounds a hit twice when it is rounded to an upcoming step. Engine has `Player.nearestStep()` and `Player.skipOnce()`; `App.recordHit` in `src/app.ts` still uses the old code. It should audition and call `skipOnce` when the nearest step is upcoming and was off, and not audition when it is upcoming and already on.

## Decisions

- Hits that would play in the past are dropped, not played late (after a long main-thread stall, notes are missed rather than played in a burst).
- A queued pattern switch lands at the first pattern boundary after about playhead + 75–100 ms plus the early room.
- A tempo change is anchored at the last lookahead horizon.
- Velocity curve: gain = velocity².

## Verification method

- `mise exec -- vp check`, `mise exec -- vp test`, `mise exec -- vp build`.
- Browser check: `mise exec -- vp preview`, then drive the page with headless Chrome over the DevTools protocol (`google-chrome --headless=new --remote-debugging-port=…`): click pattern tabs, play/stop, read console errors, capture screenshots at 1440 px and 400 px. Screenshots through the Claude in Chrome extension timed out on this machine.
