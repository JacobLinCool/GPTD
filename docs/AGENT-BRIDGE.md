# Agent Bridge — let a terminal agent play GPTD in your open tab

GPTD is a tower-defense game that simulates running an LLM-inference data center,
and it is a pure front-end app with no backend. The **agent bridge** lets a local
terminal agent (Claude Code, Codex, …) **drive the game in a browser tab you
already have open** — a human keeps watching the live board, and every move the
agent makes is narrated in the in-game **Codex bubble** so you see *why*.

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

1. Open the game in your browser and add `?agent=1`, e.g. `https://jacoblincool.github.io/GPTD/?agent=1`.
   A small **Agent bridge** panel appears with a ready-to-paste command and a live
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
   narrating each move. You watch the live board and the Codex bubble.

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

So to run two agents on two games at once, open two tabs with `?agent=auto`; each
panel shows a `node bridge.mjs --port <n> --allow-origin <origin> …` command on its
own port. Paste each to a different agent — the two sessions never collide. If a
port is already taken the bridge exits with a clear message (reload for a fresh
random port).

## HTTP API (agent side)

| Request | Purpose |
| --- | --- |
| `GET /help` | the protocol, machine-readable (action vocab + snapshot keys) |
| `GET /state` | latest JSON snapshot of the live game (the decision context) |
| `GET /do?fn=…&args=…&reason=…` | run one action (shell-friendly form) |
| `POST /do` `{fn,args,reason}` | run one action (JSON form) |
| `GET /` or `/health` | `{tabConnected, hasState, pending, allowOrigins}` |

An agent that knows nothing else can start from `curl http://127.0.0.1:8799/help`.

`/do` blocks until the tab executes the move and returns
`{ok, result?, error?, state}` (the fresh snapshot). If no tab is connected it
returns `503`; if the tab never answers, `504` after 15 s.

### Actions (`fn` + positional `args`)

| `fn` | args | effect |
| --- | --- | --- |
| `build` | `[defId, col, row]` | place a tower (see `catalog` + `board.freeTiles`) |
| `sell` | `[towerId]` | sell a tower (60% refund) |
| `deploy` | `[towerId, modelId]` | deploy a checkpoint (only models in that rack's `deployableModelIds` fit) |
| `upgradeHardware` | `[towerId]` | upgrade a rack one GPU tier |
| `cycleRackRole` | `[towerId]` | cycle P/D disaggregation role (needs `inf_disagg`) |
| `buyUpgrade` | `[upgradeId]` | buy an infra/safety upgrade (needs a Lab) |
| `research` | `[researchId]` | start a research project (from `research.options`) |
| `postTrain` | `[baseIds[], method, target, effort]` | derive a checkpoint in the Studio (see `studio`); over GET use `args=baseId,method,target,effort` (single base) — `merge` (2 bases) needs the POST JSON form |
| `startWave` | `[]` | begin the next wave (build phase only) |
| `continueEndless` | `[]` | after a win, enter endless mode |
| `select` | `[towerId]` | highlight a rack in the inspect panel (visibility) |

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
{
  "phase": "build",            // build | wave | won | lost | menu
  "wave": 1, "totalWaves": 100, "isLastWave": false, "waveActive": false, "endless": false,
  "meters": { "cash": 300, "trust": 100, "sla": 100, "data": 0 },
  "power":  { "used": 0, "cap": 6 },   // cap is recomputed live (correct in build phase)
  "cooling":{ "used": 0, "cap": 6 },
  "flags":  { "hasLab": false, "hasLiquidLoop": false },
  "modifiers": { "buildCost": 1, "powerPrice": 1, "coolingCap": 1, "safetyDamage": 1, "volume": 1, "reward": 1 },
  "incident": null,            // {id,name,desc} when an incident is telegraphed for the next wave
  "nextWave": { "wave": 1, "name": "…", "brief": "…", "clearBonus": 12, "totalRequests": 30,
                "mix": [ { "typeId": "chat", "count": 30 } ] },   // build phase only; preview the upcoming wave
  "board":  { "cols": 24, "rows": 11, "core": { "col": 11, "row": 5 },
              "freeTiles": [ { "col": 4, "row": 2, "nearLane": true }, … ] },
  "towers": [ { "id": 1, "defId": "srv_edge", "col": 4, "row": 2, "hwId": "hw_edge",
               "modelId": "…", "sellValue": 3, "nextHwId": "hw_standard", "upgradeCost": 12,
               "deployableModelIds": [ "…" ] } ],   // models that fit THIS rack's VRAM now
  "catalog":[ { "defId": "srv_edge", "name": "Edge", "cost": 5, "affordable": true, "blockedReason": null } ],
  "hardware":[ { "id": "hw_edge", "name": "…", "hbmGb": 24, "cooling": "air",
                 "deployableModelIds": [ "…" ] } ],   // the GPU-tier ladder + what fits each tier
  "models": [ { "id": "…", "name": "…", "tier": "small", "quality": 41,
               "paramsTotalB": 8, "paramsActiveB": 8, "isMoE": false, "isReasoning": false } ],
  "upgrades": [ { "id": "…", "level": 0, "maxLevel": 1, "buyable": false } ],
  "research": { "infra": null, "posttrain": null, "eval": null,
                "options": [ { "id": "…", "name": "…", "desc": "…", "dataCost": 10, "requires": [ … ] } ] },
  "studio": { "available": false, "baseModelIds": [ "…" ], "targets": [ "chat", "coding", … ],
              "effortNotches": [ 0.25, 0.5, 1, 1.5, 2 ],
              "methods": [ { "id": "sft", "name": "…", "allowedTargets": [ … ], "dataCost": 8,
                            "unlocked": true, "requiresTech": null } ],
              "activeRun": null },
  "stats": { "served": 0, "sloMiss": 0, "bad": 0, "unservable": 0, "unsafe": 0,
             "overRefused": 0, "leaked": 0, "cashEarned": 0, "peakConcurrent": 0, "lastReportWave": null }
}
```

`stats` carries all six request outcomes — `unsafe` and `overRefused` are
what bleed **Trust**, `sloMiss` bleeds **SLA**. Watch them (and `incident` /
`nextWave`) to pre-empt safety/latency waves instead of reacting after the fact.

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
  agent mode suppresses the tutorial so it doesn't overwrite the reason bubble.
- `scripts/agent-smoke.mjs` — `node scripts/agent-smoke.mjs http://127.0.0.1:5173/`
  drives the whole loop through a real browser tab and asserts it works.
