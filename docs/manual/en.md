# GigaPrompt Tower Defense — Player Manual

This guide is for players opening the game for the first time. You do not need to know anything about AI serving to play. GPTD is a tower defense with one twist: you do not destroy what comes down the lanes, you **serve** it. Waves of user requests stream in through four ingress lanes toward a central Trust Core, and your towers are GPU racks, models, caches, routers and guardrails that answer each request correctly, safely and fast enough before it reaches the core.

Underneath the board the numbers are real. A request carries real token counts, a rack carries a real GPU's memory and bandwidth, a model's skill is calibrated from public benchmarks, and money is real dollars per million tokens. Playing well therefore means learning how language-model serving actually works: small models are fast and big models are smart, thinking buys accuracy with time, guardrails buy safety with latency, and batching trades one user's speed for everyone's throughput. The campaign replays real data-center history from 2023 to 2026 as an escalating elimination gauntlet, followed by an endless mode for anyone who survives it.

**Where to play:** open <https://jacoblincool.github.io/GPTD/> in any browser. It runs entirely client-side, with nothing to install. (Running from source instead? See the repo [README](../../README.md).)

## Objective

Hold the Trust Core for as long as you can. Every wave dramatizes a real event of the inference era — the chatbot boom, the GPU shortage, long-context documents, reasoning models, agents, grid emergencies, price wars, regulators and outages — and the pressure climbs from one wave to the next. Most runs end somewhere in the campaign; reaching the last wave is the apex, and clearing it opens endless mode, where the score is simply how deep you get.

You lose the moment any one of three meters gives out:

- **Trust** — whether users believe in your platform. Every failed request costs some Trust; unsafe answers cost the most.
- **SLA** — whether you keep your service promise. Late answers, refusals of harmless users, rejected requests and timeouts cost SLA.
- **Cash** — whether the company can pay its bills. Buildings and upgrades cost money up front, and every online rack bills by the clock while a wave runs, busy or idle. Below zero you are bankrupt.

A clean serve earns its token price and nudges Trust and SLA back up, and every answered request yields **Data**, the research currency. At the end of each wave your customers also pay an **SLA contract** in proportion to how much of that wave you served cleanly.

## The Seven Outcomes

Every request ends in exactly one of seven outcomes. Each has its own glyph, color, board popup and sound, so you can tell from across the board which way a request went and why. Hovering an outcome in the HUD tally or in Settings ▸ Audio repeats its plain cause.

| Outcome | Glyph · color | Board popup | Plain cause | Pay | Meters |
| ------- | ------------- | ----------- | ----------- | --- | ------ |
| **Served** | ✓ green | `OK` and a summed `+$x.xx` | Answered correctly, safely and within its latency SLO. A blocked or refused attack also counts as served: refusing it was the right answer. | full token price | Trust +, SLA + |
| **SLO-miss** | ◷ amber | `LATE · TTFT / TPOT / E2E / THINKING` | Right answer, too late: it missed a latency bound (the bound is named on the popup). | half price (the SLA credit) | small Trust and SLA loss |
| **Bad** | ✗ orange | `WRONG · <axis>` | The model scored below the request's difficulty on the axis it is judged on. | refunded (0) | Trust loss |
| **Unsafe** | ⚠ red | `UNSAFE` | An attack's harmful answer reached the user: no guardrail caught it and the model did not refuse it. | 0 | heavy Trust loss |
| **Over-refused** | ⊘ pink | `REFUSED · MODEL / GUARD` | A harmless request was refused, by the model's own alignment or by a guardrail. | 0 | light Trust and SLA loss |
| **Unservable** | ⇥ slate grey | `TOO LONG` | The prompt does not fit the context window or the KV memory of any rack in its path. | 0 | Trust and SLA loss |
| **Dropped (504)** | ↓ brick red | `504` | Nobody answered in time: it reached the core and timed out. | 0 | Trust and SLA loss (an attack that times out costs SLA only) |

The meter cost of each outcome scales with the request's archetype, so a dropped agent task hurts far more than a dropped embedding. The colorblind-safe palette (Settings ▸ Accessibility) swaps these colors for an Okabe–Ito-derived set; the glyphs never change, so meaning never rests on hue alone. Small chips fly from each result to the Cash, Trust and SLA meters, which pop as they land.

## Display Modes: Normal and Expert

On the title screen you pick a display mode. Both run **exactly the same game** — the same waves, rules and difficulty. The mode only decides how much of the platform's internals the interface shows. Your choice is remembered for the next session, and once the guided tutorial is finished (or skipped) you can switch modes mid-run from Settings ▸ Display.

