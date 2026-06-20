# GPTD Math Reference

> New here? GPTD is a tower-defense game simulating an LLM-inference data center — start with the [README](../README.md). This file is the quick reference for every formula, constant, and variable the simulation uses.

Extracted from the **code** (the source of truth: `src/sim/**` + `src/config.ts`) and verified against it — not from prose. Order: variable glossary → constants → formulas by subsystem. The deeper design rationale lives in [BLUEPRINT.md](./BLUEPRINT.md); the real-world grounding in [REALISM.md](./REALISM.md) / [REFERENCE-DOSSIER.md](./REFERENCE-DOSSIER.md).

## 1. Variable glossary

### Meters & resources
| Symbol | Meaning | Unit |
|---|---|---|
| `s.meters.cash` | Cash; bankrupt if `<0` | credits |
| `s.meters.trust` | Trust meter; loss if `≤0` | 0..100 |
| `s.meters.sla` | SLA meter; loss if `≤0` | 0..100 |
| `s.data` | Accumulated training data | data |
| `s.utilization` | Rolling EMA fleet utilization | 0..1 |
| `s.fleetCapexUsd` | Total deployed fleet capex (telemetry) | $ |

### Request (`r`)
| Symbol | Meaning | Unit |
|---|---|---|
| `r.work` / `r.prefill` | Remaining decode (output) / prefill work | tokens |
| `r.contextLen` | KV sequence length (grows with output) | tokens |
| `r.context` | Required context demand for the quality gate | tokens |
| `r.tokensIn / r.tokensOut` | Input / output token counts (revenue) | tokens |
| `r.difficulty` / `primaryAxis` | Resolved difficulty line / axis judged on | 0..130 / enum |
| `r.bestQuality` | Best margin latched (≥0 correct, <0 bad, 999 cache hit) | pts |
| `r.safetyRisk` / `r.hazardsOpen[h]` | Max open hazard / per-hazard open severity | 0..1 |
| `r.safetyCleared` / `r.selfHandled` | All hazards cleared / layer-1 rolled | bool |
| `r.overRefused` / `r.windowBlocked` | Benign wrongly blocked / only met too-small windows | bool |
| `r.sloViolated` | TTFT/TPOT/E2EL breach | bool |
| `r.queueSec` / `r.ttftReal` / `r.e2elReal` | Real queue→TTFT / latched TTFT / running E2EL | s (real) |
| `r.data` | Base data yield (served/bad) | data |
| `r.slaPenalty / r.trustPenalty` | Per-request meter penalty weights | pts |

### Model (capability)
| Symbol | Meaning | Unit |
|---|---|---|
| `paramsTotalB` / `paramsActiveB` | Total (all experts resident) / active per token (MoE) | B params |
| `weightBytes` | Authored bytes/param (FP16=2) | bytes/param |
| `layers` / `kvHeads` / `headDim` / `attn` | KV-formula architecture fields (MLA flag) | count / enum |
| `contextWindowK` | Advertised context window | K tok |
| `qualityBy[axis]` | Per-axis quality (chat/coding/reasoning/general/agentic) | 8..130 |
| `quality` | Scalar = max over axes; `spec` = argmax axis | 8..130 / enum |
| `alignment.safety` | Intrinsic safety score | 0..100 |
| `alignment.overRefusal` | Layer-1 benign over-refusal prob | 0..1 |
| `alignment.refusalStyle` | none / hard-refusal / safe-completion | enum |
| `instructFollow` | Instruction-following score | 0..100 |
| `isReasoning / isMoE` | Thinking / MoE flags | bool |
| `depth` / `effort` | Lineage depth (base+1) / training effort notch | int / 0.25..2 |

