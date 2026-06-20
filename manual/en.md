# GigaPrompt Tower Defense — Player Manual

This document is for players opening the game for the first time. You do not need to know anything about AI serving, and you do not need to read the design blueprint. Just remember one thing: GPTD is not a tower defense where you kill enemies — it is a **realistic LLM-inference data center** drawn as a tower-defense board. Waves of user requests arrive through four ingress lanes and converge on a central Trust Core; you do not kill them, you **serve** them — fast, cheap, correct, and safe — before they leak into the core.

The board is the metaphor; the numbers underneath are real. A request carries real token counts; a rack carries a real GPU's VRAM and bandwidth; the money is real $/Mtoken. The campaign is a **100-wave march through real 2023→2026 data-center history**, drawn as an escalating elimination gauntlet — hold the central Trust Core as deep as you can, then (if you reach the end) survive endless mode.

## Objective

Survive the **100-wave campaign**. Each wave dramatizes a real event from the 2023→2026 inference era — GPT-4, the H100 shortage, Mixtral MoE, Gemini's million-token context, o1 reasoning, DeepSeek R1 and the Jan-2025 market crash, Stargate, the EU AI Act, agentic coding, the inference price war — and the difficulty climbs **every wave**. It is an elimination gauntlet: most runs end mid-campaign, and reaching wave 100 (the final **Age of Inference** boss) is the apex. Clear it and **endless mode** generates ever-harder "Surge" waves where the difficulty never stops climbing — your score is how deep you get.

You lose the instant any one of three meters collapses:

- **Trust** — whether users believe in your platform. Wrong answers, unsafe answers, dropped requests, and over-refusing benign users all cost Trust.
- **SLA** — whether you serve on time. A request that walks its lane unserved leaks as a 504 timeout; a correct-but-late answer is a Goodput miss. Both cost SLA.
- **Cash** — whether the company still has runway. Buildings, rack upgrades, training, and the wall-clock operating bill (power, cooling, $/GPU-hr, capex) all cost money; only successful service earns it back. Go below zero and you are bankrupt.

Serving a request earns Cash (priced in real `$/Mtoken`) and Data, and slightly restores Trust and SLA. Clearing a whole wave grants a clear bonus.

## Display Modes: Normal and Expert

On the title screen you pick a display mode. Both run **exactly the same game** — same waves, rules, and difficulty. The only difference is how much of the platform's internals the UI shows. The choice is locked for the run and remembered next session.

- **Normal Mode** keeps the dashboards friendly: a rack's panel shows the loaded model, quality, speed, batch, power/heat, and the deploy/upgrade controls.
- **Expert Mode** opens the full SRE console — the real telemetry an inference team watches:
  - **TopBar** — Trust / SLA / Cash / Data plus live **Power vs Cooling** headroom in kW (red line at the limit).
  - **LiveOps strip** (during a wave) — the **Goodput** gauge (the headline metric: % of requests answered correctly, safely, and within their TTFT / TPOT / E2EL SLO), requests/sec, p95 in-service time, live **$/Mtoken**, and KV-cache pressure.
  - **Rack Inspect** — four cards per rack: HARDWARE (the real GPU, VRAM, HBM bandwidth, TDP, cooling), DEPLOYED MODEL (params total/active, per-axis quality), ROOFLINE (the prefill compute-bound vs decode bandwidth-bound bars, with the binding side flagged), and LIVE (batch, KV use, throughput).
  - **Request Inspector** — the selected request's input/output tokens, latency class, difficulty by axis, prefix share, and hazards.
  - **Wave Report** — an end-of-wave settlement: the six outcomes, Goodput, TTFT / TPOT / E2EL attainment, $/Mtoken vs the operating bill, and a per-archetype scoreboard.
  - **Model Overview + Lineage Graph** — every checkpoint you own (base + derived) with filter/sort, and the DAG of how your derived models descend from their bases.
  - **TechLab + Post-Training Studio** — the infra tech tree (by category) and the post-training method menu with the effort slider.

