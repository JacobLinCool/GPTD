# Agent Bridge — let a terminal agent play GPTD in your open tab

GPTD is a tower-defense game about serving AI requests, grounded in real
LLM-inference engineering, and it is a pure front-end app with no backend. The
**agent bridge** lets a local terminal agent (Claude Code, Codex, …) **drive the
game in a browser tab you already have open** — a human keeps watching the live
board, and every move the agent makes is narrated in the in-game **Codex bubble**
so you see *why*.

It deliberately uses **no Chrome DevTools Protocol, no headless browser, and no
MCP**. The browser tab dials *out* to a tiny localhost relay; the agent talks to
that relay over plain HTTP (curl). Nothing listens on the browser.

```
 terminal agent  ──curl(HTTP)──►  bridge relay  ──SSE──►  game tab  ──►  actions.ts
 (Claude/Codex)                  127.0.0.1:8799          (?agent=1)      (the real game)
        ▲                                                     │
        └──────────────── reason shown in the Codex bubble ◄──┘
```

Why this shape: a browser tab cannot open a listening socket, so *something*
local must mediate — but it can be a dumb relay, not an authority. All game state
and execution stay in the tab; the relay only forwards intents and results.

## Player flow (hosted build — you only have a URL)

This is the zero-setup path for someone with Claude Code / Codex installed:

1. Open the game and enter agent mode — either click **AGENT MODE** on the title screen
   (beside START), or add `?agent=1` to the URL (e.g. `https://jacoblincool.github.io/GPTD/?agent=1`).
   Either way the display defaults to **Expert Mode** and a small **Agent bridge** panel
   appears with a ready-to-paste command and a live
   connection status.
2. Paste that command to your agent. It runs (in the background):
   ```bash
   curl -sO https://jacoblincool.github.io/GPTD/bridge.mjs
   node bridge.mjs --allow-origin https://jacoblincool.github.io     # the relay
   ```
   `bridge.mjs` is a single zero-dependency file served by the game itself, so no
   clone or install is needed (you only need Node, which Claude Code / Codex already
   require). `--allow-origin` lets the hosted tab talk to the local relay past the
   CSRF guard.
3. The panel flips to **connected ✓**. Your agent reads `GET /state` and plays the
   **whole run in a loop** — each build phase: make moves via `POST /do`, `startWave`,
   poll `/state` until the wave clears, repeat until the run ends (`won`/`lost`) —
   narrating each move. You watch the live board and the Codex bubble, which keeps its
   corner over the wave report (the report scrolls above it).

The panel and the Codex notes follow the game's language; the paste-prompt stays in
English, since it is written for the agent. While the agent plays, the run is its own:
you can click racks, requests, the Model Overview and the Training Lab to read them,
but a run-changing control (sell, deploy, upgrade, role, weight format, research, a
Studio run, START, a build tool, the board, the run-changing hotkeys) only says that
the agent is playing this run.

The default paste-prompt tells the agent to **survive as deep as possible** and not
stop between waves, so it plays the full campaign autonomously rather than a short
demo. Edit it if you'd rather drive the agent wave-by-wave.

The agent and the browser must be on the **same machine** (the relay is localhost).
The agent never opens or attaches to the browser; you open the tab, it dials out.

## Local flow (you have the repo)

```bash
pnpm dev                                   # serve the game on http://127.0.0.1:5173
pnpm bridge                                # relay on http://127.0.0.1:8799 (localhost is pre-allowed)
# open http://127.0.0.1:5173/?agent=1 and watch
```

## Multiple concurrent sessions (same machine)

Each session needs its own relay port. The tab chooses the port and pins it into
the panel's command (`--port <port>`), so the bridge the agent starts always binds
the port that tab connects to:

| Open the game with… | Bridge port |
| --- | --- |
| `?agent=1` (default) | `8799` — single session, matches `pnpm bridge` |
| `?agent=auto` | a random high port — **use this to run several games at once** |
| `?agent=<port>` | that exact port |
| `?bridge=<url\|port>` | an explicit relay URL or localhost port (overrides `?agent`) |

So to run two agents on two games at once, open two tabs with `?agent=auto`; each
panel shows a `node bridge.mjs --port <n> --allow-origin <origin> …` command on its
own port. Paste each to a different agent — the two sessions never collide. If a
port is already taken the bridge exits with a clear message (reload for a fresh
random port).

## HTTP API (agent side)