### Hardware (rack, `hw`)
| Symbol | Meaning | Unit |
|---|---|---|
| `hbmGb` / `hbmTbs` | HBM/VRAM capacity / bandwidth | GB / TB/s |
| `bf16Tflops` / `fp8Tflops` | BF16 / FP8(INT4) tensor throughput | TFLOPS |
| `tdpWatts` / `gpuHrUsd` / `capexUsd` | Aggregate TDP / $/GPU-hr / deployed capex | W / $ / $ |
| `targets` | Concurrent batch slots offered by scheduler | slots |
| `cooling` | Cooling type (liquid mandates a Liquid Loop) | enum |
| `t.online` / `t.throttle` / `t.load` | Powered / per-tower speed / rack slot use | bool / 0..1 / 0..1 |

### Serving / roofline (`s.infra`)
| Symbol | Meaning | Unit |
|---|---|---|
| `weightQuantBytes` / `kv.quantBytes` | Serving PTQ weight / KV precision (2/1/0.5) | bytes |
| `kv.flash` / `kv.prefixHitCeil` / `kv.utilization` | FlashAttn level / prefix-hit ceiling / KV allocator (0.55→0.96) | level / 0..1 |
| `throughput` / `engineTier` | Scheduler throughput level / engine (0 vLLM, 1 SGLang, 2 TRT-LLM) | level / 0..2 |
| `spec.enabled / spec.level` | Speculative decoding flag / level | bool / level |
| `scheduling.batch / .multiStep` | Continuous batching / extra slots | bool / slots |
| `routing.kvAware` | KV-aware routing (Dynamo) | bool |
| `batch` (`b`, `n`) | Concurrent in-flight requests | count |
| `throttle` | Thermal throttle factor | 0.35..1 |
| `realDt` / `dt` | Real seconds this tick (=dt×10) / sim timestep | s |

### Safety
| Symbol | Meaning | Unit |
|---|---|---|
| `threshold` | Global guardrail strictness | 0..1 |
| `recall` / `overRefuse` | Effective per-hazard recall / over-refusal prob | 0..1 |
| `redteamLevel` | Owned red-team eval level | 0..2 |
| `alignmentTax(m)` | Capability cost of intrinsic alignment | pts |
| `severity` | Open hazard severity | 0..1 |

### Economy & SLO
| Symbol | Meaning | Unit |
|---|---|---|
| `serveRevenue` / `pay` | Per-request income / payout | credits |
| `opCost` | Per-tick fleet operating bill | credits |
| `s.marketPriceMul` | Market price multiplier (incidents) | x |
| `s.modifiers.powerPrice / .safetyDamage / .coolingCap` | Op-bill mult / Trust-damage amp / cooling-cap mult | x |
| `powerCap` / `coolCap` / `used` / `heat` | Electrical / heat-rejection capacity / draw / heat | kW |
| `goodput` / `goodputPct` | Clean-in-SLO served / attainment | count / % |
| `answersPerSec` / `p95` | Rolling answer rate / latency p95 | req/s / s |

## 2. Constants (from `config.ts` etc., verified)

### Economy / scaling
| Constant | Value | What it tunes |
|---|---|---|
| `CREDIT_USD` | 1000 | 1 credit = $1000; build cost = capex/1000 |
| `TRAFFIC_SCALE` | 100000 | Real streams per sprite; scales BOTH token revenue and op bill |
| `OP_COST_SCALE` | 0.036 | Calibrates real $/GPU-hr bill to playable (depth lever) |
| `CLEAR_BONUS_SCALE` | 0.08 | Rescales authored wave clear bonus into credits |
| `SIM_TIME_SCALE` | 10 | Real datacenter sec per board sec (dual clock); SLO judged on real axis |
| `SIM_DT` / `MAX_STEPS` | 1/60 / 5 | Fixed deterministic timestep (s) / max steps per frame |
| `FRAMEWORK_GB` | 1.5 | Per-rack VRAM overhead before KV |
| `RACK_UTILIZATION` | 0.8 | Utilization factor on nameplate TDP |
| `THROTTLE_FLOOR` | 0.35 | Min speed an overheated GPU keeps |
| `Mtok divisor` / `sec/hr` | 1e6 / 3600 | tokens×$/Mtok→USD / board-sec→real-hours |

