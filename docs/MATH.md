# GPTD Math Reference

> New here? GPTD is a tower-defense game: you defend a stream of user requests with GPU racks, guardrails and routers, and every number behind the board comes from real LLM-inference engineering. Start with the [README](../README.md). This file is the quick reference for every formula, constant and variable the simulation uses.

Extracted from the **code** (the source of truth: `src/sim/**`, `src/config.ts`, `src/core/types.ts`, plus the pure UI mirrors in `src/ui/metrics.ts` / `src/ui/nextWave.ts`) and checked against it. Order: variable glossary → constants → formulas by subsystem. The design rationale lives in [BLUEPRINT.md](./BLUEPRINT.md); the real-world grounding in [REALISM.md](./REALISM.md) and [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md).

Units: *real s* is the datacenter clock every latency, token rate and SLO is judged on; *board s* is the visible game clock (1 board s = `SIM_TIME_SCALE` real s). Cash is in credits (1 credit = $1000).

## 1. Variable glossary

### Meters & resources
| Symbol | Meaning | Unit |
|---|---|---|
| `s.meters.cash` | Cash; the run is lost when it goes below 0 | credits |
| `s.meters.trust` / `s.meters.sla` | Trust and SLA meters, clamped to [0, 100]; the run is lost at 0 | pts |
| `s.data` | Training Data (earned by answers, spent on research and the Studio) | data |
| `s.power` / `s.cooling` | Power draw vs capacity; heat vs heat-rejection capacity (air + liquid pools) | kW |
| `s.coolingLiquid` | The Liquid Cooling Loops' own pool (inside `s.cooling`) | kW |
| `s.utilization` | Rolling fleet utilization (EMA) | 0..1 |
| `s.fleetCapexUsd` | Capex of every rack on the board (telemetry) | $ |
| `s.modifiers.*` | The active incident's multipliers (§2.13) | × |