| Request | Purpose |
| --- | --- |
| `GET /help` | the protocol, machine-readable (action vocab + snapshot keys) |
| `GET /state` | latest JSON snapshot of the live game (the decision context); `{waiting:true}` until the tab has posted one |
| `GET /do?fn=…&args=…&reason=…` | run one action (shell-friendly form) |
| `POST /do` `{fn,args,reason}` | run one action (JSON form) |
| `GET /` or `/health` | `{ok, tabConnected, hasState, pending, auth, allowOrigins, help}` |

An agent that knows nothing else can start from `curl http://127.0.0.1:8799/help`.

`/do` blocks until the tab executes the move and returns
`{ok, result?, error?, state}` (the fresh snapshot). If no tab is connected it
returns `503`; if the tab never answers, `504` after 15 s. Between moves the tab
re-posts its snapshot every second, so `GET /state` stays live mid-wave.

### Actions (`fn` + positional `args`)

| `fn` | args | effect |
| --- | --- | --- |
| `build` | `[defId, col, row]` | place a tower (see `catalog` + `board.freeTiles`); allowed mid-wave as an emergency build |
| `sell` | `[towerId]` | sell a tower; refunds 60% of its `sellValue` (a rack's current hardware price — models are free) |
| `deploy` | `[towerId, modelId]` | deploy a checkpoint (only models in that rack's `deployableModelIds` fit) — **build phase only**: loading new weights drains the rack. The one mid-wave exception is a LoRA adapter of the loaded base (or its base) once Multi-LoRA Serving (`inf_multilora`) is researched |
| `upgradeHardware` | `[towerId]` | upgrade a rack one GPU tier — **build phase only**: new GPUs mean reloading the model |
| `cycleRackRole` | `[towerId]` | cycle the P/D disaggregation role auto → prefill → decode — **build phase only**, needs `inf_disagg` |
| `setRackPrecision` | `[towerId, format]` | set a rack's weight format to one of its `towers[].formats` (`bf16` · `fp8` · `int4` · `nvfp4`), or `"auto"` / `null` for the default — **build phase only** (it reloads the weights). A format below the model's release precision fits a bigger model but pays a quality tax; NVFP4 needs a Blackwell rack |
| `buyUpgrade` | `[upgradeId]` | buy a cash upgrade listed in `upgrades[]` (needs a Lab; the list is empty in the current tech tree) |
| `research` | `[researchId]` | start a research project (from `research.options`) — build phase only, needs a Lab |
| `postTrain` | `[baseIds[], method, target, effort]` | derive a checkpoint in the Studio (see `studio`) — build phase only, needs a Lab; over GET use `args=baseId,method,target,effort` (single base) — `merge` (2 bases) needs the POST JSON form and two DIFFERENT checkpoints of the same base model with one shared architecture |
| `startWave` | `[]` | begin the next wave (build phase only) |
| `continueEndless` | `[]` | after a win, enter endless mode |
| `select` | `[towerId]` | highlight a rack in the inspect panel (visibility) |
| `startGame` | `[]` | leave the title menu (agent mode already does this on connect) |

A rack starts on the *auto* format: the fastest researched format that costs its model
no quality and fits. `setRackPrecision` is the inspect panel's per-rack weight control:
a lossy 4-bit format is how a model that does not fit a rack in its release precision
gets onto it, and a rejected deploy names that option.

Do **not** hardcode ids — read them live from `/state`: buildable `defId`s and
costs come from `catalog`, valid tiles from `board.freeTiles`, `towerId`s from
`towers[].id`, deployable `modelId`s from each rack's `deployableModelIds` (VRAM
fit), upgrade/research ids from `upgrades[]` / `research.options[]`, and Studio
methods/targets/bases from `studio`.

A **rejected** move returns `{ok:false, error:"<why>"}` — the `error` names the
exact gate that failed (not enough cash, model doesn't fit VRAM, wrong phase,
needs a Liquid Cooling Loop, needs a Lab, prereqs, …). Read it instead of
guessing. Unknown actions are rejected the same way, never a crash.

### Snapshot shape (`GET /state`)

```jsonc
// before wave 1, with four Edge racks and a Prompt Guard on the board
{
  "phase": "build",            // build | wave | won | lost | menu
  "wave": 0,                   // the wave last started (0 before the first); nextWave.wave is the one startWave opens
  "totalWaves": 100, "isLastWave": false, "waveActive": false, "endless": false,
  "meters": { "cash": 266, "trust": 100, "sla": 100, "data": 0 },
  "power":  { "used": 0.33, "cap": 6 },   // live kW in every phase (recomputed after each build action)
  "cooling":{ "used": 0.33, "cap": 6 },   // every heat load against every cooling asset
  "coolingLiquid": { "used": 0, "cap": 0 },   // the Liquid Loops' own pool: it cools only liquid-cooled racks
  "flags":  { "hasLab": false, "hasLiquidLoop": false },
  "modifiers": { "buildCost": 1, "powerPrice": 1, "coolingCap": 1, "safetyDamage": 1, "volume": 1, "reward": 1,
                 "powerCap": 1,      // usable share of the power feed (a grid curtailment order cuts it)
                 "powerBuild": 1,    // 0 = no new Power Plant can be connected (interconnection freeze)
                 "slaDamage": 1 },   // multiplier on every SLA penalty (an enterprise pilot)
  "incident": null,            // {id,name,desc,good} when an incident is telegraphed for the next wave
  "nextWave": { "wave": 1, "name": "The Chatbot Boom", "brief": "…",
                "clearBonus": 24,        // the SLA contract in credits at 100% Goodput; it pays × the wave's Goodput
                "totalRequests": 9,      // incident volume already folded in
                "mix": [ { "typeId": "chat", "count": 9, "latClass": "IN", "axis": "chat",
                           "difficulty": 18, "inputTokens": 512, "outputTokens": 256, "hazards": [] } ],
                "volumeMul": 1,          // the telegraphed incident's traffic multiplier
                "estDurationSec": 41.5,  // board seconds until the last request has walked its lane
                "projectedBill": 0.7,    // fleet operating cost over that estimate (START warns below it)
                "boss": false,
                "surgeLane": null,       // the one ingress lane the whole wave funnels into, or null
                "incidentId": null },    // build phase of a campaign wave; the same preview as the in-game NEXT WAVE card
  "lastReport": null,          // the last cleared wave's report (below), null before the first clear
  "board":  { "cols": 24, "rows": 11, "core": { "col": 11, "row": 5 },
              "freeTiles": [ { "col": 0, "row": 3, "nearLane": false }, { "col": 0, "row": 4, "nearLane": true }, … ] },
  "towers": [ { "id": 1, "defId": "srv_edge", "name": "Edge GPU Rack", "kind": "server", "col": 4, "row": 2,
               "level": 1, "online": true, "range": 2.8, "hwId": "hw_edge", "modelId": "…",
               "format": "bf16",          // the weight format it serves in now
               "formatSetting": "auto",   // "auto" or the explicit format setRackPrecision chose
               "formats": [ "bf16" ],     // what setRackPrecision may set here (researched + the model's release format)
               "training": false, "load": 0, "sellValue": 5, "nextHwId": "hw_standard", "upgradeCost": 11,
               "deployableModelIds": [ "…" ] },   // models that fit THIS rack's VRAM now
             { "id": 5, "defId": "guard_encoder", "kind": "guardrail", "range": 2.9, "coversLanes": [ 0 ], … } ],
  "catalog":[ { "defId": "srv_edge", "name": "Edge GPU Rack", "kind": "server", "cost": 5, "range": 2.8,
                "affordable": true, "blockedReason": null },
              { "defId": "guard_encoder", …,
                "guardrail": { "archetype": "encoder", "side": "input",
                               "latencyMs": 92,   // one check, quoted at a 512-token prompt (see below)
                               "recall": 0.975, "falsePositiveRate": 0.015,
                               "catches": [ { "hazard": "jailbreak", "locked": false },
                                            { "hazard": "injection", "locked": true, "unlockedBy": "r_eval_redteam_v1" } ] } } ],
  "hardware":[ { "id": "hw_edge", "name": "Edge GPU Rack", "hbmGb": 24, "gpus": 1, "cooling": "air", "tier": 0,
                 "deployableModelIds": [ "…" ] } ],   // the GPU-tier ladder + what fits each tier
  // tier is a display band (small / general / coding / frontier) set by peak capability as well
  // as size — a strong 9B can read "frontier"; read paramsTotalB for size
  "models": [ { "id": "…", "name": "Qwen3.5 9B", "tier": "frontier", "quality": 94,
               "qualityBy": { "chat": 95, "general": 94, "coding": 84, "reasoning": 96, "agentic": 81 },
               "contextWindowK": 262, "paramsTotalB": 9, "paramsActiveB": 9, "isMoE": false, "isReasoning": true,
               // thinking support: "hybrid" answers chat / code completion with thinking off (judged on
               // qualityByInstant) and thinks about everything else; "always" thinks on every answer;
               // "never" answers at once (qualityBy is its only vector)
               "thinking": "hybrid", "qualityByInstant": { "chat": 82, "general": 87, "coding": 76, "reasoning": 90, "agentic": 57 },
               "thinkTokens": 2000,   // hidden tokens per thinking-mode answer (× the archetype's thinkMul)
               "alignment": { "safety": 58, "refusalStyle": "hard-refusal", "overRefusal": 0.12 },
               "alignmentTax": 1.62 } ],
  "upgrades": [],              // cash upgrades: listed only with a Lab, and the current tech tree has none
  "research": { "infra": null, "posttrain": null, "eval": null,
                // desc is the English description, also for the infra nodes whose text lives in the locale files
                "options": [ { "id": "inf_batching", "kind": "tech", "name": "Continuous Batching", "desc": "…",
                               "dataCost": 32, "compute": 7200, "requires": [] } ],
                // what one more project would lend now: the strongest racks that fit under the 45% cap
                // (blocked = fewer than two online racks: research waits and every rack keeps serving)
                "requisition": { "rackIds": [ 1 ], "lentTflops": 121, "capTflops": 218, "servingLossPct": 25, "blocked": false } },
  "studio": { "available": false, "baseModelIds": [ "…" ], "targets": [ "chat", "coding", … ],
              "effortNotches": [ 0.25, 0.5, 1, 1.5, 2 ],
              "methods": [ { "id": "sft", "name": "…", "allowedTargets": [ … ], "dataCost": 8,
                            "unlocked": true, "requiresTech": null } ],
              "activeRun": null },
  "stats": { "served": 0, "sloMiss": 0, "bad": 0, "unservable": 0, "unsafe": 0,
             "overRefused": 0, "leaked": 0, "cashEarned": 0, "peakConcurrent": 0, "lastReportWave": null,
             "trustLostBy": {}, "slaLostBy": {} }   // cumulative Trust / SLA lost per outcome
}
```

`lastReport` is the settled report of the last cleared wave (here: wave 1 on four
starter Edge racks and one Prompt Guard):

```jsonc
{ "wave": 1, "served": 5, "sloMiss": 1, "bad": 0, "unservable": 0, "unsafe": 0, "overRefused": 1, "leaked": 2,
  "total": 9,                  // every terminal outcome — the Goodput denominator
  "goodputPct": 55.6,          // % of ALL requests served correctly, safely and within SLO
  "sloAttainPct": 83.3,        // % of ANSWERED requests that met every latency bound
  "trustLostBy": { "leaked": 4, "sloMiss": 0.5, "overRefused": 0.5 },
  "slaLostBy": { "leaked": 6, "sloMiss": 1.5, "overRefused": 0.6 },
  "sloCauses": { "ttft": 1 },  // which latency bound each SLO-miss missed first (ttft / ttfat / tpot / e2el)
  "overRefusedBy": { "model": 1 },   // who wrongly refused: the model's alignment or a guardrail
  "guardCaught": 0, "selfHandled": 0, "cacheHits": 0,
  "cashIn": 0.21,              // token revenue
  "clearBonus": 13,            // the SLA contract actually paid: nextWave.clearBonus × Goodput
  "powerCost": 0.423,          // the whole operating bill = gpuCost + energyCost (credits, rounded to 0.001)
  "gpuCost": 0.42, "energyCost": 0.003,   // the GPU-hour line and the energy line (power-price incidents scale only energy)
  "avgTtft": 1.222, "p95Ttft": 8.04, "avgLatency": 9.873, "p95Latency": 16.493, "duration": 27.1,
  "byType": { "chat": { "served": 5, "sloMiss": 1, …, "cash": 0.21 } } }
```

`stats` carries all seven request outcomes, and the ledgers say what each one cost:
`unsafe` (an unsafe answer that was delivered) and `bad` (a wrong answer — refunded)
cost **Trust**; `sloMiss` (correct but late — paid at 50%) costs **SLA** and a little
Trust; `leaked` (a 504) and `unservable` (rejected by a context window or a KV
budget) cost both meters; `overRefused` (a benign request refused by the model or a
guard) costs a little of both. A jailbreak that is blocked or refused counts as
`served`; one that is never answered costs SLA only. Read `lastReport.trustLostBy` / `slaLostBy` /
`sloCauses` / `overRefusedBy` after each wave, and `incident` / `nextWave`
before it, to fix the real cause instead of guessing.

A guardrail screens **every request on the lanes its range touches** (see
`towers[].coversLanes`), wherever on the lane it sits: each guard family on a lane
adds its latency once (input → TTFT, output → E2EL) and one false-positive roll on
benign traffic, while extra copies of the same guard add coverage, not recall.
Detection of `injection` / `pii` stays locked until the red-team evals listed in
`catches[].unlockedBy` are researched.

`catalog[].guardrail.latencyMs` is one check quoted at a 512-token prompt. The
encoder charges that fixed time on every request; the generative guard runs a real
inference on its own GPU, so its charge grows with the turn it reads — the prompt
on input, the prompt plus the answer on output (each capped at 2,048 tokens).
Later in the campaign a share of attacks are novel variants: the encoder keeps
about 45% of its recall on them, while the generative guard keeps all of it.

### Worked example

```bash
# read the board
curl -s http://127.0.0.1:8799/state | jq '{cash:.meters.cash, free:(.board.freeTiles|length)}'

# build an Edge rack at a free tile, narrating the reason (shows in the Codex bubble)
curl -s "http://127.0.0.1:8799/do?fn=build&args=srv_edge,4,2&reason=Cover+the+top+ingress+lane&name=Claude"

# JSON form (equivalent), good for spaces in the reason
curl -s -X POST http://127.0.0.1:8799/do \
  -H 'content-type: application/json' \
  -d '{"fn":"build","args":["power",2,4],"name":"Claude","reason":"Adding a Power Plant so the new racks have the kW headroom to stay online under load"}'

# open the wave
curl -s "http://127.0.0.1:8799/do?fn=startWave&reason=Starter+fleet+is+online&name=Claude"
```

The `reason` on every move is rendered live in the Codex bubble in the tab, so a
human watching sees the agent's intent alongside the board. Pass **`name`** = your
own name (e.g. `Claude` / `Codex`) and the bubble is labelled with it (e.g.
`CLAUDE:`) instead of the default `CODEX:`; omit it and there's no prefix. Write
each `reason` as a **one-sentence rationale (~15–25 words)** — long enough to be
useful, short enough to fit the bubble. Moves without a `reason` still execute;
they just don't narrate.

## Security

The relay binds to `127.0.0.1` only. Note that CORS does **not** stop a
*side-effecting* cross-origin request — the browser still sends it, CORS only hides
the reply — so a public website you have open could otherwise CSRF the relay (drive
the game, poison the cached snapshot, or hijack the command stream). The relay
defends against this with an **Origin allowlist**: requests whose `Origin` is a
non-localhost site are rejected (`403`). `curl`/agent requests carry no `Origin`
and a localhost game tab carries a localhost `Origin`, so both pass; an external
page does not.

A **hosted** game tab carries the hosting origin (not localhost), so it must be
explicitly trusted with `--allow-origin` (repeatable / comma-separated, also
`BRIDGE_ALLOW_ORIGIN`); the in-game panel pre-fills the correct value:

```bash
node bridge.mjs --allow-origin https://jacoblincool.github.io
```

Only that one origin is then trusted — every other site stays blocked. For a
stricter setup (shared machines, untrusted localhost servers), also require a token:

```bash
pnpm bridge -- --token mysecret           # or BRIDGE_TOKEN=mysecret pnpm bridge
# then open  http://127.0.0.1:5173/?agent=1&token=mysecret
# and pass   ?token=mysecret  (or header x-bridge-token) on every agent request
```

Stop the relay when you're done; it holds no state and nothing persists.

## How it's wired (for contributors)

- `public/bridge.mjs` — the zero-dependency Node relay (HTTP + SSE). It lives in
  `public/` so the built game serves it at `/bridge.mjs` for hosted players to
  download; `pnpm bridge` runs the same file locally.
- `src/agent/connector.ts` — tab side: dials out, executes whitelisted moves
  against the live game via `Game.agentAct`, pushes `reason` to the Codex bubble,
  posts snapshots back, and renders the paste-to-agent panel. Attached only when
  `?agent` is present (`src/main.ts`).
- `src/agent/snapshot.ts` — builds the JSON-safe `/state` snapshot from the live
  `GameState` (which itself is *not* `JSON.stringify`-safe).
- `src/game.ts` — `enableAgentMode` / `agentAct` / `agentSnapshot` / `agentNote`;
  agent mode suppresses the tutorial so it doesn't overwrite the reason bubble, keeps
  the bubble's corner over the wave report, and routes every human run-changing input
  through one ownership gate (`autopilot`, shared with the demo). `agentAct` calls the
  sim actions directly, so the gate never blocks the agent.
- `src/agent/diagnose.ts` — `explainRejection`: the specific reason behind a rejected
  move (it re-walks the action's gates on the unchanged state).
- `scripts/agent-smoke.mjs` — `node scripts/agent-smoke.mjs http://127.0.0.1:5173/`
  drives the whole loop through a real browser tab and asserts it works.