### Start / board
| Constant | Value | What it tunes |
|---|---|---|
| `START.cash` | 300 | Starting cash |
| `START.trust / .sla / .data` | 100 / 100 / 0 | Starting meters (clamp [0,100]) / data |
| `START.basePower / .baseCooling` | 6 / 6 | Base substation feed / house chiller (kW) |
| `TILE` | 48 | px per grid tile; range px = range×TILE |
| `GRID_COLS / GRID_ROWS` | 24 / 11 | Board grid |
| `LANE_SPEED` | 0.75 | Per-type tile speed → lane speed |

### SLO classes (`LAT_CLASS_SLO`)
| Class | Value | Meaning |
|---|---|---|
| `IN` (interactive) | ttft 400 ms, tpot 40 ms | Chat / completion |
| `NR` (near-real-time) | ttft 2000 ms, tpot 200 ms | RAG / reasoning / agentic |
| `TO` (throughput/offline) | ∞ | No hard latency SLO (embed / batch) |

### Roofline / memory (`effects.ts`)
| Constant | Value | What it tunes |
|---|---|---|
| int4 PTQ threshold | weightQuantBytes ≤ 0.5 | INT4 active |
| tensor-rate select | bytesPerParam < 2 → fp8, else bf16 | Which TFLOPS figure |
| decode/compute roof factor | 2 | 2 FLOPs/param/token |
| superlinear divisor | 16000 | `1+n/16000` prefill O(n²) penalty |
| KV factor / MLA scaling | 2 / ×0.067 | K and V / MLA KV −93.3% |
| KV flash shave / prefix shave | ×max(0.55,1−0.08·flash) / ×max(0.6,1−0.12·prefixLevel) | FlashAttn / prefix KV reduction |
| kvUtilization default | 0.55 (→0.96 paged) | KV allocator quality |
| ctx-bonus coeffs | flash 0.14 / prefix 0.06 | Effective-window expansion |
| `serverContext` | min(100, 22·log2(K)) +14·flash +6·prefixLevel | Long-ctx UI score |
| engineMul | TRT 1.25 / SGLang 1.1 / vLLM 1.0 | Engine tier |
| speedMul coeff | 0.12 | (1+0.12·throughput)·engineMul |
| specMul | b≤1:2.0, b≤4:1.7, b≤16:1.66, b≥32:1.0 (16→32 lerp) | Spec-decode gain |
| bwMul flash coeff | 0.1 | Decode BW ceiling ×(1+0.1·flash) |
| int4ContextPenalty / int4Tax | −6 (int4 & ctx>8000) / −2 | INT4 long-ctx collapse / flat quality tax |
| decodeThrottle coeff | 0.25 | decode keeps ≥75% under throttle |
| serverPower fp8 / int4 | ×0.85 / ×0.95 | Quant power reduction |
| serverPower throughput / spec | ×(1+0.05·thr) / ×(1+0.08·specLvl) (frontier only) | Power lift |
| routeBonus kvAware lift / cap | ×(1+0.8) / decode +90% cap | KV-aware routing |
| cacheChance prefix coeff / cap | 0.2·prefixLevel / 0.95 | Prefix-cache hit chance |
| dataMult lab coeff | 0.25 | +0.25 data yield per Lab |
| cache hit sentinel / retry cd | 999 / 6 s | Cache hit always correct / miss cooldown |
| quality clamp | [8, 130] | All qualityBy bounds |

