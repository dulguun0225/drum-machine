---
name: project-not-an-artifact
description: Drum machine is not published as a claude.ai artifact; artifact-only page rules (safe-area insets, claude:viewport meta, title in first 8 KB) do not apply
metadata:
  type: project
---

As of 2026-10-20 the drum machine lives only in this repo and is not published as a claude.ai artifact. The coordinator dropped artifact-only items: no `claude:viewport-fit-sides` meta, no title-in-first-8-KB rule, no `env(safe-area-inset-*)` gutters or `body::before` band; plain `top: 0` sticky transport and a 16px gutter.

**Why:** spec change from the coordinator mid-build.

**How to apply:** do not reintroduce artifact-specific markup or CSS; the single-file `dist/index.html` constraint in CLAUDE.md still holds.
