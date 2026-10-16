# GPTD — Game Design Document

> **GPTD (GigaPrompt Tower Defense)** is a pixel tower-defense game built on real-world simulation — a tower defense first, designed around real data-center LLM-inference engineering so every number has a real basis. Waves of AI user requests stream in from four global ingress lanes toward your central Trust Core; you build a serving platform — GPU racks, models, caches, routers, guardrails, power and cooling — to answer them correctly, safely, and fast enough. The board is the experience layer; the math underneath is real.
>
> **Slogan: "the board is the metaphor, the numbers are real."**

> **This is the canonical design document for GPTD.** It is the readable design overview; two companion documents go deeper:
> - **[BLUEPRINT.md](./BLUEPRINT.md)** — the detailed, implementation-ready specification (§0–§7): every formula, field name, data-model type, and subsystem decision. When a number here is summarized, the blueprint is where the derivation lives.
> - **[REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md)** — the real-world grounding: the facts about LLM inference, post-training, safety, serving systems, hardware, the open-weight model landscape and the real events behind the campaign that the simulation is built on.
>
> The **code is the ultimate source of truth.** The authoritative specifics live in `src/sim/**` (chiefly `content.ts`, `effects.ts`, `combat.ts`, `guards.ts`, `safety.ts`, `resolve.ts`, `models.ts`, `research.ts`, `campaign.ts`, `loadForecast.ts`), `src/core/types.ts`, and `src/config.ts`. Everything below is verified against them. [REALISM.md](./REALISM.md) is the mechanic-by-mechanic ledger of real-world basis and known deviations.