### Safety (`safety.ts`)
| Constant | Value | What it tunes |
|---|---|---|
| `TAX_K` | none 0 / hard-refusal 9 / safe-completion 4 | Alignment-tax weight by style |
| alignmentTax pivot | safety > 40, /100 | `TAX_K·max(0,safety−40)/100` |
| `HAZARD_HARDNESS` | jailbreak 0.35, injection 0.55, harmful 0.2, pii 0.3 | Self-handle hardness |
| `OVERREF_K` | encoder 0.06, generative 0.1, moderation 0.05 | Over-refuse convexity |
| effRecall | base·(0.6 + 0.8·threshold) + 0.02·redteamLevel | Recall floor / threshold gain |
| over-refuse redteam mult | 0.7 (once red-team owned, XSTest) | Lowers over-refusal |
| category gating | injection ≥L1, pii ≥L2, jailbreak/harmful always | Hazard catch unlock |

### Post-training (`models.ts`)
| Constant | Value | What it tunes |
|---|---|---|
| quality clamp `Q_LO/Q_HI` | 8 / 130 | Clamp; Q_HI also headroom ceiling |
| depthDamp coeff | 0.15 | `1/(1+0.15·depth)` diminishing returns |
| sizeFactor baseline / exp / floor | 8 / 0.7 / 0.1 | `(max(0.1,activeB)/8)^0.7` |
| computeCost mult | 1000 | `costCompute·sizeFactor·effort·1000` |
| `EFFORT_NOTCHES` | 0.25 / 0.5 / 1.0 / 1.5 / 2.0 | Effort multipliers |
| alignmentTaxFactor | rlhf 1 / cai 0.6 / other 0.8 | Per-method tax weight |
| safetyGain | rlhf 28 / cai 26 / other 18 (×√effort) | `alignment.safety` gain (cap 100) |
| CAI / crude-RL overRefusal | −0.04·√effort / +0.05·√effort | Pareto vs hard-refusal |
| SFT instructFollow | +8·√effort (cap 100) | Instruction following |
| QAT / distill | weightBytes→0.5, −2 each axis / cap = min(teacher, student+18) | INT4 QAT / distillation |

### Method recipes (`content.ts`) — gainScale / gainCap / taxScale / forgetScale / costCompute / costData
| Recipe | Values | Targets |
|---|---|---|
| `grpo` | 28 / 40 / 0.05 / 0.15 / 18 / 8 | reasoning, agentic (max gain; sets isReasoning) |
| `cpt` | 22 / 40 / 0 / 0.5 / 60 / 40 | domain, long-ctx, general |
| `distill` | 24 / ∞ / 0 / 0.04 / 12 / 16 | reasoning, coding, agentic (cap = min(teacher, student+18)) |
| `sft` | 16 / 14 / 0 / 0.08 / 6 / 8 | chat, coding, general, long-ctx |
| `rlhf` | 14 / 16 / 0.6 / 0.12 / 40 / 14 | safety, chat, general (max tax) |
| `dora` | 14 / 10 / 0 / 0.03 / 1.4 / 6 | PEFT |
| `dpo` | 12 / 12 / 0.08 / 0.06 / 10 / 11 | chat, general, safety |
| `cai` | 12 / 14 / 0.25 / 0.08 / 16 / 9 | safety (Pareto) |
| `lora` | 12 / 8 / 0 / 0.02 / 1 / 5 | PEFT (cheapest) |
| `qlora` | 11 / 8 / 0 / 0.02 / 0.8 / 5 | PEFT |
| `qat` | 0 / 0 / 0 / 0 / 6 / 3 | reshapes weightBytes→0.5 |
| `merge` | 0 / 0 / 0 / 0 / 0.2 / 0 | averages two same-family checkpoints |

### Research / telemetry
| Constant | Value | What it tunes |
|---|---|---|
| `RESEARCH_MAX_SHARE` | 0.45 | Max fleet FLOPS the research pool requisitions |
| `TELEMETRY_WINDOW` | 5 s | Rolling req/s window |
| p95 quantile | 0.95 | `index = ceil(n·0.95)−1` |
| answered set | served \| sloMiss \| bad | Goodput denominator |
| utilization EMA | 0.9·prev + 0.1·inst | Rolling fleet utilization |