The small **Demo** button in the title panel starts a fixed-seed Expert run and lets the built-in autoplayer handle build planning, rack deployment, research, guardrails, and Studio runs. It is intended as a live tour of the expert UI and is balanced to survive deep into the 100-wave gauntlet while showing the major operations: rack upgrades through DGX H200, model deployment, infra/eval/post-training research, derived checkpoints, power/cooling, Liquid Cooling Loop, and P/D rack roles. (Like any run, the autoplayer is eventually eliminated by the escalation — that is the gauntlet working as designed.) During Demo, you can still click racks, requests, Models, and the Training Lab to inspect information; mutation actions remain controlled by the autoplayer.

If you are new, start in Normal Mode and switch to Expert when you want to know *why* a lane is slow — the roofline card and the Wave Report usually answer it.

## Basic Controls

| Action                       | How                                              |
| ---------------------------- | ------------------------------------------------ |
| Start the game               | Press START on the main menu                     |
| Choose a display mode        | Tap NORMAL / EXPERT on the title screen (locked during a run) |
| Place a building             | Tap a building button at the bottom, then tap a map cell |
| Place the same building again | The tool stays selected after placement         |
| Inspect a building           | Tap a placed building                            |
| Deploy a model onto a rack   | Tap a rack, then a checkpoint in the DEPLOY grid (free; only gate is fitting VRAM) |
| Upgrade a rack's hardware    | Tap a rack, then RACK → (pays the tier price difference) |
| Open the Post-Training Studio / tech tree | Build a Training Lab, then press TRAIN in the Build phase |
| Sell a building              | Press SELL in the inspect panel (60% refund of current value) |
| Start the next wave          | Press START WAVE, or Space                       |
| Pause a wave                 | Space mid-wave, or the pause button              |
| Adjust speed                 | 1 / 2 / 3 / 6 / 0 (=12x), or the speed button cycles 1x / 2x / 3x / 6x / 12x |
| Close a panel / deselect     | Escape                                           |
| Mute                         | M, or the sound button                           |

You build during the Build phase and can emergency-build mid-wave with cash. Research and post-training run only during the Build phase.

## Request Archetypes — the nine workloads

The old thematic enemies are gone. A request is now defined by its **workload physics**, not its costume. Each archetype carries real input/output token counts (ISL/OSL), a **latency class** (IN interactive · NR near-real-time · TO throughput/offline), a **per-axis difficulty** vector judged against the loaded model's `qualityBy`, a **prefix share** (how cacheable it is), and possibly **hazards**.

| Archetype | ISL → OSL (typical) | Latency class | Hard axis | Prefix | Hazard | The pressure it applies |
| --------- | ------------------- | ------------- | --------- | -----: | ------ | ----------------------- |
| **Embedding** (`embed`) | ~2000 → 0 | TO | general (easy) | 0.3 | — | Pure prefill, no generation — worthless alone, a flood in volume. |
| **Interactive Chat** (`chat`) | 512 → 256 | IN | chat (easy) | 0.4 | — | Balanced, high-volume. A small model on a fast rack soaks it all day. |
| **Code Completion** (`comp`) | 1500 → 150 | IN (TTFT 200 ms) | coding | 0.5 | — | Prefill-heavy and the strictest latency. A weak model ships bad code and bleeds Trust. |
| **RAG / Long-Context QA** (`rag`) | 8000 → 512 | NR | general + reasoning | 0.6 | — | A huge retrieved prompt. A Cache makes the prefill survivable; a small window rejects it outright. |
| **Summarization** (`summ`) | 12000 → 400 | NR | general | 0.2 | — | An extreme prompt, little reusable prefix — a relentless prefill bill that strains the context window. |
| **Reasoning** (`reason`) | 512 → 6000 | NR | reasoning (hard) | 0.1 | — | Extreme decode (long chain-of-thought). Only a thinking model clears the hardest reasoning lane. |
| **Agentic Task** (`agent`) | 6000 → 800 | NR (E2EL 9 s) | **agentic** (hardest) + reasoning | 0.7 | injection 0.3 | Autonomous, SWE-grade, multi-step tool use. Benchmarks have *not* saturated here — only a true frontier model, or one you trained yourself, closes the loop. |
| **Batch / Offline** (`batch`) | 1000 → 4000 | TO (no latency SLO) | general | 0.1 | — | Decode-heavy offline generation — pure throughput and $/token. Soak it whenever racks are free. |
| **Adversarial Prompt** (`jailbreak`) | 600 → 400 | IN | general (easy) | 0.1 | jailbreak 0.9 | The hazard carrier. The model must self-handle it or a guardrail must catch it, or an unsafe answer wrecks Trust. |

