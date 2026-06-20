# GPTD Real-Model Grounding

> **Single source of truth.** The full realism redesign (P0–P5) has shipped — the authoritative as-built design is [REDESIGN-BLUEPRINT.md](./REDESIGN-BLUEPRINT.md) (grounded by [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md)). This document is the **real-model grounding view**: how GPTD's model roster, capability calibration, and post-training are tied to real open-weight models and real public benchmarks. Reconciled to the as-built code; where this and the code disagree, the code wins.

**Status: SHIPPED — the FULL redesign, not just the first real-model pass.** The original 2026-06 plan in this file was to swap the synthetic ladder for a real roster scored by real benchmarks. That shipped — but it was only the first pass. The redesign that *also* shipped goes much further: a real-roofline serving core (real GPU specs / watts / $), a player-driven **Post-Training Studio** that replaces the two closed custom-model cards, an infra-only tech tree, two-layer safety, and a six-outcome / Goodput economy. Companion to [REALISM.md](./REALISM.md) §2 (calibration) and §3 (post-training).

**Code anchors.** Roster + calibration inputs: `src/sim/content.ts` (ROSTER, `QUALITY_FLOOR`, METHOD_RECIPES); the benchmark→quality curves: `src/sim/calibrate.ts`; player post-training: `src/sim/models.ts`; serving roofline (where `paramsTotalB`/`paramsActiveB` are consumed): `src/sim/effects.ts`.

**Goal:** ground GPTD's model roster in **real open-weight models** scored by **real public benchmarks** (Artificial Analysis + primary model cards), so Expert (Professional) Mode shows a recognizable, defensible model ladder, without breaking the campaign's difficulty arc.

**Research provenance.** A 2026-06 deep-research + adversarial-verification pass produced the per-benchmark `%` cells; treat them as authored data and re-pull before each release — the open-model frontier moves monthly. The corrections from the fact-check pass are reflected in the shipped roster (e.g. Hunyuan-A13B GPQA-Diamond fix; the dense-vs-MoE Nemotron correction; DeepSeek-V3.1 LiveCodeBench).

---

## 0. What shipped (vs the original proposal)

The original proposal scoped a small change: set each checkpoint's `qualityBy` from real benchmarks and split `paramsB` into total/active for MoE. The shipped redesign realized all of that **and** the structural follow-ons the proposal only sketched:

1. **Real roster + free-deploy economy.** 30 real open-weight checkpoints (from the fact-checked 130-model `MODEL-CATALOG.md`), owned free from turn one (`STARTER_MODELS = OPEN_MODEL_IDS`); gated only by VRAM fit (`serverFitsMemory` on `paramsTotalB`). Real metadata (developer / license / openWeights / released / contextWindowK / source) rides as inert display fields the sim never reads.
2. **`qualityBy` calibrated from benchmarks, never hand-edited.** `qualityFromBenchmarks` + the piecewise-linear `CURVES` (`calibrate.ts`). The "future hook" the old code advertised — override per checkpoint with real benchmark scores — is now the *only* way quality is set.
3. **The agentic / SWE wall (the proposal's most important finding, §5 below).** A 5th capability axis `agentic`, calibrated from **SWE-bench Verified** (the unsaturated benchmark), drives the late-game `agent` request. This is the realized fix for capability compression.
4. **MoE = total-vs-active split (the one structural change), realized.** VRAM ∝ `paramsTotalB`, compute/decode ∝ `paramsActiveB`, computed on the real roofline. The proposal's "re-scope `tech_moe`" recommendation became: there is **no `tech_moe` buff at all** — MoE is purely a model property, with `inf_par_ep` (Expert Parallelism) as the serving-layer sharding node.
5. **Post-Training Studio (beyond the proposal's "train your own" hooks).** The two closed custom cards (`ft_agent` 70B agentic specialist, `pt_giga` 2T pretrain) are **gone**. Their role is now **player-created**: a GRPO-agentic Studio run on a frontier base is your agentic specialist; a deep iterative finetune-of-a-finetune chain is the endless ceiling. (Details: REALISM.md §3.)

---

## 1. How the model system works today (ground truth)

- **Correctness gate.** A request is answered **correctly iff** `effQ ≥ difficulty[primaryAxis]`, where `effQ = serverQualityVs(...) − contextGapPenalty − int4ContextPenalty` and `serverQualityVs = qualityBy[axis] − int4Tax − alignmentTax(model)` (`src/sim/effects.ts`, `src/sim/combat.ts`). Below the line → `bad` (still billed, but Trust bleeds). The model number that decides this is `qualityBy[axis]` on the ~0–130 scale, minus the alignment tax.
- **Difficulty is a per-axis vector.** Each `RequestTypeDef` carries `difficulty: Record<CapabilityAxis, number>` and a `primaryAxis` (`content.ts` REQUEST_TYPES). E.g. `chat.difficulty.chat = 18`, `comp.difficulty.coding = 56`, `reason.difficulty.reasoning = 82`, `agent.difficulty.agentic = 82`. The scalar `complexity` is retired.
- **Capability axes.** `qualityBy = {chat, coding, reasoning, general, agentic}` (`ServerSpec`). Requests are graded on `primaryAxis`.
- **Models are real and free.** `ROSTER` (`content.ts`) generates 16 base `ModelDef`s; every one is owned from the start; deploying costs nothing; VRAM fit (and the rack tier a 100B+ model needs) is the gate. Derived models the player mints in the Studio live in `s.derivedModels`, resolved via `resolveModel(s, id)`.
- **VRAM vs serve cost.** `modelMemory = paramsTotalB × bytesPerParam` gates residency; serve speed = the real roofline `min(compute roof, bandwidth roof)` keyed on `paramsActiveB` (`effects.ts`). No `flopsPerWork`/`bandwidthPerWork`/`memoryGb` fields remain.
- **Modes.** `normal` vs `expert` (= "Professional"): identical deterministic sim, expert only reveals telemetry. `src/sim/**` never imports `mode.ts`.

---

## 2. Calibration: benchmark % → game quality (as shipped)

### 2.1 Axis → benchmark (`calibrate.ts`)

| Game axis | Primary benchmark | Fallback (convert, then apply curve) |
|---|---|---|
| `coding` | **LiveCodeBench** | `SWE-bench Verified × 1.05`; `HumanEval`: `max(0, (HE−45)×0.55)` |
| `reasoning` | **GPQA-Diamond** | `AIME × 0.78 + 10` |
| `chat` | **MMLU-Pro** | `MMLU − 14` |
| `general` | **MMLU-Pro** | same as chat |
| `agentic` | **SWE-bench Verified** | discounted LiveCodeBench (`× 0.7`) |

A per-tier `QUALITY_FLOOR` fills any axis a model has no benchmark for. The agentic floors are deliberately low (small 20, general 40, frontier 70) — without a real SWE-bench score a model is assumed weak at autonomous work.

### 2.2 The curves (per-axis piecewise-linear, `CURVES`)

```
coding    (LiveCodeBench %):   (10→30) (30→56) (66→78) (84→95) (95→112)
reasoning (GPQA-Diamond %):    (28→40) (50→72) (70→86) (81→100) (90→118)
chat      (MMLU-Pro %):        (40→30) (56→52) (70→72) (84→95) (91→112)
general   (MMLU-Pro %):        same as chat
agentic   (SWE-bench Verified %): (20→30) (45→60) (60→78) (72→95) (82→112)
```

`pwl(anchors, b)`: linear to origin below the first anchor, gentle `+1.5×` extrapolation above the last, linear interpolation within; clamped to `[8, 130]`. Monotonic, deterministic, table-driven.

### 2.3 Why these anchors hold the arc

- **chat trivial:** any real instruct model (MMLU-Pro ≥ 40) → quality ≥ 30 ≫ the chat line 18.
- **coding needs a real coder / ~30B+:** LCB 30 → exactly 56 (the code line). Llama-3.1-8B (HumanEval 72.6 → LCB≈15 → ~37) ships bad code; Qwen3-32B (LCB 65.7) clears comfortably.
- **hardest reasoning needs GPQA ≳ 65:** GPQA 70 → 86 clears the reason line 82; GPQA 50 → 72 fails. Non-reasoning models (Llama-3.3-70B GPQA 50.5, Gemma-3-27B GPQA 42.4) fail the hardest lane; thinking models clear it — the realism payoff, and the compression problem (§5).
- **agentic separates by SWE:** the agent line 82 sits around SWE-bench Verified ~63; only strong-SWE frontier (or self-trained) models clear it.

### 2.4 Do NOT derive quality from the AA Intelligence Index

The AA composite re-baselines hard between versions (MiniMax-M2 read 61 on v3.0, 28 on the current scale; Kimi K2 67→33). Per-benchmark `%`s (MMLU-Pro / GPQA / LCB / AIME / SWE) are scale-stable. `qualityBy` is derived only from per-benchmark %s; AA index is kept as a display string with its scale version, never fed to calibration (`calibrate.ts` header comment).

---

## 3. The shipped roster (computed, fact-checked)

The roster is **30 real open-weight base checkpoints** (`content.ts` ROSTER), drawn from the fact-checked **130-model catalog** in [`MODEL-CATALOG.md`](MODEL-CATALOG.md) — the single source-of-truth (developer / release / license / official link / the 5 benchmarks / lineage / confidence, sourced from Artificial Analysis + official model cards and refreshed by the `gptd-model-catalog` + `gptd-newest-models` research workflows). `qualityBy` is computed by the §2 calibration from each model's benchmark inputs — **never hand-edited**.

The in-game roster spans small→large (≈1B → 1.6T): edge (Llama-3.2-1B, Qwen3-4B, Nemotron Nano 9B), small/mid (Llama-3.1-8B, Gemma-3-12B, Phi-4, gpt-oss-20B, Qwen3-32B, Qwen3-30B-A3B, Qwen3-Coder-30B, Nemotron-3-Nano-30B, Qwen3.6-27B), large (Llama-3.3-70B, Qwen3-Next-80B, GLM-4.5-Air, gpt-oss-120B, Nemotron-3-Super-120B, Qwen3.5-122B), and the 2026 frontier (Qwen3-235B, MiniMax-M3, Qwen3.5-397B, Nemotron-3-Ultra-550B, DeepSeek-V3.1, GLM-5.2, DeepSeek-V4-Pro, Kimi K2). **See `MODEL-CATALOG.md` for full per-model detail** (params/arch, benchmarks, links, lineage).

## 4. MoE handling — the one structural change (shipped form)

The proposal's plan was realized and simplified: `paramsTotalB` (VRAM basis) and `paramsActiveB` (serve compute/bandwidth basis) replace the single `paramsB`; `isMoE` flags it. The proposal's four touch points became the as-built physics:

1. `modelMemory = paramsTotalB × bytesPerParam` → VRAM / `serverFitsMemory` / KV budget track **total**.
2. The roofline (`decodeTokSb1`, `computeRoofTokS`, `prefillTokS`) is keyed on **active** params → serve speed tracks **active**.
3. There is no separate "all experts resident +15%" multiplier — that *is* the total-vs-active split (total includes all experts).
4. **`tech_moe` is gone, not re-scoped to a global toggle.** The real models are *born* MoE (the discount is already in their low `paramsActiveB`), so a global buff would double-count. The serving-layer win for sparse models is the **`inf_par_ep` (Expert Parallelism)** node.

**Net invariant:** `VRAM/KV/fit ← paramsTotalB`; `speed ← paramsActiveB`. Kimi K2 (1T total / 32B active) needs a GigaCluster to *fit* but serves at ~32B-active speed once resident — the real total-vs-active split, making the giant racks meaningful as *residency unlocks*. MLA models (DeepSeek-V3.1, Kimi K2) additionally get the ×0.067 KV scaling.

---

## 5. The capability-compression problem and its fix (shipped)

The proposal's most important finding: with real 2025–26 benchmarks, a 32B thinking model clears every *reasoning/knowledge* line a 671B frontier model does — top-end benchmarks have converged, and capability tracks post-training (reasoning RL / instruct) more than parameter count. This is correct realism but flattens the "scale up" progression.

The shipped fix uses the proposal's recommended combination:

1. **The agentic / SWE wall (primary fix).** `agentic` is calibrated from **SWE-bench Verified**, the one benchmark family that has not saturated (Devstral 53.6, GLM-4.5-Air 57.6, DeepSeek-V3.1 66, Kimi K2 71.3). The late-game `agent` request (`difficulty.agentic = 82`, which sits around SWE ~63) only true frontier checkpoints clear. Models with no SWE score fall to the low agentic floor. This restores a top-end wall grounded in real, unsaturated data.
2. **Throughput as the other late-game axis.** A fast small MoE answers correctly but cannot soak Black Friday volume from one rack; frontier value is also VRAM headroom → batch → Goodput. The compression becomes the point: everyone has a smart model; can you serve it at scale within SLO?

This is also the concrete balance fix for the formerly-OP **Qwen3 30B-A3B**: it serves fastest (3.3B active) and answers reasoning, but its **calibrated agentic score genuinely lags** (a calibration fact, not a hand-edit), so the `agent` lane is the wall it cannot pass. **DeepSeek-V3.1** is not deleted for tying the 235B on saturated knowledge axes (that tie is real) — it differentiates via `paramsActiveB` 37, the 671B residency requiring a SuperPod, and the agentic/context axes.

---

## 6. Professional (Expert) Mode surfacing

Real metadata lives as **inert display fields** (`ModelDef.real`: developer, license, openWeights, released, contextWindowK, source, confidence, and the raw `benchmarks` the `qualityBy` was derived from) that `sim/**` never reads — preserving the `sim/** must not import mode.ts` invariant. Calibration is a build-time transform run once at module load; the sim only sees `qualityBy` / `paramsTotalB` / `paramsActiveB` / `isMoE` / `contextWindowK` / `layers`/`kvHeads`/`headDim`/`attn` / `alignment`. Expert mode (S7 ModelOverview, S8 LineageGraph) surfaces active/total params + MoE, license + open-weight flag, context window, release date, and the benchmark→quality breakdown so a player sees *why* a model clears a line. Normal mode is simpler; the sim is identical.

---

## 7. Risks & open questions (still live)

1. **Benchmark contamination / "with-tools" inflation.** GPQA & LiveCodeBench leak into training; vendor "with tools" figures (Kimi AIME 99.1) overstate base capability. Mitigation: prefer no-tools numbers; the piecewise curve compresses the top so a contaminated +5% barely moves a line; never let one benchmark solely decide a crossing (it is a 5-axis vector).
2. **AA index churn** → §2.4: derive only from per-benchmark %s; AA index is display-only with its scale version.
3. **License nuance.** Several "open" models are non-commercial or research-only. Store `openWeights` + verbatim `license`; surface in expert mode; never gate gameplay on license.
4. **Advertised vs effective context.** Some models advertise windows far beyond effective. The sim's hard window is `contextWindowK`; with real 128K+ windows the hard reject rarely fires, so long context bites via the **KV budget** instead — the more honest pressure.
5. **Staleness / supersession.** Models refresh monthly. Each checkpoint pins a primary `source`; freeze the campaign roster per release; route newer frontier capability to **player-built Studio chains / endless mode** rather than re-tuning the campaign arc each season. The Nemotron-3-Super benchmarks are `confidence: 'low'` placeholders pending first-party scores.