### Outcome settlement (`combat.ts` / `movement.ts`)
| Outcome | Effect |
|---|---|
| served | cash += pay; data += r.data·dataMult; trust +0.25; sla +0.15 |
| bad | cash += pay; data += r.data·dataMult; trust −= trustPenalty·0.5 (no cash penalty) |
| slo_miss / over_refused | sla −= slaPenalty·0.5; trust −= trustPenalty·0.25; pay = 0 |
| unsafe (served) | trust −= trustPenalty·safetyDamage; pay = 0 |
| leak / unservable (core) | sla −= slaPenalty (full); trust −= trustPenalty (×safetyDamage if unsafe) |

## 3. Formulas (by subsystem)

### Hardware roofline & memory
```
bytesPerParam   = min(model.weightBytes, infra.weightQuantBytes)          # PTQ-effective
modelMemory     = paramsTotalB · bytesPerParam                            # resident weight GB (MoE: all experts)
serverFitsMemory: modelMemory + FRAMEWORK_GB ≤ hbmGb                      # VRAM gate
tensorTflops    = bytesPerParam < 2 ? fp8Tflops : bf16Tflops
kvPerReqGb      = 2·layers·kvHeads·headDim·max(1,contextLen)·kv.quantBytes / 1e9
                  ×0.067 (if attn=='MLA') ×max(.55,1−.08·flash) ×max(.6,1−.12·prefixLevel)
kvFreeGb        = max(0, hbmGb − modelMemory − FRAMEWORK_GB) · kvUtilization
decodeTokSb1    = (hbmTbs·1e12) / (2·paramsActiveB·1e9·bytesPerParam)     # b=1 bandwidth roof
computeRoofTokS = (tensorTflops·1e12) / (2·paramsActiveB·1e9)            # compute roof
prefillTokS     = computeRoofTokS / (1 + inputTokens/16000)             # compute-bound, O(n²)
speedMul        = (1 + 0.12·throughput) · engineMul     # TRT 1.25 / SGLang 1.1 / vLLM 1
specMul         = b≤1:2.0  b≤4:1.7  b≤16:1.66  b≥32:1.0  (16→32 linear; 1 if !spec)
aggDecodeTokS   = min(decodeTokSb1·speedMul·(1+0.1·flash)·specMul·max(1,b),
                      computeRoofTokS·speedMul·specMul)                  # batch-linear until compute binds
perUserDecode   = aggDecodeTokS(n) / n ;  tpotReal = 1/perUserDecode    # n = max(1,batch)
ctxWindowTokens = contextWindowK·1000·(1 + 0.14·flash + 0.06·prefixLevel)   # hard window
serverContext   = min(100, 22·log2(max(1,K))) + 14·flash + 6·prefixLevel    # UI long-ctx score
serverTargets   = !fits ? 0 : !batch ? 1 : hw.targets + multiStep        # concurrent slot cap
```

### Model capability (benchmark → quality)
Each axis is a **weighted blend** of benchmarks (primary 0.6 + two secondary 0.2). Inputs are
0–100% metrics normalized by their theoretical bound (the raw % IS the 0..100 value — stable
across snapshot refreshes). The weighted sum (a "composite %") is mapped to quality by a per-axis
curve. All six benchmarks come from Artificial Analysis (`aa-sync.mjs`): GPQA-D, IFBench, LCR,
SciCode, Terminal-Bench Hard, HLE.
```
composite[axis] = Σ weight · benchmark%        (primary 0.6 + secondary 0.2 + 0.2)
  chat      = IFBench·0.6 + GPQA·0.2 + LCR·0.2
  general   = GPQA·0.6   + IFBench·0.2 + LCR·0.2
  coding    = SciCode·0.6 + Terminal-Bench-Hard·0.2 + IFBench·0.2
  reasoning = HLE·0.6    + GPQA·0.2 + LCR·0.2
  agentic   = Terminal-Bench-Hard·0.6 + IFBench·0.2 + LCR·0.2
pwl(c):  c≤c0 → q0·(c/c0)            # linear to origin below first anchor
         c≥cn → qn + 1.5·(c−cn)      # gentle extrapolation above last
         else  → linear interpolate ;  finalize: clamp(round, 8, 130)
qualityBy[axis] = primaryPresent ? pwl(CURVES[axis], composite[axis]) : QUALITY_FLOOR[tier][axis]
quality = max over axes ;  spec = argmax axis
bench   = { ...handAuthored, ...AA_BENCH[id] }   # live Artificial-Analysis cells (the 6) override
```