### Request (`r`)
| Symbol | Meaning | Unit |
|---|---|---|
| `r.tokensIn` / `r.tokensOut` | Prompt (ISL) / answer (OSL) length as spawned | tokens |
| `r.prefill` | Prompt tokens still to ingest (a prefix-cache hit removes the shared prefix) | tokens |
| `r.work` / `r.maxWork` | Tokens still to generate / total to generate (hidden reasoning tokens are added at the first token) | tokens |
| `r.hiddenTokens` | Hidden reasoning tokens the answering model thinks before the answer (unbilled) | tokens |
| `r.contextLen` | Live KV sequence = prompt + tokens generated so far | tokens |
| `r.difficulty` | The quality line on the judged axis = `difficulty[primaryAxis] × complexityMul` | pts |
| `r.queueSec` | Real seconds waiting in range of a rack that could prefill it (a full rack is queueing too) | real s |
| `r.guardInSec` / `r.guardOutSec` | Input / output guardrail check time charged to this request | real s |
| `r.ttftReal` / `r.ttfatReal` / `r.e2elReal` | Time to first token / first ANSWER token / whole answer | real s |
| `r.decodeSec` | Per-stream decode time after the first token (the TPOT basis) | real s |
| `r.qualTokSum` / `r.qualTokW` / `r.bestQuality` | Token-weighted quality margin accumulator (`bestQuality = sum / weight`; ≥ 0 correct) | pts |
| `r.hazards` / `r.hazardsOpen` | Hazard severities spawned with / still uncleared | 0..1 |
| `r.novel` | A novel (adaptive) attack variant | bool |
| `r.selfHandled` / `r.screened` | Layer 1 rolled / lane guards screened it | bool |
| `r.attackHandled` | An adversarial request correctly blocked or refused | bool |
| `r.overRefused` / `r.refusedBy` | A benign request wrongly refused, and by whom (`model` / `guard`) | bool / enum |
| `r.windowBlocked` / `r.fitSeen` | A rack rejected it on a hard gate (window or one copy's KV) / a rack in range could hold it | bool |
| `r.sloViolated` / `r.sloCause` | Missed a latency bound, and which first (`ttft` / `ttfat` / `tpot` / `e2el`) | bool / enum |
| `r.routed` / `r.routedTo` | Inside a Router's range / the rack a Router dispatched its prompt to this tick | bool / id |
| `r.cacheLooked` / `r.cachedTokens` | Its one prefix lookup has been rolled / prompt tokens served from cache | bool / tokens |
| `r.kvModelId` / `r.kvTowerId` / `r.kvTransferSec` | The model holding its KV (a partly ingested prompt or its context) / the rack that produced its first token; P/D transfer still owed | id / real s |
| `r.homeTowerId` | The rack whose engine runs its decode (admitted before new prompts; other racks of its model help with spare capacity) | id |
| `r.recompute` | A streaming answer being re-prefilled by a rack of another model | bool |
| `r.thinkingMode` | The mode the first-token rack answered in (display) | instant / thinking |

### Model (`m`)
| Symbol | Meaning | Unit |
|---|---|---|
| `paramsTotalB` / `paramsActiveB` | Resident params (every MoE expert) / params read per token | B params |
| `isMoE` | Sparse mixture of experts | bool |
| `thinking` | Thinking support from the chat template: `always` / `hybrid` / `never` | enum |
| `isReasoning` | `thinking ≠ never` (its `qualityBy` is thinking-mode capability) | bool |
| `thinkTokens` | Hidden tokens per thinking-mode answer at full effort | tokens |
| `qualityBy[axis]` / `qualityByInstant[axis]` | Per-axis capability (thinking mode) / a hybrid's instant mode | 8..130 |
| `quality` / `spec` | Best axis value / its axis (display) | pts / enum |
| `layers` / `kvLayers` / `kvHeads` / `headDim` / `attn` | Architecture (display; KV math reads the two fields below) | count / enum |
| `kvBytesPerToken` | BF16 KV bytes per token over the KV-bearing layers only | bytes |
| `kvStateMbPerReq` | Constant per-request cache: sliding windows + linear/SSM state | MB |
| `nativeWeightBytes` | Release precision (bytes/param incl. block scales) | B/param |
| `contextWindowK` | Hard context window | K tokens |
| `longCtx` | Long-context skill | 0..1 |
| `alignment.safety` / `.refusalStyle` / `.overRefusal` | Layer-1 alignment | 0..100 / enum / 0..1 |
| `instructFollow` | Instruction following (display; SFT raises it) | 0..100 |
| `lineage.depth` | Post-training chain depth (roster bases are 0) | int |

### Hardware (`hw`) and the parallel plan (`p`)
| Symbol | Meaning | Unit |
|---|---|---|
| `gpus` | GPUs one board rack stands for | count |
| `bf16/fp8/fp4TflopsPerGpu` | Dense tensor rates per GPU (FP4 only on Blackwell) | TFLOPS |
| `hbmGbPerGpu` / `hbmTbsPerGpu` | HBM capacity / bandwidth per GPU | GB / TB/s |
| `tdpWattsPerGpu` / `tdpWatts` | Nameplate TDP per GPU / aggregate | W |
| `gpuHrUsd` | All-in rental rate of the rack (`gpuHrUsdPerGpu × gpus`) | $/hr |
| `cooling` | `air` or `liquid` (liquid needs a Liquid Cooling Loop) | enum |
| `p.g` / `p.tpDeg` / `p.stages` | GPUs per model copy / tensor-parallel degree `min(g, 8)` / pipeline stages `g / tpDeg` | count |
| `p.replicas` / `p.lanes` | Model copies `⌊gpus / g⌋` / decode lanes `replicas × stages` | count |
| `p.format` / `p.weightGb` / `p.draftGb` / `p.kvGbPerReplica` | Serving format, resident weights, spec-decode draft, usable KV — per copy | — / GB |

### Serving stack (`s.infra`, per-rack state)
| Symbol | Meaning |
|---|---|
| `scheduling.batch` / `.multiStep` / `.chunked` | Continuous batching / multi-step scheduling (count) / chunked prefill |
| `kv.utilization` / `.prefixHitCeil` / `.quantBytes` / `.offloadGb` / `.flash` | KV allocator quality / prefix-hit ceiling / KV element bytes / CPU-SSD tier / FlashAttention level |
| `disagg` | P/D disaggregation researched (racks can be pinned to a role) |
| `spec.enabled` / `.level` | Speculative decoding |
| `quant.fp8` / `.int4` / `.nvfp4` | Weight formats researched |
| `par.tp` / `.pp` / `.dp` / `.ep` | Tensor / pipeline / data / expert parallelism |
| `routing.kvAware` / `loraSlots` / `engineTier` | KV-aware routing / Multi-LoRA / engine (0 vLLM, 1 SGLang, 2 TensorRT-LLM) |
| `t.precision` / `t.role` / `t.loraHot` / `t.prefillDebtSec` | A rack's weight format (undefined = auto) / P/D role / unmerged adapter swap / prompt work owed to decode pools |
| `t.throttle` / `t.load` / `t.training` | Thermal throttle (0 = dark) / slot occupancy / requisitioned for research |

### Safety, economy & SLO
| Symbol | Meaning | Unit |
|---|---|---|
| `s.guardrailThreshold` | Global guard decision threshold (fixed at 0.5) | 0..1 |
| `redteamLevel` | Red-Team Eval levels owned | 0..2 |
| `refusalExposure` | Share of an archetype's benign traffic borderline enough to refuse | 0..1 |
| `pay` | Credits one outcome pays | credits |
| `gpuCost` / `energyCost` | The two lines of the operating bill | credits |
| `goodput` / `total` / `answered` / `answeredInSlo` | Wave counters (§3.9) | count |

## 2. Constants (from the code)

### 2.1 Economy and clocks (`config.ts`, `content.ts`, `campaign.ts`)
| Constant | Value | What it sets |
|---|---|---|
| `CREDIT_USD` | 1000 | 1 credit = $1000; build cost = `round(capexUsd / 1000)` |
| `TRAFFIC_SCALE` | 100000 | Real requests per request sprite (scales token revenue) |
| `COHORT_STREAMS` | 28 | Real concurrent streams one sprite places on every real rack a tile stands for |
| `RACKS_PER_TILE` | `TRAFFIC_SCALE / COHORT_STREAMS` ≈ 3571.4 | Real racks one board rack stands for (scales the bill) |
| `ENGINE_MAX_STREAMS` | 256 | Engine batch cap per lane: `⌊256 / 28⌋ = 9` sprites with Continuous Batching (1 before) |
| `SIM_TIME_SCALE` | 10 | Real seconds per board second |
| `SIM_DT` / `MAX_STEPS` | 1/60 / 5 | Fixed timestep (board s) / max steps per rendered frame |
| `CLEAR_BONUS_SCALE` | 0.12 | SLA contract value → credits |
| `CONTRACT_BASE` / `CONTRACT_PER_TIER` / `CONTRACT_BOSS_PREMIUM` | 160 / 40 / 320 | SLA contract value per wave |
| `RESEARCH_DATA_SCALE` / `RESEARCH_COMPUTE_SCALE` | 4 / 12 | Multipliers on every authored research node's Data and compute |
| `POSTTRAIN_COMPUTE_SCALE` | 2 | Multiplier on every Studio compute bill |
| `RESEARCH_MAX_SHARE` | 0.45 | Most of the online fleet's BF16 TFLOPS research may lend |
| `RESEARCH_TARGET_SECONDS` | 60 | Board seconds per "wave" in the research time preview |
| `POWER_USD_PER_KWH` | 0.10 | All-in industrial electricity price |
| `PUE_AIR` / `PUE_LIQUID` | 1.4 / 1.15 | Facility power usage effectiveness by cooling class |
| `IDLE_POWER_FRAC` | 0.3 | Share of nameplate an idle rack still bills as energy |
| `RACK_UTILIZATION` | 0.8 | Serving draw as a share of nameplate TDP (the kW meter) |
| `THROTTLE_FLOOR` | 0.2 | Speed an overheated rack keeps |

### 2.2 Start and board
| Constant | Value | What it sets |
|---|---|---|
| `START.cash` / `.trust` / `.sla` / `.data` | 300 / 100 / 100 / 0 | Starting meters |
| `START.basePower` / `.baseCooling` | 6 / 6 | Substation feed / house chillers (kW) |
| `TILE` / `GRID_COLS × GRID_ROWS` | 48 px / 24 × 11 | Board grid; a range of `R` tiles is `R × 48` px |
| Lanes | 4 | Ingress lanes into the central Trust Core (`LANE_PATHS`) |
| `LANE_SPEED` | 0.75 | Board speed = `def.speed × speedMul × TILE × LANE_SPEED` px/board s |

### 2.3 SLO bounds (`LAT_CLASS_SLO` + per-archetype overrides)
| Class | TTFT | TPOT | Archetypes |
|---|---|---|---|
| `IN` interactive | 400 ms | 40 ms | chat, comp, jailbreak |
| `NR` near-real-time | 2000 ms | 200 ms | rag, summ, reason, agent |
| `TO` throughput/offline | ∞ | ∞ | embed, batch |

| Override (`RequestTypeDef`) | Value |
|---|---|
| `comp.ttftSloMs` | 200 ms |
| `summ.ttftSloMs` | 6000 ms (the long-context bound) |
| `chat.ttfatSloMs` / `jailbreak.ttfatSloMs` | 4000 ms (time to first ANSWER token) |
| `comp.ttfatSloMs` | 400 ms |
| `agent.e2elSloMs` | 60000 ms (one agent step, output-guard tail included) |

### 2.4 Request archetypes (`REQUEST_TYPES`, base 2023 sizes)
| id | ISL / OSL | class | axis: line | `thinkMul` | `prefixShare` / cacheable | `refusalExposure` | hazards | $in / $out per Mtok | Trust / SLA penalty | Data |
|---|---|---|---|---|---|---|---|---|---|---|
| `embed` | 2000 / 0 | TO | general 10 | 0 | 0.3 / ✓ | 0 | — | 0.05 / 0.1 | 1 / 1 | 0 |
| `chat` | 512 / 256 | IN | chat 18 | 0.5 | 0.4 / ✓ | 1.0 | — | 0.3 / 0.9 | 2 / 3 | 1 |
| `comp` | 1500 / 150 | IN | coding 56 | 0.05 | 0.5 / ✓ | 0.1 | — | 1 / 3 | 4 / 4 | 2 |
| `rag` | 8000 / 512 | NR | general 50 | 0.5 | 0.6 / ✓ | 0.4 | — | 1 / 2 | 4 / 6 | 3 |
| `summ` | 12000 / 400 | NR | general 44 | 0.5 | 0.2 / ✗ | 0.3 | — | 1 / 2 | 3 / 5 | 3 |
| `reason` | 512 / 6000 | NR | reasoning 82 | 0 | 0.1 / ✗ | 0.5 | — | 1 / 5 | 6 / 5 | 3 |
| `agent` | 6000 / 800 | NR | agentic 82 | 1 | 0.7 / ✓ | 0.5 (unused: it always carries a hazard) | injection 0.3 | 3 / 12 | 7 / 11 | 4 |
| `batch` | 1000 / 4000 | TO | general 40 | 0.5 | 0.1 / ✗ | 0.2 | — | 0.5 / 1.5 | 1 / 2 | 4 |
| `jailbreak` | 600 / 400 | IN | general 38 | 0.5 | 0.1 / ✗ | 0 (adversarial) | jailbreak 0.7 | 0.5 / 1.5 | 9 / 3 | 1 |

Secondary difficulty axes are documentation only (`rag` reasoning 44, `agent` reasoning 66); combat judges `primaryAxis`.

### 2.5 Serving physics (`config.ts`, `effects.ts`)
| Constant | Value | What it sets |
|---|---|---|
| `MBU_DECODE` | 0.7 | HBM bandwidth utilization of a decode step |
| `MFU_PREFILL` / `MFU_DECODE` | 0.55 / 0.5 | Model-FLOPs utilization of prefill / a compute-bound decode step |
| `STEP_OVERHEAD_MS` | 1.0 | Per-step scheduler + sampling overhead (÷ 8 with multi-step) |
| `MOE_LAYER_OVERHEAD_US` | 50 | An MoE's per-layer routing kernels (router, top-k, permute, grouped GEMMs) per decode step; gpt-oss-120b alone on one H100 ≈ 250 tok/s |
| `MULTISTEP_STEPS` | 8 | Decode steps per scheduler call |
| `MAX_TP` | 8 | Widest tensor-parallel group a stream spans |
| `TP_EFFICIENCY` | {1: 1, 2: 0.9, 4: 0.8, 8: 0.65} | Per-stream scaling of bandwidth and compute |
| `ALLREDUCE_US` | 8 | One all-reduce; a TP step pays `2 × layers` of them |
| `ALLTOALL_US` | 12 | Expert-parallel dispatch + combine per MoE layer per step |
| `PP_HOP_US` / `PP_BUBBLE_MS` | 30 / 20 | Pipeline hand-off per extra stage per decode step / per prefill (TTFT) |
| `MOE_SHARED_FRAC` | 0.35 | Always-on share of an MoE's active params |
| `FRAMEWORK_GB` | 1.5 | Runtime overhead per GPU before KV |
| `FLASH_ACTIVATION_CREDIT_GB` | 0.5 | Per-GPU overhead FlashAttention gives back |
| `FLASH_PREFILL_GAIN` / `FLASH_KV_READ_GAIN` | 0.5 / 1.2 | Softer O(n²) prefill term / faster KV reads with FlashAttention |
| prefill super-linear divisor | 16000 | `1 + n / (16000 × (1 + 0.5·flash))` |
| `CHUNK_STEP_TARGET_MS` | 30 | Chunked-prefill step target |
| `CHUNK_MIN_STRETCH` | 0.25 | Least a chunk may stretch a long decode step |
| `CHUNK_MIN_TOKENS` / `CHUNK_MAX_TOKENS` | 256 / 8192 | Token-budget clamp |
| `CHUNKED_PREFILL_EFF` | 0.9 | Prefill efficiency kept by chunking |
| `SPEC_DRAFT_TOKENS` | 4 | Draft tokens verified per speculative step |
| `SPEC_DRAFT_VRAM_FRAC` / `SPEC_DRAFT_VRAM_MIN_GB` | 0.03 / 0.5 | Draft-head memory per copy (and its draft read per token) |
| `SPEC_TOKENS[axis]` | coding 2.4 · chat 2.0 · general 2.0 · agentic 1.9 · reasoning 1.7 | Mean tokens a speculative step yields at a small batch |
| `SPEC_FADE_START_STREAMS` / `SPEC_FADE_END_STREAMS` | 32 / 128 | Streams per lane where the speculative gain starts to fade / is gone (log-linear between) |
| `TRTLLM_KERNEL_GAIN` | 1.12 | TensorRT-LLM's MBU/MFU multiplier |
| `RADIX_HIT_BONUS` / `RADIX_HIT_CAP` | 0.10 / 0.80 | SGLang's prefix-hit lift / ceiling |
| `OFFLOAD_HIT_BONUS` / `OFFLOAD_HIT_CAP` | 0.12 / 0.90 | KV-offload tier lift / ceiling |
| `PCIE_RELOAD_GBPS` | 25 | Offloaded prefix reload bandwidth |
| `KV_TRANSFER_GBPS` | 50 | P/D KV hand-off bandwidth |
| `DISAGG_POOL_GAIN` | 1.1 | Rate gain of a role-pinned (prefill or decode) rack |
| `LORA_UNMERGED_SPEED` | 0.93 | Decode speed an unmerged hot-swapped adapter keeps |
| `CACHE_HIT_CAP` | 0.7 | Best a cache aura gives one request |
| `KV_ROUTE_MISS_RECOVERY` | 0.5 | Share of routed misses KV-aware routing recovers |
| Cache tower `cacheChance` | 0.35 (+`PREFIX_RESEARCH_HIT` 0.4 once Prefix Caching is researched) | Per-cache hit chance before the cap |

### 2.6 Weight formats (`effects.ts`)
| Format | Bytes/param | Tensor rate | Flat tax / >8K-token tax (only below release precision) |
|---|---|---|---|
| `bf16` | 2 | BF16 | 0 / 0 |
| `fp8` (W8A8) | 1 | FP8 | 0 / 0 (lossless) |
| `int4` (W4A16) | 0.53 | BF16 (weights dequantize) | 2 / 6 |
| `nvfp4` (W4A4) | 0.5625 | FP4 (Blackwell only; else FP8) | 1 / 2 |

Precision classes of a bytes/param figure: ≥ 1.5 → 16-bit, ≥ 0.75 → 8-bit, else 4-bit. An INT4 KV cache (`kv.quantBytes ≤ 0.5`) adds a 2-point penalty above 32K tokens.

### 2.7 Long context, thinking and calibration
| Constant | Value | What it sets |
|---|---|---|
| `LONGCTX_FILL_FREE` / `LONGCTX_MAX_PENALTY` / `LONGCTX_SKILL_RELIEF` | 0.25 / 24 / 0.75 | Window-fill quality penalty |
| `LCR_FULL` | 80 | AA-LCR % that counts as full long-context skill |
| `LONGCTX_FLOOR` | small 0.2 · general 0.5 · coding 0.5 · frontier 0.7 | Skill without an LCR cell |
| `THINK_TOKENS_MIN` / `MAX` / `FALLBACK` | 300 / 4000 / 1500 | Thinking-budget clamp / budget of an untimed thinker |
| `THINK_GAP_S` | 1 | Time-to-first-answer gap that counts as hidden reasoning |
| `ROSTER_FRONTIER_TOLERANCE` | 0.06 | Roster gate (135-checkpoint pool → 58 active) |
| Bridge `MIN_N` / equating floor | 60 / n ≥ 50 and r ≥ 0.97 | Fit trust floors (`scripts/aa-cells.mjs`) |
| Quality clamp | [8, 130] | Every quality value |

### 2.8 Safety (`safety.ts`, `effects.ts`, `content.ts`)
| Constant | Value | What it sets |
|---|---|---|
| `TAX_K` | none 0 · hard-refusal 9 · safe-completion 4 | Alignment tax weight |
| `HAZARD_HARDNESS` | jailbreak 0.35 · injection 0.55 · harmful 0.20 · pii 0.30 | Layer-1 self-handle hardness |
| `OVERREF_K` | encoder 0.06 · generative 0.10 · moderation 0.05 | Guard false-positive convexity |
| `NOVEL_RECALL_MUL` | encoder 0.45 · moderation 0.7 · generative 1.0 | Recall a family keeps on a novel attack |
| `HANDLED_ATTACK_TOKENS` | none 30 · hard-refusal 30 · safe-completion 200 | Answer length of a handled attack |
| `GUARD_VERDICT_TOKENS` | 3 | Tokens a generative guard emits per check |
| `GUARD_TURN_TOKENS` | 2048 | Cap on each side of the turn a guard reads |
| `GUARD_REF_TOKENS` | 512 | Prompt length the readouts quote a check at |
| `GUARD_SERVICE_MS` | 5 | Service hop + tokenization every guard check pays (included in the encoder's fixed figure, added to the generative roofline) |
| Red-team | v1: injection detection, ×0.7 false positives, +0.02 recall · v2: PII detection, +0.02 more | §3.6 |

| Guardrail | Family / side | Catches | `baseRecall` | Check cost | Range | Power |
|---|---|---|---|---|---|---|
| `guard_encoder` (Prompt Guard 86M) | encoder / input | jailbreak, injection | 0.975 | 10 ms fixed (a served encoder, service hop included) | 2.9 | 0.1 kW |
| `guard_llm` (Llama Guard 4 12B) | generative / both | jailbreak, injection, harmful, pii | 0.92 | 12B roofline on its own H100 (§3.6) | 3.0 | its H100's kW |
| `guard_mod` (moderation API) | moderation / both | harmful, pii | 0.88 | 120 ms fixed | 2.9 | 0.1 kW |

### 2.9 Outcome settlement (`resolve.ts`)
| Outcome | Pay | Trust | SLA |
|---|---|---|---|
| `served` | 100% of processed tokens | +0.25 | +0.15 |
| `sloMiss` | 50% (`SLO_MISS_PAY_SHARE`) | −0.25 × trustPen | −0.5 × slaPen |
| `bad` | 0 (refunded) | −0.5 × trustPen | 0 |
| `unsafe` | 0 | −trustPen × `safetyDamage` | 0 |
| `overRefused` | 0 | −0.25 × trustPen | −0.2 × slaPen |
| `unservable` | 0 | −trustPen | −slaPen |
| `leaked` | 0 | −trustPen (0 for an adversarial request) | −slaPen |

Every SLA penalty is multiplied by `s.modifiers.slaDamage`. `served` and `bad` also yield `r.data × dataMult` Data.

### 2.10 Hardware ladder (`HW_SPECS`; `HARDWARE_TIERS` is the in-place upgrade order)
| id | GPUs | BF16 / FP8 / FP4 TFLOPS per GPU | HBM per GPU | TB/s per GPU | W per GPU | Cooling | Capex → cost | $/hr (rack) | Range |
|---|---|---|---|---|---|---|---|---|---|
| `hw_edge` (L4) | 1 | 121 / 242 / — | 24 GB | 0.3 | 72 | air | $5K → 5 | 0.4 | 2.8 |
| `hw_standard` (L40S) | 1 | 362 / 733 / — | 48 GB | 0.864 | 350 | air | $16K → 16 | 1.0 | 3.0 |
| `hw_perf` (H100) | 1 | 989 / 1979 / — | 80 GB | 3.35 | 700 | air | $48K → 48 | 3.0 | 3.0 |
| `hw_frontier` (H200) | 1 | 989 / 1979 / — | 141 GB | 4.8 | 700 | air | $60K → 60 | 3.2 | 3.3 |
| `hw_pod` (DGX H200) | 8 | 989 / 1979 / — | 141 GB | 4.8 | 700 | air | $320K → 320 | 25.6 | 3.4 |
| `hw_superpod` (DGX B200) | 8 | 2250 / 4500 / 9000 | 180 GB | 8.0 | 1000 | air | $500K → 500 | 40 | 3.5 |
| `hw_giga` (GB200 NVL72) | 72 | 2250 / 4500 / 9000 | 192 GB | 8.0 | 1200 | liquid | $3M → 3000 | 360 | 3.6 |

Support buildings: Router 24 credits, range 3.6, 0.2 kW · Cache 20, range 3.0, 0.2 kW · Prompt Guard 14 · Llama Guard 40 · Moderation 18 · Power Plant 18 (+8 kW) · Cooling Tower 18 (+8 kW air) · Liquid Cooling Loop 90 (+75 kW liquid) · Training Lab 36. Selling refunds 60% of the current hardware's cost.

### 2.11 Post-training (`models.ts`, `METHOD_RECIPES`)
| Constant | Value | What it sets |
|---|---|---|
| depth damp | `1 / (1 + 0.15·depth)` | Gain decay with chain depth |
| `forgetDepthMul` | `1 + 0.5·max(0, depth − 1)` | Forgetting growth with chain depth |
| `CAPACITY_MARGIN` / `CAPACITY_PEER_SIZE` | 6 / 2 | Body ceiling: best base ≤ 2× its size, + 6 |
| size / data / sparsity / depth factors | `(activeB/8)^0.7` · `max(1, (totalB/8)^0.45)` · `1 + 0.12·√(total/active − 1)` · `1 + 0.6·baseDepth` | Run cost (floors 0.1 B on sizes) |
| `EFFORT_NOTCHES` | 0.25 · 0.5 · 1.0 · 1.5 · 2.0 | The only efforts a run may start at |
| alignment tax factor | rlhf 1 · cai 0.6 · other 0.8 | General-axis tax weight |
| alignment damp | `1 / (1 + 0.15·baseDepth)` | Safety gain and CAI cut decay down a chain (the first run lands in full) |
| safety gain | rlhf 28 · cai 26 · safety-target DPO 18 (× √effort × alignment damp, cap 100) | `alignment.safety` |
| over-refusal | CAI −0.04·√effort × alignment damp, floored at `OVERREF_FLOOR` 0.02 (→ safe-completion) · RLHF and safety-target DPO +0.05·√effort (none → hard-refusal) | `alignment.overRefusal` |
| SFT | `instructFollow += 8·√effort` (cap 100) | — |
| QAT / distill | release precision 0.5 and −2 on every axis / cap `min(teacher, student + 18)` | — |

| Recipe | relation | targets | gainScale / gainCap / taxScale / forgetScale | costCompute / costData | unlock |
|---|---|---|---|---|---|
| `cpt` | finetune | domain, longctx, general | 22 / 40 / 0 / 3 | 60 / 40 | `r_pt_cpt` |
| `rlhf` | finetune | safety, chat, general | 14 / 16 / 0.6 / 0.12 | 40 / 14 | `r_pt_pref` |
| `grpo` | finetune | reasoning, agentic | 28 / 40 / 0.05 / 0.15 | 18 / 8 | `r_pt_rl` |
| `cai` | finetune | safety | 12 / 14 / 0.25 / 0.08 | 16 / 9 | `r_pt_cai` |
| `distill` | finetune | reasoning, coding, agentic | 24 / (student cap) / 0 / 0.04 | 12 / 16 | `r_pt_distill` |
| `dpo` | finetune | chat, general, safety | 12 / 12 / 0.08 / 0.06 | 10 / 11 | `r_pt_pref` |
| `sft` | finetune | chat, coding, general, longctx | 16 / 14 / 0 / 0.08 | 6 / 8 | — (starter) |
| `qat` | quantized | general | 0 / 0 / 0 / 0 | 6 / 3 | `r_pt_qat` |
| `dora` | adapter | the five axes | 14 / 10 / 0 / 0.03 | 1.4 / 6 | `r_pt_lora` |
| `lora` | adapter | the five axes | 12 / 8 / 0 / 0.02 | 1 / 5 | `r_pt_lora` |
| `qlora` | adapter | the five axes | 11 / 8 / 0 / 0.02 | 0.8 / 5 | `r_pt_lora` |
| `merge` | merge | general | 0 / 0 / 0 / 0 | 0.2 / 4 | `r_pt_merge` |

### 2.12 Campaign (`campaign.ts`)
| Constant | Value | What it sets |
|---|---|---|
| `MAX_TIER` | 12 | Tier of the last authored waves |
| `VOLUME_FACTOR` | trickle 0.6 · steady 1.0 · heavy 1.55 · flood 2.3 · extreme 3.2 | Budget and cadence |
| `BOSS_BUDGET_MUL` | 1.25 | Boss budget over a regular wave |
| `STEP_CAP` / `BOSS_STEP_CAP` | 1.6 / 1.8 | Largest step of the load a wave brings (budget × its forced incident's volume) over the previous wave's |
| `BASE_INTERVAL` | embed 0.32 · chat 0.72 · comp 0.95 · rag 1.2 · summ 1.25 · reason 1.2 · agent 1.8 · batch 1.35 · jailbreak 0.95 | Seconds between spawns at steady volume |

`ERA_TOKEN_GROWTH` (prompt × / answer × by tier 12; an unlisted archetype uses 3 / 1.5), with the tier-12 sizes it produces:

| Archetype | prompt × | answer × | Tier 1 ISL / OSL | Tier 12 ISL / OSL |
|---|---|---|---|---|
| embed | 3 | 1 | 2000 / 0 | 6000 / 0 |
| chat | 5 | 2 | 512 / 256 | 2563 / 512 |
| comp | 5 | 1.33 | 1500 / 150 | 7508 / 200 |
| rag | 6 | 1.6 | 8000 / 512 | 47965 / 819 |
| summ | 8 | 2.5 | 12000 / 400 | 96007 / 1000 |
| reason | 4 | 2 | 512 / 6000 | 2049 / 12000 |
| agent | 8 | 1.25 | 6000 / 800 | 48031 / 1000 |
| batch | 3 | 2 | 1000 / 4000 | 2998 / 8000 |
| jailbreak | 5 | 1.25 | 600 / 400 | 2999 / 500 |

### 2.13 Incidents (`INCIDENTS`; multipliers on `s.modifiers`)
| id | Effect |
|---|---|
| `inc_cable_cut` / `inc_cloudflare_outage` / `inc_crowdstrike` | single-entry surge (`concentrate 1`), volume ×1.15 / ×1.3 / ×1.2 |
| `inc_pjm_capacity` / `inc_gas_turbine_spike` | powerPrice ×1.9 / ×1.6 |
| `inc_grid_curtailment` | powerCap ×0.85, powerPrice ×1.5 |
| `inc_interconnect_queue` | powerBuild 0 (no new Power Plant), powerPrice ×1.3 |
| `inc_nuclear_ppa` (good) | powerPrice ×0.6 |
| `inc_cooling_failure` | liquidCoolingCap ×0.55 (the Liquid Cooling Loops only) |
| `inc_water_drought` | coolingCap ×0.65 (both pools) |
| `inc_h100_shortage` / `inc_hbm_soldout` / `inc_export_ban` | buildCost ×1.8 / ×1.6 / ×2.0 |
| `inc_lead_times_ease` (good) | buildCost ×0.7 |
| `inc_price_war` / `inc_market_shock` | reward ×0.6 / ×0.7 |
| `inc_regulatory_audit` / `inc_jailbreak_storm` | safetyDamage ×1.6 / ×1.8 |
| `inc_data_poisoning` / `inc_contamination` | instant: Data × 0.5 / × 0.6 (floored) |
| `inc_viral_ghibli` (good) | volume ×1.4, reward ×1.2 |
| `inc_enterprise_demo` (good) | reward ×1.5, slaDamage ×1.8 |
| `inc_demand_lull` (good) | volume ×0.7 |

### 2.14 Forecast, readouts and telemetry
| Constant | Value | What it sets |
|---|---|---|
| `SURGE_SHARE` | 0.5 | Share of the fleet's lanes a single-entry surge reaches (the cap on its decode spread) |
| `ENTRY_SPAN_TILES` / `ENTRY_STEP_PX` | 1 / 6 | Entry racks: within 1 tile of first contact, path sampled every 6 px |
| `REACH_SPANS` | 1, 2, 3, 5, 8, 12, 20, 32 tiles | Spans past first contact the fleet's reach (decode spread) is sampled at |
| `ENTRY_DWELL_TILES` | 6 | Longest walk a request holds an entry slot for |
| `SPREAD` (lognormal σ) | TTFT 0.18 · TPOT 0.08 · TTFAT 0.3 · E2EL 0.25 | Scatter of each latency around its forecast |
| `MAX_PROMPT_UTIL` | 0.95 | Prompt-lane utilization cap in the estimate |
| `ON_TIME_USE` | 0.85 | A latency this far into its bound reads as comfortably on time (the picker's colour) |
| `ESTIMATE_SPRITES_PER_LANE` | 2 | "Busy rack" of the readouts (≈ 56 streams per copy) |
| `REF_IN_TOKENS` / `REF_OUT_TOKENS` / `REF_CONTEXT_TOKENS` | 1500 / 256 / 2048 | Reference request of the rack cards |
| `TELEMETRY_WINDOW` | 5 board s | Answers-per-second window |
| p95 | `sorted[min(n−1, ⌈0.95n⌉ − 1)]` | Latency percentiles |
| utilization EMA | `0.9·prev + 0.1·inst` | Fleet utilization |

## 3. Formulas (by subsystem)

### 3.1 Model capability: benchmarks → `qualityBy`
Every axis blends six Artificial Analysis cells (all 0–100 %, on the frozen 2026-06-21 reference scale):
```
chat      = 0.6·IFBench + 0.2·GPQA    + 0.2·LCR
general   = 0.6·GPQA    + 0.2·IFBench + 0.2·LCR
coding    = 0.6·SciCode + 0.2·TB-Hard + 0.2·IFBench
reasoning = 0.6·HLE     + 0.2·GPQA    + 0.2·LCR
agentic   = 0.6·TB-Hard + 0.2·IFBench + 0.2·LCR
qualityBy[axis] = primary present ? pwl(CURVES[axis], composite) : QUALITY_FLOOR[tier][axis]
pwl(b):  b ≤ b0 → q0·b/b0
         b ≥ bn → qn + (130 − qn)·(1 − e^(−1.5·(b − bn)/(130 − qn)))     # saturating tail, slope 1.5 at bn
         else   → linear between anchors ;   then clamp(round(q), 8, 130)
bench = { ...hand-authored card cells, ...AA_BENCH[id] }                 # AA wins where it has a number
```

| Axis | Anchors `[composite %, quality]` |
|---|---|
| general | [17.3, 19] [39.2, 69] [47.3, 80] [66.4, 89] [77.8, 97] [87.1, 104] |
| chat | [16, 19] [31.9, 69] [41.2, 80] [59.9, 89] [71.1, 97] [83.1, 104] |
| coding | [5.6, 8] [19.8, 53] [29.1, 80] [36.8, 86] [45.3, 92] [55.1, 110] |
| reasoning | [8.1, 28] [14.6, 72] [18.5, 84] [34, 94] [43.5, 106] [56.2, 122] |
| agentic | [5.6, 8] [9.8, 18] [21.4, 47] [30.1, 65] [47.1, 93] [59.4, 124] |

`QUALITY_FLOOR` (a defensive fallback; the bridges give every roster model all six cells): small 30/25/30/30/20 · general 55/45/50/55/40 · coding 50/60/45/50/55 · frontier 85/80/85/85/70 (chat/coding/reasoning/general/agentic).

**Cell resolution (`scripts/aa-cells.mjs`, committed fits in `data/aa-bridges.json`)**, per AA UUID, first match wins:
```
ref     the reference snapshot's value                                    (exact)
latest  the latest snapshot's value of a frozen eval (GPQA, IFBench, TB-Hard: identity)
eq      a re-scored eval mapped back by mean-sigma equating on same-UUID pairs:
          ref = max(0, a + b·latest),  b = σ_ref/σ_latest,  a = μ_ref − b·μ_latest
          LCR  a −0.6347  b 0.906   (n 414, sd 4.04)
          HLE  a  0.3348  b 0.9275  (n 503, sd 0.54)
          SciCode a −1.2607 b 1.0085 (n 77, sd 1.8)
bridge  OLS from measured cells only, first predictor set with all inputs measured and n ≥ 60,
        clamped to the target's observed range:
          GPQA    ← HLE + LCR + SciCode   (n 535, R 0.924, sd 7.5)
          SciCode ← HLE + LCR + GPQA      (n 535, R 0.92,  sd 5.6)
          IFBench ← LCR + HLE + GPQA      (n 448, R 0.838, sd 9.4)
          TB-Hard ← TB-2.1 + HLE + SciCode (n 144, R 0.967, sd 5.0); TB-2.1 itself imputed from
                    HLE + SciCode + LCR on 2026 releases when a model has neither
```
(The fallbacks with fewer predictors are listed in `data/aa-bridges.json`.)

**Instant mode (hybrids).** `qualityByInstant = qualityFromBenchmarks(instant cells)` through the same blends and curves. Instant cells come from AA's Non-reasoning row of the same checkpoint (an `instant` pin), else the per-cell pair fit over the 32 pinned pairs:
```
instant = min(thinking, max(0, a + b·thinking))
GPQA  −3.92 + 0.930·t   IFBench 16.44 + 0.407·t   LCR −0.75 + 0.727·t
SciCode 3.04 + 0.734·t  TB-Hard 0.24 + 0.799·t    HLE 3.83 + 0.274·t
```

**Long-context skill and thinking budget (load time):**
```
longCtx = lcr present ? round(clamp(lcr / 80, 0, 1), 2) : LONGCTX_FLOOR[tier]
thinkingOf(telemetry, support):
  support = never → isReasoning false, thinkTokens 0
  else            → isReasoning true,
                    gap = ttfat − ttft (AA telemetry on the pinned thinking variant)
                    thinkTokens = gap > 1 s ? clamp(round(gap × tok/s), 300, 4000) : 1500
```

**Roster gate (`withinFrontierTolerance`).**
```
frontier(size, axis) = max qualityBy[axis] over the pool with paramsTotalB ≤ size
keep(m) ⟺ ∃ axis: qualityBy[m][axis] ≥ (1 − 0.06)·frontier(paramsTotalB[m], axis)
```
The 135-checkpoint pool (52 hand-authored + 83 generated from `data/model-arch.json`) gates to 58 active checkpoints spanning 0.6B → 2.78T total params.

**Starter model (`DEFAULT_MODEL_ID`):** the smallest dense active checkpoint with `thinking ≠ always` whose instant vector (or `qualityBy` for a `never` model) minus its alignment tax clears the chat (18) and code-completion (56) lines and whose `qualityBy.general − tax` clears RAG's line (50). Fallback: the smallest dense non-reasoning model.

### 3.2 Weight formats, memory and the parallel plan
```
residentBytes(m, fmt) = min(m.nativeWeightBytes, FORMAT_BYTES[fmt])       # a release is never inflated
nativeFormat(m, hw)  = 16-bit → bf16 · 8-bit → fp8 · 4-bit → (Blackwell ? nvfp4 : int4)
formatAvailable      = fmt is the native format  OR  (researched AND (fmt ≠ nvfp4 OR Blackwell))
formatQuantizes      = precisionClass(residentBytes) < precisionClass(nativeWeightBytes)
formatQualityTax     = formatQuantizes ? PTQ_TAX[fmt] : 0                   # ptqBelowNative
servingFormat(rack)  = rack.precision if still available, else auto:
  auto = the available lossless formats sorted by (tensorRate × 10 − residentBytes), the first
         whose plan fits (else the first)
```
Parallel plan of a model on a rack in a format:
```
weightGb = paramsTotalB × residentBytes
draftGb  = spec ? max(0.5, 0.03 × weightGb) : 0
fw       = 1.5 − (flash ? 0.5 : 0)                                          # GB per GPU
g        = smallest power of two ≤ gpus with  weightGb + draftGb + g·fw < g·hbmGbPerGpu
maxG     = !tp ? 1 : !pp ? min(8, gpus) : gpus
blocker  = no g → 'vram' ;  g > maxG → (g ≤ 8 ? 'tp' : 'pp')
tpDeg = min(g, 8) ;  stages = g / tpDeg ;  replicas = ⌊gpus / g⌋ ;  lanes = replicas × stages
kvGbPerReplica = (g·hbmGbPerGpu − weightGb − draftGb − g·fw) × kv.utilization
kvUtilization  = 0.55 before PagedAttention, 0.96 after
```
KV of one stream, and of a cohort sharing a prefix:
```
kvPerReqGb(L)       = kvBytesPerToken × max(1, L) × (kv.quantBytes / 2) / 1e9 + kvStateMbPerReq / 1000
kvSharedGb(n)       = kvBytesPerToken × n × (kv.quantBytes / 2) / 1e9
cohortKvGb(L, k, n) = one + (k − 1) × (one − min(kvSharedGb(n), one))        # one = kvPerReqGb(L)
cohortFit(L, free, n) = one > free ? 0 : min(28, 1 + ⌊(free − one) / extra⌋)  # extra = one − shared
```
`kvBytesPerToken` (BF16) sums the growing layer groups of `data/model-arch.json`: full attention `layers × kvHeads × (headDim + vHeadDim) × 2`, MLA `layers × (latent + rope) × 2` (one tensor), CSA/HCA compressed and sparse-indexer keys `layers × dim / ratio × 2`. Sliding-window and linear/SSM layers grow nothing; their bounded windows and recurrent state are `kvStateMbPerReq`.

### 3.3 Prefill, the decode step and chunked prefill
```
tpEff = TP_EFFICIENCY[tpDeg] ;  engineEff = TensorRT-LLM ? 1.12 : 1
rate(fmt) = fp8 → FP8 · nvfp4 → FP4 (FP8 without FP4 hardware) · bf16, int4 → BF16
prefillTokS(n) = rate × 1e12 × tpDeg × tpEff × engineEff × 0.55
                 / (2 × paramsActiveB × 1e9 × (1 + n / (16000 × (1 + 0.5·flash))))
admissionDelaySec = (stages − 1) × 20 ms + (multiStep ? 4 × stepSec : 0)
```
One decode step of a lane carrying `b` streams with `kvGb` of KV (`laneStep`):
```
bw    = hbmTbsPerGpu × 1e12 × tpDeg × tpEff × engineEff × 0.7
flops = rate × 1e12 × tpDeg × tpEff × engineEff × 0.5
weightsRead = dense: activeB × bytes
              MoE:   (shared + union(b)) × bytes,  shared = 0.35·activeB,
                     union(b) = (totalB − shared) × (1 − (1 − f)^b),  f = (activeB − shared)/(totalB − shared)
              wide EP (ep ∧ MoE ∧ replicas > 1): (shared + union(max(b, rackStreams)) / replicas) × bytes
tMem  = (weightsRead + kvGb / (flash ? 1.2 : 1)) × 1e9 / bw / decodeThrottle(thr)
tComp = b × 2 × activeB × 1e9 / flops / thr
bg    = chunked ? (bgPrefillSec + chunkSec) / 0.9 / thr : bgPrefillSec / thr
fixed = 1 ms / (multiStep ? 8 : 1) + (MoE ? layers·50 µs : 0) + (tpDeg > 1 ? 2·layers·8 µs : 0)
        + (wide EP ? 2·layers·12 µs : 0) + (stages − 1)·30 µs
step  = (chunked ? max(tMem, tComp + bg) : max(tMem, tComp) + bg) + fixed
decodeThrottle(thr) = 1 − (1 − thr) × 0.85
speculative: fade(b) = b ≤ 32 ? 1 : b ≥ 128 ? 0 : ln(128 / b) / ln(4)       # the gain a batch of b keeps
             g = 1 + (SPEC_TOKENS[axis] − 1) × fade(b)                       # tokens a verify step yields
             draft = 4 × 0.03 × activeB × bytes × 1e9 / bw / decodeThrottle ;  verify = 5 × tComp
             specStep = combine(tMem + draft, verify) + fixed
             used when g / specStep > 1 / step   (it switches off once the gain is gone or compute binds)
per-user tok/s = (specOn ? 1 + (SPEC_TOKENS[axis] − 1) × fade(b) : 1) / step
LaneStep = { stepSec, specOn, specFade, computeBound, memSec = tMem (+ draft), compSec = tComp (or verify), fixedSec = fixed }
```
Background prefill (a decoding cohort's other `k − 1` prompts ingested over its answer):
```
bgPrefillSec = (k − 1) × max(0, tokensIn − shared) / outTokens / prefillTokS(tokensIn)
```
**Chunked prefill (token budget).** The budget is profiled at a reference load (two cohorts per lane, 1500-token prompts, 256-token answers, context 1628):
```
target = max(30 ms, step × 1.25)
budget = clamp(round((target − fixed − tComp − bg/0.9) × prefillTokS(0) × 0.9), 256, 8192)
prompt of T tokens: steps = T / budget ;  full = step with a budget-sized chunk
  wallSec = max(steps × full, step carrying T)           # one step at least
without chunked prefill: wallSec = T / (prefillTokS × thr), run exclusively (decodes stall)
```
Headline figures (`rackLoadEstimate`): `decodeTokSb1` is one stream alone (no KV, no speculation); `computeRoofTokS = lanes × flops / (2·activeB)`; the busy readout places 2 cohorts per lane at the reference request. Worked values on an H100 (paged KV, FP8 researched):

| Model, format | Plan | b=1 | busy (56 streams) per-user / rack | 1.5K prompt | Chunk budget |
|---|---|---|---|---|---|
| Qwen3.5 9B, BF16 | 1 GPU | 115 tok/s | 43 / 2.4K tok/s | 54 ms | 374 |
| Qwen3.5 9B, FP8 | 1 GPU | 207 tok/s | 75 / 4.2K (116 / 6.5K chunked) | 27 ms | 1164 |
| gpt-oss 120B, native MXFP4 at the FP8 rate | 1 GPU, 65.5 GB | 249 tok/s | 33 / 1.8K | 15 ms | 2549 |
| Qwen3.6 27B, FP8 (chunked) | 1 GPU | 80 tok/s | 42 / 2.3K | 81 ms | 256 |

### 3.4 Thinking mode
```
answerMode(m, def) = m.thinking = never OR def.outputTokens ≤ 0 → instant
                     m.thinking = always                         → thinking
                     hybrid → def.latClass = IN ? instant : thinking
qualityIn(m, mode) = mode = instant ∧ m.qualityByInstant ? qualityByInstant : qualityBy
hiddenTokens       = mode = instant ? 0 : round(m.thinkTokens × def.thinkMul)
```
Hidden tokens are added to `work` and `maxWork` at the first token, decode before the answer, grow KV, count toward E2EL and TPOT, and are never billed. Time to first answer:
```
ttfatReal = ttftReal + (wall time of the first hiddenTokens decoded)     # interpolated inside the tick
ttfatReal × 1000 > def.ttfatSloMs → sloMiss cause 'ttfat'
```

### 3.5 The combat tick (`combat.ts`, every board step; `realDt = dt × 10`)
**Hosts.** A server is a host when online, `throttle > 0`, not training, with a model whose plan fits. `slots = lanes × spritesPerLane` (`spritesPerLane = batch ? 9 : 1`), `window = contextWindowK × 1000`.
```
expectedSeq(r) = contextLen + work + (before first token ? hidden(model, r) : 0)
feasible(h, r) = expectedSeq ≤ window  AND  kvPerReqGb(expectedSeq) ≤ kvGbPerReplica
canHost(h, r)  = role matches the phase AND (r.kvModelId unset OR h.model = r.kvModelId) AND feasible
```
`kvModelId` is the model holding the request's KV: set on a partly ingested prompt and at the first token. **Hand-off** (`handOff`, before contact): a request with KV whose model has no rack in reach that could continue it, but a rack of another model in reach that could take it, starts over on that model — a prompt re-ingests from its first token (`prefill = tokensIn`, the cached prefix dropped), a streaming answer re-prefills its whole sequence (`prefill = contextLen`, `recompute`); its first token stands.

**First hardware contact.** A request in range of any host that `canHost` it is (a) counted as waiting — a prompt without a first token `queueSec += realDt`; an answer being re-prefilled `e2elReal += realDt`, `decodeSec += realDt` — whenever it is still unfinished after the tick, so waiting at a full rack is queueing even if another rack serves it later, and (b) screened once by the guards covering its lane (§3.6). Lane transit alone never counts.

**Admission** (every tick; candidates closest to the core first). For every rack in a request's range: `feasible` (else `windowBlocked`; a feasible one sets `fitSeen`), then `canHost`; a rack takes one more sprite while `used < slots` and one of its groups holds one stream's KV at `contextLen`.
```
group = Data Parallelism or one copy ? the whole rack : each copy (a cohort stays on its copy)
pass 1  every streaming answer on its home rack (homeTowerId: the rack that produced its first token;
        out of reach → the least busy rack of its model in reach becomes its home)
pass 2  every prompt on ONE rack among those in reach with room:
          no router: the soonest start = least queuedSec / lanes (ties: lower tower id)
          routed:    margin(h, r) = q(axis, mode) − longContextPenalty(contextLen) − r.difficulty
                     eta(h, r)    = queuedSec / lanes + promptSec + (work + (before first token ? hidden : 0)) × tpot1(h)
                     among margin ≥ 0 the smallest eta (ties: larger margin); else the largest margin (ties: eta)
          queuedSec += prompt seconds placed there (+ owed P/D prefill debt) ;  promptSec = prefill / (prefillTokS(ingest) × poolGain × thr)
pass 3  spare capacity: every other rack of an answer's model in reach co-decodes it
pick the group with the most free KV that holds one stream at contextLen
prefix lookup (once, cacheable, under a cache aura) → see below
k   = cohortFit(contextLen, free, sharedTokens) ;  reserve cohortKvGb(contextLen, k, sharedTokens)
sharedTokens = tokensIn × prefixShare × prefixHitChance
```
**Prefix cache.**
```
best   = max over covering caches of min(0.7, 0.35 + (Prefix Caching researched ? 0.4 : 0))
hbm    = min(0.7, best) ;  SGLang: min(0.8, hbm + 0.1)
         routed ∧ kvAware: min(max(hbm, 0.7, prefixHitCeil), hbm + (1 − hbm) × 0.5)
offload = offloadGb > 0 ? max(0, min(0.9, hbm + 0.12) − hbm) : 0
hit (u < hbm + offload): prefill = min(prefill, tokensIn − round(tokensIn × prefixShare))
                         offload hit: queueSec += kvSharedGb(cachedTokens) / 25 GB/s
```
**Prefill.** P/D: a prefill pool first pays its owed lane time (`debtShare = min(prefillDebtSec, lanes·realDt) / (lanes·realDt)`).
```
exclusive: prompts run back to back, each on the lane with the least used time (FCFS);
           rate = prefillTokS(ingest) × poolGain × thr / (embedding ? k : 1) ;  ingest = recompute ? contextLen : tokensIn
           left = (1 − debtShare)·realDt − used[l] (≤ 0 → the rest wait) ;  b = min(prefill / rate, left)
           done → firstToken(tDone = (used[l] + b) / (1 − debtShare)) ;  used[l] += b
           decode share of the tick = max(0, 1 − Σused / (lanes·realDt) − debtShare)
chunked:   prompts fill the lanes FCFS (least-used lane first); each takes promptOccupancy(T, budget)
           first token at start + wallSec ; decode share = mean over lanes of
           (chunkSteps × decodeStep + max(0, avail − used)) / realDt
poolGain = role prefill ? 1.1 : 1
```
**First token** (`firstToken`; a recompute instead resumes: `e2elReal += tDone`, `decodeSec += tDone`, the KV now this rack's model's).
```
ttftReal  = queueSec + tDone + guardInSec + admissionDelaySec(oneCohortStep)
ttftReal × 1000 > (def.ttftSloMs ?? class.ttftMs) → cause 'ttft'
kvTransferSec = role prefill ? kvPerReqGb(contextLen) / 50 GB/s : 0
embedding (maxWork 0): scored once by this rack (weight 1); no layer 1
else: layer 1 (§3.6), then hidden tokens are added (§3.4)
```
**Decode.** For each admitted decode job of a group (`share` from the prefill step):
```
rate      = (specOn ? 1 + (SPEC_TOKENS[axis] − 1) × specFade : 1) / step × decodeGain
decodeGain = (role decode ? 1.1 : 1) × (loraHot ∧ adapter ? 0.93 : 1)
perStream = rate × share × realDt
gen       = min(work, perStream × k / 28)          ;  work −= gen ;  contextLen += gen
sec       = gen / (rate × share)                   # physical seconds per stream
wall      = sec × 28 / k                           # a KV-limited cohort waits for its streams
first decode on a rack other than the KV holder: sec += kvTransferSec, wall += kvTransferSec
e2elReal += wall ;  decodeSec += sec
decode pool: the KV source owes ((k − 1) × (tokensIn − shared) × gen / maxWork) / (its prefill rate × 1.1)
stall: a decode with a slot and no token anywhere this tick → e2elReal += realDt, decodeSec += realDt
```
Latency is accounted per token at the producing rack's physical rate, so co-decoding one request on several racks of its model finishes it in fewer board ticks but never shortens its real latency (its E2EL is the serial per-token sum).

**Answer quality (token-weighted).**
```
each rack scores its generated tokens: qualTokSum += gen × margin(h, r) ;  qualTokW += gen
bestQuality = qualTokSum / qualTokW          # ≥ 0 correct, < 0 bad
```
**Delivery** (work = prefill = 0): output screening (§3.6), then
```
e2elReal += guardOutSec
TPOT: maxWork > 1 ∧ decodeSec / (maxWork − 1) × 1000 > class.tpotMs → 'tpot'
E2EL: def.e2elSloMs ∧ e2elReal × 1000 > e2elSloMs → 'e2el'   (also checked live with the output tail)
precedence: open hazard → unsafe ; adversarial (all cleared) → served ; bestQuality < 0 → bad ;
            sloViolated → sloMiss ; else served
```
A request that reaches the core unanswered is `unservable` when `windowBlocked ∧ ¬fitSeen` (a rack rejected it on a hard gate and no rack that saw it could ever hold it), else `leaked`. An over-refused request resolves at once.

### 3.6 Safety (two layers)
**Layer 1** (the model that produced the first token, rolled once):
```
alignmentTax(m)       = TAX_K[refusalStyle] × max(0, safety − 40) / 100     # subtracted from every axis
pSelfHandle(m, h, sev) = clamp01(safety / 100 − sev × HAZARD_HARDNESS[h])
benign:     P(over-refuse) = clamp01(alignment.overRefusal × refusalExposure)
hazardous:  each open hazard cleared with pSelfHandle
handled attack (adversarial, all cleared): work = maxWork = tokensOut = min(work, HANDLED_ATTACK_TOKENS[style])
```
**Layer 2** (guardrails screen by lane coverage):
```
covers(guard, lane) ⟺ the circle (guard.x, guard.y, range × 48 px) touches the lane polyline
stages per lane: one per family present (encoder → generative → moderation), each with its
  covering input-side and output-side towers
guardCheckMs(spec, T):
  encoder / moderation: checkLatencyMs (10 / 120)
  generative: (T / prefillTokS(T) + (3 − 1) / perUser(one cohort, T + 3)) × 1000 + 5 on its own H100 (ms)
guardScreenTokens: input = min(max(1, tokensIn), 2048) ;  output = input turn + min(tokensOut, 2048)
screenInput (first contact), per family: guardInSec += slowest input tower's check(input turn)
                                         guardOutSec += slowest output tower's check(output turn)  (not for embeddings)
  benign:    one false positive per family with an input side, P = overRefuse × refusalExposure
  hazardous: each open, unlocked hazard caught with the family's best recall (input towers)
screenOutput (delivery): families with an output side re-check open hazards; a family with
  only an output side rolls its false positive here
effRecall  = clamp01(baseRecall × (0.6 + 0.8·threshold) + 0.02·redteamLevel) × (novel ? NOVEL_RECALL_MUL[family] : 1)
overRefuse = OVERREF_K[family] × (redteamLevel ≥ 1 ? 0.7 : 1) × threshold²
categoryUnlocked: injection needs redteamLevel ≥ 1, pii ≥ 2; jailbreak and harmful always
```
At the fixed threshold 0.5 the recalls are the `baseRecall`s (+0.02 per red-team level) and the false-positive rates are 1.5% (encoder), 2.5% (generative) and 1.25% (moderation) before × 0.7 and × `refusalExposure`. Replicas of one family add coverage, never recall; distinct families compound. An input catch on an adversarial request resolves it `served` before any compute (no tokens processed). Generative check cost on an H100 (`guardCheckMs`):

| Prompt | 100 | 512 | 2048 | 4096 tokens |
|---|---|---|---|---|
| Llama Guard, BF16 | 32 ms | 53 ms | 139 ms | 139 ms (the turn is capped at 2048) |
| Llama Guard, FP8 researched | 20 ms | 31 ms | 78 ms | 78 ms |
| Prompt Guard encoder | 10 ms | 10 ms | 10 ms | 10 ms |

Compounding in expectation (the load forecast's helpers):
```
leak(h)  = (1 − pSelfHandle) × Π_families (1 − r_in)(1 − r_out)          # unlocked hazards; locked: 1 − pSelfHandle
           r = max over the family's towers catching h of effRecall × (1 − ns + ns × NOVEL_RECALL_MUL)
refusal  = adversarial or hazard-carrying → 0
           else 1 − (out > 0 ? 1 − overRefusal × exposure : 1) × Π_families (1 − overRefuse × exposure)
```

### 3.7 Power & cooling (`power.ts`)
```
serverPower = tdpWatts / 1000 × 0.8 × (fp8 ? 0.85 : 4-bit ? 0.85·0.95 : 1) × (spec ? 1 + 0.08·level : 1)
towerPowerKw = server: serverPower · Llama Guard: its H100's serverPower · support: powerDraw
powerCap = (6 + Σ Power Plant 8) × modifiers.powerCap
air pool    = (6 + Σ Cooling Tower 8) × coolingCap   → cools every rack that is not liquid-cooled
liquid pool = (Σ Liquid Loop 75) × coolingCap × liquidCoolingCap   → cools liquid racks only
liquid rack without a Loop: offline (and cannot be placed or upgraded into)
brownout: while Σ draw > powerCap, switch off servers by descending kW, then support buildings
throttle(pool) = heat ≤ cap ? 1 : max(0.2, cap / heat)
```
A rack's kW is its nameplate serving draw (RACK_UTILIZATION 0.8): an H100 rack 0.56 kW (0.48 FP8), a DGX H200 4.48 kW, an NVL72 69.1 kW (74.6 kW with speculative decoding, the most one 75 kW loop holds).

### 3.8 Economy (`effects.ts`, `resolve.ts`, `sim.ts`)
```
revenueUsd = (tokIn × priceIn + tokOut × priceOut) / 1e6
pay        = TRAFFIC_SCALE × revenueUsd × marketPriceMul / CREDIT_USD       (× 0.5 for sloMiss)
tokIn      = tokensIn − prefill remaining               # a cached prefix counts as processed
tokOut     = min(tokensOut, generated − hiddenTokens)   # hidden reasoning is never billed
price      = def price × rewardMul (incident reward)
```
The bill, per online server (dark or `throttle 0` racks pay nothing), per board second:
```
toCredits(usd/hr) = usd/hr × (10 / 3600) × RACKS_PER_TILE / 1000
gpuLine   = toCredits(gpuHrUsd − tdpWatts/1000 × 0.8 × PUE × 0.10)       # the rate minus embedded energy
energy    = toCredits(serverPower × (0.3 + 0.7·load) × throttle × PUE × 0.10) × powerPrice
load      = training ? 1 : t.load (slot occupancy) ;  PUE = liquid ? 1.15 : 1.4
Llama Guard rack: gpuLine + energy at load 1
$/Mtoken shown = rackHourlyUsd × 1e6 / (aggTokS × 3600) × generatedPerBilled          # per BILLED token
generatedPerBilled = Σ count × (out + hidden(m, def)) / Σ count × out   over the upcoming traffic's generating archetypes
                     (no traffic: the reference request, NR, thinkMul 0.5)
```
Example: an H100 rack is $3.00/hr = $2.92 GPU-hour line + $0.08 energy at full load; a Qwen3.5 9B FP8 rack serving 4.2K tok/s costs ≈ $0.20 per generated Mtok. On a chat wave that hybrid answers instantly and the card shows that $0.20; on near-real-time traffic it thinks first (≈ 1,000 hidden tokens before a 256-token answer) and the card shows ≈ $0.97 per billed Mtok.

The SLA contract paid at wave clear:
```
tierBonus(tier, boss) = round(160 + 40·tier + (boss ? 320 : 0))
contract = round(tierBonus × 0.12 × Goodput / 100)        # tier 1: 24 (boss 62) · tier 12: 77 (boss 115)
dataMult = 1 + 0.25 × Training Labs
lose ⟺ trust ≤ 0  OR  sla ≤ 0  OR  cash < 0   (checked every step during a wave)
```

### 3.9 Telemetry, SLO and Goodput (`telemetry.ts`)
```
total        += every terminal outcome
goodput      += served                                   # clean: correct, safe, on time, not refused
goodputPct    = total ? 100 × goodput / total : 100      # the live gauge, the report and the bridge
answered     += served / sloMiss / bad / unsafe with a first token (latency logged)
sloAttainPct  = answered ? 100 × answeredInSlo / answered : 100
p95 = sorted[min(n − 1, ⌈0.95·n⌉ − 1)] ;  answersPerSec = answers in the last 5 board s / 5
utilization: inst = Σ roof × load / Σ roof (roof = aggregate tok/s at full slots) ;  EMA 0.9 / 0.1
```

### 3.10 Research compute (`research.ts`)
```
research dataCost = round(authored × 4) ;  compute = round(authored × 12)     # infra, method unlocks, red-team
onlineFlops = Σ lit server racks' BF16 TFLOPS (browned-out / liquid-gated racks excluded) ;  cap = 0.45 × onlineFlops
requisitionPick: online racks by BF16 TFLOPS desc, each taken iff taken + its TFLOPS ≤ cap;
                 none fit and ≥ 2 online → the weakest; never the last online rack
rate = Σ lent TFLOPS × throttle ;  each active track gets rate / activeTracks
slot.progress += perTrackRate × dt (board s, waves only) ;  done at progress ≥ compute
applyInfraEffects: utilization / prefixHitCeil / specLevel / loraSlots / engineTier take the max ;
                   kvQuantBytes the min ; multiStep / offloadGb / flash add ; the rest set switches
researchUnlocked = not owned ∧ prerequisites ∧ no researched conflict ∧ (NVFP4: a Blackwell rack on the board)
preview: seconds = compute / (lent / (running tracks + 1)) ;  waves = seconds / waveSeconds ;  servingLoss = lent / onlineFlops
```

### 3.11 Post-training (Studio, `models.ts`)
```
baseDepth = base depth (a merge: max of the two parents' depths, so the order never matters) ;  depth (new) = baseDepth + 1
effort ∈ EFFORT_NOTCHES (startPostTrain rejects any other value)
uncappedGain = min(gainScale × √effort / (1 + 0.15·depth),  gainCap × max(0, (130 − base[axis]) / 130))
ceiling(body, axis) = min(130, 6 + max qualityBy[axis] over roster bases with paramsTotalB ≤ 2 × body)
gain = distill ? uncappedGain : max(0, min(uncappedGain, ceiling − base[axis]))      # safety target: 0
qualityBy[axis] = clamp(base + gain, 8, 130)
tax (safety target, rlhf, cai): general −= taxScale × factor × √effort  (unless general is the gain axis)
forget: every non-gain axis −= forgetScale × √effort × (1 + 0.5·max(0, depth − 1))
instant vector (hybrid): base instant + the same per-axis delta
merge: axes averaged (no gain, tax or forgetting); safety, overRefusal, instructFollow averaged;
       refusalStyle kept if shared, else hard-refusal; release precision = the higher of the two;
       thinking = same support ? it : hybrid; instant = mean of the parents' instant paths, or,
       when only one parent has one: path + min(0, merged − that parent's qualityBy) per axis
       mergeBlock: missing / self / different roster root / different body
distill: body = the largest roster base strictly smaller (active and total) ; each axis capped at
         min(teacher, student + 18) (instant likewise) ; window and longCtx = the smaller
qat: nativeWeightBytes = 0.5 ; every axis −2 (both vectors)
reasoning run (grpo, or target reasoning): never → always (a hybrid keeps its switch)
thinkTokens: merge = the larger ; a model that becomes a thinker with 0 gets 1500 ; never → 0
computeCost = costCompute × (max(0.1, activeB)/8)^0.7 × effort × 1000 × 2
              × (1 + 0.6·baseDepth) × (1 + 0.12·√(max(1, totalB/activeB) − 1))
dataCost    = round(costData × effort × (1 + 0.6·baseDepth) × max(1, (max(0.1, totalB)/8)^0.45))
tier: peak ≥ 95 or totalB ≥ 100 → frontier ; coding ≥ reasoning ∧ coding ≥ 60 → coding ; totalB ≤ 16 → small ; else general
```

### 3.12 Campaign scaling (`campaign.ts`, `sim.ts`, `actions.ts`)
```
waveBudget(tier, volume, boss) = round((11 + 4·tier) × VOLUME_FACTOR[volume] × (boss ? 1.25 : 1))
v[i] = volume of the incident wave i forces (1 if none) ;  eff[i] = budget[i] × v[i]    # campaignBudgets
budget[i] = min(waveBudget, ⌊⌈eff[i−1] × (boss ? 1.8 : 1.6)⌉ / v[i]⌋)
group: count = max(1, round(budget × weight / Σweight)) ;  interval = BASE_INTERVAL / √VOLUME_FACTOR
       delay = i × max(3, 7 − 0.25·tier)
ramp   = ((tier − 1) / 11)^1.5
workMul    = round(1 + (outGrowth − 1)·ramp, 2)
contextMul = round((1 + (promptGrowth − 1)·ramp) / max(1, √workMul), 2) × authored contextMul
complexityMul = round(1 + 0.02·min(max(0, tier − 1), 11), 2)
spawn: input  = max(1, round(ISL × contextMul × max(1, √workMul)))
       output = max(embed ? 0 : 1, round(OSL × workMul))
       difficulty = line × complexityMul
hazardMul  = min(1.45, 1 + 0.039·(tier − 1)) ;  severity = min(1, base × hazardMul)
novelShare = clamp(0.05·(tier − 2), 0, 0.5) ;  the k-th hazardous request of a burst is novel iff
             ⌊(k + 1)·share⌋ > ⌊k·share⌋                                       (no RNG draw)
single-lane surge: every burst pinned to lane hash(realEvent + name) mod 4
```
The authored curve these produce, counted as spawned (the forced incident's volume included): W1 9 requests (tier 1); late bosses W60 204, W70 219, W80 226 (its edge-outage retry storm on top), W90 235, W100 237 (the per-group rounding makes the sum differ slightly from the band budget). The steepest realized step is the W20 boss, ×1.85 after rounding. Tier 12 begins at W80; hazard pressure reaches ×1.429 and the novel share 0.5 there.

**Incidents** (rolled at every wave clear for the next wave, index `next`):
```
next < 2 → none
theme.incident ?? themedIncidentId(special) → forced
else boss, or (next + 1) % 10 = 0, or every 10th endless surge → a random hard (non-good) incident
     (a boss never gets a lane funnel or a volume surge on top)
else 60% → a random incident from the whole table
apply: modifiers[k] *= mods[k] ; concentrate → laneWindow = 1 random lane ; instant(s) now
startWave: count = max(1, round(count × volume)) ;  rewardMul × reward
clearWave: modifiers reset to 1, laneWindow cleared, then the next roll
```

### 3.13 Endless surges (`endless.ts`)
```
d = max(1, waveIndex − 99)
count      = 1 + 0.05·d          work = 1 + 0.035·d
complexity = 1.22 + 0.01·max(0, d − 2)
hazardMul  = 1.429 × (1 + 0.01·d)            novelShare = min(0.65, 0.5 + 0.005·d)
contract   = 960 + 40·d                     # wave 100's boss contract, + 40 a surge
bursts: 3–5 templates (weights chat 3, embed 2, comp 2, rag 2, reason 2, summ 1, batch 1, jailbreak 1, agent 1),
        at least one reason or agent
budget = 236 (wave 100's boss budget) × count
burst count = max(1, round(budget × max(w/Σw, hard ? 1/n : 0) × (1 + 0.2·U)))
interval = BASE_INTERVAL / √3.2 × (0.9 + 0.25·U) ;  delay = i × 4 × (0.85 + 0.3·U)
workMul = groupMuls(12).workMul × work ;  contextMul = groupMuls(12).contextMul      # U = s.rng.next()
```

### 3.14 Next-wave preview, runway and readiness (`preview.ts`, `ui/hud.ts`, `ui/nextWave.ts`)
```
estDurationSec = max over bursts (delay + (count − 1) × interval + longest lane length / speed)
fleetBurnPerSec = Σ towerOpexPerSec(load = 1) ;  projectedBill = fleetBurnPerSec × estDurationSec
runway (waves) = max(0, cash) / (burnPerSec × waveSec)
readiness per archetype, over the racks whose range touches its lanes (fits from the load forecast
at the whole mix):
  SMART = best margin ≥ 0 ;  FAST = some rack meets every bound ('na' without any bound)
  FITS  = some rack holds prompt + hidden + answer in its window and one copy's KV
  SAFE  = every hazard caught by a covering guard with its category unlocked, or self-handled
          with min pSelfHandle ≥ 0.9 across the covering models
```
Rack readouts (`ui/metrics.ts`, `ui/modelOverview.ts`), all on the same effects functions:
```
busy rack        = 2 cohorts per lane (min(spritesPerLane, 2) × lanes sprites) at context in + out/2
latencyOf        = prompt wall (promptOccupancy) + admissionDelay ;  TPOT = 1 / busy per-user rate
rack $/Mtoken    = dollarsPerMtokenAt(busy aggregate tok/s, load 1)       # the reference 1500 in / 256 out request
Model Overview   = per-user tok/s of one cohort on the smallest rack tier that holds the model
```

### 3.15 Load forecast (`loadForecast.ts`: the deploy picker's ★, fit rows, readiness, the demo)
Demand lines come from the wave's bursts (the incident volume folded in), merged per archetype at its hardest instance; each burst is `(start = delay, end = delay + (count − 1)·interval, rate = 1 / (interval × 10)` per real s, `count)`. The environment (`loadEnvOf`) samples, on every ingress lane in play, the serving racks a request meets as it walks:
```
entryByPath[p] = Σ lanes of the racks met within 1 tile of first contact, each shared by the lanes that meet it first
reach[k]       = Σ lanes of the distinct racks met within REACH_SPANS[k] tiles of first contact on any lane in play
fleetLanes     = Σ serving racks' lanes (racks a running project requisitions excluded; a surge × 0.5)
```
For one rack and model:
```
hidden, generated = out + hidden, ctx = in + generated / 2
cached = cacheable ? prefixShare × cacheHit ;  prompt = in × (1 − cached) ;  shared = in × cached
cacheHit = prefixHitChance(best cache, unrouted) × 0.5
kvSprite_j = min(kvLane, cohortKvGb(ctx_j, 28, shared_j))        # a whole cohort, or the lane when one does not fit
slots(w)   = clamp(kvLane / (Σ w_j kvSprite_j / Σ w_j), 1, spritesPerLane)   # the sprites a lane holds of the mix w
S0 = prompt wall time + generated × lightStep × 28 / k            # one sprite's occupancy
walk_j = speed_j × 0.75 / 10 tiles per real s ;  dwell_j = 6 / walk_j
in flight at t: raw_j = Σ active bursts min(rate × S_j, count) ;  T = Σ raw
spread(t) = clamp(max(reach(Σ raw_j × walk_j × S_j / T), T / slots(raw)), 1, fleetLanes)   # the racks requests meet while served
per lane = raw / spread                                           (Little's law)
pieces = each burst cut where the others start or finish; weight = arrivals in the piece
lane step at t: own cohort + min(slots − 1, max(minSprites − 1, per lane)) others (laneStep mix)
prompt lane at t:  pLanes = clamp(max(Σ entryByPath, T / slots), 1, fleetLanes)      # prompts gather on the entry racks
                   ρ = min(0.95, Σ rate·service / pLanes)
                   queue = Σ rate·service² / pLanes × (ρ / busy) / (2(1 − ρ))        # Pollaczek–Khinchine (mean)
                   util  = min(0.95, Σ rate·service / max(pLanes, spread)) ;  chunkRate = chunked ? steps·util/spread : 0
tpot  = 1 / (chunkRate + (1 − util) / step) / (specOn ? 1 + (SPEC_TOKENS − 1)·specFade : 1)
ttft₀ = prompt wall + admissionDelay + guardIn ;  ttfat₀ = ttft₀ + hidden × tpot × 28/k
e2el₀ = ttft₀ + generated × tpot × 28/k + guardOut ;  each reported with + queue
within = Π_bounds W(latency₀ / bound, σ_bound) × (1 − ρ·e^(−slack·ρ / queue))      # some prompts wait, most do not
         W(u, σ) = Φ((−ln u + σ²/2) / σ) ;  slack = min over bounds of (bound − latency₀)
entry slots of each ingress lane p: hold_j = min(S_j, dwell_j) ; ρ_j = Σ active min(rate × hold_j, count) / paths
         an arrival of line i finds every other line j holding ⌊ρ_j⌋ + Bernoulli(frac ρ_j) slots and its own line
         ⌊ρ_i⌋ + Bernoulli(frac ρ_i × mixed), mixed = the share of spawns now from other bursts
         queued_p = P(N ≥ ⌈entryByPath[p] × slots(hold)⌉) ;  wait = Σρ ≥ capacity ? dwell_i : meanHold / (capacity + 1)
         late = slack ≤ 0 ? 1 : e^(−slack / wait) ;  queued = mean over p
onTime = within × (1 − queued × late)
window = in + generated ≤ window ∧ kvPerReqGb(in + generated) ≤ kvGbPerReplica
effQ   = serverQualityVs(axis, mode) − longContextPenalty(ctx) ;  margin = effQ − difficulty
cleanShare = (!window ∨ (!adversarial ∧ margin < 0)) ? 0 : onTime × (1 − max_h leak(h)) × (1 − refusal)
deploy score = Σ count × cleanShare / Σ count ;  ★ = highest score (ties: judgedQ, then per-user speed)
speed chip = per-user tok/s of the generating archetype whose TPOT is nearest its bound at this load
```
Requests spawn at fixed intervals round-robin over the lanes, so arrivals are regular: a line spawning alone never collides with itself while its hold is shorter than its spacing on a lane. The single-archetype readouts (`readoutEnv`) assume a busy rack: 2 cohorts per lane, a 60 s wave, the board's worst-lane guards. `tests/forecast.test.ts` holds picker rows within 10 points of the share the sim serves on representative racks and eras.

### 3.16 Quality on the board
```
serverQualityVs(axis, mode) = qualityIn(m, mode)[axis] − formatQualityTax(m, fmt).flat − alignmentTax(m)
longContextPenalty(L) = 24 × (1 − 0.75·longCtx) × clamp((L/window − 0.25) / 0.75, 0, 1)^1.5
                        + (L > 8000 ? formatQualityTax(m, fmt).longCtx : 0)
                        + (L > 32000 ∧ kv.quantBytes ≤ 0.5 ? 2 : 0)
```