**Correctness is an axis match, not just "work reaching zero."** The judge compares the loaded model's `qualityBy[hard axis]` against the request's difficulty on that axis. Below it, you ship a `bad` answer: you still bill the request, but Trust drops. The **agentic** axis is special — its scores come from the un-saturated SWE-bench, so a tiny fast MoE that answers chat brilliantly can still fail every agentic request.

## Hardware — the real GPU ladder

A serving tower is two decisions: the **rack hardware** you build and upgrade, and the **model** you deploy onto it. The rack contributes real GPU specs (compute FLOPS, VRAM, HBM bandwidth, TDP, cooling); the model contributes its parameters, quality, and architecture.

The build bar sells two racks — **Edge** (cheap starter) and **Frontier** — and every new rack ships with **Llama-3.1-8B preloaded**. From a placed rack you **upgrade in place** along the ladder, paying the price difference each step:

| Rack tier (upgrade in place) | GPU | GPUs | VRAM | HBM bandwidth | TDP/GPU | Cooling |
| ---------------------------- | --- | ---: | ---: | ------------: | ------: | ------- |
| Edge GPU Rack (buildable)    | L4-class    | 1  | 24 GB  | 0.3 TB/s | 72 W   | air |
| Standard GPU Rack            | L40S-class  | 1  | 48 GB  | 0.86 TB/s | 350 W | air |
| Performance GPU Rack         | H100-class  | 1  | 80 GB  | 3.35 TB/s | 700 W | air |
| Frontier GPU Rack (buildable)| H200-class  | 1  | 141 GB | 4.8 TB/s | 700 W | air |
| DGX H200                     | 8× H200     | 8  | 1.1 TB | 38 TB/s (agg) | 700 W | **liquid** |
| DGX B200                     | 8× B200     | 8  | 1.5 TB | 64 TB/s (agg) | 1000 W | **liquid** |
| GB200 NVL72                  | 72× B200    | 72 | 13.8 TB | 576 TB/s (agg) | 1000 W | **liquid** |

Build cost is the **real capex** divided by 1000 (an Edge rack is a few credits; an NVL72 is ~3000). Two hard facts from real serving:

- **The roofline is two ceilings.** A rack **prefills** the prompt (compute-bound, super-linear at long context because attention is O(n²)) producing the time-to-first-token, then **decodes** tokens (bandwidth-bound, batched). HBM bandwidth — not raw FLOPS — is what makes decode fly, which is why H100/H200 are the workhorses. Expert Mode's roofline card shows both bars and which one binds.
- **Liquid cooling is a hard gate.** The liquid-cooled multi-GPU clusters (DGX H200, DGX B200, GB200 NVL72) **cannot be placed or upgraded into without a Liquid Cooling Loop** built first — those racks physically cannot be cooled by air. The single-GPU air-cooled tiers (up to a Frontier H200 rack) run anywhere you have power and cooling capacity.

## Models — real open weights, free to deploy