Per-axis curve anchors `[composite%, quality]` (quantile-matched to preserve the difficulty
lines; chat≠general emerges from the different blends):

| Axis | Anchors |
|---|---|
| general | [17.3,19] [39.2,69] [47.3,80] [66.4,89] [77.8,97] [87.1,104] |
| chat | [16,19] [31.9,69] [41.2,80] [59.9,89] [71.1,97] [83.1,104] |
| coding | [5.6,8] [19.8,53] [29.1,80] [36.8,86] [45.3,92] [55.1,110] |
| reasoning | [8.1,28] [14.6,72] [18.5,84] [34,94] [43.5,106] [56.2,122] |
| agentic | [5.6,8] [9.8,18] [21.4,47] [30.1,65] [47.1,93] [59.4,124] |

`QUALITY_FLOOR` (missing-benchmark, per tier) `{chat, coding, reasoning, general, agentic}`:

| Tier | chat | coding | reasoning | general | agentic |
|---|---|---|---|---|---|
| small | 30 | 25 | 30 | 30 | 20 |
| general | 55 | 45 | 50 | 55 | 40 |
| coding | 50 | 60 | 45 | 50 | 55 |
| frontier | 85 | 80 | 85 | 85 | 70 |

### Roster selection (frontier-tolerance gate)
The ~98-model candidate pool (`ROSTER`) is trimmed to the active roster (`MODEL_DEFS`, ~42) by a
per-axis frontier-tolerance gate (`withinFrontierTolerance`, `calibrate.ts`). Let
`frontier(s, axis) = max qualityBy[axis] over pool models with paramsTotalB ≤ s` (the monotone
size↔quality Pareto frontier). A checkpoint is KEPT iff:
```
keep(m) = ∃ axis : qualityBy[m][axis] ≥ (1 − TOL) · frontier(paramsTotalB[m], axis)   # TOL = ROSTER_FRONTIER_TOLERANCE = 0.10
```
i.e. dropped only if it trails the frontier by >10% on EVERY axis (strictly beaten by something
no bigger, on all five lanes). `DEFAULT_MODEL_ID` = smallest kept model that is dense &
non-reasoning (deploys without a method gate). See docs/PARETO.md.

Request difficulty `difficulty[axis] / primaryAxis`:
`embed {general 10} · chat {chat 18} · comp {coding 56} · rag {general 50, reasoning 44} · summ {general 44} · reason {reasoning 82} · agent {agentic 82, reasoning 66} · batch {general 40} · jailbreak {general 38}`.