> **Status:** shipped, playable build. **Stack:** Vite + TypeScript + PixiJS v8 + Web Audio (procedural, no asset files). Two display modes (Normal / Expert) over one identical deterministic simulation.

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
11. [Combat: the Seven Outcomes & Goodput](#11-combat-the-seven-outcomes--goodput)
12. [Buildings, Support & Incidents](#12-buildings-support--incidents)
13. [UI, Feedback & Feel: Normal & Expert](#13-ui-feedback--feel-normal--expert)
14. [Win / Lose / Endless](#14-win--lose--endless)
15. [Balance Philosophy](#15-balance-philosophy)

---

## 1. Vision & the Unified Simulation Model

GPTD wraps the real engineering of data-center LLM inference inside a tower-defense **experience layer** — four ingress lanes converging on a central Trust Core, rack placement, range, and routing pressure — while the **underlying math is real**. The player should be able to *see* and *learn* why each request succeeded or failed: too slow (and which latency bound), not smart enough (on which capability axis), unsafe, wrongly refused, out of capacity, or too long for the window. The tradeoffs a real inference engineer lives with hold in the numbers: small models are fast and big models are smart; thinking buys quality and costs time; guardrails buy safety and cost latency and false refusals; batching buys throughput and costs per-user speed; KV memory buys concurrency.

### The spine: one request's lifecycle

Every subsystem plugs into a single simulation spine. A request's life *is* the spine:

```
spawn (real token counts at the era's sizes, §6)
  → walks its ingress lane toward the Trust Core (board metaphor; transit is not latency)
  → first contact with a rack that could prefill it: TTFT clock starts,
    the guardrails covering its lane screen it once (input checks, before any compute)
  → its prompt goes to ONE in-range rack: the one that can start it soonest
    (a router instead picks the rack that answers it correctly and finishes soonest)
  → prefix-cache lookup, then prefill (compute-bound, sets TTFT)
  → first token: layer-1 alignment rolls on the model that produced it;
    a thinking-mode answer decodes its hidden reasoning first (sets time-to-first-answer)
  → decode (bandwidth-bound, batched in cohorts; sets the per-token rate) on racks of the
    model that holds its KV — another model takes over only by re-prefilling everything
  → output guards check the finished answer before delivery
  → one of seven outcomes (revenue, Trust, SLA settled; §11)
```

### The dual clock

Two clocks run at once. **`SIM_TIME_SCALE = 10`**: one board second compresses ten real datacenter seconds — purely a visual-pacing dial. **Every SLO is judged on the real-second axis**, from the request's own physical history: the queue wait at racks that could serve it, the prefill's wall time, guard checks, the per-token time of the racks that decoded it. Walking the lane is never latency. Per-latency-class SLOs in real milliseconds (`LAT_CLASS_SLO`), with per-archetype overrides (§6):

| Class | Meaning | TTFT SLO | Per-token (TPOT) SLO |
|---|---|---|---|
| `IN` | Interactive (chat, code completion, the jailbreak probes riding that traffic) | 400 ms | 40 ms |
| `NR` | Near-real-time (RAG, summarization, reasoning, agentic) | 2000 ms | 200 ms |
| `TO` | Throughput / offline (embed, batch) | none | none |

**Goodput** — clean serves over *every* request that ended — is the optimization target, not raw throughput: a late, wrong, unsafe, wrongly refused, rejected or dropped request all count against it. It decides how much of each wave's SLA contract is paid (§10).

### The three meters, win, and economy

You manage three meters: **Cash** (real credits, `1 credit = $1000`), **Trust** (0–100, customer reputation), and **SLA** (0–100, reliability). You lose if Cash < 0, Trust ≤ 0, or SLA ≤ 0. The campaign is a **100-wave escalating elimination gauntlet** of real 2023→2026 history: difficulty climbs without plateau, so most runs end mid-campaign. Surviving the final boss of wave 100 is the apex; endless mode resumes at that load and keeps climbing.

---

## 2. The Three-Layer Model Stack

A serving tower is composed of three independent layers. The separation is the central mental model of the game:

1. **Hardware (the rack)** — a real GPU tier with real VRAM, HBM bandwidth, tensor rates, TDP and capex. A rack is *neutral*: it has no opinion on what it is good at. It upgrades **in place** along the ladder, between waves. (§3)
2. **The model (the checkpoint)** — a real open-weight model deployed onto the rack. The model decides answer **quality** (a 5-axis vector, plus a second instant-mode vector for a hybrid thinker), whether and how much it **thinks**, its **alignment**, and its serving **demand** (total parameters for memory, active parameters for compute, its real per-token KV layout). Open weights are a free download, so deploying costs nothing; what gates a model is whether its weights **fit** a group of the rack's GPUs. (§4)
3. **The serving stack (infra)** — the researched techniques (continuous batching, PagedAttention, prefix caching, weight formats, parallelism, chunked prefill, …) on typed `s.infra` that govern how efficiently the rack+model pair serves. Each rack also picks its own **weight format** among the researched ones. (§8)

> A rack tier sets the *ceiling*; the deployed model sets the *capability*; the serving stack sets the *efficiency*. The same H100 rack is a chat soaker with a 2B model and a frontier reasoner with gpt-oss-120b — the 120b's native 4-bit weights fit one 80 GB GPU, which is exactly why that release mattered.

---

## 3. Hardware: the Real GPU Ladder

Racks are real accelerators (`HW_SPECS` in `content.ts`). Each entry carries per-GPU specs and a GPU count; aggregates are `perGpu × gpus`. Build cost in credits = `capexUsd / 1000` (single-GPU tiers use deployed-node capex, not the bare card). A rack upgrades one tier at a time between waves, paying the difference along `HARDWARE_TIERS`; its coverage range follows its current tier.

| Tier id | Display | GPUs | bf16 / fp8 / fp4 TFLOPS per GPU | HBM per GPU | HBM BW per GPU | TDP per GPU | Cooling | Capex | $/GPU-hr | Range |
|---|---|---|---|---|---|---|---|---|---|---|
| `hw_edge` | Edge GPU Rack (L4-class) | 1 | 121 / 242 / — | 24 GB | 0.3 TB/s | 72 W | air | $5k | 0.4 | 2.8 |
| `hw_standard` | Standard GPU Rack (L40S-class) | 1 | 362 / 733 / — | 48 GB | 0.864 TB/s | 350 W | air | $16k | 1.0 | 3.0 |
| `hw_perf` | Performance GPU Rack (H100-class) | 1 | 989 / 1979 / — | 80 GB | 3.35 TB/s | 700 W | air | $48k | 3.0 | 3.0 |
| `hw_frontier` | Frontier GPU Rack (H200-class) | 1 | 989 / 1979 / — | 141 GB | 4.8 TB/s | 700 W | air | $60k | 3.2 | 3.3 |
| `hw_pod` | DGX H200 (8× H200) | 8 | 989 / 1979 / — | 141 GB | 4.8 TB/s | 700 W | air | $320k | 3.2 | 3.4 |
| `hw_superpod` | DGX B200 (8× B200) | 8 | 2250 / 4500 / 9000 | 180 GB | 8.0 TB/s | 1000 W | air | $500k | 5.0 | 3.5 |
| `hw_giga` | GB200 NVL72 (72× B200) | 72 | 2250 / 4500 / 9000 | 186 GB | 8.0 TB/s | 1200 W | **liquid** | $3M | 5.0 | 3.6 |

Key physics the ladder teaches:

- **HBM bandwidth makes decode fly.** Decode re-reads the weights and every stream's KV each step, so bandwidth, not FLOPS, sets per-user speed; the H100's jump in TB/s matters more than its tensor rate.
- **A multi-GPU rack is not one big GPU.** A model copy spans the smallest power-of-two group of GPUs whose memory holds it; the rest of the rack runs more copies. Copies add **concurrency**, never per-user speed; a copy split across GPUs needs Tensor Parallelism research and pays a scaling efficiency below 1 plus an all-reduce per layer; beyond eight GPUs it needs Pipeline Parallelism (memory, not speed). A small model on a DGX box is eight fast replicas, not one faster model.
- **Blackwell racks carry FP4 tensor cores.** Only the DGX B200 and the NVL72 can serve NVFP4 (§8).
- **The cooling threshold is real.** Air cools up to about 1000 W per GPU; only the 1200 W/GPU NVL72 is liquid-cooled: it **cannot run at all** without a **Liquid Cooling Loop** on the board, and the loop's capacity cools only liquid racks (one loop holds one fully loaded NVL72). Every air rack, up to the 1000 W/GPU DGX B200, rejects its heat through the house chillers and Cooling Towers.
- **Power & heat are real kW.** A rack draws its aggregate TDP × `RACK_UTILIZATION` (0.8) in kW, adjusted by its weight format and speculative decoding (`serverPower`), and rejects about that much heat: an H100 rack reads ~0.56 kW, an NVL72 ~69 kW (per-GPU TDP only; interconnect and CPU overhead are not modeled — REALISM §7).

---

## 4. Models & the qualityBy Calibration

The candidate pool is **every open-weight checkpoint with an architecture record**: 135 checkpoints, 52 hand-authored in `ROSTER` from the fact-checked [MODEL-CATALOG.md](MODEL-CATALOG.md) plus 83 generated (`roster.generated.ts`). A **frontier-tolerance gate** (`ROSTER_FRONTIER_TOLERANCE = 0.06`) keeps a checkpoint only if, on at least one capability axis, it is within 6% of the best quality available at its size or smaller ([PARETO.md](PARETO.md)). The active roster is **58 checkpoints spanning 0.6B to 2.78T** from more than twenty developers, including the late-2026 open frontier (Kimi K3, GLM-5.3, DeepSeek-V4-Pro-0813 and V4.1-Flash, Qwen3.8, MiMo-V2.6, Step 5, Muse Spark Open). Every one is owned free from turn one; the only deploy gate is **fit** on the rack (and the parallelism research a multi-GPU fit needs). [REALISM-MODELS.md](REALISM-MODELS.md) documents the whole grounding pipeline.

### qualityBy: a 5-axis capability vector

Each model carries `qualityBy` over five **capability axes** — `chat`, `coding`, `reasoning`, `general`, `agentic` — on a ~0–130 scale where the request difficulty lines live. It is **never hand-edited**: each axis is a weighted blend of six Artificial Analysis benchmark cells (one primary at 0.6, two secondaries at 0.2), mapped through a per-axis piecewise-linear curve that saturates toward 130 above the anchored frontier (`calibrate.ts`):

| Axis | Primary (0.6) | Secondaries (0.2 each) |
|---|---|---|
| `chat` | IFBench | GPQA-Diamond, AA-LCR |
| `general` | GPQA-Diamond | IFBench, AA-LCR |
| `coding` | SciCode | Terminal-Bench Hard, IFBench |
| `reasoning` | Humanity's Last Exam | GPQA-Diamond, AA-LCR |
| `agentic` | Terminal-Bench Hard | IFBench, AA-LCR |

Per-benchmark cells are used, never a composite index, because composites re-baseline between versions. The cells themselves live on **one frozen reference scale** (the 2026-06-21 snapshot the curves were fitted on): newer re-scores are equated back to it, and cells the benchmark host no longer publishes are bridged from measured ones, with their uncertainty kept for Expert display. The game reads only the resolved numbers, so it stays deterministic.

**`agentic` is the axis that resisted compression longest.** Terminal-Bench Hard kept a real gap between models that clear saturated knowledge benchmarks and those that can drive a terminal; through the 2024–25 checkpoints the agent line (82 at tier 1, ≈100 by tier 12) is a frontier-only wall. In the late-2026 data a dense 27B (Qwen3.8-27B) crosses it — so the late-game agentic challenge moves from *capability* to *serving*: an agent step must think, read a long accumulated context and finish within its minute (§6, §15).

### Total vs active parameters (the MoE split)

- `paramsTotalB` → **memory** residency (every MoE expert must be resident), at the checkpoint's release precision.
- `paramsActiveB` → **compute & bandwidth** per token — but a batch touches the *union* of its tokens' experts, so the weights read per step climb from the active toward the total as the batch grows (§7).

For dense models these are equal; for MoE they diverge hugely (Qwen3.5-35B-A3B: 35 / 3; Kimi K3: 2780 / 104). A sparse model fits a big rack but serves like a small one — until the batch gets big.

### Architecture, precision and thinking are data

Every architecture fact comes from the checkpoint's Hugging Face `config.json` (`data/model-arch.json`): layers, the **real per-token KV** over only the KV-bearing layers (`kvBytesPerToken`: full-attention K/V, an MLA latent or a CSA/HCA compressed entry per layer that keeps one; linear-attention and sliding-window layers keep none) plus a constant per-request state (`kvStateMbPerReq`: recurrent states and bounded windows), the **release precision** (`nativeWeightBytes`, from the safetensors dtype mix: BF16 2, FP8 ≈1, MXFP4 / FP4 experts / INT4-QAT ≈0.53–0.66), window and licence. The 2026 hybrids make this matter: Hy3's plain GQA keeps 320 KB of KV per token, Muse Spark Open's full attention 248 KB, while DeepSeek-V4-Pro's compressed attention keeps under 10 KB — the difference between a rack holding a handful of long-context users and hundreds.

Each checkpoint's **thinking support** is read off its released chat template (`data/model-thinking.json`, with a verbatim quote as evidence):

- **hybrid** (37 of the active 58) — the serving stack can switch thinking off per request. The engine answers interactive traffic (latency class `IN`) **instantly**, judged on a second vector `qualityByInstant` (calibrated from the same checkpoint's non-reasoning benchmark row, or a per-cell thinking→instant fit), and **thinks** on everything else;
- **always** (19) — every answer reasons first (gpt-oss, Kimi K3, GLM-5.3, Step 5, the dedicated Thinking checkpoints): strong, but slow to start on chat;
- **never** (2) — an instruct deployment that answers at once.

A thinking model's hidden budget (`thinkTokens`) is sized from Artificial Analysis' serving telemetry: the time-to-first-answer gap × output speed, clamped to 300–4000 tokens (1500 when untimed).

Each model also carries an **`alignment`** profile (`safety` / `refusalStyle` / `overRefusal`, §9), hand-filled per family (no public safety benchmark exists to calibrate against), an `instructFollow`, and a long-context skill `longCtx` calibrated from the AA-LCR cell.

### A few roster landmarks

- **MiniCPM5-2B** — the free starter every new rack ships with, chosen by rule (`servesOpeningWaves`): the smallest dense checkpoint that, after its alignment tax, answers chat and code completion instantly and clears RAG's general line. It serves 2023; it will not serve 2026.
- **gpt-oss 20B / 120B** — always-thinking MoEs at 3.6B / 5.1B active, released natively in MXFP4 (the 120b fits one H100) and the safe-completion alignment exemplars.
- **Qwen3.5-35B-A3B** — near-frontier answers at 3B active: the MoE dream, until a big batch reads the union of its experts.
- **Qwen3.8-27B** — the dense 27B that clears the agentic line; a hybrid of 48 Gated DeltaNet and 16 attention layers, so only a quarter of its layers hold KV.
- **Hy3 / Muse Spark Open** — the full-attention foils whose KV per token is 10–60× the hybrids'.
- **DeepSeek-V4-Pro-0813** — 1.6T with FP4 experts and compressed attention: fits one 8-GPU box at its release precision.
- **Kimi K3** — the 2.78T top of the tree; as released, its 1.56 TB of MXFP4 weights need the NVL72 and a pipeline of two tensor-parallel stages.

---

## 5. The Post-Training Studio

The Studio is the **centerpiece** of the game's depth. There are no fixed "finetune" cards; you mint your own checkpoints. A run picks:

- a **base** — any roster model **or any previously derived model** (iterative chaining; depth grows). It defaults to the selected rack's model;
- a **method** — one of 12 real post-training methods;
- a **target** — one of 8 (the 5 capability axes + `safety` / `longctx` / `domain`);
- an **effort** — 5 discrete notches `[0.25, 0.5, 1.0, 1.5, 2.0]` (a run starts only at one of them).

It spends **Data** (paid up front) and **requisitioned compute** (the post-training research track lends the strongest racks during waves, §8) and, on completion, mints a **new named derived `ModelDef`** (`drv_{seq}`, e.g. `{base}-{Target}-{Method}`) with snapshot fields and a machine-readable `Lineage`. Derived models live in `s.derivedModels`, resolved via `resolveModel`. The Studio's preview runs the same pure computation as training (`computeDerivedFields`), so the before→after it shows is exactly what the run produces, including the capacity ceiling when it binds.

### The 12 methods (`METHOD_RECIPES`)

| Method | Relation | Targets | Character |
|---|---|---|---|
| **SFT** | finetune | chat / coding / general / longctx | The baseline; **no research needed**; raises instruction-following. |
| **CPT** | finetune | domain / longctx / general | Heaviest; broad gains with the **highest forgetting** (≈3 points off every other axis at effort 1). |
| **LoRA / QLoRA / DoRA** | adapter | the 5 axes | Cheapest PEFT; one band of capability, near-zero forgetting; with Multi-LoRA research an adapter hot-swaps with its base mid-wave. |
| **DPO** | finetune | chat / general / safety | Lighter, cheaper preference optimization than RLHF. |
| **RLHF** | finetune | safety / chat / general | Priciest preference method; the biggest alignment tax and rising over-refusal. |
| **CAI** | finetune | safety | Constitutional AI: a **Pareto** gain — raises safety, lowers over-refusal and switches to safe-completion. |
| **GRPO** | finetune | reasoning / agentic | Reasoning RL: the **strongest path** to reasoning/agentic; teaches an instruct model to think. |
| **Distill** | finetune | reasoning / coding / agentic | Moves the capability into a **smaller student** body: cheaper to serve, capped at min(teacher, student + 18). |
| **Merge** | merge | general | Averages two **distinct checkpoints of the same root base with an identical body**; costs Data for the eval pass; no gain, no forgetting. |
| **QAT** | quantized | general | Trains for 4-bit: the checkpoint's release precision becomes 4-bit (no PTQ tax there), −2 quality. |

### How quality is derived (`deriveQuality`)

The gain on the target axis is shaped by honest game curves (autoplay-calibratable, **not** first-principles physics — validated by `calibrateRecipes` against the band-displacement ordering), bounded by what bodies of that size can reach:

```
depthDamp = 1 / (1 + 0.15 × depth)               // deep chains diminish
rawGain   = gainScale × √effort × depthDamp
headroom  = (130 − base[axis]) / 130             // harder near the ceiling
gain      = min(rawGain, gainCap × headroom)     // the recipe's capacity cap
gain      = min(gain, ceiling(body, axis) − base[axis])   // the BODY's capacity ceiling (not for distill)
ceiling   = min(130, best base model ≤ 2× this body's total params on the axis + 6)
```

The ceiling depends only on the body, so stacking runs cannot ratchet it: a small model can be trained to the level of models twice its size, not to the frontier. On top of the gain the snapshot applies:

- **Alignment tax** — a safety target, RLHF or CAI lowers the `general` axis.
- **Catastrophic forgetting** — every non-target axis drifts down by `forgetScale × √effort × (1 + 0.5·(depth − 1))`: deep chains erode what the base knew.
- **Deploy reshape** — only distill / QAT / merge change the body (distill → the student's; QAT → 4-bit release precision; merge → the shared body at the higher of the two release precisions).
- **Alignment changes** — safety targets, RLHF and CAI raise `alignment.safety`; CAI lowers over-refusal and sets safe-completion; RLHF and safety-SFT raise over-refusal. The first safety run on a checkpoint lands in full and each stacked one less (the same depth damp as quality gains), and CAI never takes over-refusal below 0.02 — no real model refuses nothing borderline. A merge lands at the parents' mean safety, over-refusal and instruction-following, at the depth of its deeper parent whichever is listed first.
- **Thinking support** — the run moves both vectors (thinking and instant) by the same per-axis amount; a reasoning run (GRPO or a reasoning target) makes a never-thinker an always-thinker; a hybrid keeps its off switch; a merge keeps the support the parents share, otherwise becomes hybrid; a distilled student keeps the teacher's support.

Compute cost grows sub-linearly with active parameters, with lineage depth (×(1 + 0.6·depth)) and a mild MoE sparsity surcharge; Data grows with effort, depth and total parameters. A stacked chain is a real, diminishing-returns investment, not a free climb past a capability wall.

---

## 6. Requests: 9 First-Principles Archetypes

The "enemies" are 9 request archetypes (`REQUEST_TYPES`) defined by **workload physics**, not costume. Each carries real `inputTokens` / `outputTokens`, a `latClass` with optional per-type bounds, a per-axis `difficulty` vector judged on its `primaryAxis`, `prefixShare` (cache-friendliness), `cacheable`, `thinkMul` (how much of a thinking model's budget it draws), `refusalExposure` (how borderline its benign prompts are), optional `hazards`, and real `pricePerMtokIn` / `pricePerMtokOut`.

| Archetype | Physics shape | In / Out tok (2023 → late 2026) | Latency bounds | Axis · line | thinkMul | Refusal exposure | Hazard |
|---|---|---|---|---|---|---|---|
| **Embedding** (`embed`) | pure prefill, no generation | 2K / 0 → 6K / 0 | none (TO) | general 10 | 0 | 0 | — |
| **Interactive Chat** (`chat`) | balanced, high volume | 512 / 256 → 2.6K / 512 | IN; first answer ≤ 4 s | chat 18 | 0.5 | 1.0 | — |
| **Code Completion** (`comp`) | prefill-heavy, latency-critical | 1.5K / 150 → 7.5K / 200 | IN; TTFT ≤ 200 ms; first answer ≤ 400 ms | coding 56 | 0.05 | 0.1 | — |
| **RAG / Long-Context QA** (`rag`) | huge retrieved prompt | 8K / 512 → 48K / 819 | NR | general 50 | 0.5 | 0.4 | — |
| **Summarization** (`summ`) | extreme prompt, little reusable prefix | 12K / 400 → 96K / 1K | NR; TTFT ≤ 6 s | general 44 | 0.5 | 0.3 | — |
| **Reasoning** (`reason`) | extreme decode (long CoT) | 512 / 6K → 2K / 12K | NR | reasoning 82 | 0 (its output is the reasoning) | 0.5 | — |
| **Agentic Task** (`agent`) | agentic loop, tool use | 6K / 800 → 48K / 1K per step | NR; one step ≤ 60 s end-to-end | agentic 82 | 1 | n/a (it always carries a hazard) | injection 0.3 |
| **Batch / Offline** (`batch`) | decode-heavy, no SLO | 1K / 4K → 3K / 8K | none (TO) | general 40 | 0.5 | 0.2 | — |
| **Adversarial Prompt** (`jailbreak`) | the hazard carrier | 600 / 400 → 3K / 500 | IN; first answer ≤ 4 s | general 38 | 0.5 | n/a | jailbreak 0.7 |

The taxonomy spans the real workload-physics space: pure prefill, balanced, prefill-heavy interactive, long-context prefill, extreme decode, the agentic loop, decode-heavy offline, and the adversarial carrier. The defining traits — price, latency class, volume — are data, not theme.

**The era grows the requests, but keeps each one servable.** Prompts grew far more than answers between 2023 and 2026 — conversation history, retrieved documents, repository context and accumulated agent state all land in the prompt — so each archetype carries an end-of-campaign growth factor (`ERA_TOKEN_GROWTH`, grounded in public workload profiles) applied on a convex ramp: 2023 stays near the base lengths and the 2025–26 tiers carry most of the growth. The quality lines rise +2% per tier (×1.22 at tier 12). Late difficulty comes from volume, mix, the quality line, hazards and incidents — never from a single request no real fleet could serve.

---

## 7. Serving Physics: the Real Roofline

A rack's serving rate comes from the real roofline (`effects.ts`, combat in `combat.ts`), split into the two real phases. The ESTIMATE card, the deploy picker and the next-wave forecast read the same functions.

**Prefill (compute-bound, sets TTFT).** Ingesting the prompt is a compute-bound GEMM at the format's activation rate, with a super-linear penalty for long prompts (attention):

```
superlinear(n)  = 1 + n / (16000 × (1 + 0.5·flash))
prefillTokS(n)  = tensorRate(fmt) × tpDeg × tpEff × MFU_PREFILL(0.55) / (2 × activeB × superlinear(n))
```

One rack prefills a given prompt: of the in-range racks with room, the one that can start it soonest (the least prompt work already queued per lane; ties go to the lower tower id), so a burst spreads over the racks in reach instead of piling onto the first one built. Without chunked prefill each lane runs its prompts back to back, first come first served, **exclusively**: the lane's decodes stall for the prompts' busy time, and a burst of short prompts queues by their prefill times, never a whole tick each.

**Decode (bandwidth-bound, sets the per-token rate).** One decode step emits a token for every stream on a lane:

```
step   = max(t_mem, t_comp) + background prefill + fixed
t_mem  = (weights read + every stream's KV) / (HBM_BW × tpDeg × tpEff × MBU_DECODE(0.7))
t_comp = streams × 2 × activeB / (tensorRate(fmt) × tpDeg × tpEff × MFU_DECODE(0.5))
fixed  = scheduler overhead + an MoE's per-layer routing kernels + TP all-reduces + wide-EP all-to-alls + pipeline hops
per-user tok/s = 1 / step         aggregate = streams / step
```

Per-user speed falls as the batch and its contexts grow, while aggregate throughput rises toward the compute roof — continuous batching's real tradeoff. An MoE reads its always-on part plus the union of the routed experts its batch touches, and pays 50 µs per layer per step for its routing kernels (router, top-k, permute, grouped expert GEMMs), which a single stream cannot fill: gpt-oss-120b alone on one H100 decodes about 250 tok/s. Tensor parallelism splits a stream over ≤8 GPUs at an efficiency of {1, 0.9, 0.8, 0.65} for {1, 2, 4, 8} GPUs.

**Racks share a request only within one model.** Several racks of the same model in range can work one request's decode at once (the board's "several towers on one enemy"): it finishes in fewer board ticks, but every token is timed at the rack that produced it, so its real latency is the serial per-token sum. A request's KV belongs to the model that computed it (its layers, heads and K/V projections), so a rack of another model cannot continue it: once the request walks out of reach of every rack of its model, a rack of another model takes it over only by re-prefilling its whole sequence (recompute) — the first token stands, and the re-ingest is a stall inside the decode. Each answer has a home rack (the one that produced its first token) that admits it before any new prompt; the other racks of its model help only with spare capacity. A router follows the same rule: it picks which rack (and so which model) ingests a prompt; after that the answer is co-decoded like any other.

**Cohorts make the batch real.** Each request sprite in a rack's slot is a **cohort of 28 real streams** (`COHORT_STREAMS`), so one sprite is already a production-sized batch and two or three push a lane to 56–84 streams. With Continuous Batching an engine lane holds up to 256 streams (9 sprites); before it, one static batch. KV admits each cohort: a long context or a KV-heavy model shrinks the cohort a rack can hold, and a KV-limited cohort's sprite waits for its streams.

**Chunked prefill is a token budget.** With chunked prefill each engine step carries the running decodes plus up to a per-deployment budget of prompt tokens, profiled Sarathi-style from a 30 ms step target (or ≥25% stretch of a long decode step) and clamped to 256–8192 tokens. A prompt inside the budget finishes in one step; a longer one spans several; the decodes keep streaming, a little slower (they pay the longer chunk-carrying steps), and chunked prompt work runs at 90% of the monolithic prefill rate. Chunked prefill and P/D disaggregation are rival philosophies (a hard research conflict, §8).

**Memory & KV.** Resident weights = `paramsTotalB × (format bytes if the format is a lower precision class than the release, else release bytes)` — re-quantizing a 4-bit release to another 4-bit format saves nothing (+1.5 GB framework per GPU, less with FlashAttention). KV of one stream:

```
KV(ctx) = kvBytesPerToken × ctx × (kvQuantBytes / 2) + kvStateMbPerReq
```

The KV budget of a model copy is `(group HBM − weights − draft − framework) × kvUtilization`, where utilization is 0.55 until PagedAttention lifts it to 0.96; shared prefix blocks are stored once per cohort. Admission checks the **full sequence** a request will reach on that rack (prompt + answer + the hidden reasoning that model would think) against the window and one copy's KV: a request no copy could ever hold is rejected there (it ends **unservable** only if no rack that saw it could ever hold it); a busy budget means it waits, and the wait counts toward TTFT — waiting in range of a full rack is queueing even if another rack serves it later.

**Thinking tokens.** A model answering in thinking mode decodes `thinkTokens × thinkMul` hidden tokens before its first answer token: they cost decode time, KV and end-to-end latency, count toward TPOT, and are **never billed** (an archetype's price is what the market pays for the answer), so the rack card quotes `$/Mtoken` per billed answer token. Interactive archetypes carry a time-to-first-answer bound (`ttfatSloMs`, cause `ttfat`), so an always-thinker on chat or code completion is visibly late while a hybrid answers instantly.

**Long context costs quality too.** A sequence that fills more than a quarter of the model's window loses quality points, up to 24 at a full window, scaled down by the model's long-context skill; a 4-bit PTQ format adds its long-context tax past 8K tokens and an INT4 KV cache a small one past 32K.

**Thermal asymmetry.** Decode is memory-bound, so it keeps a slight edge under a thermal cap — `decodeThrottle(t) = 1 − (1 − t) × 0.85` — while prefill and compute-bound steps take the full hit; the throttle floor is 0.2, so an under-cooled fleet collapses rather than dips.

---

## 8. The Infra Tech Tree & Research Tracks

The tech tree is **infra-only** and lives on typed `s.infra` — the single source of truth for serving physics. It is **22 `InfraNodeDef`** across 8 categories. Model architecture (GQA / MLA / hybrid attention / MoE / thinking) is **not** here — those are model properties; the tree is the serving *stack* around the model. Every node grants its real effect and keeps its real cost:

| Category | Node → what it really does in the sim |
|---|---|
| **scheduling** | **Continuous Batching** (the engine's 256-stream cap per lane; one static batch before it) · **Multi-Step Scheduling** (amortizes the per-step overhead over 8 steps, but new requests join only every few steps) · **Chunked Prefill** (the token-budget scheduler, §7) · **P/D Disaggregation** (role-pinned prefill / decode racks at a ≤10% pool gain; the KV crosses the network; a decode pool takes only its own model's KV and owes the cohort's prompts to its prefill pool) |
| **kv-memory** | **PagedAttention** (KV utilization 0.55 → 0.96) · **Prefix Caching** (lifts cache hit chance) · **FlashAttention** (faster long prefill, faster KV reads, activation memory back — no quality or window bonus) · **FP8 / INT4 KV Cache** (narrows the growing KV; INT4 costs a little quality past 32K) · **KV Offloading (LMCache)** (a CPU/SSD prefix tier reloaded over PCIe — never active-attention KV) |
| **decoding** | **Speculative Decoding (EAGLE)** (draft-and-verify; acceptance by axis — code accepts the most drafts, open reasoning the fewest; the gain fades with the batch, whole up to 32 streams per lane and gone by 128; draft VRAM; +8% power on every rack; the engine runs it only while the speculative step beats the plain one) |
| **weight-quant** | **FP8** (W8A8: half the bytes at the FP8 rate, lossless) · **INT4 AWQ/GPTQ** (W4A16: ~0.53 B/param but the BF16 compute rate; −2 quality, −6 past 8K tokens) · **NVFP4** (Blackwell racks only; the FP4 rate; −1, −2 past 8K) |
| **parallelism** | **Tensor** (a copy may span ≤8 GPUs) · **Pipeline** (beyond 8: memory, a per-step hop and a TTFT bubble) · **Data** (load-balances requests across a rack's copies) · **Expert** (wide EP: an MoE served as several copies shards its experts and pools its batch, plus an all-to-all) |
| **routing** | **KV-Aware Routing (Dynamo)** (routed cacheable traffic lands where its prefix lives: more prefix hits) |
| **multi-lora** | **Multi-LoRA Serving (S-LoRA)** (a base and its adapters swap mid-wave without a reload, at 0.93 speed until the next wave) |
| **engine** | **SGLang** (RadixAttention: more prefix hits) ⟂ **TensorRT-LLM** (compiled kernels: ×1.12 on MBU/MFU) — a one-way choice |

Each rack then picks its own **weight format** among the researched ones between waves; *auto* takes the fastest format that costs this model no quality and fits. A checkpoint released at low precision stays at its native bytes and pays no tax there. Hard conflicts (**Chunked Prefill ⟂ P/D Disaggregation**, **SGLang ⟂ TensorRT-LLM**) and the Blackwell requirement of NVFP4 are enforced in the sim, not just the UI.

### Three research tracks

Research runs on **three concurrent tracks** — **infra** (the 22 nodes plus the post-training method unlocks `pt_lora` / `pt_pref` / `pt_rl` / `pt_cai` / `pt_cpt` / `pt_distill` / `pt_merge` / `pt_qat`; SFT needs none), **posttrain** (one Studio run, §5) and **eval** (the dev-time **Red-Team Eval** I/II, §9). A project (or Studio run) starts between waves, with a Training Lab on the board and its Data paid up front; it then advances **during waves** on one shared requisition pool: whole racks, strongest first, that fit under 45% of the online fleet's FLOPS (browned-out racks never count; never the last online rack), with the lent compute split equally across the active tracks. The lent racks go dark for serving while they train and still pay their bill — the real cost of R&D. The Training Lab and Studio preview which racks would be lent, the serving share lost and the waves a project needs.

---

## 9. Two-Layer Safety

Safety is two genuinely different layers (`safety.ts`, `guards.ts`, `combat.ts`), matching the real world.

### Layer 1 — model-intrinsic alignment (baked into the weights, zero latency)

Each model has an `AlignmentProfile`: `safety` (0–100), `refusalStyle` (`none` / `hard-refusal` / `safe-completion`), and `overRefusal` (0–1). You change it only by training (RLHF / CAI / safety-SFT). It is rolled **once, at the first output token, by the rack that produced it** — a rack that never admitted the request cannot refuse or sanitize it:

- **Self-handle** a hazard with `pSelfHandle = clamp01(safety/100 − severity × HAZARD_HARDNESS[h])`; injection is hardest (0.55), then jailbreak (0.35), PII (0.3), harmful (0.2). A handled attack is answered with a short refusal (30 tokens) or a safe completion (200 tokens).
- **Alignment tax** — being aligned costs capability: `TAX_K[style] × max(0, safety − 40) / 100`, subtracted from `qualityBy`. Hard-refusal pays K = 9; **safe-completion pays only K = 4** (the Pareto point the gpt-oss family teaches).
- **Over-refusal** — a benign request is wrongly refused with probability `overRefusal × refusalExposure`: open-ended chat carries the full rate, code completion a tenth, an embedding none (it generates no text to refuse).

### Layer 2 — guardrail buildings (pipeline stages, real latency)

A guardrail is a **pipeline stage, not a turret**: it screens every request on the lanes its range circle touches, wherever it sits. Each request is screened **once**, at its first contact with a rack that could prefill it. Per guard **family** on its lane: input latency once (→ TTFT), output latency once (→ E2E), one benign false-positive roll × refusal exposure, and a catch with the family's **best** recall — more copies of one classifier add coverage, never recall; distinct families stack (defense in depth). An input-side catch blocks an attack **before any compute**; output checks run on the finished answer before delivery.

| Building | Real model | Check latency | Compute & power | Side | Catches |
|---|---|---|---|---|---|
| **Prompt Guard (encoder)** | Prompt Guard 2 86M | fixed 10 ms (a served encoder: a few ms of forward plus the service hop and tokenization; longer prompts scanned in parallel segments) | off-rack, 0.1 kW | input | jailbreak; injection after Red-Team Eval |
| **Llama Guard (generative)** | Llama Guard 4 12B | the **real roofline** on its own H100: a prefill of the turn it classifies (the user prompt on input; prompt plus answer on output; each part capped at 2048 tokens) + a 3-token verdict + the same 5 ms service hop — about 31 ms (FP8) to 53 ms (BF16) for a 512-token prompt, up to 78–139 ms for a long turn | its rack's kW and GPU-hours | both | jailbreak, harmful; injection after Red-Team Eval; PII after Red-Team Eval II |
| **Moderation API** | OpenAI omni moderation | fixed 120 ms | vendor-hosted, 0.1 kW | both | harmful; PII after Red-Team Eval II (kept out of the build bar: only one authored wave carries harmful content and none carries PII) |

The teaching contrast is cost structure: the encoder is a cheap fixed check on one side that adaptive attacks slip past; the generative judge costs several times its latency on every prompt (an order of magnitude on a long turn), reads both sides, scales with the turn, and costs a GPU of your own — but it reasons about intent.

**The operating point is fixed.** Guards run at a fixed decision threshold of 0.5 (no in-game control): effective recall is the base recall (+0.02 per Red-Team level) and the benign false-positive rate is `OVERREF_K × 0.25` (encoder 1.5%, generative 2.5%, moderation 1.25% at full exposure). **Red-Team Eval** is the dev-time relief: it calibrates guards to judge by intent (XSTest-style; over-refusal ×0.7) and unlocks the harder detection categories.

**Attacks escalate with the era.** Hazard severities rise ×(1 + 0.039·(tier − 1)), clamped at 1 (a DAN-era jailbreak at 0.7 becomes a fully adaptive 1.0 by late 2026), and from tier 3 a growing share of attacks are **novel** — adaptive variants a classifier never trained on — up to half by tier 12. Against a novel attack an encoder keeps 45% of its recall, a moderation endpoint 70%, a generative judge all of it. Late safety needs a generative judge or a well-aligned model, not more copies of one classifier.

### The safety verdict

A hazard is handled iff the model self-handles it **or** a covering guard catches it. An **unsafe** breach is an unsafe answer actually **delivered** — it resolves at once and costs Trust (× the incident's `safetyDamage`), not SLA. A hazardous request nobody answered is a plain **leak** (SLA only; an attacker who got no answer harms no one's Trust). A correctly handled attack — blocked at input, refused or safely completed by the model, or stopped at output — is **served**: it is the right answer to an attack. A benign request wrongly refused is **over-refused**.

---

## 10. The Real Economy

`1 credit = $1000` (`CREDIT_USD`). Everything is real money, under one identity: a request sprite stands for `TRAFFIC_SCALE = 100,000` real requests, and a board rack for `RACKS_PER_TILE = TRAFFIC_SCALE / COHORT_STREAMS ≈ 3,571` real racks. Income and the bill both carry that scale, so **the $/Mtoken a rack card shows is the rate its cash flow obeys**.

- **Build cost** = `capexUsd / 1000` (× the incident's build-cost multiplier); a sale refunds 60%.
- **Income** = real $/Mtoken on the tokens actually processed — the prompt ingested (a cached prefix counts) plus the **answer** tokens generated; hidden reasoning is never billed. A served request pays 100%, an SLO-miss 50% (the SLA credit), every other outcome nothing (wrong answers are refunded).
- **The bill runs by wall-clock, in two lines**, for every online rack whether it serves or not: **GPU-hours** (the real per-GPU-hour rate minus the electricity it embeds — amortization, maintenance, colo) and **energy** (the kW actually drawn — an idle rack still burns 30% of nameplate — × PUE 1.4 air / 1.15 liquid × $0.10/kWh). Energy is a few percent of a rack's all-in hour, as in reality, and power-price incidents scale only that line. The generative guard's rack pays both lines. An idle or over-provisioned rack bleeds: the utilization penalty emerges rather than being bolted on.
- **The SLA contract** pays every cleared wave from wave 1: `(160 + 40 × tier, +320 on a boss) × CLEAR_BONUS_SCALE (0.12) × wave Goodput`. It is most of the early income (a board rack serves only minutes of real traffic per wave) and the reason clean, on-time serving pays before token volume does; token income overtakes it by the 2024 tiers.
- **Power & cooling** are real kW capacity meters (a 6 kW substation and 6 kW of house chillers; Power Plants, Cooling Towers and Liquid Cooling Loops add blocks), refreshed after every build-phase action so the HUD is always live.

---

## 11. Combat: the Seven Outcomes & Goodput

Every request ends in exactly **one of seven outcomes**, all settled in one place (`resolve.ts`) and announced by a precise `outcome` event that the board, the HUD, the wave report and the audio all read. Each outcome has its own color (with a colorblind palette), glyph, board popup and sound, so meaning never rests on hue alone; chips fly from the board to the Cash, Trust and SLA meters they touch.

| Outcome | Meaning | Pay | Trust | SLA | Glyph · popup |
|---|---|---|---|---|---|
| **served** | correct, safe, on time (or an attack correctly handled) | 100% | +0.25 | +0.15 | check · `OK` (summed `+$x.xx`) |
| **sloMiss** | correct and safe, but late on TTFT / TPOT / E2E / time-to-first-answer | 50% | −0.25 × trustPen | −0.5 × slaPen | clock · `LATE·TTFT` etc. |
| **bad** | wrong: the answering racks' margin fell below the line | 0 | −0.5 × trustPen | — | cross · `WRONG·<axis>` |
| **unsafe** | an unsafe answer was delivered | 0 | −trustPen × safetyDamage | — | hazard · `UNSAFE` |
| **overRefused** | a benign request refused by the model or a guard | 0 | −0.25 × trustPen | −0.2 × slaPen | no-entry · `REFUSED·MODEL/GUARD` |
| **unservable** | too long for every in-range rack that saw it (window / one copy's KV), never served | 0 | −trustPen | −slaPen | overflow · `TOO LONG` |
| **leaked** | nobody answered before the core (504) | 0 | −trustPen (0 for an attack) | −slaPen | drop · `504` |

(Every SLA penalty × the incident's `slaDamage`, default 1.)

**The quality gate is token-weighted.** On the request's primary axis, each rack that generated tokens scores them with its own margin (racks of one model can still differ — a 4-bit rack pays its PTQ tax; a request re-prefilled on another model is scored by both), and the answer's margin is the weighted mean — the racks that *wrote* the answer decide its quality, not the best one that touched it:

```
margin_rack = quality(model, answer mode)[axis] − PTQ tax − alignment tax − long-context penalty − difficulty
margin      = Σ(tokens_rack × margin_rack) / Σ tokens_rack        (≥ 0 → correct; < 0 → bad)
```

Precedence at delivery is worst first: `unsafe > handled attack (served) > bad > sloMiss > served`. TPOT is judged once at delivery (`decodeSec / (tokens − 1)`, hidden tokens included). **Goodput** = served ÷ every terminal outcome; the secondary `sloAttainPct` reports the latency view of answered requests only.

---

## 12. Buildings, Support & Incidents

Beyond GPU racks (`srv_edge`, `srv_frontier` — both ship with the free starter model and upgrade in place), the build bar offers:

- **Router** (3.6 tiles) — capability-aware dispatch: every prompt in range goes to an in-range rack with room for it. Among racks whose model answers it correctly it takes the one that finishes soonest (its wait for a lane, its prefill, then its answer plus any hidden reasoning at that rack's per-user speed), so easy traffic goes to fast small models and the strong thinker is kept for what needs it; otherwise the best margin. The rack that ingests the prompt holds its KV, so its model writes the answer, co-decoded by the other racks of that model like any request. It never speeds decode. Without a router, a prompt goes to the in-range rack that can start it soonest (REALISM §5.4).
- **Cache** (3.0 tiles) — a prefix-cache aura for cacheable traffic (embed / chat / comp / RAG / agent). Each request gets **one** lookup at its first admission under an aura; overlapping caches count as the best one, capped at 70%. A hit skips the prompt's shared-prefix share of the prefill; the unique suffix still prefills, and the answer still decodes and faces every gate. Prefix Caching research lifts the hit rate; KV-aware routing, SGLang and KV offload add more.
- **Guardrails** — the layer-2 families (§9).
- **Power Plant** (+8 kW), **Cooling Tower** (+8 kW air), **Liquid Cooling Loop** (+75 kW for liquid racks only, one NVL72's worth; **enables** the NVL72).
- **Training Lab** — required to research; each Lab raises Data yield by 25%.

**Incidents** between waves force adaptation. A telegraphed incident is applied at the start of the build phase and stays live through the wave (`applyIncident` in `sim.ts`): a multiplier bag (`powerPrice` / `powerCap` / `powerBuild` / `coolingCap` / `liquidCoolingCap` / `buildCost` / `safetyDamage` / `slaDamage` / `volume` / `reward`), an optional one-shot `instant` (Data loss), and an optional `concentrate` that funnels the wave's traffic into one ingress. The 23 incidents are grounded in real events: capacity-auction and on-site-fuel price spikes (and a cheap nuclear PPA, which the nuclear-deal wave forces), **grid curtailment** (15% of the feed cut, the rest on costly backup) and **interconnection freezes** (no new Power Plant), a liquid-loop fault (the Liquid Cooling Loops only) and water-drought cooling cuts (both pools), H100 / HBM shortages and export bans (and lead times easing), price wars and market shocks, regulatory audits and adversarial-suffix storms (unsafe answers cost more Trust), data poisoning and eval contamination (Data loss), viral surges (good fortune: more traffic, each clean serve paying more), the **enterprise demo** (+50% pay, every SLA penalty ×1.8), off-peak lulls, and the **single-entry surges** — cable cuts, edge-provider outages, the CrowdStrike meltdown. From the third wave on, a real-event wave forces its signature incident; a boss without one gets a forced hard operating shock (never a lane funnel or a volume surge); every 10th wave carries a hard incident; other waves roll one 60% of the time.

---

## 13. UI, Feedback & Feel: Normal & Expert

There are **two display modes** over **one identical deterministic simulation** — `src/sim/**` never imports `mode.ts`. **Normal** speaks plain language ("Fast enough for: Chat ✓ Code ✗", "Too slow 11 · Refused 1"); **Expert** reveals the SRE telemetry (TTFT/TPOT/E2E in ms, KV, roofline, $/Mtok, ledgers) and adds the Model Overview, the telemetry panel and the rack's Telemetry tab. The game, the actions and the outcomes are the same in both; the request inspector and the wave report exist in both, phrased for each.

### Planning surfaces

- **Next-wave card** (build phase) — the wave START will launch: era, brief, lesson, telegraphed incident, single-entry surge (also drawn on the board as a lane highlight with a SURGE tag) and a four-check readiness forecast per archetype against the current fleet: **SMART** (some covering rack answers correctly), **FAST** (meets its bounds under the wave's mixed load), **FITS** (window and KV hold the sequence), **SAFE** (a covering guard with the category unlocked, or self-handling models). Tooltips show the numbers behind each check.
- **Deploy picker** (rack inspect) — scores every owned checkpoint on that rack against the coming wave: per-user tok/s under the same forecast load the ★ is scored at (for the archetype nearest its TPOT bound, coloured against that bound), quality on the judged axes, how many archetypes it serves cleanly, safety and over-refusal, HYBRID / THINKS badges. The **★** marks the highest expected clean share of the coming wave under its mixed load. Models that need a bigger rack appear greyed with what they need ("needs 141 GB → H200 rack", "needs Tensor Parallelism"). Bulk rollout deploys to every rack of the tier or every rack a model fits.
- **One shared forecast.** The ★, the fit rows, the readiness card, the ESTIMATE card's prompt time and the demo autoplay all read one pure load forecast (`loadForecast.ts`): the wave's bursts in flight (Little's law) spread over the racks requests meet while they are served, the mixed decode step on each lane, prompt queueing on the entry racks (Pollaczek–Khinchine: some prompts wait, most do not), entry-slot contention for regular, round-robin arrivals (a lane that meets a single rack, or shares its entry racks with another lane, queues first), each latency's scatter around its forecast, guard checks, the answer mode, the long-context margin and the window. The pick a player is shown is the pick the autoplay plays by; a test holds every picker row within 10 points of the share the sim serves on representative racks and eras.

### Inspection surfaces

- **Rack inspect** — a fixed header and action bar (RACK → upgrade with its VRAM / speed / kW deltas, two-step SELL, UPGRADE ALL, ROLE under disaggregation, the weight-format button) above Overview / Deploy / Telemetry (Expert) tabs; a model-split line ("N GPU per copy · TP×k · M copies"); the ESTIMATE card colored against the SLO bounds. It docks opposite the selected rack. Model swaps and rack upgrades are between-waves actions (a Multi-LoRA adapter swap excepted); emergency builds are allowed mid-wave.
- **Request inspector** (both modes) — the forecast outcome (a neutral "waiting for a rack" until a rack takes the request on) and the live diagnosis: TTFT so far against its bound, TPOT on the answering rack, the scaled difficulty against that rack's quality in the mode it answers in, hidden tokens, guards passed, and whether anything on the board can still catch each hazard.
- **Wave report** — Expert: Goodput, the seven-outcome bar, Trust and SLA lost per outcome, which bound late answers missed, who refused (model or guard), TTFT / E2E / TPOT in ms, per-type SLO targets, the bill's GPU-hour and energy lines, and a WHY section with one cause and one fix per top failure. Normal: a compact plain-language summary with net cash and FIX NEXT. It folds to a remembered chip.
- **Model Overview, Lineage Graph, Training Lab + Studio** — every base and derived checkpoint with fits-my-racks filtering, per-axis sort, a speed column, both thinking-mode vectors and benchmark provenance; the derived-checkpoint DAG; the research tracks with prerequisite and lending previews, and the Studio's exact before→after.
- **End screen** — all seven outcomes, the biggest Trust / SLA drains, run Goodput and total earned.

### The HUD, notifications and controls

- **HUD** — in the build phase "Next: Wave n — name" with the incoming count; during a wave a live seven-outcome tally with cause tooltips and the live incident on the status line; a runway chip (waves of cash at zero income); Trust / SLA hover ledgers of what drained them; START warns and asks twice when cash is below the wave's projected bill.
- **Notification stack** — research done, checkpoint minted (with one-click DEPLOY ×n rollout), achievements, first brownout / throttle of a wave; at most three, out of the way of the inspect column and modals.
- **Denied reasons** — every rejected action names its reason at the cursor ("between waves", "needs a Liquid Cooling Loop", "needs Tensor Parallelism"); disabled buttons explain themselves.
- **Hotkeys** — one table (`ui/help.ts`) drives the key dispatch, the button badges and the H / ? sheet, bound to physical keys so every keyboard layout works: Space start / pause; Q–P build; Z upgrade, X sell (twice while Confirm Before Selling is on), C copy a rack's loadout as a blueprint, V role; , . cycle racks; G coverage rings (hold Alt to peek); L Training Lab, K models, ` / Tab telemetry; 1 2 3 6 0 and − = speed, F toggles 1× and the last fast speed; M mute; Esc / right-click cancel; [ ] tabs; PgUp / PgDn in long lists. The sheet freezes a running wave while it covers the board. Support buildings paint by dragging; touch uses tap-to-confirm and long-press tooltips. Optional auto-start, pause on focus loss and two-step Restart / Quit.
- **Codex** — the onboarding guide and contextual tips (first SLO-miss, first wrong answer, first over-refusal, injection with no Red-Team, a wave whose bill beat its income), remembered per player; an optional bring-your-own-key chat assistant tab.

### Board feedback

The board shows *why*: request packets outline their latency class and carry a two-phase progress bar (prefill, then hidden thinking, then the answer) with a TTFT budget line while queued and one badge for the most urgent problem; racks show batch-slot LEDs (decoding, prefilling, stalled behind an unchunked prefill), a KV gauge in Expert, and an icon for why a rack is dark (power cut, missing liquid loop, throttled); token streams flow into a prefilling rack and out to its decoding requests; guard catches, wrongful blocks and model self-handles each have their own stamp; the Trust Core cracks, pulses and glows as Trust falls. An FX budget scales with crowd size, speed and the FX level setting, and reduced motion, screen shake, reduce flashing and colorblind settings are honored everywhere.

### Audio direction

Audio is **outcome feedback first**. The same outcome table that drives the FX drives the sounds: a served answer is a bright pluck that climbs a pentatonic scale while service stays clean and drops back to the root on any failure — the drop itself is information; a late answer sags with a tick-tock; a wrong answer buzzes; an unsafe one is the loudest alarm and ducks the music; a refusal is a polite "nuh-uh" (with a shield tick when a guard refused); a 504 whooshes into a thump at the core. Failures always sit above routine serves in the mix, and a voice manager with per-cue budgets keeps 12× speed legible instead of noisy; sounds pan by board position. An adaptive score (title, build, wave, boss, won, lost) is a load and danger gauge with a drone near failure, a heartbeat under low Trust or SLA and a clock tick when cash is about to run out; room tone follows utilization, fans and throttling. Everything is synthesized procedurally in Web Audio — no asset files.

### Demo

The title screen's **Demo** is a fixed-seed Expert spectator run at 12× driven by the production autoplayer (`src/sim/demo.ts`). It plays only with the actions and read-only forecasts a player has — the next-wave preview and the shared load forecast — never a privileged view of the dice: it keeps a reserve for the projected bill, builds and upgrades racks, researches the stack in dependency order, post-trains a safe-completion workhorse and agentic / reasoning specialists, and deploys per rack tier what the forecast says serves the wave best. Like a real run it gets deep (the gate seeds reach waves 55–91) and is eventually eliminated. Demo viewers can inspect everything; state-changing actions stay under the autoplayer's control, and a run-changing button says so instead of acting. An agent-bridge run (docs/AGENT-BRIDGE.md) follows the same ownership rule, with the agent's narration in the Codex bubble.

---

## 14. Win / Lose / Endless

- **Lose** if any meter fails: Cash < 0 (bankruptcy), Trust ≤ 0, or SLA ≤ 0.
- **Win** the campaign by surviving all **100 waves** through the final boss, *The Always-On Agent Era* (wave 100), where all nine archetypes, jailbreaks and agent-borne injection, and a single-entry surge land at once.
- **Endless** mode resumes at the wave-100 load — the same per-request scaling, the boss-sized budget, the tier-12 hazards, wave 100's SLA contract — and climbs every surge: volume and per-request work grow, the quality lines harden after a short grace, the novel-attack share rises, and incidents keep rolling. The model tree tops out at the largest open checkpoint while difficulty does not, so every endless run ends; the score is how deep you got.

The **100-wave authored campaign** (`campaign-data.ts`, expanded into `WaveDef`s by `buildCampaign` in `campaign.ts`) dramatizes real 2023→2026 history **from the provider's seat**: every wave is a **demand shift** (people start using AI for something en masse → the traffic mix and volume change) or an **operating shock** (an energy, supply, network, abuse or regulatory event → the ability to serve is hit) — *never* a model or chip announcement; those are the player's tools. It runs chronologically from *The Chatbot Boom* (January 2023) through the jailbreak, RAG, coding-assistant, reasoning and agent waves to the dated events of mid-to-late 2026: a record PJM heat wave under a federal curtailment order, the first intrusion run end to end by autonomous agents, the EU AI Act's transparency day, three assistants going dark the same morning, a half-price frontier price war, and the always-on agent era. Twelve boss waves (a 1.25× request budget, a contract premium, and a forced hard incident when they carry no signature one) punctuate it, and ten single-entry surges pin all traffic to one ingress. Tiers rise monotonically from 1 to 12; no wave may bring more than 1.6× the requests of the wave before it (1.8× for a boss), counting the volume of the incident it forces, so runs end from accumulated pressure rather than a sudden doubling. The whole curve is tuned from a handful of knobs in `campaign.ts` (the era token table and ramp, `tierComplexity`, `waveBudget` and the step caps, hazard pressure, the contract constants); per-run variability comes from the seeded incident system.

---

## 15. Balance Philosophy

The lessons the numbers are tuned to teach:

1. **Not every request deserves the frontier model.** A chat flood on a small instant-answering model is more profitable than a SuperPod idling on it — the wall-clock bill punishes idle frontier iron — and the router makes the split automatic: easy traffic to fast racks, hard traffic to capable ones.
2. **Thinking is a tool with a latency cost.** A thinker clears lines an instruct model cannot, but its hidden tokens blow the interactive time-to-first-answer bounds; a hybrid answers chat instantly and thinks on the rest. Placing the right *mode* is as important as placing the right model.
3. **Capability compression is real, and it moves the wall.** Small and sparse models deliver frontier-grade answers at a fraction of the serving cost. The agentic axis compressed last, and by late 2026 a 27B clears it — so late agent traffic is decided by serving: long accumulated prompts, KV per user, and finishing an agent step inside a minute.
4. **Memory is concurrency.** The hybrid-attention models of 2026 hold a fraction of the KV per token of their full-attention peers; on long-context traffic that is the difference between a rack serving a handful of users and hundreds.
5. **Safety has a price on both sides.** Guards add latency and false refusals; alignment adds a capability tax and its own refusals; Constitutional AI and safe-completion move the Pareto frontier. Novel attacks punish relying on one classifier.

Balance is guarded by the autoplay gate (`tests/playthrough.test.ts`): the production demo must reach at least wave 45 on every gate seed (it reaches waves 55–91) and must still be eliminated before wave 100; a naive build (cheap racks, the starter model, nothing else) must fall in waves 6–14 (it falls at waves 8–10, by the first boss); and a fleet strong enough for wave 100 must clear the first endless surges at high Goodput. The recipe gain/cost table is autoplay-calibratable and validated by `calibrateRecipes` against the band-displacement ordering, so a hand-edit cannot silently break balance.
