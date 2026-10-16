# GPTD Documentation

This folder holds all of GPTD's documentation. **New here?** GPTD is a
tower-defense game about serving AI requests, grounded in real LLM-inference
engineering — **[▶ play it now](https://jacoblincool.github.io/GPTD/)**, or read the
[project overview](../README.md) first.

Two files live at the repo root, not here: **[../README.md](../README.md)** (the
project landing page — what GPTD is, how to run it) and
**[../AGENTS.md](../AGENTS.md)** (the working rules for contributors and AI coding
agents, kept at the root so tools discover it).

## For players

| Doc | What it is |
| --- | --- |
| **[manual/en.md](./manual/en.md)** | The player manual — what the game is and how to play it, no prior knowledge needed. **English (primary).** |
| **[manual/zh-TW.md](./manual/zh-TW.md)** | The player manual, **正體中文（台灣）**. |
| **[manual/README.md](./manual/README.md)** | Language picker for the manual. |
| **[AGENT-BRIDGE.md](./AGENT-BRIDGE.md)** | Let a local terminal agent (Claude Code / Codex) play the game in a browser tab you already have open — the protocol, action vocabulary, and `/state` snapshot shape. |

## Design & game spec

| Doc | What it is |
| --- | --- |
| **[DESIGN.md](./DESIGN.md)** | The **canonical Game Design Document** — the readable design of record. **Start here to understand the design.** |
| **[BLUEPRINT.md](./BLUEPRINT.md)** | The **authoritative design spec** (§0–§7): the unified data model, the serving spine, the dual-clock / SLO physics, and every subsystem — the deepest implementation layer beneath the GDD. (正體中文.) |
| **[MATH.md](./MATH.md)** | Quick reference: every formula, constant, and variable the simulation uses, extracted from the code (glossary → constants → formulas by subsystem). |
| **[SYSTEM-MENU.md](./SYSTEM-MENU.md)** | Design spec for the system/pause menu, the settings tabs (Audio, Display, Accessibility, Gameplay), the content browsers (How to Play, Codex, Achievements, About), and the persistence layer. |

## Real-world grounding

GPTD's slogan is *"the board is the metaphor, the numbers are real."* These docs
are where the numbers come from and how they map to reality.

| Doc | What it is |
| --- | --- |
| **[REALISM.md](./REALISM.md)** | The realism ledger: each mechanic → its real-world basis, the literature, what GPTD ships, and where it knowingly deviates. |
| **[REALISM-MODELS.md](./REALISM-MODELS.md)** | The real-model grounding: how the model roster, capability calibration, and post-training tie to real open-weight models and public benchmarks, and the data pipeline that builds them. |
| **[MODEL-CATALOG.md](./MODEL-CATALOG.md)** | The fact-checked model reference — developer, release, license, link, the six calibration benchmarks, and lineage for every model the roster is drawn from, plus a generated serving line per roster checkpoint (KV cache per token, release precision, thinking support). ★ marks the active roster. |
| **[PARETO.md](./PARETO.md)** | The roster's size ↔ capability analysis, generated from the loaded roster: the five capability frontiers, per-size ceilings, the frontier-tolerance gate that picks the active roster, and how the hand-authored entries sit against the frontier. |
| **[REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md)** | Deep background: the real-world 2024–2026 facts about LLM inference, post-training, safety, serving systems, and hardware the simulation is calibrated against. The blueprint's `§ref` citations resolve here. (正體中文; not required to play.) |

The model facts behind MODEL-CATALOG and PARETO live as data in [`../data/`](../data/):
Artificial Analysis benchmark snapshots and the fits that keep them on one reference
scale, per-checkpoint architecture read from each Hugging Face `config.json`
(`model-arch.json`), the thinking support each chat template allows, with a verbatim
quote as evidence (`model-thinking.json`), and the pins that join each roster model to
its benchmark rows (`roster-aa-map.json`). [AGENTS.md](../AGENTS.md) §3 has the
pipeline that turns them into the game's roster.
