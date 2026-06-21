# GPTD — Game Design Document

> **GPTD (GigaPrompt Tower Defense)** is a pixel tower-defense game built on real-world simulation — a tower defense first, designed around real data-center LLM-inference engineering so every number has a real basis. Waves of AI user requests stream in from four global ingress lanes toward your central Trust Core; you build a serving platform — GPU racks, models, caches, routers, guardrails, power and cooling — to answer them correctly, safely, and within their latency SLO. The board is the experience layer; the math underneath is real.
>
> **Slogan: "the board is the metaphor, the numbers are real."**

> **This is the canonical design document for GPTD.** It is the readable design overview; two companion documents go deeper:
> - **[BLUEPRINT.md](./BLUEPRINT.md)** — the detailed, implementation-ready specification (§0–§7): every formula, field name, data-model type, and subsystem decision. When a number here is summarized, the blueprint is where the derivation lives.
> - **[REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md)** — the real-world grounding: the 2024–2026 facts about LLM inference, post-training, safety, serving systems, hardware, and the open-weight model landscape that the simulation is built on.
>
> The **code is the ultimate source of truth.** The authoritative specifics live in `src/sim/{content,models,effects,combat,safety,research}.ts`, `src/core/types.ts`, and `src/config.ts`. Everything below is verified against them.

> **Status:** shipped, playable build. **Stack:** Vite + TypeScript + PixiJS v8 + Web Audio. Two display modes (Normal / Expert) over one identical deterministic simulation.

> **How to run / play → see [README.md](../README.md).**

---

## Table of Contents