Open weights are a **download**, so deploying a model **costs nothing** and has exactly one gate: **VRAM**. The rack must hold the model's total parameters (`paramsTotalB` × bytes/param) — a 70B fits an H200; a 117B+ MoE needs a DGX pod; a 671B/1T frontier needs a DGX B200 or NVL72. There is **no architecture unlock to deploy**: MoE and reasoning are just model attributes (a thinking model's gain is already baked into its `qualityBy`). *(The Post-Training Studio's training methods — LoRA, GRPO, RLHF, … — do have their own research unlocks, but those gate what you can **train**, never what you can **deploy**.)*

The roster is real 2025–2026 open-weight models (Llama, Qwen3 dense + MoE, gpt-oss, Gemma 3, Phi-4, Mistral/Devstral, GLM-4.5-Air, DeepSeek-V3.1, Nemotron, Kimi K2). Each model's quality is **calibrated from public benchmarks** (Artificial Analysis / model cards), never hand-edited — so the ladder you see is the real one.

**MoE decouples memory from speed.** A Mixture-of-Experts model's VRAM tracks its **total** params (all experts resident) but its compute and decode speed track only its **active** params per token. That is why a 30B-A3B MoE serves like a 3B but answers like a 30B — the dream — *except* on the agentic axis, where a tiny active body genuinely falls short (its un-saturated SWE-bench score is the wall it cannot pass quickly).

## The Post-Training Studio — train your own

The old fixed finetune cards are gone. In the **Post-Training Studio** (in the Training Lab) you derive **your own checkpoints**, unlimited and iterative — you can even fine-tune a fine-tune. Pick three things:

1. **A base** — any model you own (base or a derived one).
2. **A method** — the real per-model menu:

   | Method | Kind | What it does |
   | ------ | ---- | ------------ |
   | **SFT** | finetune | The baseline; no research needed. Solid capability gain on chat/coding/general/long-context. |
   | **LoRA / QLoRA / DoRA** | adapter | The cheapest finetunes; one band of capability with almost no forgetting. |
   | **DPO** | finetune | Light, cheap preference tuning (chat/general/safety). |
   | **RLHF** | finetune | Strong safety/chat alignment — but the steepest quality tax and rising over-refusal. |
   | **CAI** (Constitutional AI) | finetune | A Pareto safety gain: raises safety *and* lowers over-refusal (safe-completion). |
   | **GRPO** | finetune | Reasoning RL — turns a base into a thinker; the strongest path to reasoning/agentic capability. |
   | **Distillation** | finetune | A big teacher into a smaller student base: cheaper to serve, capped below the teacher. |
   | **Merge** | merge | Average two same-family checkpoints — blend specialists with no retraining. |
   | **CPT** | finetune | Continued pre-training: broad domain/long-context gains, but the highest catastrophic forgetting. |
   | **QAT** | quantized | Train for INT4 inference: half the weight memory, faster decode, −2 quality. |

3. **A target axis** (chat / coding / reasoning / general / agentic / safety / long-context / domain) and an **effort** slider (more effort = more gain, but more compute, data, and waves to finish — with diminishing returns).

The run produces a **new derived model** with a snapshotted **lineage** (base, method, target, effort, depth) you can see in the Lineage Graph. Deeper chains get diminishing marginal gains and accumulating forgetting — there is no free infinite-quality glitch. This is your endless-mode quality ceiling: a GRPO-agentic run on a frontier base is your agentic specialist.

## The infra tech tree — serving only

Research (in the Training Lab) runs on **three independent tracks sharing one compute pool**: **infra** upgrades, **post-training** runs, and **eval** (red-teaming). A training run costs **Data up front** then **requisitions your strongest racks for GPU compute** during waves — they stop serving until the budget is met — so plan runs around the wave schedule.

The infra tree is **serving/infrastructure only** (it never touches model weights — model architecture is a property of the model). The 22 nodes follow the real serving history:

- **Scheduling** — Continuous Batching (the root of everything: ends the one-request-at-a-time era), Multi-Step Scheduling, Chunked Prefill **vs** P/D Disaggregation (hard-exclusive: chunked keeps decoding while ingesting; disagg splits prefill and decode into separate pools).
- **KV memory** — PagedAttention (utilization 30% → 96%, the root of KV efficiency), Prefix Caching (hit ceiling up to 85%), FlashAttention, FP8 / INT4 KV-quant, KV Offloading.
- **Decoding** — Speculative Decoding (a low-batch front-line multiplier that fades as batch grows).
- **Weight quant (PTQ)** — FP8 / INT4 (AWQ/GPTQ) / NVFP4 (Blackwell-only): less VRAM and cheaper decode bandwidth, distinct from per-model QAT.
- **Parallelism** — Tensor / Pipeline / Data / Expert (EP is the MoE serving win).
- **Routing / multi-LoRA / engine** — KV-Aware Routing, Multi-LoRA serving (S-LoRA), and the engine tier vLLM → SGLang → TensorRT-LLM.

## Two-layer safety

Hazard-carrying requests (`jailbreak`, and `agent` with prompt injection) must be **handled**, or an unsafe answer reaching the core wrecks Trust. There are two layers:

- **Layer 1 — model-intrinsic alignment.** Baked into the weights (by RLHF/CAI/safety-SFT). It self-handles hazards at **zero serving latency** but carries an **alignment tax** (lower quality) and an **over-refusal** risk. The gpt-oss family is the teaching contrast: high safety with *low* over-refusal and a small tax (safe-completion style) versus everyone else's hard-refusal. You cannot toggle it per-request — it is who the model is.
- **Layer 2 — guardrail buildings** (placed beside lanes, latency added to the request):

  | Guardrail | Type | Latency | Catches | Side | Cost on your racks |
  | --------- | ---- | ------- | ------- | ---- | ------------------ |
  | **Prompt Guard** | encoder (BERT 86M) | ~92 ms | jailbreak, injection | input | none — it does not occupy a rack |
  | **Llama Guard** | generative (12B) | a real (shorter) 12B inference | all four hazards | both | runs on its **own H100 rack** — draws real power and competes for batch |
  | **Moderation API** | vendor-hosted | ~120 ms | harmful, PII | both | none — off your racks |

  The crucial real contrast: the encoder is **milliseconds**; the generative guardrail is a **full inference** — one to two orders slower and it costs real serving resources.

A guardrail's **threshold** trades recall against **over-refusal**: turn it up to catch more, and it wrongly blocks more benign traffic (the `over_refused` outcome — revenue 0 and a light Trust hit). There is no free lunch. **Red-Team Eval** (the eval research track) is the real fix — it recalibrates guardrails to judge by *intent* not keywords, cutting over-refusal and unlocking injection/PII detection.

## The economy — real $/Mtoken

- **Income** is `$/Mtoken`: each archetype has an input and an output token price. Reasoning and agentic output sells at a premium; embeddings and chat sell cheap. A prefix-cache hit saves your prefill compute (and bills the cached input at a fraction), so caching is a real profit lever.
- **Operating cost** is real and **billed by wall-clock**: capex amortization + $/GPU-hr + power + cooling. Because the bill is fixed by time, not by tokens served, an **idle or over-provisioned rack bleeds money** and low utilization blows up your unit cost. Over-building is a real way to go bankrupt.
- **Six outcomes** settle every request:

  | Outcome | Meaning | Economy |
  | ------- | ------- | ------- |
  | `served` | correct, on time, safe | full $/Mtoken + Data + Trust/SLA up |
  | `slo_miss` | correct and safe but **late** (missed TTFT, TPOT, or E2EL) | zero cash (Goodput miss) + SLA hit |
  | `bad` | quality below the request's difficulty | still billed, but −Trust |
  | `unservable` | context exceeded the model's window, or leaked unfinished | leak: −SLA, −Trust |
  | `unsafe` | a hazard reached the core uncleared | heavy −Trust |
  | `over_refused` | a benign request wrongly refused (layer 1 or 2) | revenue 0 + −SLA + a light −Trust |

## Reading the Wave Report — what to fix next

The Wave Report is your postmortem. Start with the largest non-`served` bucket, then fix the matching subsystem:

| Report result | What it means | First fixes to try |
| ------------- | ------------- | ------------------ |
| `slo_miss` | The reply was correct and safe, but missed its latency contract. | If **TPOT** is high, decode is too slow: upgrade from L4 to Standard/H100, use a smaller-active model, FP8 Weight Quant, Speculative Decoding, FlashAttention, SGLang/TRT-LLM. If **TTFT** p95 is high, prefill or queueing is the issue: add rack coverage earlier on that lane or at the central merge, add more racks, use Cache/Prefix Caching, or split prefill/decode with the infra tree. |
| `bad` | The rack finished the request, but the model's quality was below that request's axis difficulty. | Match models to traffic: coding traffic wants Devstral, Qwen3-30B-A3B, Qwen3-32B, or a coding-trained checkpoint; reasoning wants a thinking model; agentic wants a frontier model or a GRPO-agentic derived model. A faster weak model still produces `bad`. |
| `unservable` | The request hit a hard model limit, usually context window / VRAM fit, and was never completed. | Deploy a model with a larger context window, use FlashAttention / Prefix / KV tech, or use FP8 Weight Quant and a bigger rack so the right model fits. This is not a speed problem first. |
| `unsafe` | A hazardous request was answered or leaked without being cleared. | Put the right guardrail before the Trust Core: Prompt Guard for jailbreak/injection, Moderation API for harmful/PII, Llama Guard for broad coverage. Also consider safer models or safety-targeted Studio runs. |
| `over_refused` | A benign user was wrongly blocked by model alignment or a guardrail. | Do not blanket every lane with heavy guardrails unless the wave needs it. Prefer lower-over-refusal models, CAI/safe-completion style safety, and Red-Team Eval to calibrate guardrails by intent. |
| `Timed out (504)` / `leaked` | The request reached the Trust Core before service completed. | Add coverage, add serving capacity, stop brownout/throttling, avoid running too much training during a wave, and use Router/Cache so the correct rack sees the request earlier. |

Two common traps:

- **Serving time starts at first hardware contact.** Lane travel before a request reaches its first server or guardrail is tower-defense positioning time, not TTFT/E2EL. Once it touches hardware, queueing, guardrail checks, prefill, and decode count.
- **Inspect latency is necessary but not sufficient.** A rack can show acceptable TTFT/TPOT in isolation, then still miss the wave because requests queue after entering rack range.
- **Speed and quality are separate.** A small model on a fast GPU may hit SLO but still be `bad`; a strong model on a slow rack may be correct but `slo_miss`.

## Incidents

After you clear a wave, the next wave's **Incident** appears in the banner — and unlike older builds, its effect is now **live** through the build phase and the wave. It is a build requirement, not backstory. The 21 incidents are drawn from real 2023→2026 events; the headline families:

- **Power spikes** — *Capacity Auction Shock* / *On-Site Fuel Spike*: the operating bill jumps ~1.6–1.9×. (And the rare *Firm Nuclear PPA* boon makes power cheap.)
- **Cooling shortfalls** — *Liquid Loop Fault* / *Water-Use Restriction*: cooling capacity drops 35–45% (expect throttling).
- **Supply shocks** — *H100 Allocation Crunch* / *HBM Sold Out* / *Chip Export Ban*: new builds cost 1.6–2.0× more. (*Lead Times Ease* makes them cheaper.)
- **Price wars** — *Token Price War* / *DeepSeek Market Shock*: revenue per request drops 30–40% — only high utilization stays profitable.
- **Safety pressure** — *Regulatory Audit* / *Adversarial Suffix Storm*: every unsafe answer costs 1.6–1.8× Trust.
- **Data integrity** — *Training-Data Poisoning* / *Eval Set Contamination*: your stored Data is cut.
- **Good fortune** — *Viral Demand Surge* (volume up, but each clean serve pays more), *Enterprise Demo Day* (+50% reward), *Firm Nuclear PPA* / *Lead Times Ease* (cheap power / cheap builds), *Off-Peak Demand Lull* (volume dips — a breather to catch up).
- **Single-entry surges** — *Undersea Cable Severed* / *Edge Provider Outage* / *Global IT Meltdown*: every request **funnels through one ingress lane** while the other three sit idle. Build serving + guardrails deep at the surge lane, not spread thin.

Real-event waves force their signature incident; other waves draw a random one (and every 10th wave guarantees a hard one). Add Cooling before a cooling fault; add guardrails before an audit or jailbreak storm; stock up before a shortage; concentrate capacity for a cable cut.

## Endless Mode

Clearing **Wave 100** (the *Age of Inference* boss — the apex of the gauntlet) unlocks **∞ CONTINUE — ENDLESS MODE**: procedural "Surge" waves where difficulty (request difficulty, volume, workload, reward) climbs every wave and every 10th surge guarantees a hard incident. Your roster tops out at the real frontier, but your **Post-Training Studio** does not — iterative finetune-of-a-finetune chains are how you keep your quality ahead of the rising difficulty line. Your score is the wave you reach.

## Opening Advice

### Wave 1 — Launch Day

Mostly Interactive Chat. Place 3–4 Edge racks near the first ingress lanes or the central merge; their preloaded Llama-3.1-8B handles chat fine. Keep a cash buffer for the operating bill.

### Wave 2 — Coding Boom

Code Completion starts testing quality, and 8B will get some wrong — survivable Trust bleed that tells you to **research**. Build the Training Lab and start **Continuous Batching** first (cheap, fast, and the single biggest early multiplier — it ends one-request-at-a-time serving). Then **PagedAttention** for KV headroom. Upgrade a rack and deploy a stronger model (Qwen3-32B, gpt-oss-20b, or a frontier MoE later — any model deploys as soon as it fits VRAM).

### Mid game — Mixed Traffic, Safety, Reasoning

You need specialization: a Router to get the right model on the right archetype; a Cache over your rack cluster for cacheable traffic (embed/chat/rag); guardrails (start with the encoder, add Llama Guard for the agentic/jailbreak surges); a Performance/Frontier rack with a real reasoning model; and power/cooling kept ahead of demand. Watch utilization — do not over-build idle racks.

### Late game and the agentic wall

The `agent` traffic is the real test. A fast cheap MoE answers everything else but loses agentic requests — you need a genuine frontier model *or* a **GRPO-agentic** checkpoint trained in the Studio. Before any DGX/NVL72 cluster (DGX H200, DGX B200, GB200 NVL72), build a **Liquid Cooling Loop** — those racks cannot run without it. Keep the priority ingress routes over-provisioned: one agentic timeout is catastrophic.

## Common Failures and Fixes

| Problem | Symptom | Fix |
| ------- | ------- | --- |
| Requests leak to the core | SLA drops fast | More rack coverage / batch (Continuous Batching, PagedAttention), or a Router |
| Trust slowly bleeds | Serving, but `bad` answers pile up | Model quality below the request's axis difficulty — deploy a stronger model or post-train one |
| Agentic lanes always fail | `bad` on `agent` even with a big MoE | The agentic axis is un-saturated — use a frontier model or GRPO-train an agentic specialist |
| Jailbreaks wreck Trust | `unsafe` at the core | Layer guardrails earlier; raise model alignment (RLHF/CAI); run Red-Team Eval |
| Over-refusing benign users | `over_refused`, Trust + SLA drop | Lower guardrail thresholds; prefer CAI (safe-completion) over hard-refusal RLHF; run Red-Team Eval |
| BROWNOUT | Racks drop offline | Add a Power Plant, or weight-quant to lower draw |
| THROTTLING | Everything slows | Add a Cooling Tower (or a Liquid Loop) |
| Can't place a high-density rack | DGX/NVL72 won't build or upgrade | Build a Liquid Cooling Loop first (the hard gate on every liquid-cooled DGX/NVL72 cluster) |
| Cash hits zero | Bankrupt despite serving | Too many idle/over-provisioned racks bleeding the wall-clock bill — right-size the fleet, raise utilization |

## Core Strategy

The key to GPTD is not "buy the biggest rack" — it is "serve every kind of traffic in the cheapest sufficiently-reliable way." The rack is the gun; the **model is the ammunition** you choose per rack; the Post-Training Studio is your gunsmith. Every wave, ask:

1. Does the next wave mainly test speed, quality, safety, or economy?
2. Can my power/cooling (and a liquid loop, if needed) support the next batch of racks?
3. Am I reserving my expensive frontier/agentic capability for the requests that actually need it, and keeping my utilization high enough not to bleed?

Answer those three and you are not stacking towers — you are running a real AI platform that can survive deep into the Age of Inference.