### Post-training (Studio)
```
depthDamp = 1/(1 + 0.15·depth)              # depth = base+1
headroom  = max(0, (130 − base[axis])/130)
gain      = max(0, min(gainScale·√effort·depthDamp, gainCap·headroom))     # 0 if target=='safety'
qualityBy[target] = clamp(base + gain, 8, 130)
tax     = taxScale · alignmentTaxFactor(method) · √effort                  # rlhf 1 / cai 0.6 / other 0.8 → general
forget  = forgetScale · √effort                                           # each non-target axis
merge:  qualityBy[a] = clamp((base[a] + other[a])/2)  # no gain/tax/forget; larger body; ctx = min
safetyGain = (rlhf 28 / cai 26 / other 18)·√effort → alignment.safety (cap 100)
CAI overRefusal −= 0.04·√effort (safe-completion) ;  crude-RL overRefusal += 0.05·√effort (hard-refusal)
SFT instructFollow += 8·√effort (cap 100)
isReasoning = method=='grpo' OR (target=='reasoning' && method!='merge')
distill: cap = min(base[a], student[a]+18) ; qualityBy[a]=clamp(min(qualityBy[a],cap)) ; swap to student body
QAT: weightBytes = 0.5 ; qualityBy[a] −= 2 (each)
sizeFactor  = (max(0.1, activeB)/8)^0.7
computeCost = costCompute · sizeFactor · effort · 1000 ;  dataCost = round(costData · effort)
estWaves    = ceil(computeCost / requisitionPerWave)
pickTier:   peak≥95 || totalB≥100 → frontier ; coding≥reasoning && coding≥60 → coding ; totalB≤16 → small ; else general
```

### Serve resolution & correctness
```
in_range     = (t.x−r.x)² + (t.y−r.y)² ≤ (def.range·TILE)²
routingMul   = 1 + min(0.9, Σ routeBonus)   routeBonus = def.routeBonus·(1 + (kvAware?0.8:0))
cacheChance  = min(0.95, def.cacheChance + 0.2·prefixLevel)   cacheBuff = 1 − Π(1−chance)
cache hit (cacheable & cd≤0 & roll cacheBuff): work=prefill=0, bestQuality=999, hazards cleared ; miss → cd = 6s
serverQualityVs(axis) = qualityBy[axis] − int4Tax(2 if int4) − alignmentTax(model)
effQ   = qualityBy[primaryAxis] − max(0, r.context − serverCtx)·0.45 − int4ContextPenalty(6 if int4 & ctx>8000)
margin = effQ − difficulty[primaryAxis]      # correct ⟺ margin ≥ 0 ; bestQuality = max(bestQuality, margin)
KV admission: admit if servedSlots==0 OR kvUsed + kvPerReq ≤ kvBudget
window block: contextLen > ctxWindowTokens(>0) → windowBlocked → unservable
batch = max(1, decodeJobs) ; perUserDecode = serverPerUserDecodeTokS(batch) ; tpotReal = 1/perUserDecode
prefillShare = prefillJob ? (chunked & decodeJobs>0 ? 0.35 : 1) : 0 ;  decodeShare = 1 − prefillShare
roleMul      = prefill ? 1.5 : decode ? 1.25 : 1                          # DistServe P/D pools
mul          = (primaryAxis==spec ? 1.6 : spec=='general' ? 1.0 : 0.65) · (routingMul if matched & routed)
prefill −= prefillRate · roleMul · throttle · prefillShare · realDt       # full thermal hit
work    −= perUserDecode · roleMul · dThr · decodeShare · mul · realDt    # dThr = 1−(1−throttle)·0.25
generated = decremented work → contextLen += generated ; e2el += generated·tpotReal
RESOLVE precedence: overRefused → (work|prefill>0 → wait) → unsafe (open hazard) → bad (margin<0) → slo_miss → served
```

### Safety (two layers)
```
alignmentTax(m) = TAX_K[refusalStyle] · max(0, safety−40)/100             # none 0 / hard 9 / safe 4
pSelfHandle(m,h,sev) = clamp01(safety/100 − sev·HAZARD_HARDNESS[h])       # jail .35 / inject .55 / harmful .2 / pii .3
layer-1 (once/request): benign → roll overRefusal → over_refused ;  else per hazard roll pSelfHandle → clear
effRecall   = clamp01(baseRecall·(0.6 + 0.8·threshold) + 0.02·redteamLevel)
overRefuse  = OVERREF_K[type] · (redteamLevel≥1 ? 0.7 : 1) · threshold²   # encoder .06 / generative .1 / moderation .05
layer-2 catch: per in-path guardrail, for catchable & unlocked hazard, roll effRecall → clear
              (injection ≥L1, pii ≥L2, jailbreak/harmful always)
guard latency: input/both → queueSec += latSec ; output/both → e2el += latSec
  generative guardLatencyMs = (300/prefillSpeed(300) + 23/perUserDecode(1))·1000 ; encoder ≈ 92 ms fixed
breach ⟺ any hazard reaches the core unhandled
```