1. [Vision & the Unified Simulation Model](#1-vision--the-unified-simulation-model)
2. [The Three-Layer Model Stack](#2-the-three-layer-model-stack)
3. [Hardware: the Real GPU Ladder](#3-hardware-the-real-gpu-ladder)
4. [Models & the qualityBy Calibration](#4-models--the-qualityby-calibration)
5. [The Post-Training Studio](#5-the-post-training-studio)
6. [Requests: 9 First-Principles Archetypes](#6-requests-9-first-principles-archetypes)
7. [Serving Physics: the Real Roofline](#7-serving-physics-the-real-roofline)
8. [The Infra Tech Tree & Research Tracks](#8-the-infra-tech-tree--research-tracks)
9. [Two-Layer Safety](#9-two-layer-safety)
10. [The Real Economy](#10-the-real-economy)
11. [Combat: the Six Outcomes & Goodput](#11-combat-the-six-outcomes--goodput)
12. [Buildings & Support](#12-buildings--support)
13. [UI Surfaces: Normal & Expert](#13-ui-surfaces-normal--expert)
14. [Win / Lose / Endless](#14-win--lose--endless)
15. [Balance Philosophy](#15-balance-philosophy)

---

## 1. Vision & the Unified Simulation Model

GPTD wraps the real engineering of data-center LLM inference inside a tower-defense **experience layer** — four ingress lanes converging on a central Trust Core, rack placement, range, and request routing pressure — while the **underlying math is entirely real**. What the player learns is what a real inference engineer decides: the prefill/decode roofline, the MoE memory-vs-compute split, the KV budget, Goodput, $/Mtoken, the cooling threshold, per-model post-training vs serving-layer techniques, and two-layer safety.

### The spine: one request's lifecycle

Every subsystem plugs into a single simulation spine. A request's life *is* the spine:

```
spawn (real token counts sampled, §6)
  → travels its assigned ingress lane toward the central Trust Core (movement; board metaphor)
  → admitted by an in-range GPU rack → prefill (compute-bound, sets TTFT)
  → decode (bandwidth-bound, continuous batching, sets per-token rate)
  → safety verdict (layer 1 model-intrinsic + layer 2 guardrails)
  → quality verdict (capability margin on the request's primary axis)
  → SLO verdict (real-ms TTFT ∧ per-token, concurrency-amortized)
  → one of six outcomes (revenue / Trust / SLA settled)
```

### The dual clock

Two clocks run at once. **`SIM_TIME_SCALE = 10`**: one board second compresses ten real datacenter seconds — purely a visual-pacing dial. **SLO is always judged on the real-second axis** through `effLatencyMs`, a *concurrency-amortized* effective latency (not the naive batch-of-one latency), so Goodput is never trivially zero. Per-latency-class SLOs in real milliseconds (`LAT_CLASS_SLO`):

| Class | Meaning | TTFT SLO | Per-token (TPOT) SLO |
|---|---|---|---|
| `IN` | Interactive (chat, completion) | 400 ms | 40 ms |
| `NR` | Near-real-time (RAG, reasoning, agentic) | 2000 ms | 200 ms |
| `TO` | Throughput / offline (embed, batch) | none | none |

**Goodput** — the within-SLO served rate — is the true optimization target, not raw throughput. It drives the SLA meter.

### The three meters, win, and economy

You manage three meters: **Cash** (real credits, `1 credit = $1000`), **Trust** (0–100, customer reputation), and **SLA** (0–100, reliability). You lose if any of Cash < 0, Trust ≤ 0, or SLA ≤ 0. The campaign is a **100-wave escalating elimination gauntlet** (real 2023→2026 history): difficulty climbs monotonically, so most runs end mid-campaign. Surviving all 100 waves — through the **Age of Inference** final boss — is the apex; endless mode continues procedurally past it.

---

## 2. The Three-Layer Model Stack

A serving tower is composed of three independent layers. Understanding the separation is the central mental model of the game:

1. **Hardware (the rack)** — a real GPU tier with real VRAM, HBM bandwidth, TFLOPS, TDP, and capex. A rack is *neutral*: it has no opinion on what it's good at. You upgrade a rack **in place** along the ladder. (§3)
2. **The model (the checkpoint)** — a real open-weight model deployed onto the rack. The model decides answer **quality** (a 5-axis vector) and serving **demand** (its parameter counts feed the roofline). Open weights are a free download, so deploying costs nothing; what gates a model is whether its weights **fit the rack's VRAM**. (§4)
3. **The serving stack (infra)** — the researched serving techniques (continuous batching, PagedAttention, prefix cache, quantization, parallelism, …) that live on typed `s.infra` and govern how efficiently the rack+model combination serves. (§8)

> A rack tier sets the *ceiling*; the deployed model sets the *capability*; the infra tree sets the *efficiency*. The same H100 rack is a chat soaker with Llama-8B and a frontier reasoner with gpt-oss-120B — but only if the 120B's weights fit and you have a Pod to hold them.

---

## 3. Hardware: the Real GPU Ladder

Racks are real accelerators (`HARDWARE_DEFS` in `content.ts`). Each tile stands for `gpus` GPUs; aggregate specs are `perGpu × gpus`. Build cost in credits = `capexUsd / 1000`. A rack upgrades one tier at a time, paying the difference, along `HARDWARE_TIERS`.

| Tier id | Display | GPUs | bf16 / fp8 TFLOPS (agg) | HBM | HBM BW | TDP (agg) | Cooling | Capex | $/GPU-hr |
|---|---|---|---|---|---|---|---|---|---|
| `hw_edge` | Edge GPU Rack (L4-class) | 1 | 121 / 242 | 24 GB | 0.3 TB/s | 72 W | air | $2.5k | 0.4 |
| `hw_standard` | Standard Rack (L40S-class) | 1 | 362 / 733 | 48 GB | 0.864 TB/s | 350 W | air | $10k | 1.0 |
| `hw_perf` | Performance Rack (H100-class) | 1 | 989 / 1979 | 80 GB | 3.35 TB/s | 700 W | air | $30k | 3.0 |
| `hw_frontier` | Frontier Rack (H200-class) | 1 | 989 / 1979 | 141 GB | 4.8 TB/s | 700 W | air | $35k | 3.2 |
| `hw_pod` | DGX H200 (8× H200) | 8 | 7912 / 15832 | 1128 GB | 38.4 TB/s | 5600 W | **liquid** | $320k | 25.6 |
| `hw_superpod` | DGX B200 (8× B200) | 8 | 18000 / 36000 | 1536 GB | 64 TB/s | 8000 W | **liquid** | $500k | 40 |
| `hw_giga` | GB200 NVL72 (72× B200) | 72 | 162000 / 324000 | ~13.8 TB | 576 TB/s | 72000 W | **liquid** | $3M | 360 |

Key physics the ladder teaches:

- **HBM bandwidth makes decode fly.** Decode is bandwidth-bound; the H100's 3.35 TB/s is the jump that matters more than raw FLOPS.
- **VRAM fits the model.** An H200's 141 GB holds a 70B unquantized; only Pods/SuperPods/GigaClusters hold 100B–1T checkpoints.
- **The cooling threshold is real.** Racks at ≥1000 W/GPU (the DGX/NVL72 tiers, marked `cooling: 'liquid'`) **cannot run at all** without at least one **Liquid Cooling Loop** building on the board — a hard gate (`hasLiquidLoop`).
- **Power & heat are real kW.** A rack draws its aggregate `tdpWatts × RACK_UTILIZATION (0.8)`, in kW (`serverPower`), and rejects ≈that much heat. An H100 rack reads ~0.56 kW; an NVL72 ~57.6 kW (per-GPU TDP only; interconnect/CDU overhead is not modeled — an honest design note).

---

## 4. Models & the qualityBy Calibration

The active roster is **42 real open-weight base checkpoints** (`MODEL_DEFS`) — frontier-tolerance-gated (10%) from a ~98-model candidate pool of 30 hand-authored plus 68 per-size-bucket Pareto picks (`ROSTER`; see [PARETO.md](PARETO.md)) — spanning ~1B to 1.6T parameters across Alibaba, OpenAI, Google, NVIDIA, Z.ai, DeepSeek, MiniMax, and Moonshot, including the 2026 frontier (GLM-5.2, DeepSeek-V4-Pro, Qwen3.5-397B, Nemotron 3 Ultra). The hand-authored picks are drawn from a fact-checked **130-model catalog** (`MODEL-CATALOG.md`) sourced from Artificial Analysis + official model cards; `qualityBy` is calibrated from those real benchmarks (`calibrate.ts`), never hand-written. Every base checkpoint is owned free from turn one (the weights are a download); the only deploy gate is **VRAM fit**.

### qualityBy: a 5-axis capability vector

Each model carries `qualityBy`, a vector over five **capability axes**: `chat`, `coding`, `reasoning`, `general`, `agentic`. These are **never hand-edited** — they are calibrated from public benchmarks (`calibrate.ts`) via piecewise-linear curves:

| Axis | Primary benchmark | Fallbacks |
|---|---|---|
| `chat` / `general` | MMLU-Pro | (MMLU → MMLU-Pro) |
| `coding` | LiveCodeBench | SWE-bench Verified, HumanEval |
| `reasoning` | GPQA-Diamond | AIME |
| `agentic` | Terminal-Bench Hard | SWE-bench Verified (converted ×0.42) |

The decision to use **per-benchmark percentages** (not the Artificial Analysis composite Intelligence Index) is deliberate: that composite re-baselines between versions, whereas per-benchmark %s are scale-stable.

**`agentic` is the anti-saturation axis.** Terminal-Bench Hard keeps a real frontier gap (ceiling ~50%) where LiveCodeBench has compressed — so late-game agentic traffic stays a wall only strong-terminal frontier (or self-trained) checkpoints clear. Raw scale is not agentic: Terminal-Bench Hard ranks terminal-agent skill, where some big non-terminal MoEs (e.g. Qwen3-235B at TB-Hard 13.6 → agentic 58) genuinely lag below cheap mid models. This is the "big models still matter, but the right kind of big" property encoded into the data.

### Total vs active parameters (the MoE split)

- `paramsTotalB` → **VRAM** residency (all weights, including every MoE expert, must fit).
- `paramsActiveB` → **compute & bandwidth** cost (only active params serve each token).

For dense models these are equal; for MoE they diverge hugely (DeepSeek-V3.1: 671 total / 37 active; Qwen3-30B-A3B: 30.5 / 3.3). This memory-vs-compute decoupling is the most important single fact in the cost structure — a sparse model fits a big rack but serves like a tiny one.

### Other model properties

Each `ModelDef` also carries real architecture (`layers`, `kvHeads`, `headDim`, `attn` ∈ MHA/MQA/GQA/MLA) feeding the KV/roofline formulas, `contextWindowK`, `weightBytes` (deploy precision), `isMoE` / `isReasoning` flags, an **`alignment`** profile (`safety` / `refusalStyle` / `overRefusal`, §9), and `instructFollow`. A thinking (`isReasoning`) model's gain is already baked into its benchmarked `qualityBy` and it emits far more output tokens.

### A few roster landmarks

- **Llama 3.1 8B** — the free starter every rack ships with: soaks chat, ships bad code, cannot reason.
- **gpt-oss 20B / 120B** — reasoning models at 3.6B / 5.1B active; the safe-completion alignment exemplars.
- **Qwen3 30B-A3B** — frontier-grade answers at 3.3B active: the MoE dream.
- **Devstral 24B** — a dedicated coder.
- **Kimi K2 Thinking** — 1T params / 32B active, the open coding/reasoning ceiling; only a GigaCluster holds it.

---

## 5. The Post-Training Studio

The Studio is the **centerpiece** of the game's depth. There are no fixed "finetune" cards; instead you mint your own checkpoints. A run picks:

- a **base** — any roster model **or any previously-derived model** (unlimited iterative chaining; depth grows);
- a **method** — one of 12 real post-training methods;
- a **target** — one of 8 (the 5 capability axes + `safety` / `longctx` / `domain`);
- an **effort** — 5 discrete notches `[0.25, 0.5, 1.0, 1.5, 2.0]`.

It spends **Data** (paid up front) + **requisitioned compute** (on the posttrain research track) and, on completion, mints a **new named derived `ModelDef`** (`drv_{seq}`, e.g. `{base}-{Target}-{Method}`) with a snapshot `qualityBy`, alignment, and deploy fields, plus a machine-readable `Lineage`. Derived models live in `s.derivedModels`, resolved O(1) via `resolveModel` (snapshotted at creation — no recursive resolution at serve time).

### The 12 methods (`METHOD_RECIPES`)

| Method | Relation | Targets | Character |
|---|---|---|---|
| **SFT** | finetune | chat/coding/general/longctx | The baseline; **no research needed** (the starter). |
| **CPT** | finetune | domain/longctx/general | Heaviest; broad + long-context gains, **highest forgetting**. |
| **LoRA / QLoRA / DoRA** | adapter | the 5 axes | Cheapest PEFT; one band of capability, near-zero forgetting. |
| **DPO** | finetune | chat/general/safety | Lighter, cheaper preference optimization than RLHF. |
| **RLHF** | finetune | safety/chat/general | Priciest preference method; biggest alignment tax + over-refusal. |
| **CAI** | finetune | safety | Constitutional AI: a **Pareto** gain — raises safety *and* lowers over-refusal. |
| **GRPO** | finetune | reasoning/agentic | Reasoning RL: **strongest path** to reasoning/agentic; cold-starts a thinker. |
| **Distill** | finetune | reasoning/coding/agentic | Swaps to a **smaller student** body; cheaper to serve, never quite matches teacher. |
| **Merge** | merge | most | Averages two models; no retraining, no forgetting, no gain. |
| **QAT** | quantized | general | Drops `weightBytes` to INT4: half the weight memory, −2 quality. |

### How quality is derived (`deriveQuality`)

The gain on the target axis is shaped by honest game curves (autoplay-calibratable, **not** first-principles physics — validated by `calibrateRecipes` against the §6.3 band-displacement ordering):

```
depthDamp = 1 / (1 + 0.15 × depth)              // deep chains diminish
rawGain   = gainScale × √effort × depthDamp
headroom  = (130 − base[axis]) / 130            // harder near the ceiling
gain      = min(rawGain, gainCap × headroom)    // PEFT capacity cap
```

On top of the gain, the snapshot also applies:
- **Alignment tax** — a safety target or crude RLHF lowers the `general` axis.
- **Catastrophic forgetting** — every non-target axis drifts down by `forgetScale × √effort`.
- **Deploy reshape** — only distill/qat/merge change params/arch/bytes (distill caps at `min(teacher, student-capacity)`; qat → INT4; merge inherits the larger body).
- **Alignment changes** — safety/rlhf/cai raise `alignment.safety`; CAI lowers over-refusal and sets `safe-completion`; crude RLHF raises over-refusal.

The endless quality ceiling is a deep, iterative finetune-of-a-finetune chain; the depth damp keeps it bounded but rewarding.

---

## 6. Requests: 9 First-Principles Archetypes

The "enemies" are 9 request archetypes (`REQUEST_TYPES`) defined by **workload physics**, not costume. Each carries real `inputTokens` / `outputTokens`, a `latClass`, a per-axis `difficulty` vector, a `primaryAxis` (the axis combat judges), `prefixShare` (cache-friendliness), `cacheable`, optional `hazards`, and real `pricePerMtokIn` / `pricePerMtokOut`.

| Archetype | Physics shape | In/Out tok | Class | Primary axis | Hazard | Notes |
|---|---|---|---|---|---|---|
| **Embedding** (`embed`) | pure prefill, no generation | 2000 / 0 | TO | general | — | Worthless alone, a flood in volume. |
| **Interactive Chat** (`chat`) | balanced, high volume | 512 / 256 | IN | chat | — | A small model on a fast rack soaks these. |
| **Code Completion** (`comp`) | prefill-heavy, latency-critical | 1500 / 150 | IN (TTFT 200ms) | coding | — | A weak model ships bad code, bleeds Trust. |
| **RAG / Long-Context QA** (`rag`) | huge retrieved prompt | 8000 / 512 | NR | general | — | Cache/KV makes prefill survivable. |
| **Summarization** (`summ`) | extreme prompt, little reusable prefix | 12000 / 400 | NR | general | — | A relentless prefill bill. |
| **Reasoning** (`reason`) | extreme decode (long CoT) | 512 / 6000 | NR | reasoning | — | Only a thinking model clears it. |
| **Agentic Task** (`agent`) | agentic loop, tool use | 6000 / 800 | NR (E2EL 9s) | agentic | injection 0.3 | SWE-grade; the unsaturated wall. |
| **Batch / Offline** (`batch`) | decode-heavy, no SLO | 1000 / 4000 | TO | general | — | Pure throughput & $/token. |
| **Adversarial Prompt** (`jailbreak`) | the hazard carrier | 600 / 400 | IN | general | jailbreak 0.9 | Self-handle or a guardrail catches, or Trust wrecks. |

The taxonomy spans the real workload-physics space: pure-prefill, balanced, prefill-heavy, extreme-decode, agentic loop, decode-heavy no-SLO, and the adversarial hazard carrier. Each archetype's defining traits — price, latency class, volume — are expressed as data, not theme.

---

## 7. Serving Physics: the Real Roofline

A rack's serving rate comes from the real roofline (`effects.ts`), split into the two real phases:

**Prefill (compute-bound, sets TTFT).** Ingesting the prompt is a compute-bound GEMM with a super-linear penalty for long prompts (O(n²) attention):
```
superlinear(n) = 1 + n / 16000
prefillTokS(n) = aggTflops / (2 × activeB × superlinear(n))
```
Prefill serializes a rack and gains nothing from batching.

**Decode (bandwidth-bound, sets per-token rate).** Generation is memory-bandwidth-bound and batch-friendly:
```
decodeTokS_b1     = HBM_bandwidth / (2 × activeB × bytesPerParam)
computeRoofTokS   = aggTflops / (2 × activeB)
aggregate(batch)  = min(decodeTokS_b1 × batch, computeRoofTokS)
perUser(batch)    = aggregate / batch
```
Decode scales linearly with batch until it saturates the compute roof — then per-user rate falls. This is continuous batching, capped by the real KV budget.

**VRAM & KV.** Resident weights = `paramsTotalB × bytesPerParam` (+ `FRAMEWORK_GB = 1.5`). The deploy precision is `min(model.weightBytes, s.infra.weightQuantBytes)` (FP16=2 / FP8=1 / INT4=0.5). KV per request:
```
KV = 2 × layers × kvHeads × headDim × contextLen × bytesPerElem    (MLA × 0.067)
```
GQA/MQA are reflected naturally by a model's low `kvHeads`; there is no global GQA discount. Continuous batching is limited by the KV budget = usable VRAM after weights, scaled by `kvUtilization` (0.55 → 0.96 after PagedAttention).

**Thermal asymmetry.** Decode is more memory-bound than prefill, so it keeps a slight edge under a cap, but overheating is intentionally painful: prefill takes the full throttle hit, while `decodeThrottle(t) = 1 − (1 − t) × 0.85` (≈58% decode speed at half-throttle, ≈32% at the `0.2` floor).

---

## 8. The Infra Tech Tree & Research Tracks

The tech tree is **infra-only** and lives on typed `s.infra` — the single source of truth for serving physics. It is **22 `InfraNodeDef`** across 8 categories. Crucially, model architecture (GQA/MLA/MoE/reasoning) is **not** here — those are model properties; the tree is the serving *stack* around the model.

| Category | Nodes |
|---|---|
| **scheduling** | Continuous Batching, Multi-Step Scheduling, Chunked Prefill, P/D Disaggregation |
| **kv-memory** | PagedAttention, Prefix Caching, FlashAttention, FP8 KV Cache, INT4 KV Cache, KV Offloading (LMCache) |
| **decoding** | Speculative Decoding (EAGLE) |
| **weight-quant** | FP8, INT4 (AWQ/GPTQ), NVFP4 (Blackwell-gated) |
| **parallelism** | Tensor (TP), Pipeline (PP), Data (DP), Expert (EP, MoE) |
| **routing** | KV-Aware Routing (Dynamo) |
| **multi-lora** | Multi-LoRA Serving (S-LoRA) |
| **engine** | SGLang, TensorRT-LLM |

Notable real interactions: **Chunked Prefill ⟂ P/D Disaggregation** is a hard conflict (you pick one scheduling philosophy). **Speculative Decoding** is batch-dependent — ×2.0 at batch ≤1, fading to ×1.0 at batch ≥32 (turn it off under load). **PagedAttention** lifts KV utilization to 0.96. The **engine tier** multiplies throughput (vLLM 1.0 → SGLang 1.10 → TRT-LLM 1.25).

### Three research tracks

Research runs on **three concurrent tracks** that share one **fleet-FLOPS requisition pool** (the strongest racks train instead of serving during waves):
- **infra** — the 22 nodes above, plus the post-training **method unlocks** (one-time gates: `pt_lora`, `pt_pref`, `pt_rl`, `pt_cai`, `pt_cpt`, `pt_distill`, `pt_merge`, `pt_qat`; SFT needs none).
- **posttrain** — a single Post-Training Studio run (§5).
- **eval** — the dev-time **Red-Team Eval** (§9): cuts guardrail over-refusal (`OVERREF_K × 0.7`) and unlocks the harder detection categories (v1 → injection, v2 → pii) plus a small recall bonus.

A project is sized to finish in roughly one wave (`RESEARCH_TARGET_SECONDS = 60`) and never requisitions more than 45% of fleet FLOPS.

---

## 9. Two-Layer Safety

Safety is two genuinely different layers (`safety.ts`), matching the real world.

### Layer 1 — model-intrinsic alignment (baked, zero latency)

Each model has an `AlignmentProfile`: `safety` (0–100), `refusalStyle` (`none` / `hard-refusal` / `safe-completion`), and `overRefusal` (0–1). You raise it in the Studio (RLHF / CAI / safety-SFT). At serve time, layer 1 is consumed at **0 latency**:
- **Self-handle** a hazard with `pSelfHandle = clamp01(safety/100 − severity × HAZARD_HARDNESS[h])`. Injection is hardest (0.55), then jailbreak (0.35), harmful (0.2), pii (0.3). A high-safety model clears most jailbreaks unaided; a base model cannot.
- **Alignment tax** — being aligned costs capability: `TAX_K[style] × max(0, safety−40)/100`, subtracted from `qualityBy`. Hard-refusal pays K=9; **safe-completion pays only K=4** (the Pareto point the gpt-oss family teaches).
- **Over-refusal** — a benign request is wrongly refused with probability `overRefusal` → the `over_refused` outcome.

### Layer 2 — guardrail buildings (on the path, real latency)

Three guardrail families, each a building on the request path:

| Building | Real model | Latency | Compute | Side | Catches |
|---|---|---|---|---|---|
| **Prompt Guard (encoder)** | Prompt Guard 86M | fixed 92 ms | 0 (off-rack) | input | jailbreak, injection |
| **Llama Guard (generative)** | Llama Guard 4 12B | **real roofline** (~337 ms, its own H100 tile) | draws real power/heat | both | all four |
| **Moderation API** | OpenAI omni | fixed 120 ms | 0 (vendor) | both | harmful, pii |

The key teaching contrast: an encoder is a millisecond-scale BERT forward; the generative guardrail runs a **real (shorter) 12B inference on its own rack** via the §7 roofline — one to two orders slower, drawing real KV and watts.

### The no-free-lunch threshold

A global `guardrailThreshold` (default 0.5) trades recall against over-refusal:
```
effRecall  = clamp01(baseRecall × (0.6 + 0.8 × threshold) + redteamBonus)
overRefuse = OVERREF_K[archetype] × overrefMul × threshold²          (convex)
```
Raise the threshold to catch more — and wrongly block more benign traffic. **Red-Team Eval** (eval track) is the dev-time relief: it lowers the over-refusal convexity (judge by intent, XSTest-style) and unlocks injection/pii detection.

### The safety verdict

A request is handled iff **every** hazard is cleared by layer 1 (self-handle) **or** by a layer-2 guardrail in path. An unhandled hazard reaching the core is an **unsafe** breach (heavy Trust hit). A benign request wrongly refused is **over_refused** (revenue 0, light Trust/SLA hit — *not* a breach).

---

## 10. The Real Economy

`1 credit = $1000` (`CREDIT_USD`). Everything is real money:

- **Build cost** = `capexUsd / 1000`.
- **Income** = token-priced real $/Mtoken on the request's actual input+output tokens (`serveRevenue`), scaled by `TRAFFIC_SCALE = 100000` (each sprite stands for that many real traffic streams) and the market multiplier.
- **Operating cost** = real `$/GPU-hr` billed by **wall-clock** (`rackOperatingCostPerSec`) — it charges whether the rack serves or not, so an **idle/over-provisioned rack bleeds**. This is how the **utilization penalty** emerges rather than being bolted on.
- **Power & cooling** are real kW capacity meters (substation + chillers; Power Plant / Cooling Tower / Liquid Cooling Loop add blocks).

Both income and the wall-clock bill carry `TRAFFIC_SCALE`, keeping the real $/Mtoken identity exact. Two documented calibration constants keep the real rates playable: `OP_COST_SCALE = 0.036` (the full real $/Mtok on a low-throughput rack would bankrupt any imperfect fleet) and `CLEAR_BONUS_SCALE = 0.08` (so the per-wave clear bonus is a kicker, not the economy). These are honest design notes, not bugs.

---

## 11. Combat: the Six Outcomes & Goodput

Every answered request resolves into one of **six outcomes** (`WaveTypeStat`, settled in `combat.ts`):

| Outcome | Meaning | Revenue | Trust / SLA |
|---|---|---|---|
| **served** | correct, safe, within SLO | full token revenue | +Trust, +SLA |
| **slo_miss** | correct, safe, but **late** | **zero** (you missed the SLA) | −SLA, −Trust; excluded from Goodput |
| **bad** | model too weak (margin < 0) | billed (token revenue) | −Trust (wrong answer) |
| **unservable** | rejected by the hard context-window gate, never served | none | leak penalties |
| **unsafe** | a hazard reached the core | none | heavy −Trust |
| **over_refused** | benign request wrongly refused | 0 | light −Trust/−SLA |

The **quality gate** (`scoreQuality`): on the request's `primaryAxis`,
```
effQ   = qualityBy[primaryAxis] − contextGap × 0.45 − int4ContextPenalty
margin = effQ − difficulty       (≥0 → correct; <0 → bad)
```
Outcome precedence is worst-first: `unsafe > bad > slo_miss > served`. **Goodput** is the answered-within-SLO rate (the `goodput / answered` ratio shown in the wave report) — the headline reliability number.

---

## 12. Buildings & Support

Beyond GPU racks (`srv_edge`, `srv_frontier` — both ship with the free Llama-8B and upgrade in place), the build bar offers:

- **Router** — reads each request and steers it to the right server; boosts matched servers (KV-aware routing ~doubles it).
- **Cache** — an aura giving in-range servers a chance to reuse a cached prompt prefix on *cacheable* traffic (embed/chat/comp/rag/agent). A hit skips prefill and makes TTFT instant, but non-embedding responses still decode on the model and still face the normal window, quality, and safety gates. Prefix-cache research lifts the hit rate.
- **Guardrails** — the three layer-2 safety families (§9).
- **Power Plant** (+8 kW), **Cooling Tower** (+8 kW air), **Liquid Cooling Loop** (+60 kW, **enables** liquid racks — the hard gate).
- **Training Lab** — required to research; raises Data yield and opens the research tracks.

**Incidents** between waves force adaptation, and their effects are **live** during the build phase and the wave (`applyIncident` in `sim.ts`): a multiplier bag (`powerPrice` / `coolingCap` / `buildCost` / `safetyDamage` / `volume` / `reward`), an optional one-shot `instant` (Data loss), and an optional `concentrate` that funnels the wave's un-pinned traffic into one randomly-chosen ingress lane. The 21 incidents are grounded in real events: PJM capacity-auction & on-site-fuel power spikes (and a cheap nuclear-PPA boon), liquid-loop & water-drought cooling failures, H100/HBM shortages and chip export bans (and lead-times easing), DeepSeek/price-war reward cuts, EU-AI-Act regulatory audits & adversarial-suffix storms (2× unsafe Trust cost), training-data poisoning & eval contamination (Data loss), viral demand surges, enterprise-demo and off-peak demand-lull boons, and the **single-entry surges** — undersea-cable cuts, edge-provider outages, and the CrowdStrike meltdown that reroute all traffic through one ingress. A real-event wave forces its *signature* incident deterministically (`themedIncidentForWave`); other waves draw from a seeded random roll, with a guaranteed hard incident every 10th wave.

---

## 13. UI Surfaces: Normal & Expert

There are **two display modes** over **one identical deterministic simulation** — `src/sim/**` never imports `mode.ts`. **Normal** keeps the SRE telemetry tucked away; **Expert** reveals it. The title screen also offers a small **Demo** button: a fixed-seed Expert spectator run driven by the production demo autoplayer (`src/sim/demo.ts`), which plans builds, rack upgrades through DGX H200, model deployment, infra/eval/post-training research, guardrails, Studio-derived checkpoints, power/cooling, liquid cooling, and P/D rack roles, surviving deep into the 100-wave gauntlet (a sensible heuristic, like a real run, is eventually eliminated by the escalation — it does not "beat" the campaign). Demo viewers can inspect racks, requests, models, and lab panels, but state-changing actions stay under autoplayer control. The 9 archetypes are shown with vector icons.

The Expert UI exposes 9 surfaces:

1. **TopBar** — meters, real kW, Goodput.
2. **LiveOpsStrip** — live serving telemetry during a wave.
3. **RackInspect** — HARDWARE / DEPLOYED-MODEL / ROOFLINE / LIVE cards for a selected rack.
4. **RequestInspector** — a request's physics and verdict trace.
5. **WaveReport** — the end-of-wave settlement: six outcomes + Goodput per type.
6. **BuildBar** — buildings, with as-shipped loadout previews.
7. **ModelOverview** — all base + derived models, sortable/filterable.
8. **LineageGraph** — the derived-checkpoint DAG.
9. **TechLab + Post-Training Studio** — the research tracks and the effort-slider Studio with a live before→after preview that exactly matches what training produces.

---

## 14. Win / Lose / Endless

- **Lose** if any meter fails: Cash < 0 (bankruptcy), Trust ≤ 0, or SLA ≤ 0.
- **Win** the campaign by surviving all **100 waves** — through the final boss, *The Age of Inference* (wave 100), where every archetype, every hazard, and a single-entry surge land at once. The campaign is an **elimination gauntlet**: difficulty rises monotonically (tier 1→12), so most runs end mid-campaign — reaching wave 100 is the apex achievement.
- **Endless** mode continues procedurally past wave 100 with climbing difficulty (harder benchmarks, growing context windows, hard incidents every 10th surge) and no wave cap.

The **100-wave authored campaign** (`campaign-data.ts`, expanded into `WaveDef`s by `buildCampaign` in `campaign.ts`) dramatizes real 2023→2026 history **from the provider's seat**: every wave is a **demand shift** (people start using AI for something en masse → your traffic mix/volume changes) or an **operating shock** (a world/infra/energy/supply/regulatory/abuse event → your ability to serve is hit) — *never* a model/tech/chip announcement (those are the player's tools). Chronological: *The Chatbot Boom* (Jan 2023) → *The DAN Jailbreak Wave* → *The Matsu Cable Cut* → *A Chatbot for 750 Million* → *The Code-Completion Surge* → *The Great GPU Shortage* (boss) → *Everyone Builds a RAG Bot* → *The DevDay Assistant Rush* → *The Reasoning-Demand Flood* → *The Baltic Cable Cuts* → *Tools Inside the Reasoning Loop* → *The Coding-Agent Majority* → *The Stargate Power Race* → … → *The Age of Inference* (wave 100). Difficulty is tuned from one place — the `tier*` knobs in `campaign.ts` — so the whole 100-wave curve stays consistent and re-tunable; per-run variability comes from the seeded incident system. Boss-grade waves land roughly every tenth wave; eleven waves are **single-entry surges** (real outages / undersea-cable cuts — Matsu, Baltic, Red Sea, us-east-1, CrowdStrike, Cloudflare…) that pin all traffic to one ingress.

---

## 15. Balance Philosophy

Three lessons the numbers are tuned to teach:

1. **Not every request deserves the frontier model.** A chat flood served by Llama-8B on a cheap rack is *more profitable* than over-provisioning a SuperPod for it — the wall-clock operating bill punishes idle frontier iron. Match the model (and rack) to the request's primary axis and SLO class. The whole economy rewards the right tool, not the biggest tool.

2. **The agentic wall is real.** Because `agentic` is calibrated from unsaturated Terminal-Bench Hard (ceiling ~50%), late-game agentic traffic stays a genuine frontier gap. Code completion yields to a good coder; autonomous agentic tasks need a strong-terminal frontier model — or one you trained yourself in the Studio with a GRPO-agentic run (e.g. on gpt-oss-120B, whose agentic 79 sits just short of the agent line 82 and closes to ~95 after GRPO). This is the deliberate "big models still matter" counterweight to capability compression.

3. **Capability compression is real too.** Tiny MoE thinkers (gpt-oss 20B at 3.6B active, Qwen3-30B-A3B at 3.3B active) deliver frontier-grade reasoning at a fraction of the serving cost — the MoE memory-vs-compute split made playable. The skill is knowing where compression holds (reasoning, chat) and where the wall stands (agentic).

The recipe gain/cost table is autoplay-calibratable and guarded by `calibrateRecipes` against the band-displacement ordering, so a future hand-edit cannot silently break balance. A competent player wins the campaign; the capability-compression and agentic-wall lessons both hold under autoplay.