| Surface | Normal Mode | Expert Mode |
| ------- | ----------- | ----------- |
| HUD | Trust, SLA, Cash with runway, Data, Power and Heat in kW, the next-wave title and the live outcome tally | the same, plus MODELS and METRICS buttons |
| Next-wave card | plain lines ("instant reply · needs Coding 58") | technical lines (latency class, judged axis and threshold, token counts) |
| Rack inspect | Overview in plain words ("Fast enough for", "Smart enough for", refusal and self-handle rates), Deploy picker | Overview cards (HARDWARE, DEPLOYED MODEL), Deploy picker, and a Telemetry tab (ROOFLINE, ESTIMATE, live batch and KV) |
| Request inspector | plain diagnosis ("smart enough? ✓"); "waiting for a rack" until a rack takes the request on | the full diagnosis: tokens, TTFT so far, TPOT, judged axis, margin, guards passed, hazards; the same "waiting for a rack" status until a rack takes it on |
| Wave report | a compact summary: outcome bar, "Too slow · Wrong · Unsafe · Refused" counts, net cash and FIX NEXT | the full report: Goodput, outcome bar, Trust and SLA lost per outcome, which bound late answers missed, who refused, TTFT / E2E / TPOT, unit cost, income and the SLA contract, the operating bill split into GPU-hours and energy, a per-archetype table and WHY lines |
| Board | everything below | adds a KV gauge on each rack, tags on racks that differ from the rest of the fleet, and a "?" badge on requests that are being answered wrongly |
| Model Overview + Lineage Graph | — | every checkpoint you own, filterable and sortable, with the family tree of your derived models (K) |
| Fleet Telemetry | — | six live charts: Goodput, requests/s, p95 latency, $/Mtoken, KV utilization, fleet utilization (` or Tab) |

The Training Lab, the Post-Training Studio, the Codex and the notifications work the same in both modes.

The small **Demo** button on the title panel starts a fixed-seed Expert run at 12× and lets the built-in autoplayer play it: it upgrades racks up to 8-GPU systems, picks models with the deploy picker's own forecast, researches the serving stack, places routers, caches and guardrails, and trains Constitutional-AI and GRPO specialist checkpoints in the Studio. It survives deep into the campaign and is eventually eliminated, like any run. During the demo you can still click racks, requests, Models and the Training Lab to read them; the autoplayer keeps control of every action, and a button that would change the run says so and does nothing. The **Agent** button hands the run to a terminal agent over a local bridge instead (see [AGENT-BRIDGE.md](../AGENT-BRIDGE.md)): the agent narrates each move in the Codex bubble, which stays visible over the wave report, and your clicks only inspect, as in the demo.

If you are new, start in Normal Mode and switch to Expert when you want to know *why* a lane is slow — the roofline card and the wave report usually answer it.

## Basic Controls

Every hotkey binds to the physical key position, so the layout is the same on any keyboard layout and under an IME. Key caps appear as badges on the build bar and buttons (Settings ▸ Gameplay ▸ Hotkey Badges), and **H** or **?** opens the full sheet in game; How to Play in the system menu lists the same table.

**Mouse and touch**

| Action | How |
| ------ | --- |
| Start the game | START on the title screen, or Space / Enter |
| Choose a display mode or language | the NORMAL / EXPERT buttons and the language button on the title screen |
| Place a building | pick it on the build bar, then click a tile beside a lane; the tool stays selected for the next one |
| Preview a placement | hover a tile with a tool: a ghost of the building, the lane stretch it would cover, the racks a Cache or Router would reach (or "no rack in range"), and its power draw |
| Paint a row | drag with a support building held; hold Shift to paint racks |
| Cancel a tool or deselect | right-click, or Esc |
| Inspect a building | click it; the panel docks on the side of the board away from it. Hovering shows its range ring and a one-line card |
| Inspect a request | click its packet (both modes) |
| Deploy a model | select a rack, open the DEPLOY tab, click a checkpoint (free; between waves) |
| Deploy to many racks | Shift-click a checkpoint (or its ALL ×N button) for every rack of this tier; Shift+Ctrl/⌘-click for every rack it fits |
| Upgrade a rack | RACK → in the inspect panel (pays the price difference; between waves); UPGRADE ALL moves every rack of this tier up one step, as far as cash allows |
| Change a rack's weight format | the Weights button in the inspect panel (between waves; shown when more than one format is possible) |
| Sell a building | SELL (a second press confirms while Confirm Before Selling is on); 60% of its current value back |
| Open the Training Lab / Studio | build a Training Lab, then TRAIN on the build bar (between waves) |
| Start the next wave | START WAVE |
| Pause / resume | the pause button (during a wave) |
| Change speed | the speed button steps up and wraps; right-click it to step down |
| Mute | the speaker button |
| Open the system menu | the gear button, or Esc with nothing to cancel |
| Scroll a list | mouse wheel or drag |
| Touch | tap a tile to preview the ghost and cost, tap it again to build; long-press for a tooltip; hold briefly before dragging to paint |

**Keyboard**

| Key | Action |
| --- | ------ |
| Space | start the next wave · pause / resume during a wave · start from the title |
| Q W E R T Y U I O P | pick a building from the build bar, left to right (press again to drop it) |
| Esc | drop the tool or deselect; again opens the system menu; inside menus, go back |
| , and . | select the previous / next rack |
| G | toggle every coverage ring (racks included); hold Alt to peek |
| Z | upgrade the selected rack's hardware |
| X | sell the selected building (press twice to confirm while Confirm Before Selling is on) |
| C | copy the selected rack's hardware, model and role as a blueprint, then click tiles to place copies (Esc drops it) |
| V | cycle the selected rack's role: auto / prefill pool / decode pool (needs P/D Disaggregation; between waves) |
| [ and ] | switch the selected rack's tabs (Overview / Deploy / Telemetry) |
| PgUp / PgDn | page the deploy picker |
| 1 2 3 6 0 | game speed 1× 2× 3× 6× 12× |
| − and = | one step slower / faster |
| F | toggle between 1× and your last fast speed |
| M | mute / unmute |
| L | open or close the Training Lab (between waves, with a Lab built) |
| K | open or close the Model Overview (Expert) |
| ` or Tab | toggle the Fleet Telemetry panel (Expert) |
| H or ? | the hotkey sheet (a running wave holds still while it is open) |
| Enter | Codex: next |

**Inside panels and menus**

| Where | Keys |
| ----- | ---- |
| System menu | ↑ ↓ to move, Enter to pick |
| Settings | [ ] or ← → to switch tabs |
| How to Play, Codex, About, Achievements | ↑ ↓ and PgUp / PgDn scroll; [ ] switch the Codex tabs |
| Training Lab | [ ] switch Infra / Studio; arrows and Enter move and pick; PgUp / PgDn page |
| Model Overview | ↑ ↓ select, PgUp / PgDn page, Home / End jump, [ ] cycle the filter; typing letters filters by name (Esc clears the filter, then closes; K closes it while no filter is typed) |

You build during the build phase, and you can still emergency-build or sell mid-wave if you have the cash. Model swaps, rack upgrades, weight formats and rack roles change only between waves, because loading new weights takes a rack offline; the one exception is a Multi-LoRA adapter swap (see Research). Research and Studio runs start between waves and make progress while waves run.

## Reading the Board

The board is built to show *why* each request goes the way it does.

**Requests.** Each packet is colored by its archetype, and its outline tells its latency class: rounded for interactive traffic, square for near-real-time, notched corners for offline work, and spikes for anything that carries a hazard (attacks and agent tasks). Above it runs a progress bar in up to three phases: amber while the prompt is read (**prefill**), violet while a thinking model reasons silently (**thinking**, shown only when there are hidden tokens), then the archetype's color as the visible answer streams out (**decode**). A white tick flashes the moment the first token arrives. While a prompt waits for a rack, a hairline under the bar drains from green to amber to red as its time-to-first-token budget runs out. One badge flags the most urgent problem — a blinking hazard sign for an attack that is still open, an overflow mark for a prompt too long to fit, a clock once it is already late, and in Expert Mode a "?" while it is being answered wrongly — and an open hazard also pulses a ring around the packet. A small orange pip marks a request inside a Router's range.

**Racks.** Each hardware tier has its own silhouette on a tier-colored floor plate. Up to eight LEDs show the batch: cyan slots are decoding answers, amber is a prompt being prefilled, and grey slots mean the decodes are stalled behind an unchunked prefill (the amber LED blinks). An icon explains a dark or degraded rack: a lightning bolt for a power cut, a droplet for a liquid rack with no Liquid Cooling Loop, a thermometer and heat glow for thermal throttling. A scanline sweeps a rack lent to research. In Expert Mode a thin gauge on the rack's edge shows how full its KV memory is (amber from 75%, red from 92%). Builds drop in, sales lift away, an upgrade wipes the old tier off with an "H100 → H200" label, and a deploy flashes the model's name.

**Token streams.** During prefill one dense stream flows *into* the rack from the prompt it is reading — prefill is compute-bound and takes the rack's full attention. During decode, thin streams flow *out* to every request in the batch — decode is bandwidth-bound and shared. A small fast model sprays tokens; a big slow one trickles. The outbound streams freeze while an unchunked prefill stalls the batch.

**Guardrails.** A catch draws a scan beam from the guard to the request, stamps a shield and pops `BLOCKED`. A wrongful block flashes the guard and stamps a no-entry sign with `REFUSED · GUARD`. When a model refuses an attack on its own, a shield rises over its rack with `MODEL SAFE`. A prefix-cache hit pops `CACHE HIT`.

**The Trust Core and the lanes.** The core is tinted by the Trust band. It cracks below 50, 25 and 10 Trust, its heartbeat quickens as Trust falls, and below 25 the board's edge glows red. Hits shake the board (Settings ▸ Accessibility ▸ Screen Shake). Ingress portals flash as requests spawn, flow chevrons show direction, the lanes take on the era's tint, and a single-entry surge highlights its lane with a SURGE tag. Banners mark the start of a wave, a boss wave and a clear (with the contract payout and the wave's Goodput).

**Coverage rings** stay hidden until you hover or select a building, hold a related tool, press G or hold Alt. A rack's reach follows its hardware tier.

**The HUD** shows Trust, SLA and Cash on the left, with a runway chip under Cash (how many waves your cash lasts at zero income) and your Data. Power and Heat show real kW against capacity. Between waves the title names the wave START will launch and how many requests are coming; during a wave the line becomes a live tally of the seven outcomes. Hovering Trust or SLA shows what drained them last wave and over the run. A status line names a brownout, throttling, a dark liquid rack, a pause, or the active incident (hover it for details).

**Notifications** stack above the build bar: research complete, a new checkpoint (between waves with a DEPLOY ×N button that rolls it out to every rack it fits), achievements, and the first brownout or throttle of a wave. Up to three show at once; hovering holds one, clicking opens what it refers to. A rejected action shows its reason at the cursor ("Model swaps happen between waves", "needs Tensor Parallelism", "Need $12 more").

## Planning a Wave: the Next-Wave Card

Between waves the **NEXT WAVE** card on the right shows what START will launch: its era and name, a brief of the real event, the lesson it drills, the incident it brings, a single-entry surge if the traffic will funnel through one lane, and a traffic multiplier when an incident changes the volume. For each archetype in the wave it then forecasts your *current* fleet against four checks:

| Check | Passes when |
| ----- | ----------- |
| **SMART** | some rack covering its lanes would answer it correctly: its model, in the mode it would answer in, scores at or above the request's difficulty on the judged axis after the format, alignment and long-context costs |
| **FAST** | some covering rack meets every latency bound it carries (first token, per-token speed, end-to-end, first answer token) under the wave's mixed load |
| **FITS** | some covering rack's context window and KV memory hold the whole prompt plus the answer |
| **SAFE** | every hazard it carries is caught by a guardrail covering its lanes, or refused by every covering model at least 90% of the time |

Hover a check for the numbers behind it (best margin, latency against each bound, window against the tokens needed, and per hazard whether a guard covers it, is locked until Red-Team Eval, or how often the models self-handle it). The forecast reads the same load model the deploy picker uses, queueing at each rack included; treat it as an estimate, since it does not model racks sharing the same requests. The card's footer gives the request count, the wave's projected operating bill and the most the SLA contract can pay. The card collapses with its button and turns into a click-through ghost while you hold a build tool.

If your cash is below the projected bill, START warns you first and turns into START ANYWAY; press it again to go. The runway chip turns amber under two waves of runway and red under one.

## Request Archetypes — the nine workloads

A request is defined by its workload physics, not its costume: how many tokens it reads and writes, how fast it must be answered, which skill it is judged on, how much of its prompt is shared and cacheable, whether it carries an attack, and what the market pays for it. Prompts and answers grow through the campaign as real workloads did (conversation history, retrieved context, accumulated agent state), so the late-game sizes are shown in parentheses.

| Archetype | Tokens in → out (late 2026) | Latency bounds | Judged on | Cacheable prefix | Hazard | $/Mtok in / out |
| --------- | --------------------------- | -------------- | --------- | ---------------: | ------ | --------------: |
| **Embedding** | 2K → 0 (6K → 0) | none (offline) | general 10 | 30% | — | 0.05 / 0.1 |
| **Interactive Chat** | 512 → 256 (2.6K → 512) | TTFT 400 ms · TPOT 40 ms · first answer 4 s | chat 18 | 40% | — | 0.3 / 0.9 |
| **Code Completion** | 1.5K → 150 (7.5K → 200) | TTFT 200 ms · TPOT 40 ms · first answer 400 ms | coding 56 | 50% | — | 1 / 3 |
| **RAG / Long-Context QA** | 8K → 512 (48K → 819) | TTFT 2 s · TPOT 200 ms | general 50 | 60% | — | 1 / 2 |
| **Summarization** | 12K → 400 (96K → 1K) | TTFT 6 s · TPOT 200 ms | general 44 | not cacheable | — | 1 / 2 |
| **Reasoning (long CoT)** | 512 → 6K (2K → 12K) | TTFT 2 s · TPOT 200 ms | reasoning 82 | not cacheable | — | 1 / 5 |
| **Agentic Task** | 6K → 800 (48K → 1K) | TTFT 2 s · TPOT 200 ms · E2E 60 s | agentic 82 | 70% | prompt injection | 3 / 12 |
| **Batch / Offline Gen** | 1K → 4K (3K → 8K) | none (offline) | general 40 | not cacheable | — | 0.5 / 1.5 |
| **Adversarial Prompt** | 600 → 400 (3K → 500) | TTFT 400 ms · TPOT 40 ms · first answer 4 s | handled or not | not cacheable | jailbreak | 0.5 / 1.5 |

TTFT is the time to the first token, TPOT the time per output token (judged once, over the whole answer), E2E the whole answer, and *first answer* the time until the first *visible* token after any hidden thinking. The quality line rises about 2% per campaign tier, so the reasoning and agentic lines approach 100 by the end.

**Correctness is an axis match.** A request is judged against the answering model's score on one axis — chat, coding, reasoning, general or agentic. Below its difficulty the answer is wrong (`bad`) and refunded. When several racks share a request's decode, the answer's quality is the token-weighted blend of the racks that wrote it, so a weak rack in range drags a strong one down. Long prompts cost quality too: once a prompt fills more than a quarter of a model's window, quality slides, and models with real long-context skill lose far less of it. The **agentic** axis is calibrated from benchmarks that have not saturated, so a model that chats brilliantly can still fail every agent task.

**Each archetype meets thinking and refusals differently.** A thinking model spends hidden tokens before it answers — its thinking budget times the archetype's share — and over-cautious alignment hits archetypes in proportion to how much borderline content they carry:

| Archetype | Hidden thinking (share of the model's budget) | Exposure to over-refusal |
| --------- | --------------------------------------------- | ------------------------ |
| Embedding | none (it writes no text) | none |
| Interactive Chat | ½ | full |
| Code Completion | 5% | 10% |
| RAG | ½ | 40% |
| Summarization | ½ | 30% |
| Reasoning | none extra (its long answer *is* the reasoning) | 50% |
| Agentic Task | the full budget | 50% |
| Batch | ½ | 20% |
| Adversarial Prompt | ½ | n/a (an attack is never harmless) |

## Hardware — the real GPU ladder

A serving tower is two decisions: the **rack hardware** you build and upgrade, and the **model** you deploy onto it. The rack contributes real GPU specs; the model contributes its size, skill and architecture.

The build bar sells two racks — **Edge** (the cheap starter) and **Frontier** — and every new rack ships with the free starter model, MiniCPM5-2B, preloaded. From a placed rack you **upgrade in place** along the ladder, paying the price difference at each step:

| Rack tier | GPU | GPUs | VRAM | HBM bandwidth / GPU | TDP / GPU | Cooling | Price | Reach (tiles) |
| --------- | --- | ---: | ---: | ------------------: | --------: | ------- | ----: | ------------: |
| Edge GPU Rack (buildable) | L4-class | 1 | 24 GB | 0.3 TB/s | 72 W | air | $5 | 2.8 |
| Standard GPU Rack | L40S-class | 1 | 48 GB | 0.86 TB/s | 350 W | air | $16 | 3.0 |
| Performance GPU Rack | H100-class | 1 | 80 GB | 3.35 TB/s | 700 W | air | $48 | 3.0 |
| Frontier GPU Rack (buildable) | H200-class | 1 | 141 GB | 4.8 TB/s | 700 W | air | $60 | 3.3 |
| DGX H200 | 8× H200 | 8 | 1.1 TB | 4.8 TB/s | 700 W | air | $320 | 3.4 |
| DGX B200 | 8× B200 | 8 | 1.5 TB | 8 TB/s | 1000 W | air | $500 | 3.5 |
| GB200 NVL72 | 72× B200 | 72 | 13.8 TB | 8 TB/s | 1000 W | **liquid** | $3000 | 3.6 |

Prices are real capex divided by 1000. Three facts from real serving shape every choice:

- **The roofline is two ceilings.** A rack first *prefills* the prompt — compute-bound, and super-linear on long prompts because attention grows with the square of the length — which sets the time to first token. It then *decodes* the answer token by token, and every step re-reads the model's weights and every stream's KV cache from memory, so HBM bandwidth, not raw FLOPS, sets how fast tokens flow. That is why an H100 serves many times faster than an L4 even for the same small model. Expert Mode's roofline card shows both bars and which one binds.
- **Big systems buy fit and concurrency, not per-user speed.** On a DGX or an NVL72, a model that fits one GPU runs as one copy per GPU: eight (or seventy-two) times the users, each at single-GPU speed. A model too big for one GPU is split across the smallest power-of-two group of GPUs that holds it, with tensor parallelism capped at eight GPUs, running below perfect efficiency and paying a small synchronization cost every token. Spanning GPUs needs research: Tensor Parallelism for up to eight GPUs, Pipeline Parallelism beyond that. Faster *per-user* speed comes from bandwidth — climbing the single-GPU tiers, or Blackwell's B200 over the H200.
- **Liquid cooling is a hard gate, for the NVL72 only.** The GB200 NVL72 cannot be cooled by air: it cannot be built or upgraded into without a Liquid Cooling Loop, and it goes dark if none exists. Every other tier, up to the DGX B200, is air-cooled and runs on ordinary Cooling Towers.

## Models — real open weights, free to deploy

Open weights are a download, so deploying a model **costs nothing**. What gates a model is memory: one copy's weights (its parameter count times bytes per parameter in the rack's weight format), plus the engine's overhead, must fit a GPU group the rack is allowed to use. Every model in the roster is owned from the first wave.

The roster holds 58 real open-weight checkpoints, from a 0.6B model that fits anywhere to Kimi K3 at 2.78 trillion parameters, more than a terabyte and a half of weights even in its native 4-bit release. They come from Qwen, Gemma, gpt-oss, DeepSeek, GLM, MiniMax, Nemotron, MiMo, Kimi and more. Each model's per-axis skill is **calibrated from public benchmarks** (Artificial Analysis and model cards), never hand-tuned; in Expert Mode the Model Overview shows where each number came from.

- **Release precision matters.** Many checkpoints ship in BF16 (2 bytes per parameter), some in FP8, and some natively in 4-bit (gpt-oss's MXFP4, DeepSeek V4's FP4 experts). A model always serves at its release precision or below; quantizing below it (post-training quantization) saves memory and may cost quality, while a natively 4-bit model pays nothing to run in 4-bit.
- **Mixture-of-Experts decouples memory from compute.** An MoE must hold *all* its experts in VRAM, but each token runs only its active experts, so it reads prompts as fast as a much smaller model. Decoding is different: a real batch of users picks many different experts, so every step reads a large share of the expert weights anyway, and a busy MoE decodes closer to its full size than its active size. Expert Parallelism shards the experts across copies so each copy reads less.
- **KV memory is per architecture.** In Expert Mode the Model Overview shows each model's KV bytes per token and release precision. Hybrid designs (sliding-window or linear-attention layers, compressed latent attention) keep far less KV per token than full attention, so they fit longer prompts and more users on the same rack.

### Choosing a model: the deploy picker

Select a rack and open the **DEPLOY** tab. Every owned checkpoint is scored against the coming wave *on this rack*:

- per-user tokens per second, colored against the 40 ms and 200 ms per-token bounds;
- `Q` — its quality on the axes the wave will judge, and how many of the wave's archetypes it serves cleanly;
- `safe` — its alignment safety and how often it wrongly refuses;
- a **HYBRID** or **THINKS** badge (see below), and ✓ on the model already loaded;
- models that do not fit are greyed with what they would need: "needs 141 GB → H200 rack", or "spans 8 GPUs — needs Tensor Parallelism".

The **★** marks the best fit: the model with the highest expected share of the coming wave served *cleanly* on this rack — on time under the wave's mixed load, correct, inside the window, not wrongly refused, and with nothing unsafe delivered. Sort by ★ Best, Fast, Smart, Safe or Size. Click to deploy here, or roll it out with Shift-click (every rack of this tier), Shift+Ctrl/⌘-click (every rack it fits) or the ALL ×N button. In Normal Mode the Overview tab says the same thing in plain words: which archetypes the loaded model is fast enough for and smart enough for, with the next wave's quality lines marked on its skill bars.

### Thinking, hybrid and instruct models

Thinking is the clearest trade in the game: a model that reasons before it answers is sharper, and it spends real time and memory doing so. Hidden reasoning tokens cost decode time, KV memory and end-to-end latency, and nobody pays for them — the market pays for the answer. Every checkpoint has one of three kinds of thinking support, read off its released chat template:

| Kind | Badge | How it serves |
| ---- | ----- | ------------- |
| **Hybrid** | HYBRID | answers interactive traffic (chat, code completion, attacks) instantly with thinking switched off, judged on its thinking-off skill; thinks first on everything else |
| **Always** | THINKS | thinks before every answer, chat included: sharp, but slow to start, and it can miss the first-answer bound on interactive traffic |
| **Never** | — | answers at once, weaker on hard problems |

Most of the roster is hybrid, which is why a hybrid can hold a chat lane and a reasoning lane at once. Put always-thinkers where accuracy matters more than the first word — reasoning and agent lanes — and keep them off chat and code completion. In Expert Mode the skill bars show the judged mode with a notch and a purple value for the other mode, and the request inspector names the mode an answer ran in. A Studio reasoning run (GRPO, or any reasoning target) turns a never-thinking model into an always-thinker.

## Batching and the KV Cache

A rack does not serve one person at a time. Each request packet on the board stands for a crowd of real users — it puts 28 concurrent streams on a rack — and a busy rack interleaves many packets, one token for every stream per decode step. Batching is the trade at the heart of serving: every extra stream adds a little to each step (its KV must be read), so **per-user speed falls while total throughput rises** toward the compute roof. A rack that looks fast alone can be too slow for chat when it is full.

- **Continuous Batching** is the root of the research tree. Before it, a model copy serves one cohort at a time; after it, the engine keeps up to 256 streams per copy running and swaps finished ones out every step.
- **KV memory caps concurrency.** Every stream keeps its context's keys and values resident, so long prompts and long answers hold more memory. When a rack's KV is full, new requests wait (and the wait counts against their TTFT); a request whose KV would exceed a rack's entire budget is never admitted there and, if nothing else can take it, ends `unservable`. PagedAttention raises usable KV from 55% to 96% of free memory, FP8 and INT4 KV caches halve and quarter it, and KV Offloading keeps cold prefixes on the CPU side for reuse.
- **Prefix caching skips shared prompts.** A Cache building gives racks in its range a chance to reuse a cached prompt prefix on cacheable traffic. A hit skips the shared-prefix share of the prefill, and the unique rest still prefills, so a cache lowers TTFT and frees prefill capacity. Each request gets one lookup; overlapping caches do not stack (the best one counts), and the hit chance is capped at 70% because unique prompts share nothing. Prefix Caching research lifts a cache from 35% to that cap. Cached prompt tokens are billed at full price — they were served.
- **Chunked Prefill keeps answers streaming.** Without it, a rack that starts a long prompt stalls every answer in its batch until the prompt is read (the grey LEDs). With it, every engine step carries the running answers plus a budget of prompt tokens sized to the rack's speed: short prompts finish in one step, long ones are split across steps, and the answers keep streaming, a little slower.

## Two-layer Safety

Attacks must be **handled**, or a harmful answer reaches the user. Adversarial prompts carry a jailbreak; agent tasks can carry a prompt injection hidden in the tools and documents they read. There are two layers of defense, and they can work together.

**Layer 1 — the model's own alignment.** Safety is baked into the weights. When a model writes its first token, it either self-handles the attack (refuses it, or answers it safely) or does not. Self-handling costs no latency, but it is a property of the model, and it comes with two costs: an **alignment tax** (aligned models lose a little skill) and **over-refusal** (they turn some harmless users away). The gpt-oss family shows the better trade: safe-completion alignment with high safety, a low refusal rate and a smaller tax for its safety than hard-refusal models. Injection is the hardest hazard for a model to resist on its own.

**Layer 2 — guardrail buildings.** A guardrail is a stage on the request path, not a turret. It screens **every request on the lanes its range touches, wherever it sits on the lane** — so a guard beside the core, where the four lanes meet, can cover all of them. Each request is screened once, at its first contact with a rack. An input-side check runs before any compute (so a blocked attack costs no prefill) and its latency is added to TTFT; an output-side check reads the finished answer before delivery and adds to the end-to-end time. A guard's inspect panel lists the lanes it screens, and warns when it covers none.

| Guardrail | Family | Check time | Catches | Side | Cost on your fleet |
| --------- | ------ | ---------- | ------- | ---- | ------------------ |
| **Prompt Guard** (encoder) | a fine-tuned 86M classifier | a fixed 92 ms | jailbreak; injection after Red-Team Eval | input | none — it does not occupy a rack |
| **Llama Guard** (generative) | a 12B judge model | a real inference: tens of ms per side for a typical prompt, more for long turns | jailbreak and harmful content; injection after Red-Team Eval; PII after Red-Team Eval II | both | runs on its own H100: draws power and bills GPU-hours |

(The game also models a third family, a vendor-hosted Moderation API for harmful and PII content; it is not on the build bar, because the campaign's traffic does not call for it.)

What matters is how guards combine on a lane:

- **Defense in depth works; redundancy does not.** Different guard families stack: each one gets its own chance to catch what the others missed. A second copy of the *same* guard on the same lane adds coverage of other lanes but no extra recall — the same classifier gives the same verdict on the same prompt.
- **Every guard has a price.** Each family on a lane adds its check time to every request there (92 ms is almost half of code completion's 200 ms first-token budget), and each one rolls its own false positive on harmless traffic. Cover the lanes that carry attacks; do not blanket the board.
- **Prompt injection needs Red-Team Eval.** Until you research it, no guardrail can catch an injection, and an agent's only defense is its model. Red-Team Eval also cuts every guard's wrongful blocks; Red-Team Eval II unlocks PII detection.
- **Attacks evolve.** Through the campaign attacks grow sharper (their severity climbs toward the maximum), and from mid-2023 a growing share of them are *novel* variants no classifier was trained on — up to half by the end. An encoder keeps under half of its recall against a novel attack; a generative judge keeps all of it, and a model's own alignment is judged on severity, not novelty. Late safety needs Llama Guard or a well-aligned model, not more encoders.

| Guard | Catch rate | Wrongful-block rate on fully exposed traffic |
| ----- | ---------- | -------------------------------------------- |
| Prompt Guard | 97.5% (about 44% against novel attacks) | 1.5% |
| Llama Guard | 92% (unchanged against novel attacks) | 2.5% |

Red-Team Eval adds a little recall to every guard and cuts wrongful blocks by 30%. The rates are scaled by each archetype's exposure (the table under Request Archetypes).

**Over-refusal and Constitutional AI.** A refusal of a harmless request is an outcome of its own (`over_refused`): no pay, a light Trust and SLA hit. It comes from two places, the model and the guards, and the wave report says which. Hard-refusal models turn away roughly one chat request in ten; a gpt-oss-style model about one in thirty. In the Studio, **Constitutional AI** is the Pareto move: it raises a model's safety *and* lowers its over-refusal, switching it to safe-completion. RLHF raises safety more but makes the model refuse more and pays the steepest quality tax.

## Research: the Training Lab

Build a **Training Lab** to open research (TRAIN on the build bar, or L, between waves). Each Lab also adds 25% to the Data you earn. Research runs on **three tracks** at once:

| Track | What runs on it |
| ----- | --------------- |
| **Infra** | the 22 serving-stack techniques below, and the 8 unlocks for Studio methods |
| **Eval** | Red-Team Eval and Red-Team Eval II |
| **Post-training** | your Studio runs |

Each track runs one project at a time. A project pays its **Data** up front when you start it (between waves), then needs real GPU compute, which it **requisitions from your racks during waves**: whole racks, strongest first, as many as fit under 45% of your fleet's compute, never your last online rack (if no rack fits under the cap, the weakest one is lent). Lent racks stop serving and keep billing at full load until the work is done, and the tracks share what is lent equally, so running all three at once slows each. The Infra tab previews what a project would borrow ("Lends 2 rack(s) to training: −40% serving compute · ≈18 s of wave time"), its cards name any missing prerequisite, and an AVAILABLE NOW filter hides the rest. Plan research around the wave schedule: a big project during a boss wave can cost you the wave.

The infra tree is serving infrastructure only; it never changes model weights.

- **Scheduling** — Continuous Batching (the root), Multi-Step Scheduling (more throughput, a short delay before new requests join), and **Chunked Prefill or P/D Disaggregation** — mutually exclusive. Disaggregation splits racks into prefill and decode pools (V cycles a rack's role) with a small tuning gain and a KV transfer between them.
- **KV memory** — PagedAttention, Prefix Caching, FlashAttention (faster long prompts and KV reads, a little activation memory back), FP8 and INT4 KV caches (INT4 costs a little quality past 32K tokens), and KV Offloading (a larger prefix cache on the CPU side, with a PCIe reload delay).
- **Decoding** — Speculative Decoding: a small draft model proposes tokens the big one verifies, several tokens per step at low load. It takes a little VRAM, draws more power on every tier, helps most on code and least on open reasoning, and switches itself off once the batch is compute-bound.
- **Weight formats** — FP8 (half the memory, effectively lossless, and FP8 tensor speed), INT4 AWQ/GPTQ (about a quarter of BF16 memory, computes at BF16 speed, and costs quality — more on prompts past 8K tokens), and NVFP4 (Blackwell racks only: 4-bit memory at FP4 tensor speed with a smaller quality cost). Each rack then picks its own format with its Weights button; *auto* takes the fastest format that costs this model no quality, and a lossy 4-bit format is how a model too big for a rack gets onto it. Lower precision also draws less power.
- **Parallelism** — Tensor Parallelism (span up to 8 GPUs), Pipeline Parallelism (beyond 8, with a pipeline bubble on each prompt), Data Parallelism (load-balance requests across copies), Expert Parallelism (shard an MoE's experts across copies so a busy batch reads less per copy).
- **Routing, adapters, engine** — KV-Aware Routing (routed cacheable requests land where their prefix already lives: more cache hits), Multi-LoRA Serving (a rack can swap between adapter checkpoints of the same base mid-wave, at a small speed cost until the next build phase), and the engine choice, **SGLang or TensorRT-LLM** — mutually exclusive: SGLang reuses more prefixes, TensorRT-LLM runs faster kernels.

The infra track also unlocks the Studio's methods (PEFT, preference optimization, GRPO, Constitutional AI, continued pre-training, distillation, merging, QAT).

## The Post-Training Studio — train your own

In the **Studio** tab of the Training Lab you derive your own checkpoints, iteratively — you can fine-tune a fine-tune. Pick a base (any checkpoint you own; the Studio starts on the selected rack's model), a method, a target and an effort (five notches from ¼ to 2×). The preview shows the projected change on every axis, the Data and compute cost, what the run would borrow from your fleet, any change to safety or thinking support, and when the body's ceiling limits the gain.

| Method | Kind | What it does |
| ------ | ---- | ------------ |
| **SFT** | finetune | the baseline, no research needed: chat, coding, general or long-context gains |
| **LoRA / QLoRA / DoRA** | adapter | the cheapest finetunes: a modest gain with almost no forgetting; adapters can hot-swap with Multi-LoRA |
| **DPO** | finetune | light, cheap preference tuning (chat, general, safety) |
| **RLHF** | finetune | strong safety and chat alignment, at the steepest quality tax and a rising refusal rate |
| **Constitutional AI** | finetune | raises safety and lowers over-refusal (safe-completion) at a small tax |
| **GRPO** | finetune | reasoning RL: the strongest path to reasoning and agentic skill; makes a never-thinking model think |
| **Distillation** | finetune | a big teacher into a smaller student body: cheaper to serve, capped below the teacher |
| **Merge** | merge | average two checkpoints of the same base with no retraining |
| **CPT** | finetune | continued pre-training: broad domain and long-context gains, the highest forgetting |
| **QAT** | quantized | train for 4-bit inference: about a quarter of BF16 weight memory, faster decode, −2 on every axis |

There is no free infinite-quality loop:

- **Ceilings.** Post-training cannot push a body past what models of its size reach: on each axis the ceiling is the best base model up to twice its size, plus a small margin. The preview says when the ceiling binds. Distillation is bounded by its student instead.
- **Depth.** Each run on an already-derived checkpoint gains less, costs more, and forgets more of the other axes than the run before it.
- **Merges.** A merge needs two *different* checkpoints derived from the *same* base model with an identical architecture; anything else has no shared weights to average. The merged model lands at the average of its parents, safety and refusal rate included, and a thinker merged with its instruct sibling becomes a hybrid. A merge costs a little Data for the evaluation pass.

The run produces a new checkpoint with a recorded lineage (base, method, target, effort, depth), shown in Expert Mode's Lineage Graph. Runs finish while a wave is under way: the new checkpoint is announced at once, and when the wave ends a notification offers it with a DEPLOY ×N button that rolls it out to every rack it fits. A GRPO-agentic run on a strong base is your agent specialist, and deep, carefully chosen chains are how you keep pace in endless mode.

## Power and Cooling

Racks draw real kilowatts and turn them into heat. The HUD's POWER and HEAT bars show draw against capacity.

| Building | Effect | Price |
| -------- | ------ | ----: |
| (the site itself) | 6 kW of power and 6 kW of air cooling before you build anything | — |
| **Power Plant** | +8 kW of power | $18 |
| **Cooling Tower** | +8 kW of air cooling | $18 |
| **Liquid Cooling Loop** | +60 kW of liquid cooling, for liquid racks only; required for any NVL72 | $90 |

A single-GPU H100 or H200 rack draws about half a kilowatt, an 8-GPU DGX several kilowatts, and an NVL72 close to sixty. Lower-precision weights draw less; speculative decoding draws more; Llama Guard's own GPU draws too.

- **Over the power limit, racks brown out.** The most power-hungry racks go dark first (support buildings last). A dark rack serves nothing and bills nothing.
- **Over the cooling limit, racks throttle.** There are two cooling pools: Cooling Towers and the site's chillers cool air racks and buildings; Liquid Cooling Loops cool only liquid racks. Each pool throttles only its own racks, down to a 20% floor, and a throttled rack decodes and prefills more slowly.
- **The meters are live between waves.** They update after every build, so you can see a telegraphed power or cooling incident before the wave starts.

## The Economy — real dollars per token

- **Income is token-priced.** Each archetype has an input and an output price (the archetype table). A served request pays for the tokens actually processed — the prompt it read, cached prefix included, plus the answer it got; a late one pays half; every other outcome pays nothing, and a wrong answer is refunded. Hidden thinking tokens are never billed. Agent and reasoning answers sell at a premium; embeddings and chat sell cheap.
- **The SLA contract pays every wave.** When a wave clears, your committed customers pay its contract times the wave's **Goodput** — the share of all its requests served cleanly. It is most of your early income and grows with the era; boss waves pay a premium. As prompts lengthen, token income overtakes it. The wave report and the clear banner list this payment as the *SLA contract*.

  | Wave tier | Contract at 100% Goodput | A boss wave of that tier |
  | --------- | -----------------------: | -----------------------: |
  | 1 (early 2023) | $24 | — |
  | 3 | $34 | $72 |
  | 5 | $43 | $82 |
  | 10 | $67 | $106 |
  | 12 (2026) | $77 | $115 |

- **The bill runs by the clock.** While a wave runs, every online rack bills its **GPU-hours** (amortization, maintenance, colocation, network) plus the **energy** it draws (an idle rack still draws part of its power; facility overhead included). The build phase is free. Because the bill depends on time, not on tokens served, an idle or over-provisioned rack bleeds money: utilization is profit. Energy is a small slice of a GPU rack's bill, so a power-price spike stings less than a capacity cut. Racks lent to research keep billing at full load.
- **Selling** refunds 60% of a building's current value — for a rack, the price of its current hardware tier (models are free and refund nothing).

## Reading the Wave Report — what to fix next

The wave report appears after every wave, in both modes (fold it to a chip with its button). Start with the outcome that cost the most Trust and SLA, then fix the matching subsystem:

| Outcome | What it means | First fixes to try |
| ------- | ------------- | ------------------ |
| SLO-miss · **TTFT** | The prompt waited too long or prefilled too slowly. | More racks reaching the lane where requests first arrive; a Cache on the lane; a faster rack; FP8 weights; a model with fewer active parameters; fewer input-guard families on interactive lanes. |
| SLO-miss · **TPOT** | Tokens came too slowly per user. | A higher-bandwidth tier; a smaller model or one with fewer active parameters; FP8 weights; Speculative Decoding at low load; fewer users per rack (more racks); Chunked Prefill so prompts stop stalling answers; fix any throttling. |
| SLO-miss · **E2E** | An agent step took over a minute in total. | Faster per-user decode, a model that thinks less, or a less loaded rack. |
| SLO-miss · **THINKING** | An always-thinking model took too long to start answering interactive traffic. | Serve chat and code completion with a hybrid or instruct model; a Router sends easy traffic to fast racks. |
| Bad | The model scored below the request's difficulty on the judged axis. | The deploy picker's ★ for that wave; a Router so hard requests reach strong racks and weak racks stop answering them; a model with better long-context skill for long prompts; avoid lossy 4-bit formats on hard lanes; a Studio run on that axis. |
| Unsafe | An attack's answer was delivered. | A guardrail covering that lane; Red-Team Eval for prompt injection; Llama Guard or a well-aligned model once attacks turn novel; a Constitutional-AI checkpoint. |
| Over-refused | A harmless user was refused. | The report names who refused. Model: a safe-completion model or a CAI checkpoint. Guard: fewer guard families on that lane, and Red-Team Eval. |
| Unservable | The prompt did not fit any window or KV budget in its path. | A longer-context model, a model with a smaller KV footprint, PagedAttention, FP8 or INT4 KV cache, a bigger rack. |
| Dropped (504) | It reached the core unanswered. | More racks reaching that lane, Continuous Batching and PagedAttention for concurrency, fix brownouts, and avoid lending too many racks to research during heavy waves. |

Three traps:

- **Serving time starts at a rack that could serve it.** Lane travel before a request reaches a rack able to prefill it is positioning time, not TTFT. From then on, queueing, guard checks, prefill and decode all count.
- **One rack in isolation is not the wave.** A rack can look fast alone and still miss the wave once its batch fills; the ★ and the next-wave forecast judge the wave's mixed load for exactly this reason.
- **Speed and quality are separate.** A small model on a fast GPU can be on time and wrong; a strong model on a slow rack can be right and late.

## Incidents

Most waves arrive with an **incident**. It is telegraphed in a banner during the build phase before it, and its effect is live from then through the wave, so it is a build requirement, not backstory. During the wave the HUD status line names it. The 23 incidents are drawn from real 2023→2026 events:

| Family | Incidents | Effect |
| ------ | --------- | ------ |
| Single-entry surges | Undersea Cable Severed · Edge Provider Outage · Global IT Meltdown | every request funnels through one ingress lane, with 15–30% more volume |
| Power-price spikes | Capacity Auction Shock · On-Site Fuel Spike | energy costs 1.6–1.9× |
| Grid shocks | Grid Curtailment Order · Interconnection Freeze | curtailment cuts 15% of your power capacity (racks beyond it go dark) and raises energy prices 1.5×; a freeze blocks any new Power Plant and raises energy prices 1.3× |
| Cooling shortfalls | Liquid Loop Fault · Water-Use Restriction | cooling capacity drops 35–45% |
| Supply shocks | H100 Allocation Crunch · HBM Sold Out · Chip Export Ban | new builds and upgrades cost 1.6–2.0× |
| Price wars | Token Price War · DeepSeek Market Shock | revenue per request drops 30–40% |
| Safety pressure | Regulatory Audit · Adversarial Suffix Storm | every unsafe answer costs 1.6–1.8× Trust |
| Data integrity | Training-Data Poisoning · Eval Set Contamination | you lose 40–50% of your stored Data |
| Demand spikes | Viral Demand Surge | 40% more requests, each clean serve pays 20% more |
| Good fortune | Firm Nuclear PPA · Lead Times Ease · Off-Peak Demand Lull · Enterprise Demo Day | cheaper energy · cheaper builds · 30% less volume · clean serves pay 50% more, but every SLA penalty is 1.8× |

Real-event waves force their signature incident: a drought wave restricts water, a regulator's wave brings the audit, a price-cut wave starts a price war. Boss waves and every tenth wave carry a guaranteed hard incident; other waves roll one at random more often than not, starting with wave 3. Add cooling before a cooling fault, guardrails before an audit or a jailbreak storm, buy before a shortage, keep power headroom before a curtailment, and concentrate capacity on the surge lane for a cable cut.

## The Campaign

The campaign is 100 waves of real history, from the chatbot boom of early 2023 to late 2026. Waves are **demand shifts** (people start using AI for something new, en masse) and **operating shocks** (cable cuts, shortages, grid emergencies, outages, regulators, attacks); model and chip launches are not waves, because those are your tools. The difficulty tier rises steadily from 1 to 12: more requests, longer prompts and answers, a higher quality line, sharper and more novel attacks, and harder incidents, while no single wave suddenly multiplies the load a fleet just proved it could carry.

| Era | Waves | What it drills |
| --- | ----- | -------------- |
| 2023 | 1–25 | chat at scale, the first jailbreaks, RAG and long documents, code completion's strict latency, the GPU shortage, export bans, the first agents and prompt injection |
| 2024 | 26–50 | long-context floods, coding agents, the liquid-cooling and interconnection walls, the price collapse, the EU AI Act audit, reasoning demand |
| 2025 | 51–85 | open reasoning floods, deep research, coding-agent explosions, zero-click exfiltration, outage spillovers, adapter fleets, the capacity-market cap |
| 2026 | 86–100 | the agent economy, election-season abuse, the gigawatt power race, HBM squeezes, and the second half of the year below |

Twelve **boss waves** (10, 13, 20, 30, 38, 40, 50, 60, 70, 80, 90 and 100) carry a quarter more requests, a larger contract and, unless they force their own signature incident, a guaranteed hard one. The final stretch replays the second half of 2026:

| Wave | Name | The event | What it tests |
| ---- | ---- | --------- | ------------- |
| 95 | The Grid Calls Its Marker | a record heat wave and an emergency order curtail large loads | usable power shrinks at peak demand (Grid Curtailment) |
| 96 | The Sandbox Breakout | an autonomous agent system escapes its evaluation sandbox and breaches a model hub | novel attacks on agent lanes (Adversarial Suffix Storm) |
| 97 | Transparency Day | EU AI Act transparency duties take effect | every unsafe answer costs far more Trust (Regulatory Audit) |
| 98 | Three Front Doors Go Dark | three major assistants fail the same morning | the spillover arrives on one lane (single-entry surge) |
| 99 | The Half-Price Frontier | frontier API prices are cut in half | margins collapse (Token Price War) |
| 100 | BOSS: The Always-On Agent Era | always-on personal agents launch as the first AI-agent breach of a government system goes public | all nine archetypes at once, through one lane |

## Endless Mode

Clearing wave 100 unlocks **∞ CONTINUE — ENDLESS MODE**. Procedural surges resume at wave 100's load and keep climbing: every surge brings more requests and longer work, after the first two the quality line hardens a little each time, attacks grow sharper and more often novel, and the contract grows with them. Every surge carries at least one hard lane (reasoning or agents); every tenth brings a guaranteed hard incident, and the rest roll one at random. Your roster tops out at the real open-weight frontier, but your Studio does not: careful finetune chains are how you stay ahead for a while. Your score is the wave you reach.

## Opening Advice

**Waves 1–2 (the chatbot boom).** Mostly chat. Place three or four Edge racks beside the lanes near the core, where every lane converges, and let the starter model answer. Expect a few wrongful refusals: the starter has hard-refusal alignment.

**Wave 3 (an LLM behind the search box).** RAG arrives with 8K-token prompts, which an L4 prefills too slowly — they time out. Upgrade your racks one step to Standard (L40S) before it.

**Waves 4–5 (the DAN jailbreak wave, then Italy's block).** Jailbreaks arrive, and wave 5's regulator makes each unsafe answer hurt more. One Prompt Guard beside the core covers all four lanes; a second copy on the same lanes adds nothing.

**Waves 6–12.** Build a Training Lab and research **Continuous Batching** first (concurrency), then **PagedAttention** (KV room) and **FP8 weights** (half the memory, faster). Wave 6 funnels the whole wave through one lane; the NEXT WAVE card names it, so make sure that lane has enough racks within reach. Wave 12 floods code completion: its 200 ms first-token bound and coding line are beyond L40S racks, so move to H100-class racks and use the ★ — it picks a 30B-class MoE that codes well with thinking off.

**Waves 13–21.** Keep power and cooling ahead of your racks, add Routers so hard requests reach your strongest racks and Caches over cacheable lanes, and research Prefix Caching. On the long-document wave (16), small fast models beat big ones: prefill is the bottleneck. Research **Red-Team Eval before wave 21**, when agents arrive carrying prompt injection.

**Mid and late game.** Pick Chunked Prefill or P/D Disaggregation, add Tensor Parallelism before you deploy anything that spans GPUs, and train a Constitutional-AI checkpoint of the model your fleet runs most. Agents are the real test: a fast cheap model answers everything else and fails agents, so field a genuine frontier model on a DGX or train a GRPO-agentic specialist. Once attacks turn novel, replace encoders with Llama Guard on the lanes that need it. Keep the lanes that carry the expensive archetypes over-provisioned: one agent timeout costs more than many chat misses.

## Common Failures and Fixes

| Problem | Symptom | Fix |
| ------- | ------- | --- |
| Requests leak to the core | 504s pile up, SLA drops fast | More racks reaching that lane, Continuous Batching and PagedAttention, fewer racks lent to research mid-wave |
| Chat is late even on a fast rack | `LATE · THINKING` on chat or code completion | An always-thinking model is on interactive traffic; deploy a hybrid or instruct model there |
| Trust slowly bleeds | `WRONG` answers pile up | The model is below the request's line on its axis; follow the ★, add a Router, or post-train |
| Agent lanes always fail | `WRONG · agentic` even with a big model | The agentic axis is the hardest; a frontier model or a GRPO-agentic specialist |
| Jailbreaks wreck Trust | `UNSAFE` popups | A guard covering the attack lanes; Llama Guard or CAI once attacks turn novel |
| Agents leak unsafe answers | `UNSAFE` on agent tasks | Prompt injection: research Red-Team Eval so guards can catch it |
| Harmless users are refused | `REFUSED · MODEL` or `REFUSED · GUARD` | A safe-completion or CAI model; fewer guard families per lane; Red-Team Eval |
| BROWNOUT | racks go dark (⚡) | Add Power Plants, or use lower-precision weights |
| THROTTLING | everything slows (🌡) | Add Cooling Towers for air racks, a Liquid Cooling Loop for liquid racks |
| LIQUID RACK OFFLINE | an NVL72 is dark (💧) | Build a Liquid Cooling Loop |
| A model will not deploy | "needs Tensor Parallelism" or "needs 141 GB" | Research TP / PP, switch to a smaller weight format, or upgrade the rack |
| Cash runs out | runway chip turns red, bankrupt despite serving | Too many idle racks billing by the clock; right-size the fleet and raise utilization, and keep Goodput high for the contract |

## Settings

Open the system menu with the gear button or Esc, then **Settings**. Changes apply instantly and are saved in your browser; **Reset to Defaults** restores audio, accessibility and gameplay (language and display mode stay as they are).

| Tab | Setting | Options (default) |
| --- | ------- | ----------------- |
| Audio | Master · Music · SFX · Interface | volume sliders (50% · 50% · 100% · 60%); releasing a slider plays a sample on its bus |
| Audio | Mute | on / off (off); also the speaker button and M |
| Audio | Mute in Background | on / off (on): silence while the tab is hidden or unfocused |
| Audio | Serve Chimes | Full / Reduced (Full): Reduced thins routine serve and cache chimes so failures stand out |
| Audio | Outcome Sounds | tap each of the seven outcome glyphs to hear it |
| Display | Language | EN (English) · 中 (Traditional Chinese) |
| Display | Display Mode | Normal / Expert (switchable mid-run once the tutorial is finished or skipped) |
| Accessibility | Reduced Motion | on / off (follows your system setting): holds animations steady and removes particle bursts (token streams become dotted lines) |
| Accessibility | Screen Shake | on / off (on): with it off, a core hit flashes the border instead (within the flash limit) |
| Accessibility | Reduce Flashing | on / off (off): removes full-screen flashes and rapid blinking, the core-hit border flash included (otherwise at most three flashes a second) |
| Accessibility | Colorblind-Safe Colors | on / off (off): a color-vision-safe outcome palette; every outcome keeps its glyph |
| Accessibility | Effects | Full / Reduced / Minimal (Full): particle and popup density; Minimal keeps only the meaningful glyphs, beams and dotted token streams |
| Gameplay | Default Speed | 1× · 2× · 3× · 6× · 12× (1×) |
| Gameplay | Auto-Start Next Wave | Off · 5 s · 10 s (Off): from wave 4 and after the guided tutorial, counts down and presses START; any build, inspect or menu action cancels it for that build phase |
| Gameplay | Confirm Before Selling | on / off (on): selling takes a second press |
| Gameplay | Pause When Unfocused | on / off (off): pauses the wave when you switch away |
| Gameplay | Tooltips | on / off (on) |
| Gameplay | Hotkey Badges | on / off (on): key caps on the build bar and controls |
| Gameplay | Tutorial | Replay Tutorial: the Codex walks you through again and its tips return |

The **Codex**, your on-call SRE, walks you through the first wave and then speaks up the first time something new happens: a brownout or throttle, an injection your guards cannot catch yet, an open jailbreak, the first late answer (naming the archetype and its bounds), the first wrong answer (naming the axis), the first wrongful refusal, a wave whose bill beat its income, and low Trust. Each tip appears once per player.

### Sound cues

You can hear which way a request went. Most cues are panned to where on the board they happened.

| Sound | Meaning |
| ----- | ------- |
| a bright pluck that climbs the scale while service stays clean | served (the climb resets on any failure) |
| the same pluck sagging, with a tick-tock | SLO-miss: right answer, too slow |
| a dissonant buzz | bad: the model was not smart enough |
| a metallic alarm, the loudest cue (the music ducks) | unsafe |
| a polite "nuh-uh", with a shield tick when a guardrail refused | over-refused |
| a drop and a bit-crushed crunch | unservable: too long to fit |
| a whoosh falling into a thump at the core | dropped (504) |
| a glassy ping · a shield tink · a soft hum | a cache hit · a guardrail catch · a model refusing an attack itself |

The music builds with load, gains a tension drone near failure, and turns darker on boss waves. A heartbeat starts when Trust or SLA falls under 30, a clock ticks when cash is about to run out, and racks power down and back up audibly when they go dark or recover.

## Core Strategy

The key to GPTD is not "buy the biggest rack" but "serve every kind of traffic in the cheapest way that is reliable enough." The rack is the gun, the **model is the ammunition** you choose per rack, and the Studio is your gunsmith. Every wave, ask:

1. Does the next wave mainly test speed, quality, safety or cost — and which of its archetypes does the forecast flag?
2. Will my power and cooling carry the racks I am about to add?
3. Am I reserving my expensive frontier and agentic capacity for the requests that need it, and keeping utilization high enough not to bleed?

Answer those three and you are not stacking towers — you are running a real AI platform deep into the age of inference.