### Power & cooling
```
powerCap = START.basePower(6) + Σ def.power
coolCap  = (START.baseCooling(6) + Σ def.cooling) · coolingCap
serverPower = (tdpWatts/1000)·RACK_UTILIZATION(0.8) ·(fp8?.85:1)·(int4?.95:1)·(1+.05·throughput)
              ·(frontier & spec ? 1+.08·specLevel : 1)        # serverHeat = serverPower
liquidGated: server needs-liquid hw but no Liquid Loop → forced offline
brownout: while Σdraw > powerCap → drop the highest-effDraw online server (support last)
throttle = heat ≤ coolCap ? 1 : max(THROTTLE_FLOOR(0.35), coolCap/heat)
```

### Economy ($/Mtoken, cost, outcomes)
```
revenueUsd   = (tokensIn·priceIn + tokensOut·priceOut) / 1e6
serveRevenue = TRAFFIC_SCALE · revenueUsd · marketPriceMul / CREDIT_USD
rackOpCost/s = gpuHrUsd · (REAL_SEC_PER_BOARD_SEC/3600) · TRAFFIC_SCALE · OP_COST_SCALE / CREDIT_USD
opCost(tick) = Σ_online rackOpCost/s · dt · powerPrice ;  cash −= opCost      # wall-clock fixed; idle racks bleed
dataMult     = 1 + 0.25·labs
clearBonus   = round(w.clearBonus · CLEAR_BONUS_SCALE(0.08))
loss ⟺ trust ≤ 0  OR  sla ≤ 0  OR  cash < 0
```
> **Cost-model note:** `opCost` is **only** the `$/GPU-hr` term. Capex, power, and cooling are **not** separately billed — capex is telemetry (`fleetCapexUsd`); power/cooling gate uptime (brownout/throttle), not the bill. The real `$/GPU-hr` rate implicitly bundles amortized capex + energy, so the docs' "capex amortization + $/GPU-hr + power + cooling" is the *conceptual* real-world cost; the code uses a single `$/GPU-hr` proxy.

### SLO & Goodput
```
realDt = dt · SIM_TIME_SCALE (×10)                       # SLO judged on the real-second axis
TTFT: on prefill≤0 → ttftReal = queueSec ; if ttftReal·1000 > (def.ttftSloMs ?? cls.ttftMs) → sloViolated
TPOT: if tpotReal·1000 > cls.tpotMs → sloViolated
E2EL: if def.e2elSloMs & e2el·1000 > def.e2elSloMs → sloViolated
answered = served | slo_miss | bad ;  goodput += (served & ¬sloViolated)
goodputPct = answered>0 ? 100·goodput/answered : 100
p95 = sorted[ min(n−1, ceil(n·0.95)−1) ] ;  answersPerSec = recentServes / 5s
```

### Research compute
```
fleetFlops  = Σ (server ? hw.bf16Tflops : 0)
pool        = anyResearchActive ? fleetFlops · RESEARCH_MAX_SHARE(0.45) : 0
selection   = servers by rackFlops desc, requisition until taken ≥ pool (browned-out excluded)
perTrackRate= min(rate, pool) / activeTracks
slot.progress += perTrackRate · dt ;  complete ⟺ ≥ slot.compute  (= max(1, computeCost) post-train, else def.compute)
applyInfraEffects: max(utilization, prefixCeil, specLevel, loraSlots, engineTier) ; min(kvQuantBytes, weightQuantBytes) ; add(multiStep, throughput, flash)
```
