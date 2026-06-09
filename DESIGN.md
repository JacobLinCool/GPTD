# GigaPrompt Tower Defense — Game Design Document

> **GigaPrompt Tower Defense (GPTD)** is a pixel tower-defense management game where waves of AI user requests try to overwhelm your serving platform. It translates the real tension of running an AI provider — routing, serving optimizations, power and cooling, data quality, and training tradeoffs — into real-time defensive decisions. Build data centers, train models, route traffic, and defend user Trust.

> **Status:** Design + **playable build (v0.1)**. &nbsp;·&nbsp; **Stack:** Vite + TypeScript + PixiJS v8 + Web Audio &nbsp;·&nbsp; **Legend:** 🟢 marks features in the MVP scope ([§20](#20-mvp-scope)). &nbsp;·&nbsp; Where the shipped build diverges from this design vision, see the **as-built notes** in [§20](#20-mvp-scope).

## Table of Contents

- [1. Concept & Core Fantasy](#1-concept--core-fantasy)
- [2. Win & Lose Conditions](#2-win--lose-conditions)
  - [Failure pathways](#failure-pathways)
- [3. The Trust Core](#3-the-trust-core)
- [4. Enemies: The Request Taxonomy](#4-enemies-the-request-taxonomy)
  - [Request stat block](#request-stat-block)
  - [Tower-defense mapping](#tower-defense-mapping)
  - [The Request taxonomy](#the-request-taxonomy)
- [5. The Map & The Serving Pipeline](#5-the-map--the-serving-pipeline)
  - [5.1 The serving pipeline](#51-the-serving-pipeline)
  - [5.2 Where each tower class sits](#52-where-each-tower-class-sits)
  - [5.3 Lane + back-row layout](#53-lane--back-row-layout)
- [6. Request Resolution & Combat Logic](#6-request-resolution--combat-logic)
  - [6.1 Worked example](#61-worked-example)
  - [6.2 Processing rate](#62-processing-rate)
  - [6.3 Answer quality](#63-answer-quality)
  - [6.4 The multi-gate success condition](#64-the-multi-gate-success-condition)
  - [6.5 Failure modes](#65-failure-modes)
- [7. Towers & Buildings: Model, GPU, Infrastructure](#7-towers--buildings-model-gpu-infrastructure)
  - [7.1 Serving Towers](#71-serving-towers)
  - [7.2 Infrastructure Towers](#72-infrastructure-towers)
  - [7.3 Resource Towers](#73-resource-towers)
  - [7.4 The four-connection firing rule](#74-the-four-connection-firing-rule)
- [8. Routing: The Core Skill](#8-routing-the-core-skill)
  - [8.1 Three ways to route — two traps and the smart play](#81-three-ways-to-route--two-traps-and-the-smart-play)
  - [8.2 Routing decision tree](#82-routing-decision-tree)
  - [8.3 Router upgrades](#83-router-upgrades)
- [9. Models & Model Stats](#9-models--model-stats)
  - [9.1 Model Stats](#91-model-stats)
  - [9.2 MVP Model Tiers](#92-mvp-model-tiers)
  - [9.3 Example Model Cards](#93-example-model-cards)
  - [9.4 Training is a between-wave system, not a shooting tower](#94-training-is-a-between-wave-system-not-a-shooting-tower)
- [10. Inference & Serving Systems](#10-inference--serving-systems)
  - [10.1 Serving Concept → Game Mechanic](#101-serving-concept--game-mechanic)
  - [10.2 Throughput vs. Memory: Two Separate Bottlenecks](#102-throughput-vs-memory-two-separate-bottlenecks)
  - [10.3 Serving a Viral Spike Without Infinite GPUs](#103-serving-a-viral-spike-without-infinite-gpus)
- [11. Training Methods & the Four Tech-Tree Paths](#11-training-methods--the-four-tech-tree-paths)
  - [11.1 Methods Table](#111-methods-table)
  - [11.2 The Four Competing Paths](#112-the-four-competing-paths)
  - [11.3 How Methods Map to Serving Towers](#113-how-methods-map-to-serving-towers)
- [12. Scaling Laws](#12-scaling-laws)
  - [12.1 The Toy Quality Formula](#121-the-toy-quality-formula)
  - [12.2 Bigger Is Not Automatically Better](#122-bigger-is-not-automatically-better)
  - [12.3 The Params / Dataset / Compute Triangle](#123-the-params--dataset--compute-triangle)
- [13. Resources & the Data Pipeline](#13-resources--the-data-pipeline)
  - [13.1 Main resources](#131-main-resources)
  - [13.2 The data pipeline loop](#132-the-data-pipeline-loop)
  - [13.3 Data sources & their tradeoffs](#133-data-sources--their-tradeoffs)
  - [13.4 The core tension: fast dirty data vs slow clean data](#134-the-core-tension-fast-dirty-data-vs-slow-clean-data)
  - [13.5 Pixel/HUD notes](#135-pixelhud-notes)
- [14. Money & Business Economy](#14-money--business-economy)
  - [14.1 Reward by customer type](#141-reward-by-customer-type)
  - [14.2 The profit formula](#142-the-profit-formula)
  - [14.3 Business tensions](#143-business-tensions)
- [15. Power, Cooling & the Data Center](#15-power-cooling--the-data-center)
  - [15.1 Per-building derived stats](#151-per-building-derived-stats)
  - [15.2 Capacity inequalities](#152-capacity-inequalities)
  - [15.3 PUE: the energy-overhead model](#153-pue-the-energy-overhead-model)
  - [15.4 Failure chains](#154-failure-chains)
  - [15.5 Pixel/HUD notes](#155-pixelhud-notes)
- [16. Waves & the Incident System](#16-waves--the-incident-system)
  - [16.1 The 20-wave campaign](#161-the-20-wave-campaign)
  - [16.2 Boss wave — Singularity Night](#162-boss-wave--singularity-night)
  - [16.3 What makes an Incident, not a stat tick](#163-what-makes-an-incident-not-a-stat-tick)
  - [16.4 The Incident table](#164-the-incident-table)
- [17. Strategic Decisions & Tradeoffs](#17-strategic-decisions--tradeoffs)
- [18. Core Gameplay Loop](#18-core-gameplay-loop)
- [19. Player Experience & Aesthetics (MDA)](#19-player-experience--aesthetics-mda)
  - [19.1 The intended emotional arc](#191-the-intended-emotional-arc)
  - [19.2 Target feelings](#192-target-feelings)
  - [19.3 Mechanics → Dynamics → Aesthetics map](#193-mechanics--dynamics--aesthetics-map)
- [20. MVP Scope](#20-mvp-scope)
  - [Resources](#resources)
  - [Buildings](#buildings)
  - [Models](#models)
  - [Training Methods](#training-methods)
  - [Request Types](#request-types)
  - [Vertical-slice goal](#vertical-slice-goal)
  - [Explicitly deferred](#explicitly-deferred)
  - [As-built notes (v0.1)](#as-built-notes-v01)
- [21. Technical Architecture](#21-technical-architecture)
  - [Stack & project setup](#stack--project-setup)
  - [Fixed-timestep simulation, decoupled from rendering](#fixed-timestep-simulation-decoupled-from-rendering)
  - [Entity / component model](#entity--component-model)
  - [System list](#system-list)
  - [Data-driven content](#data-driven-content)
  - [Rendering notes (PixiJS v8, pixel art)](#rendering-notes-pixijs-v8-pixel-art)
  - [Procedural Web Audio](#procedural-web-audio)
  - [Game state machine](#game-state-machine)
  - [Save / load & testing](#save--load--testing)
- [22. Development Roadmap](#22-development-roadmap)
  - [M0 — Scaffold & tooling](#m0--scaffold--tooling)
  - [M1 — One playable lane](#m1--one-playable-lane)
  - [M2 — Power & cooling constraints](#m2--power--cooling-constraints)
  - [M3 — Routing & caching](#m3--routing--caching)
  - [M4 — Data pipeline & Training Lab](#m4--data-pipeline--training-lab)
  - [M5 — Safety, threats & economy](#m5--safety-threats--economy)
  - [M6 — Depth, incidents & boss](#m6--depth-incidents--boss)
- [23. Glossary](#23-glossary)
- [24. References](#24-references)
- [25. Open Design Questions](#25-open-design-questions)

## 1. Concept & Core Fantasy

You are not learning AI slides. You are holding the line for an AI platform under load.

A trend goes viral. Traffic floods in. Somewhere a launch tweet is climbing, an enterprise contract just signed, and a coordinated jailbreak campaign is hiding in the noise. Your one job is to keep serving — **fast, cheap, correct, and safe** — before the surge buries the service you run.

> **The strongest-version pitch:** _GigaPrompt Tower Defense (GPTD) is a pixel tower-defense management game where waves of user Requests try to overwhelm your AI platform. Build data centers, train Models, route traffic, manage electricity and cooling, and protect user Trust while scaling from a tiny startup model to a global AI platform._

The central inversion that separates GPTD from ordinary tower defense:

> **You are not killing the enemy. You are processing it.** Each Request is a unit of demand that must be _served_ before it leaks. Towers do not "shoot to destroy" — they spend compute to _complete_ a Request's Work Required. An unserved Request is not a monster that got past you; it is a customer you failed.

A wave is a flood of Requests advancing down your data-center lane. Your towers are GPU Racks, Routers, Cache Servers, Safety Gates, data pipelines, training labs, and model-serving buildings. Your base is the **Trust Core** (see §3): not one HP bar but three loss conditions you defend at once.

Serving _well_ is a four-part bar, and a Request only counts as fully served if it clears all four:

- **Fast** — answered inside its Latency Deadline, before it leaks and damages SLA.
- **Cheap** — routed to the cheapest _capable_ Model so Reward exceeds inference, power, and cooling cost (see §8 Routing, §14 Money).
- **Correct** — answered by a Model whose Quality meets the Request's Complexity, so it is not a bad answer.
- **Safe** — passed through a Safety Gate that clears any Safety Risk, so it is not an unsafe answer.

```text
The served bar — a Request only "counts" when ALL FOUR are green:

   FAST     ████████░░   served before latency_deadline      → protects SLA
   CHEAP    ████████░░   reward > inference + power + cooling → protects Cash Runway
   CORRECT  ████████░░   model_quality >= complexity          → protects Trust
   SAFE     ████████░░   safety_risk cleared by a Safety Gate  → protects Trust

   miss ANY one bar → the serve is tainted, and a Trust Core meter bleeds.
```

To survive, the player builds GPU clusters, Power Plants, Cooling Towers, network routing, model-serving towers, data pipelines, training and distillation labs, RLHF/alignment work, caches and retrieval systems, and Safety Gates. The core fantasy is not running a dashboard — it is physically standing up a working AI platform and keeping it alive under load. Every mechanic is a real serving-systems tension translated into a tower-defense decision; nothing on screen is a buzzword to recognize, only a lever to pull.

> **Core design rule:** Not every Request should go to the biggest Model. The fun lives in the gap between brute-forcing the frontier and routing each Request to the cheapest thing that can still serve it correctly and safely (see §8 Routing).

```text
PixiJS note: a "served" Request should read instantly on screen.
  fast   → green latency timer never empties
  cheap  → coin/Reward popup at the Response Exit
  correct→ no red "bad answer" flash
  safe   → no purple Safety Risk aura survives the Safety Gate
```

## 2. Win & Lose Conditions

GPTD has no single HP bar. You win by _staying alive and healthy across the wave set_; you lose the instant any one of the three Trust Core meters bottoms out.

**Win condition.** A wave is survived when its Requests are answered fast, cheaply, correctly, and safely, and all three Trust Core meters remain above zero. A run is won when the full set of authored waves — through the Singularity Night boss (see §16 Waves & the Incident System) — is survived with Trust, SLA, and Cash Runway all still standing. Concretely, you are winning a wave when:

```text
served_fast   : answered before latency_deadline        (protects SLA)
served_cheap  : reward > inference + power + cooling cost (protects Cash Runway)
served_correct: model_quality >= request_complexity      (protects Trust)
served_safe   : safety_risk cleared by a Safety Gate      (protects Trust)
AND Trust > 0  AND SLA > 0  AND Cash Runway > 0
```

**Lose condition.** The run ends the moment **Trust, SLA, or Cash Runway hits zero**. Because each meter has multiple drain paths defended by a _different_ part of the build, failure is multidimensional — there are many distinct ways to die, and a defense tuned against one does nothing for the others.

> **Design rule:** The three meters are never averaged into one. You can **technically defend but go bankrupt** — every Request answered, every deadline met, yet you ran the Frontier Model everywhere and Cash Runway bled out. You can **earn a fortune but lose Trust** — fat margins on cheap Small Models that quietly shipped bad and unsafe answers until users stopped believing you. Surviving the wave is not the same as surviving the run.

### Failure pathways

Each row is a distinct way to die. Note the _meter drained_ column: the same wave can kill you down three different axes depending on how you under-built.

| #   | Failure                | Trigger                                                                | Meter drained               | Why it happens                                                |
| --- | ---------------------- | ---------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| 1   | **Timeout**            | Request not served before its Latency Deadline; it leaks               | SLA, then Trust             | Not enough serving speed / throughput for the incoming volume |
| 2   | **Bad answer**         | Request completed but `model_quality < request_complexity`             | Trust                       | Routed to a Model too weak for the Request's Complexity       |
| 3   | **Unsafe answer**      | Jailbreak/Abuse Request served without clearing Safety Risk            | Trust (heavy)               | No Safety Gate in the path, or Safety too weak                |
| 4   | **Overload**           | Too many Requests funneled to one cluster, cascading timeouts          | SLA, then Trust             | Poor routing / no Load Balancing                              |
| 5   | **Brownout**           | `total_power_draw > electricity_capacity` → random GPU Racks shut down | SLA, then Trust (via leaks) | Under-built Power Plants vs. GPU draw (see §15)               |
| 6   | **Thermal Throttling** | `total_heat > cooling_capacity` → all GPU towers lose speed            | SLA, then Trust (via leaks) | Under-built Cooling Towers vs. GPU heat (see §15)             |
| 7   | **Bankruptcy**         | Overspending on hardware, power, or training drains the reserve        | Cash Runway                 | Buying GPUs/training faster than served Reward can fund       |

> **Design rule:** Brownout and Thermal Throttling do not kill you directly — they degrade serving, which produces _timeouts_, which leak and bleed SLA and Trust. Every infrastructure failure routes back to one of the three meters. There is no failure that "doesn't matter," and no single fix that closes all seven paths at once.

## 3. The Trust Core

The thing you defend is **the Trust Core** — a single base object that holds three independent health bars. You do not lose when one big number empties; you lose when _any_ of three empties, so all three are always in tension.

| Core meter      | Meaning                                    | Raised by                                                                                                                    | Lowered by                                                                                                   |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Trust**       | Users believe the Model is useful and safe | Serving correctly and safely; satisfied Enterprise traffic; Research-benchmark and Safety-audit reputation rewards (see §14) | Requests that leak unanswered, get bad answers, or get unsafe answers                                        |
| **SLA**         | Latency and uptime commitments             | Serving every Request inside its Latency Deadline; healthy throughput headroom                                               | Slow answers, timeouts, overload, Brownout/Throttling-induced leaks                                          |
| **Cash Runway** | Whether the company can keep operating     | Reward (Cash) from served Requests                                                                                           | Overspending on hardware, power, or training (`profit = revenue − inference − power − maintenance`; see §14) |

The wiring is direct: if Requests leak through unanswered, **Trust** drops; if Requests are answered too slowly, **SLA** drops; if you overspend on hardware, power, or training, **Cash Runway** drops.

> **Why three simultaneous pressures beat a single HP bar:** A single HP bar collapses every threat into one number, so any defense that adds HP defends against everything, and the optimal play is always "more." Three meters refuse that. Each is defended by a _different_ part of the build, so they pull against each other:
>
> - Buying GPU Racks to protect **SLA** raises power and maintenance cost, draining **Cash Runway**.
> - Cutting cost to protect **Cash Runway** can starve serving, leaking Requests and draining **Trust** and **SLA**.
> - Cranking up the Frontier Model to protect **Trust** burns **Cash Runway** and may blow your power budget into a Brownout that wrecks **SLA**.
>
> There is no single dial that fixes the base — only a balance that keeps all three alive at once. The skill is not maximizing one number; it is refusing to let any one fall while the others are under fire.

```text
Three meters, three independent drain paths, one shared base:

   ┌──────────────────────── TRUST CORE ────────────────────────┐
   │  TRUST       ███████░░░   ← leaks, bad answers, unsafe       │
   │  SLA         ████████░░   ← timeouts, overload, brownout     │
   │  CASH RUNWAY ██████░░░░   ← overspend on GPUs/power/training  │
   └─────────────────────────────────────────────────────────────┘
   ANY bar hits 0 → run over. They are never summed or averaged.
```

```text
PixiJS note: render the Trust Core as one base sprite with THREE
stacked bars (Trust / SLA / Cash Runway). A meter hitting zero
should flash and trigger the lose state — never average them into one.
```

## 4. Enemies: The Request Taxonomy

The Request taxonomy is the **top design priority** of GPTD. It is the spawn table the whole game is balanced around: every other system — Models, Routing, Caching, Safety, Power — exists because the taxonomy poses a problem that one tool cannot solve. Get the taxonomy right and the strategy emerges on its own.

Each **Request** is an enemy unit that moves along the lane. The defining twist: instead of HP, a Request carries **Work Remaining** — the processing a Serving Tower must complete to finish it (see §6 Request Resolution).

### Request stat block

Every Request type is fully described by this eight-field stat block. These are the only numbers that define an enemy; everything the player builds is an answer to some field in this block.

```text
type                    # taxonomy label (Simple Chat, Coding, Reasoning, ...)
work_required           # processing needed to complete (= effective HP)
complexity              # min model Quality needed for a correct answer (= armor)
latency_deadline        # time before it leaks and damages SLA/Trust
safety_risk             # jailbreak/abuse danger to clear (= poison/status)
context_length          # token footprint; consumes memory and GPU time
reward                  # Cash (and sometimes Data/Trust) on a fast/cheap/correct/safe serve
trust_penalty_if_failed # Trust lost if it leaks or is mishandled
```

Example unit:

```text
Coding Request
type                    : Coding
work_required           : 120
complexity              : 40
latency_deadline        : 12 s
safety_risk             : 0
context_length          : medium
reward                  : $5
trust_penalty_if_failed : -3 Trust
```

### Tower-defense mapping

This is the bridge from familiar TD vocabulary to GPTD's mechanics:

| Request stat         | TD equivalent                     | Effect in GPTD                                                             |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| **Work Required**    | HP                                | Drained by Serving Tower processing until it reaches 0                     |
| **Complexity**       | Armor                             | A correct answer needs `model_quality >= complexity`, else a bad answer    |
| **Latency Deadline** | Leak timer                        | Counts down; on zero the Request leaks, hitting SLA and Trust              |
| **Safety Risk**      | Poison / stealth / special status | Must be cleared by a Safety Gate or it deals Trust damage on serve         |
| **Context Length**   | Unit weight / size                | Consumes KV Cache memory and GPU time; oversized prompts stall weak Models |
| **Reward**           | Money on kill                     | Cash (and sometimes Data or Trust) paid out only on a clean serve          |

> **Design rule:** A Request never "dies" from damage. It is _completed_ when Work Remaining reaches zero — and only counts if Quality cleared its Complexity, the Safety Gate cleared its Safety Risk, and the Latency Deadline was not missed. Speed alone is never enough.

### The Request taxonomy

The design target is that **each request type forces a different answer**. No single Model, tower, or routing rule handles the whole table — a build that crushes one row will visibly fail another. The 🟢 column marks types (and wave modifiers) in the MVP subset.

| Request type                      | work_required       | complexity | latency_deadline   | safety_risk | context_length | reward          | trust_penalty_if_failed | The answer it forces                                                                                                                               | MVP |
| --------------------------------- | ------------------- | ---------- | ------------------ | ----------- | -------------- | --------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **Simple Chat**                   | low                 | low        | medium             | none        | short          | low (high data) | small                   | **Small Model** — cheap volume; routing one of these to the Frontier is pure margin loss                                                           | 🟢  |
| **Coding**                        | medium              | high       | medium             | none        | medium         | high            | medium                  | **Coding-capable / General+ Model** — Quality must clear Complexity or it's a bad answer                                                           | 🟢  |
| **Reasoning**                     | high                | very high  | long               | none        | medium         | high            | high                    | **Frontier Model** — only high Quality+Reasoning serves it correctly; nothing cheaper does                                                         | 🟢  |
| **Long Context**                  | medium              | medium     | long               | none        | very long      | medium          | medium                  | **KV Cache / PagedAttention + high-Context Model** — the prompt itself is the threat (memory + GPU time), not its Complexity (see References, [4]) | 🟢  |
| **Jailbreak**                     | low–medium          | medium     | medium             | **high**    | short–medium   | low             | **heavy**               | **Safety Gate (+ RLHF'd Model)** — must clear Safety Risk before exit, or it's an unsafe answer that hammers Trust                                 | 🟢  |
| **Enterprise**                    | medium              | high       | **strict (short)** | none        | medium         | **very high**   | **very heavy**          | **Priority Queue (reserved-capacity lane)** — lucrative but a single missed deadline is outsized SLA+Trust damage                                  | 🟢  |
| **Bot Swarm** _(wave modifier)_   | very low            | trivial    | lax                | varies      | short          | ~$0             | low each                | **Rate Limiting** — cap intake so worthless volume can't starve compute/power from paying Requests                                                 |     |
| **Viral Spike** _(wave modifier)_ | low (massive count) | low        | medium             | none        | short          | low each        | low each                | **Cache Server + Continuous Batching + distilled Small Model** — repeats and bulk, never the frontier (see References, [1][4])                     |     |

> Note on naming: the MVP request set is **Simple Chat, Coding, Reasoning, Long Context, Enterprise, Jailbreak**. **Bot Swarm** and **Viral Spike** are post-MVP wave/incident pressures (see §16), expressed as floods or modifiers over the MVP types rather than new enemy stat blocks — Viral Spike is a count multiplier on small Requests, Bot Swarm is a worthless-traffic overlay that tests Rate Limiting.

Why each row demands a different tool:

- **Simple Chat** rewards the cheapest tier; over-serving it bankrupts you on volume.
- **Coding** is the first wall where a fast cheap Model empties the Work bar yet flunks `model_quality >= complexity` — a _bad answer_. It forces the Training Lab and specialization (see §11).
- **Reasoning** is genuinely hard armor: only Frontier-grade Quality clears it, so you cannot route around it with throughput. Speculative Decoding (see §10, References, [5]) keeps that slow Frontier card inside the Deadline.
- **Long Context** attacks a different axis entirely — its Complexity is unremarkable, but its `context_length` burns KV Cache memory and GPU time, so the answer is a memory technique (KV Cache / PagedAttention), not a stronger Model.
- **Jailbreak** is the only row with real `safety_risk`; it is camouflaged in normal traffic and must hit a Safety Gate. Pure serving power does nothing for it.
- **Enterprise** is defined by its strict Deadline and outsized penalty, so the answer is a _reserved lane_ (Priority Queue), not raw speed shared with best-effort traffic.
- **Bot Swarm** and **Viral Spike** attack capacity itself — the first by wasting it (answer: Rate Limiting), the second by saturating it with repeats and bulk (answer: Cache + Continuous Batching + a distilled Small Model).

> **The lesson of the taxonomy:** _Not every request deserves the frontier model._ The eight rows above are deliberately impossible to beat with one Model or one tower. A correct build is a _portfolio of cheapest-capable answers_ — Small for chat, specialized for code, Frontier for reasoning, cache for repeats, a Safety Gate for risk, a Priority Queue for Enterprise, and Rate Limiting for junk. That portfolio is expressed entirely through the Router (see §8), which is why Routing is the skill.

```text
PixiJS note: encode stats as readable sprite cues —
  work_required   → length of a shrinking work bar
  complexity      → an armor pip / shield icon
  latency_deadline→ a draining ring/timer on the unit
  safety_risk     → a purple hazard aura
  context_length  → unit size / "weight" footprint
  reward          → coin tier badge on the unit
Tag Jailbreak units so the hazard aura only reveals on Router inspection —
they are meant to hide inside legitimate traffic.
```

Now producing my two sections.

## 5. The Map & The Serving Pipeline

The map is not an abstract battlefield — it is your **serving pipeline** drawn as a lane. Every stage a Request crosses is a real stage of an AI-platform request lifecycle, and each stage is where the relevant class of tower physically lives. Requests spawn at the left as **User Traffic**, advance stage by stage, and either exit clean at the **Response** stage (paying Reward) or leak somewhere upstream and strike the **Trust Core** at the right.

> **Design rule:** The path _is_ the pipeline. Processing a Request before its **Latency Deadline** is a successful defend; a **timeout**, a **bad answer**, or an **unsafe answer** is a hit on the Trust Core. There is no separate "enemy goal tile" — the goal tile is your own infrastructure failing to serve.

### 5.1 The serving pipeline

```text
User Traffic → API Gateway → Router → Context Builder → Model Inference → Safety Check → Response → Trust Core
```

- **User Traffic** — ingress; where the wave's Requests spawn (Free chat, Plus, Enterprise, and during later waves Bot Swarm / Viral Spike modifiers; see §4).
- **API Gateway** — admission control. Where **Rate Limiting** caps low-value, high-volume traffic (Bot Swarm) and **Load Balancing** spreads Requests across clusters so no one Serving Tower is swamped (see References for both). A Request rejected here never reaches compute.
- **Router** — classifies each Request and assigns it to the cheapest _capable_ destination: a Serving Tower, the Cache Server, or the safety pipeline. This is the skill-expression stage (see §8).
- **Context Builder** — where **Context Length** is paid. **Cache Server** hits short-circuit the rest of the lane at near-zero compute; **RAG** retrieval and **KV Cache / PagedAttention** resolve here, assembling the prompt the Model will actually run.
- **Model Inference** — the **Inference Zone**, where Serving Towers run a loaded Model on connected GPU Racks and drain **Work Required**. This is the only stage that consumes real GPU throughput, power, and heat budget.
- **Safety Check** — the **Safety Gate**, where Safety Filters clear a Request's **Safety Risk**. An uncleared risky serve exits as an _unsafe answer_ and deals heavy Trust damage.
- **Response** — clean exit. A Request served fast, cheap, correct, and safe pays **Reward** (Cash, and sometimes Raw Data) here.
- **Trust Core** — your base (see §3). Anything that leaks, times out, answers wrong, or answers unsafe lands a hit on Trust, SLA, or Cash Runway here.

> Earlier lane vocabulary maps one-to-one onto these stages: _Internet Gateway_ → API Gateway, _Context Assembly_ → Context Builder, _Inference Zone_ → Model Inference, _Safety Gate_ → Safety Check, _Response Exit_ → Response. The pipeline names are the canonical stage labels.

### 5.2 Where each tower class sits

Each tower class has a fixed home stage on the lane — placement is constrained, not free-form, so the player reads the pipeline at a glance:

| Pipeline stage      | Tower class living there                                        | Job                                                           |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| **API Gateway**     | 🟢 Load Balancer / Rate Limiter (Router-adjacent infra)         | Admit, throttle, and spread incoming volume                   |
| **Router**          | 🟢 **Router**                                                   | Classify and assign each Request to its cheapest capable lane |
| **Context Builder** | 🟢 **Cache Server**, RAG Index, KV Cache                        | Resolve repeats and assemble context cheaply                  |
| **Model Inference** | 🟢 **GPU Server** (Small / General / Frontier), 🟢 **GPU Rack** | Drain Work Required by running the loaded Model               |
| **Safety Check**    | 🟢 **Safety Gate** (Safety Filter)                              | Clear Safety Risk before exit                                 |

### 5.3 Lane + back-row layout

The map splits into a **front lane** (the serving path Requests travel) and a **back row** (infrastructure that powers and cools the lane but never touches a Request directly):

```text
[User Traffic]
     ↓
Front lane (serving pipeline):
  Ingress ─ API Gateway ─ Router ─ Context Builder ─ Model Inference ─ Safety Check ─ Response ─▶ [Trust Core]
                            │            │                  │
                            │            ├── Cache / RAG     │
                            │            └── Priority Queue  │ (Enterprise / strict-SLA lane)
                            │
                       Data / Training Area  (off-lane; feeds the between-wave loop)

Back row (infrastructure, not on the lane):
  Power Plants ─ Substations ──┐
                               ├──▶ GPU Racks  (Model Inference stage)
  Cooling Towers ─ Chillers ───┘
```

The **front lane** is what Requests walk. The **back row** is provisioning: Power Plants feed Electricity through substations into the GPU Racks at the Model Inference stage, and Cooling Towers feed heat capacity through chillers into the same Racks. The **Data / Training Area** sits off-lane entirely — it does not touch Requests in real time; it feeds the between-wave upgrade loop (see §11 Training, §13 Data). The **Priority Queue** is a reserved-capacity sub-lane that pulls Enterprise / strict-SLA traffic ahead of best-effort Requests so lucrative deadlines are protected (see References).

This spatial split is what makes **wiring, electricity, and cooling** real gameplay instead of flavor. A GPU Rack stranded from power or cooling is dead weight at the very stage that does all the work.

> **Design rule — GPU towers are not standalone weapons.** A GPU tower at the Model Inference stage only works when connected to all four of:
>
> - **power** (Electricity from the back-row Power Plants; under-supply → Brownout, see §15)
> - **cooling** (heat capacity from the back-row Cooling Towers; under-supply → Thermal Throttling, see §15)
> - **network** (routing/connectivity from the Router and back-row wiring)
> - **model checkpoint** (a loaded Model card; a Rack with no Model serves nothing)
>
> Miss any one and the Rack contributes zero throughput. The player is building a _working serving pipeline_, not a row of turrets.

When GPU load at the Inference stage outruns its back-row supports, the failure cascades straight forward down the lane into the Trust Core meters of §2–§3:

```text
GPU load > power or cooling
  → GPUs throttle / brownout at Model Inference
  → Work Required drains too slowly
  → Requests miss their Latency Deadline and leak before Response
  → SLA drops (then Trust)
If it worsens: overheat → hardware damage → repair cost → Cash drop + downtime
```

```text
PixiJS note: draw the lane as the literal pipeline (User Traffic → … → Trust Core),
with power drawn as wires from Power Plants and coolant as pipes from Cooling Towers
into each GPU Rack. An unpowered or unconnected Rack renders dark/idle so the player
sees at a glance which towers at the Inference stage are actually firing. A leak should
fire a short streak from the failing stage straight into the Trust Core sprite.
```

## 6. Request Resolution & Combat Logic

A Request is an enemy carrying **Work Required** instead of HP. A Serving Tower at the Model Inference stage "attacks" it by completing that Work each tick — but unlike an ordinary tower-defense bullet, emptying the Work bar is not enough. The answer must also be **correct**, **safe**, and **on time**. Resolution is therefore a **multi-gate check**, which is exactly what makes a _leaked_ Request and a _served_ Request meaningfully different outcomes, and what gives GPTD several distinct ways to lose the same enemy.

### 6.1 Worked example

A single Coding Request enters the lane carrying this stat bundle:

```text
Coding Request
Work Required : 120
Complexity    : 40
Deadline      : 12 seconds
Reward        : $5
Failure       : -3 Trust
```

The Router assigns it to a Serving Tower running a coding-specialized **General Model** (Quality 62, Speed 70, Specialization +10 vs Coding) on a GPU Rack delivering GPU_power 1.0, with a serving_bonus of 1.0 (no batching/spec-decoding yet):

```text
processing_rate = GPU_power × model_speed × serving_bonus
                = 1.0       × 70          × 1.0
                = 70 work / second

time_to_drain   = work_required / processing_rate
                = 120 / 70
                ≈ 1.7 seconds                     →  1.7s ≤ 12s deadline   ✓ on time

answer_quality  = model_quality + specialization_bonus − request_complexity
                = 62            + 10                  − 40
                = +32                                →  +32 ≥ 0             ✓ correct

safety_passed   = (Safety Risk low; cleared at Safety Check)  → true        ✓ safe
```

All four gates hold, so the Request exits at **Response** and the Trust Core gains **$5**. Now swap in a bare **Small Model** (Quality 54, no coding specialization). Even though its Speed of 92 drains the Work bar _faster_ (≈1.3s, comfortably on time), `answer_quality = 54 + 0 − 40 = +14` — still correct here. Push Complexity to 60 instead and the Small Model yields `54 + 0 − 60 = −6 < 0`: the Work bar empties, the deadline is met, the Request is safe, and it **still leaks for −3 Trust** as a _bad answer_. Speed never substitutes for Quality.

### 6.2 Processing rate

Each tick, the Serving Tower applies its **processing rate** against the Request's remaining Work. Processing rate is a product of the GPU hardware, the loaded Model's Speed, and the serving optimizations stacked on the tower:

```text
processing_rate = GPU_power × model_speed × serving_bonus

work_remaining -= processing_rate × Δt        (each tick)
```

- **GPU_power** — raw inference throughput from the GPU Racks feeding this tower, _degraded by Brownout (random Rack shutdown) and Thermal Throttling (global speed loss); see §15._
- **model_speed** — the loaded Model's Speed stat (tokens/sec; see §9).
- **serving_bonus** — the combined multiplier from inference-systems optimizations on this tower: **Batching** and **Continuous Batching** for throughput under volume, **Speculative Decoding** to lift a Frontier Model's effective Speed with no Quality loss, and **KV Cache / PagedAttention** for long-context efficiency (see §10 and References). A bare tower with no optimizations runs at 1.0.

> **Design rule:** Processing rate only empties the Work bar — it answers the _fast_ question and nothing else. Quality, Safety, and the Deadline are independent gates. A blazing-fast Small Model still produces a _bad answer_ on a high-Complexity Request, no matter how quickly it finishes.

### 6.3 Answer quality

Whether a finished Request is _correct_ is a separate computation from how fast it drained. **Answer quality** measures how far the loaded Model's effective Quality clears the Request's Complexity:

```text
answer_quality = model_quality + specialization_bonus − request_complexity
```

- **model_quality** — the loaded Model's Quality stat (raised by Pretraining, Fine-tuning, RLHF, RAG; see §11).
- **specialization_bonus** — the bonus the Model's Specialization grants against a _matching_ Request type (a coding-tuned Model vs a Coding Request, a reasoning Model vs a Reasoning Request). Zero on a mismatch.
- **request_complexity** — the Request's Complexity (its armor; the minimum Quality needed for a correct answer; see §4).

If `answer_quality ≥ 0` the Model met or beat the armor and the answer is correct; if `answer_quality < 0` the Work still finishes but the answer is **bad** and costs Trust.

### 6.4 The multi-gate success condition

A Request is served successfully only if **all four** conditions hold at the moment Work hits zero:

```text
work_remaining   <= 0          # finished the compute (driven by processing_rate)
and  answer_quality   >= 0          # answer is correct: quality meets complexity
and  safety_passed                  # cleared Safety Risk at the Safety Check stage
and  deadline_not_exceeded          # delivered before the Latency Deadline
```

Because the gates are **independent**, a Request can be "finished" and still fail. A fast cheap Model drains the Work bar yet flunks `answer_quality >= 0` (bad answer); a Request routed past the Safety Check unscreened flunks `safety_passed` (unsafe answer); a correct, safe answer that arrives a tick too late flunks `deadline_not_exceeded` (timeout). This independence is the core richness of GPTD's combat over ordinary tower defense — four orthogonal ways to lose the same enemy, each defended by a different part of the build.

> **Design rule:** Speed empties the Work bar; Quality clears the armor; the Safety Gate clears the poison; the Deadline is the leak timer. No single gate wins a Request, and a defense tuned for one gate does _nothing_ for the other three.

> **As-built note (held pending safety review):** In the shipped build, a Request whose Work hits zero but whose Safety Risk is still _uncleared_ is not scored immediately — it is **held**, flowing on (at Work 0) until a Safety Gate clears it (→ served) or it leaks at the core (→ a Trust **breach**). So you never serve an unsafe answer outright; you only fail to screen one before it leaks — which is exactly why a Safety Gate must sit _before_ the core.

### 6.5 Failure modes

Every way a Request — or a whole serving pipeline — can fail maps to one of the three Trust Core meters. The first four are _direct_ serving failures at the lane stages; the next three are _infrastructure_ failures that reach Trust **indirectly** — they degrade serving until Requests miss deadlines and leak, then the leaks bleed the meters:

| Failure           | Cause                                                                    | Pipeline stage           | Hits                      |
| ----------------- | ------------------------------------------------------------------------ | ------------------------ | ------------------------- |
| **Timeout**       | Not enough processing rate for the volume; `deadline_not_exceeded` fails | Model Inference / Router | SLA → Trust               |
| **Bad answer**    | `answer_quality < 0`; Model Quality too low for Complexity               | Model Inference          | Trust                     |
| **Unsafe answer** | `safety_passed` false; Safety Risk uncleared                             | Safety Check             | Trust (heavy)             |
| **Overload**      | Too many Requests funneled to one cluster, cascading timeouts            | API Gateway / Router     | SLA → Trust               |
| **Brownout**      | `total_power_draw > electricity_capacity`; random GPU Racks shut down    | Model Inference (infra)  | SLA → Trust _(via leaks)_ |
| **Throttling**    | `total_heat > cooling_capacity`; all GPU towers lose speed               | Model Inference (infra)  | SLA → Trust _(via leaks)_ |
| **Bankruptcy**    | Overspending on hardware, power, or training drains the reserve          | Economy (off-lane)       | Cash Runway               |

> **Design rule:** Brownout and Thermal Throttling never kill you _directly_. They cut `GPU_power`, which slows `processing_rate`, which makes `work_remaining` drain too slowly, which trips `deadline_not_exceeded` into a **Timeout** — and _that_ leak is what bleeds SLA and then Trust. Overload reaches the meters the same way: a clogged cluster is just a timeout factory. Bankruptcy is the lone failure that bypasses the lane entirely, draining Cash Runway through the profit formula (`profit = revenue − inference − power − maintenance`; see §14).

> **Design rule:** A run is never lost to one number. These seven failure modes keep Trust, SLA, and Cash Runway in constant three-way tension — fixing processing rate can bankrupt you, cutting cost can leak bad answers, and skipping the Safety Check can torch Trust even while every other gate passes. Multidimensional failure is the point.

## 7. Towers & Buildings: Model, GPU, Infrastructure

Every weapon system in GigaPrompt Tower Defense is built from three layers that must all be present before a single Request is served. They are not interchangeable, and confusing them is the most common way new players lose:

```text
LAYER 1  MODEL          = weapon design    → quality, speed, cost, safety
         (the ammunition: see §9)            "How good is the shot?"

LAYER 2  GPU            = firepower         → throughput, parallel capacity
         (the gun barrel: GPU Server/Rack)   "How many shots, how fast?"

LAYER 3  INFRASTRUCTURE = can it run at all → power, cooling, router, cache, safety
         (power/cooling/network/safety)      "Does the gun even turn on?"
```

> **The central relationship:** A **Model** decides _whether an answer is good_ (Quality vs Complexity, Speed vs Deadline, Cost vs Reward, Safety vs Risk). A **GPU** decides _how much work per second_ you can deliver and how many Requests run in parallel. **Infrastructure** decides _whether the weapon fires at all_ — an unpowered, uncooled, unrouted, or unloaded GPU contributes exactly zero. You do not place turrets; you wire up a working AI data center where all three layers line up over the same Rack.

This three-layer split is why "buy a bigger Model" or "buy more GPUs" both fail in isolation. A Frontier Model (Layer 1) loaded onto a GPU Server (Layer 2) with no Power Plant behind it (Layer 3) browns out and serves nothing. A wall of GPU Racks with no Model checkpoint loaded is a row of empty guns. The skill is keeping all three provisioned in proportion (see §11 Scaling Laws, §15 Power, Cooling & the Data Center).

> 🟢 marks buildings in the MVP scope. In PixiJS terms each building is a sprite on the back-row/lane grid with a live connection state (powered / cooled / networked / loaded) surfaced as small status pips, so a dark tower reads at a glance.

### 7.1 Serving Towers

These are the **guns** — they directly deplete a Request's Work Required by running a loaded **Model** (the ammunition, see §9) on connected **GPU Racks** (the firepower). A Serving Tower with no loaded Model is an empty gun; a Serving Tower with no GPU behind it is a gun with no powder. The central decision is **which** tower — and therefore which Model — a Request lands on; sending everything to the biggest server is the classic mistake (see §8 Routing).

| Tower                              | Role                                                        | MVP |
| ---------------------------------- | ----------------------------------------------------------- | --- |
| 🟢 **GPU Server (Small Model)**    | Cheap, fast; handles Simple Chat and cached/common Requests | 🟢  |
| 🟢 **GPU Server (General Model)**  | Balanced workhorse for most traffic                         | 🟢  |
| 🟢 **GPU Server (Frontier Model)** | Expensive, slow; handles hard Reasoning/Coding/Enterprise   | 🟢  |
| **Coding Model Server**            | Bonus against Coding waves                                  |     |
| **Reasoning Model Server**         | Bonus against math/planning Requests                        |     |
| **Multimodal Server**              | Handles image/audio Requests                                |     |
| **Embedding / Retrieval Server**   | Helps factual and Long Context Requests                     |     |

> **Design rule:** Not every Request should go to the biggest Model. Matching Request type to the _cheapest capable_ Serving Tower is a core gameplay decision, not an optimization afterthought. In the MVP there is one Serving Tower archetype — the **GPU Server** — and its behavior is fully determined by which of the three Model tiers is loaded into it (see §9.2). Specialized servers are a later-milestone extension.

### 7.2 Infrastructure Towers

These never empty a Work bar on their own — they **multiply or reroute** the work of Serving Towers, adding throughput, intelligence, caching, and safety. They are the part of Layer 3 that makes serving _smart_ rather than merely _possible_.

| Building                        | Function                                                                                                                                                                     | MVP |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| 🟢 **GPU Rack**                 | Adds inference throughput (the firepower a GPU Server fires with)                                                                                                            | 🟢  |
| **GPU Upgrade**                 | More tokens/sec, more VRAM                                                                                                                                                   |     |
| 🟢 **Router**                   | Sends easy Requests to cheap Models and hard ones to strong Models (see §8)                                                                                                  | 🟢  |
| **Load Balancer**               | Spreads Requests so no one cluster is overwhelmed; prevents Overload cascades                                                                                                |     |
| 🟢 **Cache**                    | **Aura** — gives Serving Towers in range a chance to instantly answer a cacheable Request (a cache hit returns a stored answer). Needs a server to overlap; see §20 as-built | 🟢  |
| **KV Cache Upgrade**            | Improves long-conversation efficiency (see §10)                                                                                                                              |     |
| **Batching Controller**         | Increases throughput, may add small latency                                                                                                                                  |     |
| **Speculative Decoding Engine** | Uses a small Model to speed up a big Model                                                                                                                                   |     |
| 🟢 **Safety Gate**              | Clears Safety Risk before a Request exits; stops Jailbreaks                                                                                                                  | 🟢  |
| **Monitoring Center**           | Detects overloads, outages, bad model behavior                                                                                                                               |     |

### 7.3 Resource Towers

These make the data center physically possible — the Layer 3 constraints that decide whether any GPU fires at all. This is where "power plants, contracts, wires, hardware, electricity, cooling" become real gameplay constraints (see §15) rather than flavor.

| Building                            | Resource                                    | MVP |
| ----------------------------------- | ------------------------------------------- | --- |
| 🟢 **Power Plant**                  | Increases electricity capacity              | 🟢  |
| **Substation**                      | Distributes electricity to nearby buildings |     |
| 🟢 **Cooling Tower**                | Increases heat capacity                     | 🟢  |
| **Chiller Upgrade**                 | Prevents GPU Thermal Throttling             |     |
| **Battery Storage**                 | Handles power spikes                        |     |
| **Fiber Backbone**                  | Improves routing and latency                |     |
| **Warehouse / Supply Chain Office** | Speeds up hardware delivery                 |     |

> 🟢 The **Training Lab** is also an MVP building, but it is an _off-lane_ between-wave structure that never processes Requests in real time. It belongs to the training tech tree (see §11), not to the serving line, and is listed here only for completeness.

### 7.4 The four-connection firing rule

The single rule that ties all three layers together — and the reason this section is structured around them:

> **Design rule — a GPU Server fires only when connected to four things at once:**
>
> - **Model** — a loaded Model checkpoint (Layer 1). No checkpoint, no ammunition, no shot.
> - **Power** — Electricity from Power Plants (Layer 3). Under-supply → **Brownout**: random Racks go dark (see §15).
> - **Cooling** — heat capacity from Cooling Towers (Layer 3). Under-supply → **Thermal Throttling**: every GPU tower slows (see §15).
> - **Network** — routing/connectivity from the Router and back-row wiring (Layer 3). No network, no Requests reach the gun.
>
> Drop any one of the four and the Rack contributes **zero** throughput. The player is building a working AI infrastructure, not a row of turrets.

When Resource Towers can't keep up with GPU load, two cascades trigger. The first is recoverable pressure on SLA; the second costs real Cash:

```text
GPUs throttle → slower responses → Requests leak → SLA drops          (recoverable)
Overheat → hardware damage → repair cost → downtime → Cash drops      (costly)
```

> **Design rule:** Resource Towers are not optional scenery. Every GPU Rack you place raises both `power_draw` and `heat_output`; if those outrun your Power Plants and Cooling Towers you hand SLA (throttle/leak) or Cash (overheat/repair) straight to the loss conditions. Provisioning Layer 3 _ahead_ of the throughput it feeds is the difference between firepower and a dark, expensive wall.

---

## 8. Routing: The Core Skill

Routing is **THE** skill-expression tower of GigaPrompt Tower Defense. The Router classifies each incoming Request and assigns it to the cheapest _capable_ destination — a Serving Tower, the Cache, or the safety pipeline. Two players with identical buildings, identical Models, and identical power can post wildly different results based purely on how well their Router sorts traffic. This mirrors reality: the providers that win do not run the single biggest Model — they win on **system design**, on knowing which Request needs which Model and sending it there for the lowest cost that still clears every gate.

> **Why routing is the skill, not the scale:** Every other tower has a ceiling you can buy your way toward. The Router has no ceiling — a perfectly tuned Router on cheap hardware beats a careless Router on a frontier fleet, because it spends compute only where compute is needed. This is the design goal "reward system design over brute scaling" made into a single tower.

### 8.1 Three ways to route — two traps and the smart play

There are three archetypal strategies. Two are traps; the third is the actual game:

**Trap 1 — Cheap but risky (everything to the Small Model).** Point every Request at the cheapest tier and your margins look beautiful — until Complexity climbs past Quality:

```text
All Requests → Small Model
→ Simple Chat served cheaply (good)
→ Coding / Reasoning / Enterprise get model_quality < complexity
→ BAD ANSWERS → Trust bleeds → loss
```

**Trap 2 — Conservative but costly (everything to the Frontier Model).** The naive "safe" line: send every Request to the strongest Model so nothing is ever under-served. It looks safe and loses anyway:

```text
All Requests → Frontier Model
→ GPU overload (Speed 28 can't drain volume in time)
→ slow responses → TIMEOUTS → SLA bleeds
→ inference_cost + power_cost > reward on trivial traffic
→ negative profit → Cash Runway bleeds → loss
```

That single chain triggers three failure modes at once: **Overload** and **Timeout** (SLA + Trust) plus a slow slide toward **Bankruptcy** (Cash). It also strains §15 power and cooling, because a Frontier Model everywhere maximizes `power_draw`.

**The smart play — estimate difficulty and intent, then assign.** The Router reads each Request's _intent_ (what kind of work) and _complexity_ (how hard), then sends it to the cheapest destination whose stats still clear every gate:

```text
Simple / repeated → Cache              (instant, $0 compute)
Simple, novel     → Small Model        (cheap volume)
Coding            → Coding/General Model (Quality clears Complexity)
Hard Reasoning    → Frontier Model      (only where it's actually needed)
Unsafe (Jailbreak)→ Safety Gate         (clear Risk before any serve)
Enterprise / SLA  → Priority Queue      (reserved capacity, defended deadline)
```

> **Design rule:** The optimal strategy is _smart assignment_, not brute throughput. Caching repeats, distilling cheap Models (see §11), and routing each Request to its cheapest capable destination beats "buy more GPUs forever" — which is deliberately an inefficient, losing line. The Frontier Model is a scalpel reserved for the Requests that actually need it, not a hammer for all traffic.

### 8.2 Routing decision tree

The Router evaluates each Request top-down and stops at the first matching lane. Cache hits and safety screening come first because they short-circuit expensive compute and irreversible Trust damage:

```text
                        ┌─────────────────────┐
                        │  Incoming Request   │
                        └──────────┬──────────┘
                                   ▼
                        ┌─────────────────────┐
                        │ Seen before? (Cache)│──Yes──▶ Cache Server   (instant, $0 compute)
                        └──────────┬──────────┘
                                   │ No
                                   ▼
                        ┌─────────────────────┐
                        │ Safety Risk high?   │──Yes──▶ Safety Gate ───┐
                        └──────────┬──────────┘                        │ cleared
                                   │ No                                ▼
                                   ▼                          (continue routing)
                        ┌─────────────────────┐
                        │ Enterprise / SLA?   │──Yes──▶ Priority Queue  (reserved capacity)
                        └──────────┬──────────┘
                                   │ No
                                   ▼
                        ┌─────────────────────┐
                        │ Classify INTENT +   │   ← Intent Classifier + Complexity Estimator
                        │ estimate COMPLEXITY │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                      ▼
        Complexity LOW       Coding / specialized    Complexity HIGH
              │                    │                      │
              ▼                    ▼                      ▼
        Small Model         Coding Model           Frontier Model
              │                    │                      │
              └────────────────────┴──────────────────────┘
                                   ▼
                        ┌─────────────────────┐
                        │ Answer failed gate? │──Yes──▶ Fallback: retry on stronger Model
                        └─────────────────────┘
```

### 8.3 Router upgrades

Each upgrade sharpens one decision in the tree above. Together they convert the Router from a dumb splitter into the system's brain — the real-world "smart routing" stack of intent classification, difficulty estimation, and cost/SLA/safety awareness (see References):

| Upgrade                  | Sharpens               | Effect                                                                                                   |
| ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **Intent Classifier**    | The classify step      | Better Request-type detection, so Coding/Reasoning/Enterprise land on the right lane                     |
| **Complexity Estimator** | The LOW/HIGH split     | Estimates difficulty, sending hard Requests to stronger Models and easy ones to cheap ones               |
| **Cost-Aware Routing**   | Destination choice     | Picks the _cheapest_ capable Model, protecting Cash Runway against negative-profit serves                |
| **SLA-Aware Routing**    | The Enterprise branch  | Prioritizes strict-deadline traffic into the Priority Queue, defending lucrative SLAs                    |
| **Safety Routing**       | The Safety Risk branch | Forces risky Requests through the Safety Gate before any serve, preventing unsafe answers                |
| **Fallback Routing**     | The failed-gate check  | Retries a Request that flunked its gate on a stronger Model instead of leaking it                        |
| **Cache-Aware Routing**  | The Cache branch       | Recognizes near-duplicate and common Requests up front, diverting them to the Cache before any GPU spins |

> **Design rule:** A Request misrouted to too-weak a Model produces a _bad answer_ even if the Work bar empties; misrouted to too-big a Model it wastes Cash and clogs the cluster; misrouted past the Safety Gate it produces an unsafe answer that hits Trust hard. The Router is where Quality, Cost, SLA, and Safety are all balanced at once — making it the single most important tower to upgrade, and the truest test of whether the player thinks like a platform.

---

## 9. Models & Model Stats

A **Model** is a trainable stat card you **load into a Serving Tower**. Models are the _weapons_ of GigaPrompt Tower Defense: the Serving Tower is the gun, the GPU Rack is the firepower, and the Model is the **ammunition**. The same GPU Rack and Serving Tower behave completely differently depending on which Model checkpoint is loaded into them. You do not place a "Model" on the map — you train it in the **Training Lab** (see §11) and equip it into a tower.

> **Design rule:** Models are equipment, not towers. A Serving Tower with no loaded Model is an empty gun. Training improves the Model card; the improved card then changes how every tower running it performs (see §7's three-layer relationship).

### 9.1 Model Stats

Every Model carries seven stats. These are the numbers the Request-resolution system (see §6) reads when it decides whether a served Request is fast enough, correct enough, and safe enough.

| Stat               | Meaning                                  | Checked against                                                                        |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| **Quality**        | General answer correctness               | Must be ≥ a Request's **Complexity** or the answer is bad (Trust damage)               |
| **Reasoning**      | Handles hard, multi-step Requests        | Gates Reasoning/Coding Request success on top of Quality                               |
| **Speed**          | Tokens/sec the Model produces            | Multiplies into how fast **Work Required** is depleted before the **Latency Deadline** |
| **Cost**           | GPU time per Request                     | Drives inference cost and effective Power draw on the host GPU Rack                    |
| **Safety**         | Resists jailbreak and abuse Requests     | Reduces **Safety Risk** damage; complements the Safety Gate tower                      |
| **Context**        | Handles long prompts                     | Must cover a Request's **Context Length** or Long Context Requests stall               |
| **Specialization** | Coding, math, language, enterprise, etc. | Grants a routing bonus against matching Request types                                  |

> **Design rule:** No single stat wins the game. High Quality with low Speed times out on volume waves; high Speed with low Quality produces bad answers on Coding and Reasoning Requests; high everything melts your Cash Runway through Cost. Every Model is a bundle of tradeoffs — a weapon design, not a strict upgrade ladder.

### 9.2 MVP Model Tiers

The MVP ships three general-purpose Model tiers. Each is the same card type with a different stat profile — the same ammunition class loaded into the same GPU Server (see §7), shaped to a different role:

| Tier                  | Profile                                              | Routing role                                                 | MVP |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | --- |
| 🟢 **Small Model**    | High Speed, low Cost, modest Quality/Reasoning       | Cheap volume: Simple Chat, cached/common Requests            | 🟢  |
| 🟢 **General Model**  | Balanced across all stats                            | Default workhorse for most lanes                             | 🟢  |
| 🟢 **Frontier Model** | High Quality/Reasoning/Context, low Speed, high Cost | Reserved for hard Reasoning, Coding, and Enterprise Requests | 🟢  |

The **Router** (see §8) exists precisely because these tiers have different costs. The losing line is loading the Frontier Model everywhere; the winning line is routing each Request to the cheapest tier whose stats still clear it.

**Specializations (later-milestone extensions).** Beyond the three tiers, Models can carry a Specialization that grants a routing bonus against matching Request types. These are the weapon variants the campaign unlocks:

| Specialization | Bonus against                           | Built from                                                |
| -------------- | --------------------------------------- | --------------------------------------------------------- |
| **Coding**     | Coding Requests (high correctness need) | Fine-tune on a coding Clean Dataset (see §11)             |
| **Reasoning**  | Math / Reasoning Requests (multi-step)  | Pretraining + Reasoning RLHF                              |
| **Multimodal** | Image / audio Requests                  | Multimodal training data                                  |
| **Embedding**  | Factual and Long Context Requests       | Powers Cache lookup and RAG retrieval, not direct serving |

### 9.3 Example Model Cards

Model cards are the player-facing pixel UI for a Model: a small framed card showing the stat block, the loaded-tower indicator, and any active training-method badges (distilled, quantized, RLHF'd).

```text
SmallChat-v2          (Small Model tier)
Quality:  54
Speed:    92
Cost:     12
Safety:   60
Context:  30
```

```text
FrontierReasoner-v1   (Frontier Model tier)
Quality:  91
Speed:    28
Cost:     95
Safety:   78
Context:  85
```

Read these as opposites. `SmallChat-v2` shreds a Simple Chat flood — Speed 92, Cost 12 — but its Quality of 54 fails any Request whose Complexity climbs past it, and its Context of 30 cannot hold a Long Context Request. `FrontierReasoner-v1` answers nearly anything correctly (Quality 91, Context 85) but at Speed 28 and Cost 95 it will both time out on volume and drain Cash if you point it at trivial traffic. The strategic question every wave is _which card goes in which tower, fed by which Router rule._

### 9.4 Training is a between-wave system, not a shooting tower

A Model card is not improved by anything that happens on the lane during a wave. It is reshaped **off-lane, between waves**, in the Training Lab (see §11) — a tech tree, not a turret:

> **Design rule:** Training never directly stops a Request. It rewrites the stat block on a Model card so that the _next_ wave is fought with a better weapon through the _same_ GPU Racks you already own. A distilled Small Model, a quantized Frontier Model, or an RLHF'd General Model fights better without a single new GPU purchased — which is exactly why brute scaling (§11) is the inefficient line and smart card design plus routing (§8) is the winning one.

> **Design note (PixiJS):** Render Model stats as a compact radar/bar sprite on the card so players read a Model's shape at a glance. When a training method completes (see §11), animate the changed bars and stamp a method badge onto the card sprite.

## 10. Inference & Serving Systems

Training (see §11) reshapes a Model's stat card; **serving systems decide how many Requests that card can clear per second through the GPU Racks you already own.** This is the layer where modern LLM-serving research becomes tower upgrades. Every mechanic here attacks the same problem: a Viral Spike (see §16) throws ten times your normal volume at a fixed fleet, and buying ten times the GPU Racks would Brownout your data center (see §15) and bankrupt your Cash Runway (see §3). Serving systems are how you survive the surge **without** buying infinite GPUs.

> **Design rule:** A GPU Rack's raw throughput is a ceiling, not a guarantee. Serving systems are the difference between a rack that runs at 20% utilization with idle slots and one that runs flat-out, batched, cached, and load-balanced. The same hardware serves a Viral Spike or melts under it depending entirely on what is installed here.

These towers and upgrades sit in the **Context Assembly** and **Inference Zone** stages of the lane (see §5), wrapping the Serving Towers (see §7) without ever emptying a Work bar themselves. They are throughput and memory multipliers grounded in vLLM-style high-throughput serving (see References, [4]).

### 10.1 Serving Concept → Game Mechanic

Each row turns a real serving technique into an on-screen tower-defense decision. None of these add a single token/sec of raw GPU power; they all extract **more served Requests per Rack** from throughput you have already paid for.

| Real concept             | What it does in practice                                                                                                        | Game mechanic                                                                                                                                                                                                                          | Defends                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Batching**             | Processes many Requests in one inference pass for far higher throughput, at the cost of a little latency                        | **Batching Controller** upgrade on a Serving Tower: groups queued Requests into one pass, multiplying Requests-cleared-per-tick; adds a small fixed delay to each, so it helps volume lanes and hurts strict deadlines                 | SLA (throughput)              |
| **Continuous Batching**  | Admits new Requests into an in-flight batch and retires finished ones mid-pass, so GPU slots never wait for the slowest Request | **Continuous Batching** upgrade (Efficiency path): GPU slots refill the instant a Request finishes instead of idling until the whole batch drains; sustains peak throughput under bursty Viral Spike volume (see References, [4])      | SLA (throughput under burst)  |
| **KV Cache**             | Stores attention key/value state so a long conversation continues without recomputing prior tokens                              | **KV Cache** upgrade: a Request's Context Length is paid once, not re-paid every tick; long-conversation and multi-turn Requests drain Work Required far cheaper                                                                       | SLA + Cash (compute saved)    |
| **PagedAttention**       | Pages the KV Cache into fixed VRAM blocks so memory is used without fragmentation, fitting more concurrent contexts             | **PagedAttention** upgrade: raises how many Long Context Requests a Rack holds at once by removing VRAM fragmentation; more concurrent slots from the same GPU memory (see References, [4])                                            | SLA (concurrency)             |
| **Speculative Decoding** | A small model drafts tokens, the big model verifies them, so the frontier answers faster with no quality loss                   | **Speculative Decoding Engine**: pairs a Small drafting Model with a Frontier Serving Tower, raising the Frontier Model's _effective Speed_ with zero Quality loss, so hard Requests beat their Latency Deadline (see References, [5]) | SLA (frontier speed)          |
| **Load Balancing**       | Spreads Requests across clusters so no single node is overwhelmed                                                               | **Load Balancer**: distributes intake across Serving Towers so no one cluster cascades into Overload and timeouts (see §6)                                                                                                             | SLA + Trust (no Overload)     |
| **Rate Limiting**        | Caps low-value, high-volume traffic so it cannot starve paying traffic                                                          | **Rate Limiting** lane cap: throttles the intake of Bot Swarm (see §4, §16) so it cannot drain compute and power away from paying Requests                                                                                             | Cash + SLA (block Bot Swarm)  |
| **Priority Queue**       | Reserves capacity for strict-SLA traffic so lucrative deadlines are protected                                                   | **Priority Queue / Enterprise SLA lane**: a reserved-capacity lane that serves Enterprise Requests ahead of best-effort traffic, protecting their strict deadlines (see §14)                                                           | SLA + Cash (enterprise first) |

> **Design rule:** Batching trades a little latency for a lot of throughput; Priority Queue trades best-effort latency to protect enterprise latency; Rate Limiting trades served volume to protect served value. Every serving upgrade is a deliberate throughput-versus-latency-versus-cost trade, never a free buff.

### 10.2 Throughput vs. Memory: Two Separate Bottlenecks

Serving upgrades attack two distinct ceilings, and a build can be starved on either one. Reading them apart is how the player picks the right upgrade under pressure.

```text
THROUGHPUT ceiling — "how many Requests can I finish per second?"
  raised by: Batching, Continuous Batching, Load Balancing, Speculative Decoding
  starved   → Requests queue, miss Latency Deadlines, leak → SLA drops

MEMORY ceiling — "how many Requests can I hold concurrently?"
  raised by: KV Cache, PagedAttention
  starved   → Long Context Requests cannot be admitted, stall → SLA drops
```

A Viral Spike of Simple Chat is a **throughput** crisis: thousands of tiny Requests, each cheap, but too many to finish in time. The fix is Batching plus Continuous Batching, so the GPU slots stay saturated and never idle between Requests (see References, [4]). A wave heavy in **Long Context** Requests is a **memory** crisis: each Request hogs VRAM for its KV state, and the Rack runs out of concurrent slots long before it runs out of compute. The fix is KV Cache (pay the context once) plus PagedAttention (defragment VRAM so more contexts fit). Installing throughput upgrades against a memory bottleneck — or vice versa — wastes Cash and still leaks.

### 10.3 Serving a Viral Spike Without Infinite GPUs

This is the section's thesis: a Viral Spike (see §16) is engineered so that **the brute-force answer — buy more GPU Racks — is the losing line**, because more Racks means more `power_draw` and `heat_output`, which triggers Brownout and Thermal Throttling (see §15) and drains Cash Runway. The intended answer is the serving stack composed in order:

```text
Viral Spike hits (10× normal volume on a fixed Rack fleet)

  1. Rate Limiting     → cap Bot Swarm intake so junk does not eat compute
  2. Cache Server      → repeated/common Requests answered at ~$0 compute
  3. Continuous Batching→ remaining Requests packed into saturated GPU slots
  4. KV / PagedAttention→ Long Context Requests fit concurrently, no stalls
  5. Load Balancing    → spread across Serving Towers, no Overload cascade
  6. Speculative Decode → the few hard Requests still beat their deadline

  → the SAME Racks now serve 10× volume, inside power and cooling budget
```

> **Design rule:** The Viral Spike teaches that **serving is a systems problem, not a hardware problem.** A player who answers the surge by stacking GPU Racks Brownouts, overheats, and bankrupts before the wave ends. A player who layers caching, batching, paging, and load balancing serves the same flood through provisioned hardware and keeps all three meters alive. Smart serving beats brute scale — by design.

```text
PixiJS note: render serving upgrades as install-able modules clipped onto
Serving Towers, not new lane towers. Show a live "GPU slot utilization"
fill on each Rack so Batching/Continuous Batching visibly pack idle slots;
render KV Cache hits as a Request skipping the Context Assembly stage; flash
a Rate Limiting "blocked" stamp on capped Bot Swarm Requests at Ingress.
```

## 11. Training Methods & the Four Tech-Tree Paths

Training is GPTD's **between-wave strategic layer**, run in the **Training Lab**. It is deliberately _not_ a tower that shoots Requests. You spend resources — Cash, **Clean Dataset** (or risky **Raw Data**; see §13), and **Compute Hours** — on **Training Methods** that rewrite the stat blocks on your Model cards (see §9).

> **The key idea:** Training does not directly stop a wave. Training changes how effective your serving towers (see §10) are when the next wave hits. A distilled Small Model, a quantized Frontier Model, or an RLHF'd General Model fights better _through the same GPU Racks you already own._

### 11.1 Methods Table

| Method                              | Cost                              | Effect                                                                                  |
| ----------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| **Pretraining**                     | Huge dataset + huge Compute Hours | Raises base Quality and Reasoning across the board                                      |
| 🟢 **Supervised fine-tuning (SFT)** | Clean Dataset + Cash              | Improves instruction following and specialization                                       |
| 🟢 **RLHF / RL**                    | Human feedback + Compute Hours    | Improves user satisfaction and Safety; hardens against Jailbreaks (see References, [2]) |
| 🟢 **Distillation**                 | Big Model + dataset               | Mints a faster, cheaper Small Model from a big one (see References, [1])                |
| 🟢 **Quantization**                 | Engineering + testing             | Cuts Cost and Power draw, slight Quality risk                                           |
| **RAG indexing**                    | Data + storage                    | Cuts hallucination on factual / long-context Requests                                   |
| **Speculative Decoding**            | Small + large Model               | Raises the large Model's effective Speed, no Quality loss (see References, [5])         |
| **Red-teaming**                     | Evaluators + Cash                 | Improves Safety against Jailbreak waves                                                 |
| **Continual Learning**              | Ongoing data + Compute Hours      | Adapts a Model to new Request types as the campaign introduces them                     |

The 🟢 MVP tech tree is the four-node core — **Fine-tuning, Distillation, RLHF, Quantization** — which already forces real tradeoffs between Quality, Cost, Power, and Safety. Pretraining, RAG, Speculative Decoding, Continual Learning, and Red-teaming are later-milestone branches.

### 11.2 The Four Competing Paths

The full tech tree is organized into **four research paths**, each with a distinct theme and win-condition. The methods above slot into these paths, and so do the serving upgrades from §10 — because a serving optimization (Distillation, Speculative Decoding, KV Cache) _is_ a research investment. The four paths are deliberately **competing**: they draw on the same Compute Hours, Clean Dataset, and Cash, so progress on one is progress _not_ made on another.

| Path           | Theme                                                                                              | Nodes                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Scale**      | Brute-force capability: bigger models and more raw throughput, paid in compute, power, and cooling | Pretraining · Bigger Parameters · More GPU Racks · Continual Learning · Synthetic Data Augmentation                                  |
| **Efficiency** | Serve more for less: squeeze throughput out of the Racks you already own                           | Distillation · Quantization · Speculative Decoding · KV Cache / PagedAttention · Continuous Batching                                 |
| **Safety**     | Survive Jailbreaks and unsafe answers without bleeding Trust                                       | RLHF · Red-Teaming · Policy / Safety Model · Safety Routing · Abuse Detection                                                        |
| **Product**    | Win on system design: smart routing, caching, retrieval, defended enterprise SLAs                  | Smart Routing (Intent + Complexity) · Cache Server · RAG Indexing · Enterprise SLA / Priority Queue · Load Balancing & Rate Limiting |

Reading the paths as strategies:

- **Scale** answers "make the Model bigger and the fleet larger." It raises raw capability through Pretraining and Bigger Parameters (see References, [3] for why parameters alone are not enough), but every node demands more Compute Hours, power, and cooling — the most expensive and most easily-Brownout path.
- **Efficiency** answers "do more with the same Racks." Distillation mints cheap Small Models (see References, [1]); Quantization shrinks Cost and Power; Speculative Decoding (see References, [5]), KV Cache / PagedAttention, and Continuous Batching (see References, [4]) all live here. This is the path that beats Scale on a budget.
- **Safety** answers "don't bleed Trust to Jailbreaks." RLHF (see References, [2]) and Red-Teaming harden Models; Safety Routing and Abuse Detection harden the lane. It buys nothing for throughput — it buys _survival of the Jailbreak Raid_ (see §16).
- **Product** answers "win on system design." Smart Routing (see §8), the Cache Server, RAG Indexing, the Priority Queue, and Load Balancing & Rate Limiting (see §10) convert raw serving into smart serving. This is the path the whole game's thesis rewards.

> **Design rule:** You cannot max all four paths. Compute Hours spent Pretraining (Scale) are Compute Hours not spent on RLHF (Safety); Cash spent on More GPU Racks (Scale) is Cash not spent on a Cache Server (Product). Each run forces a build identity — and a Scale-only build is the designed-in losing line, because Efficiency and Product serve the same waves for less.

```text
                    Shared pool: Compute Hours · Clean Dataset · Cash
                                       │
        ┌──────────────┬───────────────┼───────────────┬──────────────┐
        ▼              ▼               ▼               ▼
     SCALE         EFFICIENCY        SAFETY         PRODUCT
  bigger / more   same Racks,      survive          win on
   raw power      more served    Jailbreaks      system design
        │              │               │               │
        └──────────────┴───────────────┴───────────────┘
              every node spent here is a node NOT spent elsewhere
```

### 11.3 How Methods Map to Serving Towers

Each method reshapes a specific axis of your serving performance — it changes how the Models in §9 perform through the towers in §7 and §10. Concrete cases:

- **Distillation** (Efficiency) upgrades **Small Model Servers**: it spends a big Model plus a dataset to mint a faster, cheaper Small Model, so your cheap volume lane gets cheaper and quicker without buying GPUs (see References, [1]).
- **RLHF** (Safety) raises **Safety** and user satisfaction, hardening Models against Jailbreak Requests and reducing bad-answer Trust loss — the training-side complement to the Safety Gate tower (see References, [2]).
- **Quantization** (Efficiency) cuts a Model's **Cost** and **Power** draw, easing pressure on Power Plants and Cooling Towers (fewer Brownouts and less Thermal Throttling; see §15), at a slight Quality risk.
- **RAG indexing** (Product) indexes Data into storage to cut **hallucination** on factual and long-context Requests, lifting effective Quality on the lanes where Complexity is about facts, not reasoning.
- **Speculative Decoding** (Efficiency) pairs a Small drafting Model with a Frontier Model to raise the **Frontier Model's effective Speed** with no Quality loss, letting your expensive card survive the Latency Deadline on hard Requests (see References, [5]).
- **Pretraining** (Scale) lifts base Quality across the board but costs enormous Compute Hours — a long-horizon investment, not a wave-to-wave fix, and only worthwhile if data scales with it (see §12).

> **Design rule:** Because training only changes serving effectiveness, brute GPU scaling is never the optimal answer. The efficient line is to _train smarter cards_ — distill, quantize, RLHF, RAG — and route them well (see §8), not to stack more racks. Training does not stop waves directly; it changes how effective your serving towers are when the wave arrives.

```text
PixiJS note: present the tech tree as four parallel branches (Scale /
Efficiency / Safety / Product) in the Training Lab, all draining one shared
resource bar at the top. Each node shows its Cash / Clean Dataset / Compute
Hours cost and a preview stat delta on the selected Model card, so the
player sees both the gain AND the opportunity cost before committing.
```

## 12. Scaling Laws

A toy **Scaling Law** keeps model training coherent and turns "how big a model should I build?" into a real decision instead of flavor. It is grounded in Chinchilla compute-optimal scaling — the finding that **parameters and training tokens must grow together**, and that an oversized model trained on too few tokens is _undertrained_, not better (see References, [3]). In GPTD this is an abstract game formula, not real machine learning.

### 12.1 The Toy Quality Formula

```text
quality = base
        + log(parameters)
        + log(clean_dataset)
        + method_bonus
        - undertraining_penalty
        - data_noise_penalty
```

Reading the terms:

- `log(parameters)` — bigger Models help, but with **diminishing returns** (it is a log, not a line).
- `log(clean_dataset)` — more **Clean Dataset** raises Quality, also with diminishing returns; **Raw Data** used directly feeds the `data_noise_penalty` instead.
- `method_bonus` — the stat gains from Training Methods (see §11) stack on top of raw scale.
- `undertraining_penalty` — a large `parameters` value paired with too little dataset or **Compute Hours** is _undertrained_ and loses Quality. This is the Chinchilla rule made into a penalty: parameters that outrun their training tokens are wasted (see References, [3]).
- `data_noise_penalty` — training on noisy **Raw Data** poisons the Model and subtracts Quality.

> **Design rule (Chinchilla, as gameplay):** Parameters and Clean Dataset must scale _together._ Doubling `parameters` while holding `clean_dataset` fixed grows the `undertraining_penalty` faster than the `log(parameters)` gain — so the bigger Model scores _lower_. The player learns to grow data and compute in step with model size, not ahead of it (see References, [3]).

### 12.2 Bigger Is Not Automatically Better

The formula exists to punish naive scaling. The same oversized Model fails three different ways depending on what you _under_-provisioned around it:

- **Undertrained** — a huge Model with **too little data or Compute Hours**: high `parameters`, but the `undertraining_penalty` cancels the gain. This is the Chinchilla failure directly (see References, [3]): the Model is big but starved of training tokens, so it scores below a smaller, properly-fed Model.
- **Data bottleneck** — a huge Model fed on **dirty Raw Data instead of Clean Dataset** to hit its token budget: the `data_noise_penalty` poisons it, dropping Quality and Safety, which surfaces two waves later as bad answers and unsafe answers (see §13).
- **Too slow for the next wave** — a huge Model with **too little serving hardware, power, or cooling**: even with a correct answer, its Speed and Cost (see §9) blow past every Latency Deadline, leaking Requests and draining SLA; its Power draw triggers Brownout and Thermal Throttling (see §15), randomly shutting Racks and slowing every GPU tower.

> **Design rule:** Scaling is a balancing act, not a number to maximize. A Frontier Model only pays off when its data, compute, serving hardware, power, and cooling are all provisioned to match it. Bigger is not automatically better.

### 12.3 The Params / Dataset / Compute Triangle

Chinchilla's lesson is a triangle: model size, training tokens, and training compute are mutually constrained, and pulling one corner without the others wastes the investment (see References, [3]). Around that core triangle sit the serving and economic constraints that turn a trained Model into a _served_ Model.

```text
                         parameters
                        (model size)
                        ╱           ╲
       grow together   ╱             ╲   grow together
      or undertrained ╱               ╲ or undertrained
                     ╱                 ╲
          clean_dataset ───────────── training_compute
          (training tokens)            (Compute Hours)
              must scale with parameters (Chinchilla, [3])

  ── then the Model still has to be SERVED: ──
  serving compute  (GPU throughput — too little misses deadlines)
  power            (Electricity capacity — exceed it and Brownout hits)
  cooling          (heat capacity — exceed it and Thermal Throttling hits)
  money            (Cash — the budget that gates all of the above)
```

This is what makes scaling laws _gameplay_: the three triangle corners must scale together (the Chinchilla rule), and the serving corners must then match the Model you trained. The player turns all of these knobs against each other every round, and the toy formula guarantees that ignoring any one of them undoes the others.

> **Lesson:** Bigger is not automatically better. A compute-optimal Model — parameters, data, and compute grown in balance, then served on provisioned hardware — beats a giant undertrained Model that times out, poisons, or Brownouts. Scale is a corner of the triangle, never the whole strategy.

## 13. Resources & the Data Pipeline

GPTD runs on two layers of resources: **main resources** the player sees and spends directly, and **derived/hidden resources** (per-building power draw, heat, GPU throughput) that emerge from how those main resources are provisioned. This section covers the main layer, the **data sources** that feed it, and the data pipeline that links them together; the derived power/heat layer is detailed in §15 Power, Cooling & the Data Center.

### 13.1 Main resources

| Resource          | Used for                                                                                                                         | MVP |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --- |
| **Cash**          | Everything — building, training, power, maintenance. Its reserve is tracked as the Cash Runway meter on the Trust Core (see §3). | 🟢  |
| **Raw Data**      | Unprocessed data collected from usage, contracts, web, and partners. Cannot train safely on its own.                             | 🟢  |
| **Clean Dataset** | Training-ready data refined from Raw Data; the actual input to Training Methods (see §11).                                       | 🟢  |
| **Hardware**      | GPUs, servers, storage, networking — the physical stock you place as GPU Racks and Serving Towers.                               |     |
| **Electricity**   | Maximum operational power capacity; gates how many GPU Racks can run (see §15).                                                  | 🟢  |
| **Cooling**       | Maximum heat capacity; prevents Thermal Throttling of GPU towers (see §15).                                                      | 🟢  |
| **Compute Hours** | Consumed by training and evaluation in the Training Lab (see §11).                                                               | 🟢  |
| **Trust**         | A Trust Core health bar, not a spendable currency — listed here because the data loop ultimately defends it.                     | 🟢  |

> **Design rule:** "Money" in early notes is canonically **Cash**. It is the universal currency; its depletion is the Cash Runway loss condition. Hardware is the only main resource not in the MVP subset — in the MVP, Cash buys buildings directly and a separate Hardware stock is deferred.

### 13.2 The data pipeline loop

Raw Data and Clean Dataset are deliberately split into two resources. That split is the engine of the between-wave economy:

```text
Raw Data → Data Cleaning → Clean Dataset → Training → Model upgrade → Better Serving → more Raw Data
```

Raw Data is generated as a byproduct of serving Requests (especially high-volume Free chat traffic; see §14). It accumulates quickly and cheaply. But it is **dirty**: it carries noise, mislabeled examples, and adversarial/jailbreak content harvested from the lane. Spending it directly is fast but dangerous.

Clean Dataset is produced by running Raw Data through **Data Cleaning**, which costs Cash and time (and, at scale, Compute Hours). It is the only safe, high-quality input to the Training Lab. Once cleaned, Clean Dataset is spent on a **Training Method** (Fine-tune, Distill, RLHF, Quantize; see §11), which rewrites a Model card — the **Model upgrade** that makes the next wave easier to serve.

### 13.3 Data sources & their tradeoffs

Raw Data is not one faucet. Where you _source_ it changes its cost, its cleanliness, and what it is good for. Every source pairs a clear upside with a clear cost, so a player who leans on one source alone builds a lopsided, exploitable Model.

| Source             | Upside                                                                                              | Cost / Risk                                                                            | Feeds                                              | MVP |
| ------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- | --- |
| **User logs**      | Free and continuous — harvested as a byproduct of every served Request, especially Free chat        | Privacy exposure and high noise; carries jailbreak/abuse content straight off the lane | Raw Data volume (the default faucet)               | 🟢  |
| **Licensed data**  | High quality, low noise — close to Clean Dataset on arrival                                         | Expensive; a direct Cash sink that competes with hardware and power spend              | Clean Dataset (cheaply, post-cleaning)             |     |
| **Synthetic data** | Fast and arbitrarily scalable — mint training data on demand without users                          | Overuse risks **Model Collapse** (see §11) and entrenches existing bias                | Raw/Clean volume to pad undertrained Models        |     |
| **Human-labeled**  | Excellent for RLHF and instruction tuning — the only source that teaches preference and Safety well | Slow and expensive; throughput-limited by human labelers                               | Clean Dataset for RLHF / Fine-tune                 |     |
| **Domain data**    | Enterprise-useful — lifts Quality on the lucrative, fact-bound lanes (RAG, specialization)          | Narrow; pays off only on the matching Request type and is dead weight elsewhere        | Clean Dataset for Fine-tune / RAG indexing         |     |
| **Red-team data**  | Improves Safety — hardens Models against Jailbreak waves and reduces unsafe-answer Trust loss       | No direct revenue; pure defensive spend that never shows up as Cash                    | Clean Dataset for RLHF / Red-Teaming (Safety path) |     |

> **Design rule:** Data sources are a portfolio, not a single tap. User logs are free but dirty and risky; licensed and human-labeled data are clean but burn Cash and time; synthetic data is fast but collapses your Model if you overdrink it; red-team data costs Cash and earns no revenue yet keeps Trust alive on Jailbreak waves. No source is strictly best — each is the right answer to a _different_ failure.

### 13.4 The core tension: fast dirty data vs slow clean data

This is the heart of §13, and a design goal of the whole game ("Data quality matters"). Every source above ultimately resolves to one axis: **how dirty is the data you are about to train on?**

> **Design rule:** Clean Dataset produces **better, safer** Models. Raw Data trains **faster and cheaper** but risks **poisoning** the Model — raising hallucination, weakening Safety, and inviting regression, which surfaces later as bad answers and unsafe answers during waves.

```text
Train on dirty Raw Data:   fast, cheap, high noise
   → ↑ hallucination risk   (bad answers fail the Complexity gate, §6)
   → ↑ safety risk          (weak Safety → unsafe answers on Jailbreak waves)
   → ↑ regression risk      (a previously good Model card gets worse)

Train on slow Clean Dataset: slow, costly, low noise
   → reliable stat gains, no poisoning, Safety holds
```

A poisoned Model is not a penalty the player notices immediately — it shows up two waves later when a Jailbreak Raid or Coding Boom exposes the weakness. This rewards players who invest in cleaning (and in clean sources like licensed and human-labeled data) ahead of need, and punishes players who shortcut the pipeline to rush a bigger model. The toy Scaling Law (§12) reads `clean_dataset` size and quality directly, so cleaning is not optional flavor — it is a term in the formula that decides whether a model trains well or comes out undertrained and noisy.

### 13.5 Pixel/HUD notes

Represent Raw Data and Clean Dataset as two distinct top-bar counters with a visible "cleaning" conveyor animation between them so the loop is legible at a glance. Show each **data source** as a selectable faucet feeding the conveyor, tagged with its cleanliness so the player feels the dirty-vs-clean choice. Poisoned-data risk should render as a subtle corruption tint on a Model card rather than a hidden stat, so the tradeoff is felt, not buried in a tooltip.

## 14. Money & Business Economy

Cash is earned by serving Requests and spent on everything else. The economy is built so that no single customer mix or model size is a dominant strategy — every revenue source pairs a clear upside with a clear punishment.

### 14.1 Reward by customer type

Different Request sources pay differently. The Reward stat on a Request (see §4) is drawn from these profiles:

| Customer               | Reward                                                            | MVP request type        |
| ---------------------- | ----------------------------------------------------------------- | ----------------------- |
| **Free user chat**     | Low reward, high volume — but generates the most Raw Data         | 🟢 Simple Chat          |
| **Plus user request**  | Medium reward, steady                                             | 🟢 Simple Chat / Coding |
| **Enterprise request** | High reward, strict SLA — heavy penalty if missed                 | 🟢 Enterprise           |
| **API batch job**      | High volume, predictable, latency-tolerant                        | (Coding / Reasoning)    |
| **Research benchmark** | Reputation reward (feeds Trust more than Cash)                    | (Reasoning)             |
| **Safety audit**       | Trust reward — pays in Trust for handling risky traffic correctly | (Jailbreak)             |

> **Design rule:** Not all payment is Cash. Research benchmarks and safety audits pay primarily in **Trust** and reputation, giving the player a route to repair Trust through correct, safe service rather than pure volume. This is the demand-side mirror of §13's red-team data: some work earns no Cash yet keeps a different meter alive.

### 14.2 The profit formula

Serving is never free. Each served Request nets:

```text
profit = revenue − inference_cost − power_cost − maintenance
```

- **revenue** — the Request's Reward, modified by whether it was served fast, cheaply, correctly, and safely.
- **inference_cost** — GPU time consumed, driven by the loaded Model's Cost stat and the Request's Work Required and Context Length.
- **power_cost** — Electricity burned by the GPU Racks that did the work (ties directly into §15, and scales with your PUE overhead).
- **maintenance** — ongoing upkeep on placed hardware, charged whether or not a Rack is busy.

A Request routed to an oversized model can post a **negative profit** even when "successfully" answered, because inference*cost and power_cost exceed its Reward. This is the mathematical reason routing (§8) is the skill expression: the goal is the \_cheapest capable* model, not the strongest.

### 14.3 Business tensions

The economy is tuned around four standing tensions:

- **Small models are profitable but weak.** Cheap to serve, low power, great margin on Free/Plus chat — but their Quality fails the Complexity check on Coding, Reasoning, and Enterprise Requests, producing bad answers that bleed Trust.
- **Big models are impressive but expensive.** A Frontier Model clears any Complexity, but its Cost, power_draw, and heat make every Request it touches a margin risk and a strain on §15 capacity.
- **Enterprise traffic is lucrative but punishing.** The highest Cash per Request, but the strict SLA means a single missed deadline inflicts an outsized SLA and Trust penalty. Enterprise revenue must be _defended_, not just collected.
- **Free traffic gives data but can bankrupt you.** Free chat is the primary Raw Data faucet feeding §13's pipeline — but its low Reward means high volume routed to anything but the cheapest model drains Cash Runway faster than it earns. Unmanaged free traffic is a slow bankruptcy.

> **Design rule:** Every economic decision must carry a real tradeoff. The right strategy is a _portfolio_: harvest Raw Data from cheap free traffic, protect lucrative enterprise SLAs with redundancy, and reserve the expensive frontier for the Requests that actually need it.

## 15. Power, Cooling & the Data Center

Power and cooling are not flavor — they are the constraint layer that makes GPU Racks a provisioning puzzle instead of a "buy more towers" button. This is a core design goal: infrastructure gates whether towers function at all.

### 15.1 Per-building derived stats

Every piece of hardware exposes three derived values:

```text
power_draw    — Electricity consumed while active
heat_output   — heat added to the data center while active
throughput    — inference work delivered (tokens/sec equivalent)
```

GPU Racks are the heavy consumers: high throughput, high power_draw, high heat_output. Serving Towers, the Router, Cache Servers, and Safety Gates draw smaller amounts. Power Plants raise Electricity capacity; Cooling Towers raise heat capacity. Neither produces throughput — they exist purely to keep the throughput-makers running.

### 15.2 Capacity inequalities

Two hard inequalities must hold across all active buildings:

```text
total_power_draw <= electricity_capacity
total_heat       <= cooling_capacity
```

`electricity_capacity` is the sum of Power Plant output; `cooling_capacity` is the sum of Cooling Tower output. Place too many GPU Racks for your provisioning and one or both inequalities break.

### 15.3 PUE: the energy-overhead model

A real data center never spends all its power on compute. Some electricity always goes to cooling, power conversion, and overhead — and the industry measures this with **Power Usage Effectiveness (PUE)**, the ratio of _total facility energy_ to _IT (compute) energy_ (see References, [6]). GPTD models a simplified PUE as an efficiency stat the player can improve:

```text
PUE = total_facility_energy / IT_energy        (PUE >= 1.0; lower is better)

total_power_draw  = IT_draw × PUE              (what your meter must cover)
power_cost        = total_power_draw × price   (feeds §14 profit)
```

- **PUE = 1.0** is the perfect-but-unreachable ideal: every watt does compute, zero overhead.
- A fresh data center starts **inefficient** (high PUE) — a large slice of every watt is lost to cooling and conversion, so the same GPU Racks cost more power and bankrupt you faster.
- The player **lowers PUE** by investing in better Cooling Towers, chillers, and facility upgrades, shrinking the overhead multiplier so each GPU's real-world draw drops without touching its throughput.

> **Design rule:** PUE is the efficiency-vs-overhead lever of the data center. Two players with identical GPU Racks pay different power bills purely on PUE — the inefficient one watches Cash Runway bleed on overhead it never sees served. Improving PUE is a quiet, compounding win that makes every later Rack cheaper to run.

### 15.4 Failure chains

When an inequality is violated, the system degrades — and the two failure modes are distinct:

```text
total_power_draw > electricity_capacity
  → Brownout
  → random GPU Racks shut down       (lose throughput unpredictably)

total_heat > cooling_capacity
  → Thermal Throttling
  → all GPU towers lose speed         (global throughput slowdown)

both bad, sustained
  → hardware damage
  → downtime + repair cost            (Cash drain + capacity loss)
```

Brownout is **random and discrete** — specific Racks go dark, so part of your serving capacity vanishes without warning. Thermal Throttling is **uniform and continuous** — nothing shuts off, but every GPU tower fires slower, so Work Required drains too slowly and Requests start leaking against their Latency Deadlines. Sustained simultaneous failure escalates to **long-term hardware damage**: Racks take downtime and incur a repair cost, hitting Cash Runway and SLA at once.

```text
GPUs throttle/shut down → slower or lost serving → Requests leak → SLA + Trust drop
worsens → overheat → hardware damage → repair cost → Cash drops
```

> **Design rule:** Power and cooling are the reason to build **Power Plants and Cooling Towers, not only GPUs**. A wall of GPU Racks with no power and cooling behind it browns out and throttles itself into uselessness. Capacity must be provisioned _ahead_ of the throughput it feeds — and a bad PUE means that capacity must be even larger than the raw IT draw suggests.

### 15.5 Pixel/HUD notes

Surface two live capacity meters (Power and Heat) in the HUD that fill toward their caps as Racks activate, flashing red on breach, plus a small **PUE readout** showing how much of your power is overhead versus compute. Brownout should visibly kill individual Rack sprites (lights off); Thermal Throttling should tint the whole GPU zone with a heat shimmer and slow firing animations globally — making the difference between the two failures readable at a glance. Long-term hardware damage should leave a cracked/scorched overlay on affected Racks until repaired.

## 16. Waves & the Incident System

A **Wave** is a themed flood of Requests engineered to test one set of defenses and teach one lesson. The shipped campaign is **20 waves** escalating from a gentle Launch Day to the **Singularity Night** boss. Each wave below lists its dominant request mix and what it teaches. Between waves, the **Incident system** (§16.4) attacks one axis of your build at a time, so a run is never a solved spreadsheet.

### 16.1 The 20-wave campaign

The shipped campaign runs **20 authored waves** in four acts. Act I isolates one lesson per wave; Acts II–IV remix those axes under compounding volume and work scaling. Every wave is data-driven (`src/sim/content.ts`): named groups of Request types with spawn timing, work multipliers, and a clear bonus.

| #   | Wave                           | Dominant mix                       | What it teaches                                        |
| --- | ------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| 1   | Launch Day                     | Simple Chat                        | Place a server by the lane and serve volume            |
| 2   | Coding Boom                    | Chat + Coding                      | `quality ≥ complexity` — weak Models ship bad answers  |
| 3   | Mixed Traffic                  | Chat + Coding + Long               | Spread coverage along the lane; add a Router           |
| 4   | Jailbreak Raid                 | Chat + Jailbreak                   | A Safety Gate before the core, or Trust bleeds         |
| 5   | Enterprise Contract            | Enterprise + Reasoning             | Priority and reliability beat raw volume               |
| 6   | Viral Spike                    | Bot Swarm + Chat + Long            | Cache + throughput, not infinite GPUs                  |
| 7   | Heavy Reasoning                | Reasoning + Enterprise             | Fund Scale _and_ Efficiency; Frontier-grade quality    |
| 8   | Code Review Crunch             | Coding flood                       | Coding Servers / Pretraining carry correctness         |
| 9   | The Long Haul                  | Long Context + Chat                | Cache + KV Cache make Long Context survivable          |
| 10  | Adversarial Surge              | Jailbreak-heavy mix                | Scale Safety with RLHF + Red-teaming, layered gates    |
| 11  | Black Friday                   | Bot armies + Chat + Enterprise     | Caches/batching/rate-limits beat GPU spend             |
| 12  | Research Benchmark             | Reasoning (high work)              | Max Quality via Pretraining; Frontier mandatory        |
| 13  | Multi-Tenant Cloud             | All seven types at once            | Only a well-tuned Router keeps a 7-type mix afloat     |
| 14  | Security Audit                 | Jailbreak + Enterprise + Reasoning | Safety _and_ SLA at once, no slack                     |
| 15  | The Scaling Wall               | Few but enormous Requests          | Scaling laws bite: params, data, serving all scale     |
| 16  | Sustained Load                 | Unbroken mixed stream              | Endurance: throughput + economy over a long wave       |
| 17  | Spike Storm                    | Volume floods ↔ reasoning spikes   | Build for both extremes at once                        |
| 18  | Enterprise Megadeal            | Enterprise flood, brutal SLA       | Over-provision the priority lane; one timeout is fatal |
| 19  | Jailbreak Apocalypse           | Relentless abuse campaign          | Maxed Safety, layered gates, Red-teaming or bust       |
| 20  | **Singularity Night** _(BOSS)_ | Everything, escalating             | The whole platform at maximum pressure                 |

> **Design rule:** Act I keeps one failure mode per wave so each lesson is legible — volume → correctness → coverage → safety → SLA. Acts II–IV remix those axes and dial up count and work scaling, so by Singularity Night every axis is under pressure at once.

### 16.2 Boss wave — Singularity Night

Wave 20, **Singularity Night**, is a giant escalating wave that layers every Request type — bots, chat, code, jailbreaks, long context, reasoning, and enterprise — across nine staggered groups with rising work multipliers, and it always carries **one hard Incident** (the system forces a non-favorable incident on the final wave). The player cannot pre-optimize for the specific disaster, so robust, balanced provisioning is rewarded over a single min-maxed line.

Random disaster pool:

```text
• Power-price spike   — power_cost soars; running the same GPUs now drains Cash Runway fast
• Cooling failure     — cooling_capacity drops; Thermal Throttling looms unless load is cut
• GPU shortage        — cannot build/repair Racks; must survive on existing throughput
• Bad dataset bug     — a recent training batch was poisoned; a Model's Quality/Safety is degraded
• Model regression    — a deployed Model's stats silently fell; answers start failing checks
• API bot swarm       — flood of low-value, high-volume bot Requests wasting compute and power
```

> **Design rule:** Every disaster attacks a different axis — Cash (power-price spike), Cooling (failure), Hardware (shortage), Data (bad dataset), Models (regression), or Throughput (bot swarm). A run min-maxed for one strategy will be blindsided by the disaster that hits its weak axis, which is exactly the point: the boss tests the _whole_ system built across §12–§15.

### 16.3 What makes an Incident, not a stat tick

An **Incident** is a random between-wave disaster that attacks one axis of the build and tests flexibility. The design bar is strict:

> **Design rule:** An Incident must _force a different action_, never just subtract a number. A "−10% Cash" debuff is a stat tick; "electricity now costs 3× — your profitable routing is now bankrupting you, re-route or shed load" is an Incident. Every event below changes which decision is correct, so the player re-plans rather than re-multiplies.

Incidents fire as a standalone **Incident phase** between waves (the fourth beat of the core loop; see §18), or are folded into the Singularity Night boss. They keep the three Trust Core meters in constant tension instead of letting the player settle into a static optimum.

### 16.4 The Incident table

Each row names the event, the axis it attacks, the wrong reflex it punishes, and the **adaptation it forces** — the move that actually saves the run.

| Incident                                | Axis attacked         | What it does in-sim                                                                                          | Adaptation it forces (not a stat tick)                                                                                                                               |
| --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GPU shortage**                        | Hardware / throughput | Building and repairing GPU Racks is locked; existing throughput is your ceiling for the round                | Squeeze more from owned racks: Quantize, Speculative Decoding, Continuous Batching, and Rate-Limit the Bot Swarm so paying Requests keep the compute                 |
| **Power-price spike**                   | Cash Runway           | `power_cost` multiplies; the same fleet that was profitable now posts negative profit per Request            | Re-route toward cheaper Models and the Cache, Quantize to cut Power draw, or idle racks you cannot afford to run — shed load instead of serving at a loss            |
| **Cooling failure**                     | Cooling / SLA         | `cooling_capacity` drops; `total_heat > cooling_capacity` triggers Thermal Throttling and global speed loss  | Cut active heat: power down racks, Quantize hot Models, build emergency Cooling, or narrow the Router to fewer high-value lanes until heat is back under cap         |
| **Dataset contamination**               | Data                  | A Raw Data batch was poisoned; any Model trained from it carries a hidden `data_noise_penalty` (see §11)     | Stop training on the tainted pool, re-clean from scratch, lean on RAG for fact-bound lanes, and accept slower progress to avoid a Model that fails the _next_ wave   |
| **Model regression**                    | Models                | A deployed Model's stats silently fell; answers that used to clear gates now produce bad answers             | Re-validate the card, roll back or re-train, and have the Router's Fallback Routing retry failed answers on a stronger Model while you fix the regression            |
| **Jailbreak trend**                     | Safety / Trust        | A spike in high-Safety-Risk traffic camouflaged in normal volume; unsafe serves deal heavy Trust damage      | Harden via RLHF and Red-Teaming, tighten Safety Routing so risky Requests hit the Safety Gate first, and absorb the throughput cost of screening more traffic        |
| **Enterprise demo tomorrow**            | SLA / business        | An incoming Enterprise burst with brutal Latency Deadlines is pre-announced for the next wave                | Reserve Priority Queue capacity, add redundancy and Load Balancing, and pre-warm the right Model — defend the SLA _before_ the traffic, not during it                |
| **Viral app integration**               | Throughput / memory   | A partner ships you a sustained surge of small Requests plus Long Context load on short notice               | Stand up Cache Servers for repeats, enable Continuous Batching and PagedAttention, and distill a Small Model so the cheap lane scales without new GPUs               |
| **Regulatory audit**                    | Trust / compliance    | Your serving is graded on safety and reliability; weak Safety or recent unsafe serves are penalized in Trust | Invest in Safety ahead of need, take the Safety Audit reward stream (Trust over Cash; see §13), and prove a clean pipeline rather than chasing pure volume           |
| **Competitor launches a cheaper model** | Cash / business       | Margins compress: Free and Plus Reward per Request drops; brute-force serving now loses money                | Win on efficiency — distill and cache to undercut your own cost, route to the _cheapest capable_ tier, and stop subsidizing volume your model can't profitably serve |

> **Design rule:** No Incident has a build that is immune to all of them. A defense tuned against timeouts does nothing for Dataset contamination; a Safety-heavy build still browns out under a Power-price spike. Incidents are the enforcement mechanism for the whole-system thesis — they reward the player who provisioned _breadth_, not depth.

---

## 17. Strategic Decisions & Tradeoffs

The whole game bends toward one idea, and it is the opposite of the naive AI-scaling reflex:

> **Core design philosophy.** _AI scaling is not buying more GPUs._ It is balancing eight coupled systems at once — **data, models, hardware, power, cooling, routing, safety, and business pressure** — so that every Request is served fast, cheaply, correctly, and safely. Distill, route, and cache first; reserve the big Model for the hard cases. Brute-force throughput stacking ("buy more GPUs forever") is intentionally an inefficient, often losing line, not a valid strategy.

The frontier Model is your most expensive, slowest, most power-hungry weapon. Pointing it at a "what's 2+2" Simple Chat is a loss disguised as a win — you served the request, but you burned Cash, Electricity, and heat budget you needed for the Reasoning and Enterprise Requests behind it. This produces a tiered mental model the player learns to internalize:

```text
Simple / repeated   → Cache Server            (zero compute)
Simple / novel      → Small Model             (cheap, fast)
General traffic     → General Model           (balanced)
Hard reasoning      → Frontier Model          (reserved, expensive)
Unsafe              → Safety Gate → server    (clear risk first)
Enterprise          → Priority Queue          (protect strict SLA)
```

Every build, train, or contract choice must offer a clear benefit paired with a clear risk, so there is no dominant strategy. The strategic-tradeoffs table:

| Decision                 | Benefit                                               | Risk                                                    |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------- |
| Buy more GPUs            | More throughput                                       | More power/cooling cost; Brownout/Throttle risk         |
| Train bigger model       | Better hard-request quality                           | Higher serving Cost; undertrained without matching data |
| Distill model            | Cheaper inference, cheaper volume lane                | May lose quality                                        |
| Add cache                | Great for repeated queries                            | Weak against novel queries                              |
| Use RLHF                 | Better satisfaction/safety; hardens vs. Jailbreak     | Costs Clean Dataset and Compute Hours                   |
| Use quantization         | Lower Cost and Power; eases Brownout/Throttle         | Slight quality drop                                     |
| Build power plant        | Higher Electricity capacity                           | Expensive, slow to come online                          |
| Build cooling tower      | Higher heat capacity                                  | Expensive; PUE overhead eats budget                     |
| Sign enterprise contract | More Cash per Request                                 | Strict SLA — one miss is heavily penalized              |
| Use raw data quickly     | Faster, cheaper training                              | Noise/safety risk; poisons the Model                    |
| Clean dataset carefully  | Better, safer model                                   | Slower progress, higher Cash cost                       |
| Upgrade the Router       | Cheapest-capable assignment; the highest-leverage buy | Costs a build slot now for compounding return           |
| Reserve Priority Queue   | Protects lucrative SLA traffic                        | Idle reserved capacity if Enterprise volume is low      |

> **Reward smart composition.** A run won with three Small Models, a Cache Server, a well-upgraded Router, and a single reserved Frontier Model should out-score a run won with a wall of Frontier Model Servers — lower Cash burn, lower Power draw, healthier SLA. Scoring and difficulty curves (see §12 Scaling Laws and §16 Waves & Incidents) are tuned so that efficiency, not raw size, is the winning variable.

The standing tensions the player juggles every round, one per system axis:

- **Quality vs. cost (models vs. business)** — a bigger Model answers hard Requests but drains Cash Runway and Electricity on every Request, including easy ones it should never see.
- **Speed vs. correctness (efficiency vs. data)** — a fast cheap Model clears the lane but produces bad answers when its Quality falls below a Request's Complexity, costing Trust.
- **Data quality vs. speed (data)** — Raw Data trains fast but risks poisoning Models; Clean Dataset is slower and pricier but safe (see §13 Resources & Data Pipeline).
- **Provisioning vs. throughput (hardware vs. power/cooling)** — every GPU Rack you add must be matched by Power Plant and Cooling Tower capacity, or it Brownouts and Thermal Throttles instead of serving (see §15 Power, Cooling & the Data Center).
- **Safety vs. throughput (safety)** — screening risky traffic through the Safety Gate costs compute and latency, but skipping it trades a saved millisecond for heavy Trust damage on an unsafe serve.

---

## 18. Core Gameplay Loop

The game runs in **rounds**. Each round walks through four phases — **Build → Train → Wave → Incident** — then repeats with a bigger, meaner Wave. The first three phases are where the player makes decisions; the fourth tests how robust those decisions were.

1. **Build phase.** Place and upgrade hardware while the lane is quiet.
   - Buy GPU Racks for inference throughput.
   - Build Power Plants and Cooling Towers to feed and cool those racks.
   - Place or upgrade the Router, Cache Server, and Safety Gate.
   - Choose a training project to queue in the Training Lab.
2. **Train phase.** Spend Clean Dataset, Compute Hours, and Cash in the Training Lab to improve Model stats (Quality, Speed, Cost, Safety, Context). Training does not attack Requests — it reshapes how effective your Serving Towers will be in the coming Wave (see §11 Training Methods).
3. **Wave phase.** A themed flood of Requests enters the lane.
   - Requests arrive at Ingress carrying Work Required, Latency Deadline, Complexity, Safety Risk, Context Length, and Reward.
   - The Router classifies each Request and assigns it to the cheapest capable Serving Tower, Cache Server, or safety pipeline.
   - Serving Towers deplete Work Required; the Safety Gate clears Safety Risk on risky Requests.
   - Requests served fast, cheaply, correctly, and safely pay out Cash (and sometimes Data).
   - Requests that leak, time out, get a bad answer, or escape unsafe damage Trust and SLA.
4. **Incident phase.** A random event fires (GPU shortage, power-price spike, cooling failure, dataset contamination, model regression, jailbreak trend, and the rest of the §16 table). The player adapts _within the current build_ before the next, larger Wave.

The four-beat loop, drawn as a cycle:

```text
        ┌──────────────────────────────────────────────────┐
        │                                                  │
        ▼                                                  │
   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐
   │  BUILD  │──► │  TRAIN  │──► │  WAVE   │──► │ INCIDENT │
   └─────────┘    └─────────┘    └─────────┘    └────┬─────┘
   place racks,   reshape Model   serve the      one disaster
   power, cooling, cards in the    flood; earn    attacks one axis;
   router, cache   Training Lab    Cash + Data    adapt and survive
        ▲                                              │
        └──────────────── bigger next Wave ◄───────────┘
```

The **macro loop** is the spine those rounds turn around — the economic engine that lets each round handle a Wave the last one could not:

1. **Serve users** — process Requests fast, cheaply, correctly, and safely before they leak.
2. **Earn money + data** — clean serves pay Cash, and high-volume Free chat harvests Raw Data as a byproduct.
3. **Clean data** — refine dirty Raw Data into safe Clean Dataset (Cash + time + Compute Hours).
4. **Train** — spend Clean Dataset and Compute Hours on Training Methods that rewrite Model cards.
5. **Improve serving** — the better cards run through the _same_ GPU Racks, raising effective throughput, Quality, and Safety.
6. **Survive bigger waves** — the strengthened fleet meets a larger flood, which generates still more money and data, closing the loop.

```text
   ┌────────────────────────────────────────────────────────────┐
   │                                                            │
   ▼                                                            │
Serve users ──► earn money / data ──► clean data ──► train models
   ▲                                                            │
   │                                                            ▼
   └──────────── survive bigger waves ◄──── improve serving ────┘
```

> **Heart of the game.** _Serve users → earn money/data → clean data → train models → improve serving → survive bigger waves._ Each turn of this loop should let the player handle a Wave they could not have survived last round — but only if they spent their earnings on the _right_ upgrades. The Incident phase exists to punish over-specialized builds and reward flexible infrastructure.

---

## 19. Player Experience & Aesthetics (MDA)

GPTD is designed top-down from the feelings it wants to produce, using the **MDA framework** — _Mechanics → Dynamics → Aesthetics_ (see References, [7]). Mechanics are the rules and data (Work Required, the Router, the power inequality); Dynamics are the run-time behavior those rules generate under pressure (a traffic spike forcing a re-route, heat creeping toward its cap); Aesthetics are the emotional responses the Dynamics evoke in the player. The designer authors Mechanics; the player experiences them backwards, as Aesthetics first.

> **Design rule:** Every mechanic in this document must earn its place by the Dynamic and Aesthetic it produces. A term that is only recognizable AI vocabulary — with no felt Dynamic — is flavor, and flavor gets cut (see Non-Goals).

### 19.1 The intended emotional arc

The campaign is paced so the player's _self-image_ grows across three phases — the same Mechanics read differently as understanding deepens:

- **Early — "I am just blocking requests."** On Launch Day the player sees a tower-defense game: enemies advance, towers process them, do not let them leak. The Aesthetic is **Challenge** and legibility — learn the lane, place a Rack, watch a Latency Deadline drain.
- **Mid — "I see the model/GPU/power/data balance."** By Coding Boom and the Enterprise Contract, the player feels the systems underneath: a bad answer traces to Quality < Complexity, a leak traces to a throttled rack, a near-bankruptcy traces to the frontier serving trivial traffic. The Aesthetic shifts to **Discovery** — the board stops being towers and becomes a coupled machine.
- **Late — "I am running a platform."** By Viral Spike and Singularity Night, the player is composing a tiered fleet, defending SLAs, pre-warming for an announced demo, and absorbing Incidents without panic. The Aesthetic is **Expression** and **Fantasy** — two players with identical buildings post different results purely on how they route. The fantasy of _running an AI-serving platform_ is fully delivered.

### 19.2 Target feelings

The specific Aesthetics GPTD aims to produce, each owned by a named moment:

- **Traffic-spike tension** — the lane fills faster than it drains, the Power meter climbs toward its cap, and the player must decide _now_ what to shed.
- **The cleverness of a good route** — the small, repeated satisfaction of a Cache hit or a cheapest-capable assignment that serves a Request for almost nothing.
- **The growth rush after training a better model** — a card's bars animate upward and the _same racks_ suddenly chew through a wave that buried them last round.
- **The dread of a data center about to brown out** — `total_power_draw` creeping under `electricity_capacity`, knowing one more Rack means random racks go dark mid-wave.
- **The relief of saving Trust from near-zero** — a Jailbreak Raid nearly empties the Trust bar, the Safety Gate holds, and a Safety Audit reward (see §14) claws it back from the edge.

### 19.3 Mechanics → Dynamics → Aesthetics map

How core Mechanics chain into the feelings above:

| Mechanic (rules/data)                                 | Dynamic (run-time behavior)                                                                    | Aesthetic (felt experience)                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Router + cheapest-capable assignment                  | Player reads each Request's intent and sorts traffic across a tiered fleet under time pressure | **Expression** — the cleverness of a good route; identical builds diverge on skill |
| `total_power_draw <= electricity_capacity` + Brownout | Heat/power meters creep toward caps; one extra Rack risks random shutdowns                     | **Sensation / dread** of a data center about to brown out                          |
| Training Methods rewriting Model cards between waves  | A wave that buried you last round is now routine on the same hardware                          | **Growth rush** — the platform getting visibly stronger                            |
| Three independent Trust Core meters (no averaging)    | A defense tuned for one meter leaks the others; the player triages which bar to save           | **Challenge** — multidimensional, never a single solved number                     |
| Safety Gate vs. Jailbreak Safety Risk                 | Risky Requests hidden in normal volume must be screened before they exit                       | **Tension then relief** — saving Trust from near-zero                              |
| Wave volume vs. serving throughput + Cache/Batching   | A surge outruns the lane until caching and batching catch it back up                           | **Traffic-spike tension** resolving into control                                   |
| Incident phase attacking one axis (see §16)           | A surprise disaster invalidates the current optimum and forces a re-plan                       | **Discovery / Submission** — adapting a living system, not min-maxing a static one |

> **Design rule:** The win-state Aesthetic is _competence under a system you respect._ GPTD should never feel solved — the Incident system and the three-meter tension keep every round a fresh negotiation, so the late-game feeling is not "I beat the math" but "I am keeping a real platform alive." That is the whole game.

## 20. MVP Scope

The MVP is the **minimal playable subset** that still proves the core fantasy — not everything in this document ships at once. A player must be able to _win this slice by smart routing and lose it to Brownout, bad answers, or bankruptcy._ The canonical `mvpSubset` (🟢 = included in MVP):

### Resources

```text
🟢 Cash             # universal currency; its reserve IS the Cash Runway meter
🟢 Raw Data         # cheap, dirty serving byproduct; poison risk if trained on directly
🟢 Clean Dataset    # refined, safe training input to the Training Lab
🟢 Electricity      # power capacity; gates how many GPU Racks can run (see §15)
🟢 Cooling          # heat capacity; prevents Thermal Throttling (see §15)
🟢 Compute Hours    # consumed by training and evaluation in the Training Lab
🟢 Trust            # a Trust Core health bar (not a spendable currency)
```

> **Note.** Hardware is the only main resource (see §13) deliberately _outside_ the MVP: in the slice, Cash buys buildings directly and a separate Hardware stock is deferred.

### Buildings

```text
🟢 GPU Server       # supplies inference throughput; draws Power, emits heat
🟢 Router           # classifies traffic, assigns the cheapest capable destination
🟢 Cache            # instantly answers repeated/common Requests at near-zero compute
🟢 Safety Gate      # clears Safety Risk before a Request can exit
🟢 Training Lab     # between-wave Model upgrades along the tech tree
🟢 Power Plant      # raises Electricity capacity
🟢 Cooling Tower    # raises heat capacity
```

### Models

```text
🟢 Small Model      # high Speed, low Cost, modest Quality/Reasoning — cheap volume lane
🟢 General Model    # balanced workhorse for most lanes
🟢 Frontier Model   # high Quality/Reasoning/Context, low Speed, high Cost — hard cases only
```

### Training Methods

```text
🟢 Fine-tune        # Clean Dataset + Cash → instruction following / specialization
🟢 Distill          # big Model + dataset → faster, cheaper Small Model
🟢 RLHF             # human feedback + Compute Hours → satisfaction + Safety (see References, [2])
🟢 Quantize         # cuts Cost and Power draw at slight Quality risk
```

### Request Types

```text
🟢 Simple Chat      # low compute, low Reward, high volume
🟢 Coding           # medium compute, high Complexity, bad answers if Quality too low
🟢 Reasoning        # high compute, high latency, needs a strong Model
🟢 Long Context     # huge token/memory cost, stresses Context capacity
🟢 Jailbreak        # carries Safety Risk; heavy Trust damage if served unsafe
🟢 Enterprise       # high Reward, strict SLA, outsized penalty if missed
```

> **Note.** **Bot Swarm** and **Viral Spike** are MVP-adjacent **wave modifiers**, not distinct enemy stat blocks — they are authored as floods of the six MVP Request types (a Viral Spike of Simple Chat + Long Context; a Bot Swarm of low-value chatter) so they ship inside the slice's wave sequence without new enemy content.

### Vertical-slice goal

> **Vertical slice.** **One map, one escalating authored wave sequence,** with: the Router doing real cheapest-capable work over the three Models; routing plus Power/Cooling acting as a live placement constraint; the Cache short-circuiting repeats; the Safety Gate clearing Jailbreak risk; and **at least one training path** usable between waves in the Training Lab — with **all three Trust Core meters (Trust, SLA, Cash Runway) live and losable.**

The slice keeps the three load-bearing systems honest end to end:

- **Routing — the skill layer.** Two players with identical buildings post different results purely on how well the Router sorts traffic (see §8).
- **Power/Cooling — the constraint layer.** GPU Servers brown out and throttle if under-provisioned (see §15), so placement is a real puzzle, not scenery.
- **At least one training path — the upgrade layer.** A between-wave Model improvement (e.g. Distill the cheap lane, or RLHF the Safety stat against the Jailbreak wave) that visibly changes how the _same_ hardware performs next wave (see §11).

All three meters must be **capable of reaching zero** — win by routing well, lose distinctly to a timeout-leak (SLA), a bad/unsafe answer (Trust), a Brownout-induced leak (SLA→Trust), or overspending (Cash Runway). If failure is not genuinely multidimensional, the slice has not proven the fantasy.

### Explicitly deferred

Present in this document, absent from the MVP subset:

- **Specialized Serving Towers** — Coding, Reasoning, Multimodal, Embedding/Retrieval Model Servers.
- **Advanced infrastructure** — Load Balancer, KV Cache / PagedAttention upgrade, Batching Controller, Speculative Decoding Engine, Monitoring Center, Substation, Battery Storage, Fiber Backbone, Warehouse.
- **Extra Training Methods** — Pretraining, LoRA/Adapter tuning, RAG indexing, Speculative Decoding, Continual Learning, Red-teaming (the non-🟢 tech-tree nodes across all four paths).
- **Extra Request content** — Multimodal Requests, and Viral Spike / Bot Swarm promoted to first-class enemy stat blocks beyond their wave-modifier role.
- **The full Incident phase and the Singularity Night boss wave** (see §22, M5–M6).
- **Advanced Router upgrades** — intent classifier, complexity estimator, cost-aware, SLA-aware, safety, and fallback routing beyond the baseline cheapest-capable assignment.

### As-built notes (v0.1)

The shipped, playable build follows this design closely but makes a few concrete decisions and simplifications worth recording so the doc matches reality:

- **20-wave campaign.** Ships **20 authored waves** in four acts (see §16), Launch Day through the **Singularity Night** boss — not the original eight.
- **Cache is a server-side aura.** Instead of a standalone tower that answers Requests itself, the **Cache buffs Serving Towers in range** with a chance to instantly answer a _cacheable_ Request (Chat, Long Context, Bot Swarm). A cache hit returns a stored, correct answer for free — so a Cache does nothing without a server to overlap, and KV Cache raises the hit chance.
- **Safety is "held pending review."** A risky Request whose Work hits zero is **held** (no unsafe answer is ever served outright); it flows on until a **Safety Gate** clears it (→ served) or it leaks at the core (→ a Trust breach). This makes "Safety Gate before the core" the operative rule (see §6.4).
- **Servers batch by default.** Every Serving Tower processes **2 concurrent Requests** baseline (continuous batching); the Continuous Batching upgrade adds more.
- **Codex, the tutorial guide.** A pixel terminal-bot named **Codex** runs step-by-step onboarding (deploy → spread → start wave → serve → expand) and pops up contextual tips on Brownout, Throttling, Jailbreaks, and low Trust, with on-screen highlights of the relevant UI. Skippable; remembered via local storage.
- **Visible system design.** Online Routers and Caches draw a faint **aura ring**, and each routed Request draws a thin **routing line** to its assigned (matching-spec) server — so the value of routing and caching is legible at a glance.
- **Power is a gentle per-second operating cost** _plus_ a hard capacity constraint (Brownout / Thermal Throttling), tuned to pressure over-building without being a bankruptcy timer.
- **Implemented incidents** are a subset of §16.4: Power-Price Spike, Cooling Failure, GPU Shortage, Regulatory Audit, Dataset Contamination, plus the favorable Viral Integration and Enterprise Demo. Singularity Night always carries a hard one.
- **Tech tree** ships all four paths (Pretraining, Bigger Racks, Quantization, Distillation, Speculative Decoding, RLHF, Red-teaming, Cost-Aware Routing, KV Cache, Continuous Batching), gated behind a built Training Lab.

---

## 21. Technical Architecture

> This section proposes an implementation shape and **may** include code identifiers. It is concrete but **not mandatory** — treat identifiers and snippets as a starting point for the build, not a contract. Balance lives in data, not in these structures.

### Stack & project setup

- **Vite + TypeScript (strict) + PixiJS v8 + Web Audio.** Vite for the dev server and bundling; TypeScript strict mode for the simulation's correctness; PixiJS v8 as the WebGL/WebGPU renderer; the Web Audio API for all sound, generated procedurally (no audio asset pipeline in the MVP).
- ESLint + Prettier for hygiene; **Vitest** for unit tests over the deterministic simulation.
- Suggested folders: `src/sim/` (pure simulation, no PixiJS imports), `src/render/` (PixiJS), `src/data/` (typed definition tables), `src/ui/` (HUD), `src/app/` (bootstrap, loop wiring), `src/audio/` (Web Audio graph).

### Fixed-timestep simulation, decoupled from rendering

The simulation advances in fixed steps so a run is deterministic and replayable; rendering interpolates between sim states at the display refresh rate. The sim never reads wall-clock time or `Math.random()` directly.

```ts
const TICK_MS = 1000 / 30 // 30 Hz sim

let acc = 0
function frame(dtMs: number) {
  acc += Math.min(dtMs, 250) // clamp to avoid spiral-of-death
  while (acc >= TICK_MS) {
    world.step(TICK_MS / 1000) // pure, deterministic
    acc -= TICK_MS
  }
  renderer.draw(world, acc / TICK_MS) // alpha for interpolation
}
```

> **Determinism rule.** All randomness flows through a single **seeded RNG** (e.g. mulberry32 / xorshift) carried in the simulation state. Same seed + same inputs → identical run. This is what makes Vitest tests over Waves, Brownouts, and routing meaningful, and what lets both a fixed campaign and seeded roguelike runs share one engine (see §25).

### Entity / component model

A lightweight entity-component layer keeps `Request`, tower, projectile, and building behavior data-driven and composable. Entities are plain ids; components are typed structs in parallel stores; systems iterate the components they care about.

- **Request** — `Position`, `LaneProgress`, `RequestStats { workRequired, latencyDeadline, complexity, safetyRisk, contextLength, reward }`, `Health` (work remaining + deadline timer), `RouteAssignment`.
- **Tower / Building** — `Placement`, `TowerKind`, `PowerDraw`, `HeatOutput`, and for Serving Towers a `LoadedModel` reference plus `Targeting` and connection flags (`powered / cooled / networked / loaded`).
- **Projectile ("compute beam")** — the visual + logical link a Serving Tower fires at a Request to deplete Work Required: `Source`, `Target`, `WorkPerHit`. Pooled, never allocated mid-Wave.
- **Building (infrastructure)** — Power Plants, Cooling Towers, Router, Cache, Safety Gate as entities exposing capacity/throughput components the systems sum each tick.

### System list

Systems run in a fixed order each tick so the result is order-stable:

```text
WaveSpawner        → emits Requests per the active Wave definition + modifiers (Viral/Bot)
Routing            → classifies Requests, assigns cheapest capable server / Cache / Safety Gate
Processing/Combat  → Serving Towers fire compute beams, deplete Work Required, resolve the 4 gates
Power & Cooling    → sums power_draw / heat_output, applies Brownout & Thermal Throttling
Economy            → revenue − inference − power − maintenance; updates Cash Runway
Safety             → Safety Gate clears Safety Risk before unsafe answers land
Incident           → rolls and applies random between-wave events
Audio              → maps sim events (serve, leak, breach, incident) to procedural Web Audio cues
Render             → draws world state (separate cadence, reads an interpolated sim snapshot)
HUD/UI             → meters, capacity warnings, build/train menus
```

### Data-driven content

Balance must live in data, not code. All content ships as **typed definition tables** for **towers, models, requests, waves, and training methods** so a designer can retune without touching systems:

```ts
interface ModelDef {
  id: string
  quality: number
  reasoning: number
  speed: number
  cost: number
  safety: number
  context: number
  spec?: string
}
interface RequestDef {
  id: string
  workRequired: number
  latencyDeadline: number
  complexity: number
  safetyRisk: number
  contextLength: number
  reward: number
}
interface TowerDef {
  id: string
  powerDraw: number
  heatOutput: number
  throughput: number
}
interface WaveDef {
  id: string
  modifiers?: ('viralSpike' | 'botSwarm')[]
  spawns: { requestId: string; count: number; atSec: number }[]
}
interface MethodDef {
  id: string
  cost: Partial<Resources>
  effects: StatDelta[]
}
```

These tables are the single source of balance truth; systems read them and never hardcode numbers. The toy Scaling Law (§12) is itself a pure function over these fields, so retuning quality is a data change, not a code change.

### Rendering notes (PixiJS v8, pixel art)

- **Nearest-neighbor filtering + integer scaling** to keep pixels crisp: set `scaleMode: 'nearest'` on the `TextureSource` **at load time** (via the Assets loader's `data: { scaleMode: 'nearest' }`, overriding PixiJS v8's `linear` default), pair it with renderer `antialias: false` and `roundPixels: true`, and snap the stage scale to whole multiples.
- One **texture atlas** so all sprites share a base texture and **batch** into few draw calls. Keep interactive Request units as batched `Sprite`s in a normal `Container`.
- Reserve a **`ParticleContainer`** for high-count, purely visual effects (compute-beam particles, heat shimmer, Reward sparkles). In PixiJS v8 it holds lightweight **`Particle`** objects added via **`addParticle()`** (not `Sprite` children), trading per-child interactivity for raw throughput.
- **Object pooling** for Requests, compute beams, and floating damage/Reward text — allocate up front, recycle, never `new` mid-Wave.

### Procedural Web Audio

- All SFX and music are **synthesized at runtime** via the Web Audio graph (oscillators, gain envelopes, filtered noise) — no sample assets in the MVP. A small `audio/` layer subscribes to deterministic sim events and triggers cues: a soft "served" chime, a leak buzz, a Brownout power-down sweep, an Incident sting, and a layered procedural music bed whose intensity scales with wave pressure.
- Audio is a **pure consumer** of sim state, never a producer — it must never feed back into the simulation, so muting or audio-context suspension cannot desync a run.

### Game state machine

```text
Menu ──► Build ──(start wave)──► Wave ──(event)──► Incident ──┐
          ▲                       │                          │
          │                       └──────► GameOver           │
          └───────(round end)──────────────────◄─────────────┘
```

The top-level machine gates which systems and which UI are active: **Menu** (title / new run / load), **Build** (placement + Training Lab, lane quiet), **Wave** (spawning + combat live), **Incident** (a disaster resolves between waves), and **GameOver** (any one meter hit zero). Explicit transitions let the sim pause spawning, freeze the economy clock, or surface phase-specific HUD affordances.

### Save / load & testing

- **Save/load** serializes the full simulation state (RNG seed + tick + entity/component stores + resources + meters + state-machine phase) to JSON; loading rehydrates and resumes deterministically. Because the sim is PixiJS-free, the serialized state is exactly the canonical world — nothing in the renderer or audio layer needs persisting.
- **Testing** runs **Vitest** against the pure sim: seed a world, feed a `WaveDef`, step N ticks, and assert meter, economy, routing, and Brownout outcomes. Determinism makes these tests fast and stable, and lets a regression be reproduced from a single seed.

---

## 22. Development Roadmap

Milestones are incremental: each builds on a clean, tested foundation from the last. The MVP (see §20) is reached around **M3–M4**; M5–M6 complete the full strategic vision.

### M0 — Scaffold & tooling

_Goal: Repo scaffold and tooling so every later milestone builds on a clean, tested, deterministic foundation._

- Initialize Vite + TypeScript (strict) + PixiJS v8 with a booting render canvas.
- Set up ESLint + Prettier and a strict `tsconfig`.
- Add Vitest with one smoke test and a CI workflow.
- Wire a Web Audio bootstrap and a fixed-timestep (30 Hz) game-loop stub with a seeded RNG.
- Establish folder structure (`sim` / `render` / `data` / `ui` / `app`) and the shared glossary/definition types.

### M1 — One playable lane

_Goal: One playable lane where Requests spawn, advance, leak, and damage the Trust Core._

- Implement Request entities carrying Work Required, Latency Deadline, Complexity, Safety Risk, Context Length, and Reward.
- Render the data-center lane (Ingress to Response Exit) with Requests moving left to right.
- Implement the Trust Core with live Trust, SLA, and Cash Runway meters and their lose conditions.
- Add a basic Serving Tower that depletes Work Required and earns Reward, plus Simple Chat Requests.

### M2 — Power & cooling constraints

_Goal: Power and cooling constraints make GPU Servers a real placement and provisioning problem._

- Add GPU Server, Power Plant, and Cooling Tower with `power_draw` and `heat_output` budgets.
- Enforce `total_power_draw <= electricity_capacity` and `total_heat <= cooling_capacity` checks.
- Implement Brownout (random rack shutdown) and Thermal Throttling (global speed loss).
- Surface live Power and Heat capacity meters and breach warnings in the HUD.

### M3 — Routing & caching

_Goal: Routing and caching turn brute serving into a smart-assignment puzzle._

- Add the Router that classifies Request types and assigns the cheapest capable Serving Tower.
- Add the Cache to instantly answer repeated or common Requests.
- Introduce Small, General, and Frontier Models with Quality, Speed, and Cost plus the quality-vs-Complexity success gate.
- Add Coding and Reasoning Request types so routing choices start to matter.

### M4 — Data pipeline & Training Lab

_Goal: Data pipeline and Training Lab deliver the between-wave upgrade loop._

- Add Raw Data collection, cleaning into Clean Dataset, and the Compute Hours resource.
- Build the Training Lab with the Build / Train / Wave round structure.
- Implement Fine-tune, Distill, RLHF, and Quantize as Model stat upgrades.
- Add the toy Scaling Law so model size must balance against data, compute, and provisioning.

### M5 — Safety, threats & economy

_Goal: Safety, threat variety, and the full economy complete the core fantasy and finish the MVP._

- Add the Safety Gate and Jailbreak Requests with Safety Risk and unsafe-answer Trust penalties.
- Add Long Context and Enterprise Request types with memory cost and strict SLA penalties.
- Implement the full money economy (revenue minus inference, power, and maintenance).
- Author the themed campaign waves (Launch Day, Coding Boom, Jailbreak Raid, Enterprise Contract, Viral Spike).

### M6 — Depth, incidents & boss

_Goal: Depth, incidents, and the boss wave deliver the full strategic vision._

- Add the Incident phase with random events (power-price spike, cooling failure, GPU shortage, bad dataset, model regression, Bot Swarm).
- Add Speculative Decoding and RAG plus advanced Router upgrades (intent classifier, cost-aware, SLA-aware, safety, fallback routing).
- Implement the Singularity Night boss wave combining a giant mixed wave with a random disaster.
- Add progression, a balancing pass, save/load, and onboarding tutorials for the full campaign.

---

## 23. Glossary

| Term                            | Definition                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batching                        | Grouping multiple Requests into one inference pass to raise throughput, at the cost of a small added latency.                                                                                             |
| Brownout                        | A failure state when `total_power_draw` exceeds `electricity_capacity`, randomly and discretely shutting down GPU Racks and dropping serving capacity without warning.                                    |
| Cache Server                    | An infrastructure tower that instantly answers repeated or common Requests at near-zero compute, bypassing Serving Tower work entirely.                                                                   |
| Cash Runway                     | Trust Core meter for whether the company can keep operating. Fed by served Reward; drained by overspending on hardware, power, and training (profit = revenue − inference − power − maintenance).         |
| Clean Dataset                   | Training-ready data refined from Raw Data via Data Cleaning; slower and costlier to produce but the only safe, reliable input to the Training Lab.                                                        |
| Complexity                      | A Request's armor; the minimum Model Quality needed for a correct answer. If model_quality < complexity the work finishes but yields a bad answer that costs Trust.                                       |
| Continual Learning              | Ongoing training on fresh data and compute that adapts a Model to new Request types as the campaign introduces them.                                                                                      |
| Continuous Batching             | Dynamically admitting and retiring Requests within an in-flight batch so GPU slots never sit idle, sustaining high throughput under bursty volume.                                                        |
| Distillation                    | A Training Method that spends a big Model plus a dataset to mint a faster, cheaper Small Model, upgrading the cheap volume lane without buying GPUs.                                                      |
| Fine-tuning                     | Supervised fine-tuning (SFT); spends Clean Dataset plus Cash to improve instruction following and specialization on a Model card.                                                                         |
| GPU Rack                        | Infrastructure that supplies inference throughput while drawing Power and emitting heat; contributes zero unless connected to power, cooling, network, and a loaded Model checkpoint.                     |
| Incident                        | A random between-wave disaster (power-price spike, cooling failure, GPU shortage, bad dataset, model regression, bot swarm) that attacks one axis and tests build flexibility.                            |
| KV Cache                        | Stored key/value attention state that lets a Model continue a conversation or long context without recomputing prior tokens, improving long-conversation efficiency.                                      |
| Load Balancing                  | Spreading Requests across clusters so no single Serving Tower is overwhelmed; prevents Overload cascades and timeouts.                                                                                    |
| Model Collapse                  | Quality and diversity degradation from training a Model repeatedly on its own synthetic outputs instead of fresh real data.                                                                               |
| Models (Small/General/Frontier) | The three MVP Model tiers loaded into Serving Towers: Small (fast, cheap, modest quality), General (balanced workhorse), Frontier (high quality/reasoning, slow, costly). Models are weapons, not towers. |
| MVP                             | The minimal playable subset of resources, buildings, models, training methods, and request types that still proves the core fantasy, with all three Trust Core meters live and losable.                   |
| PagedAttention                  | A memory-management scheme that pages the KV Cache in fixed blocks so VRAM is used without fragmentation, letting more concurrent Long Context Requests fit.                                              |
| Pretraining                     | A long-horizon Training Method that raises base Quality and Reasoning across the board at the cost of enormous datasets and Compute Hours.                                                                |
| Priority Queue                  | A reserved-capacity lane that serves strict-SLA traffic (Enterprise) ahead of best-effort Requests so lucrative deadlines are protected.                                                                  |
| PUE                             | Power Usage Effectiveness; the ratio of total facility power to IT power, measuring how much electricity is wasted on cooling and overhead versus actual compute.                                         |
| Quantization                    | A Training Method that cuts a Model's Cost and Power draw at a slight Quality risk, easing Brownout and Thermal Throttling pressure.                                                                      |
| RAG                             | Retrieval-Augmented Generation; indexes Data into storage to cut hallucination on factual and long-context Requests, lifting effective Quality on fact-bound lanes.                                       |
| Rate Limiting                   | Capping the intake of low-value, high-volume traffic (Bot Swarm) so it cannot starve compute and power from paying Requests.                                                                              |
| Raw Data                        | Unprocessed data harvested as a byproduct of serving (especially free chat); cheap and plentiful but dirty, risking Model poisoning if trained on directly.                                               |
| Request                         | An enemy unit traveling the lane carrying Work Required, Latency Deadline, Complexity, Safety Risk, Context Length, and Reward. It is processed (served), never killed.                                   |
| RLHF                            | A Training Method using human feedback plus Compute Hours to improve a Model's user satisfaction and Safety, hardening it against Jailbreak Requests.                                                     |
| Router                          | The core skill-expression tower that classifies each Request and assigns it to the cheapest capable destination (Serving Tower, Cache, or safety pipeline).                                               |
| Safety Gate                     | The lane stage and Safety Gate tower where Safety Risk is cleared before a Request can exit; an uncleared risky serve deals heavy Trust damage.                                                           |
| Safety Risk                     | A Request's poison/status stat marking jailbreak or abuse danger; must be cleared by a Safety Gate or it deals heavy Trust damage on serve.                                                               |
| Scaling Law (Chinchilla)        | The toy quality formula relating parameters, Clean Dataset size, dataset quality, and training compute, enforcing that an oversized Model paired with too little data is undertrained, not better.        |
| Serving Tower                   | Any model-serving building that depletes a Request's Work Required by running a loaded Model on connected GPU Racks; the gun to the Model's ammunition.                                                   |
| SLA                             | Trust Core meter for latency and uptime commitments. Drained by slow answers, timeouts, overload, and Brownout/Throttling-induced leaks.                                                                  |
| Speculative Decoding            | An optimization pairing a small drafting Model with a Frontier Model to raise the Frontier Model's effective Speed with no Quality loss.                                                                  |
| Synthetic Data                  | Model-generated training data; cheap to scale but, if overused, risks Model Collapse as outputs feed back into training.                                                                                  |
| Thermal Throttling              | A failure state when `total_heat` exceeds `cooling_capacity`, uniformly and continuously reducing the speed of all GPU towers until Requests leak.                                                        |
| Trust                           | Trust Core meter for user belief that the service is useful and safe. Drained by leaked, bad, or unsafe answers; raised by correct/safe serving and reputation rewards.                                   |
| Trust Core                      | The player's base; a single defended object holding three independent loss-condition meters (Trust, SLA, Cash Runway). You lose the instant any one bottoms out.                                          |
| Work Required                   | A Request's effective HP; the processing a Serving Tower must complete (work_remaining −= processing_power × dt) before the answer can finish.                                                            |

---

## 24. References

GPTD is a game, not an ML system — but every mechanic is grounded in a real idea. These are the sources behind the techniques cited inline throughout the document.

1. Hinton, Vinyals & Dean (2015), _"Distilling the Knowledge in a Neural Network."_ — https://arxiv.org/abs/1503.02531 — basis for **Distillation** (train a small serving model from a big one).
2. Ouyang et al. (2022), _"Training language models to follow instructions with human feedback"_ (InstructGPT). — https://arxiv.org/abs/2203.02155 — basis for **RLHF** (satisfaction / safety / instruction-following).
3. Hoffmann et al. (2022), _"Training Compute-Optimal Large Language Models"_ (Chinchilla). — https://arxiv.org/abs/2203.15556 — basis for **compute-optimal scaling** (params and tokens must scale together).
4. vLLM. — https://vllm.ai/ — basis for the **Serving systems** (PagedAttention, continuous batching, high-throughput inference).
5. Leviathan, Kalman & Matias (2022), _"Fast Inference from Transformers via Speculative Decoding."_ — https://arxiv.org/abs/2211.17192 — basis for **Speculative Decoding** (small model drafts, big model verifies).
6. Google, _"Power usage effectiveness (PUE)."_ — https://datacenters.google/efficiency — basis for the **energy-overhead / PUE model** in Power & Cooling.
7. Hunicke, LeBlanc & Zubek (2004), _"MDA: A Formal Approach to Game Design and Game Research."_ — https://www.cs.northwestern.edu/~hunicke/MDA.pdf — framework for the **Player Experience & Aesthetics** section (see §19).

---

## 25. Open Design Questions

These are genuine unresolved questions implied by the design. Each needs a decision before or during the milestones in §22.

1. **Is the Build phase paused or real-time?** §18 describes discrete Build → Train → Wave → Incident phases, but it is undecided whether building is strictly between Waves (classic round-based TD) or whether the player can place and upgrade towers _during_ a Wave under time pressure. This changes the entire feel and the difficulty curve.
2. **Lane-based or grid placement?** §5 shows a single left-to-right lane, but a back row of Power Plants and Cooling Towers implies a 2D buildable area. Is placement a free grid, fixed tower slots along a lane, or a hybrid of lane (combat) plus yard (infrastructure)?
3. **Is routing authored by rules or fully automatic?** The Router is the skill expression (§8), yet it is open whether the player writes explicit routing rules (request-type → destination), buys upgrades that auto-route, or tunes weighted policies. Too automatic and the skill vanishes; too manual and it becomes spreadsheet micromanagement.
4. **How is training time represented across Waves?** It is unclear whether a training project completes instantly between Waves, consumes one or more whole rounds, or runs in real time competing with Wave attention. This determines how punishing a long-horizon bet (Pretraining, Continual Learning) feels.
5. **Can Models hot-swap into Serving Towers mid-run, and at what cost?** It is undecided whether a Serving Tower's loaded Model is fixed at build time or hot-swappable between Waves (with a Cash/Compute reload cost), which strongly affects how players respond to a Wave's specific threat profile.
6. **How does the toy Scaling Law expose itself to the player?** §12 promises "bigger isn't automatically better," but it is open whether the player sees the actual quality formula and its penalties, or only feels the consequences through Model stat changes. Transparency directly affects how learnable the strategic layer is.
7. **How visible and steerable is the Incident phase?** Incidents (power-price spike, cooling failure, bot swarm) drive replayability, but it is open whether they are telegraphed in advance (letting players pre-mitigate) or pure surprises, and whether the player has insurance tools (Battery Storage, redundancy) to hedge against them ahead of time.
8. **How granular is the Cache's "repeated query" model?** Caching is central to the anti-brute-force strategy, but it is undefined whether the Cache keys on exact Request types, a similarity/embedding match, or a simple hit-rate stat — which determines how strong caching is against a Viral Spike versus genuinely novel traffic.
9. **Roguelike runs or fixed campaign?** §16's themed Waves and random Incidents could support a fixed authored campaign (Launch Day → … → Singularity Night) or procedurally seeded roguelike runs with meta-progression. The seeded deterministic sim (§21) supports both — which is the primary mode?
10. **Single map or multiple maps?** The MVP targets one map and one Wave sequence, but it is open whether the full game ships distinct maps (different lane topologies, power/cooling constraints) or one evolving data center the player expands across the campaign.
11. **What is the art and audio scope?** Pixel art and procedural Web Audio are the chosen styles (§21), but the volume — how many Request sprite variants, tower tiers, animation states, and how deep the procedural music/SFX layer goes — is unscoped and directly drives the M5–M6 production budget.
12. **How is the three-meter balance kept anti-snowball?** With Trust, SLA, and Cash Runway all live, the design needs guardrails so a strong economy doesn't trivially carry the run (rich-get-richer) and a single bad Wave doesn't death-spiral all three meters at once. What dampening or comeback mechanics exist?
