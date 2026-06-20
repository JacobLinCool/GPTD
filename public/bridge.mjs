#!/usr/bin/env node
// GPTD agent bridge — a zero-dependency localhost relay between a terminal agent
// (Claude Code / Codex, via curl) and an already-open game tab (?agent=1).
//
//   agent  --curl-->  bridge (127.0.0.1:8799)  --SSE-->  game tab  --> actions.ts
//
// The tab dials OUT to this relay (so no inbound socket to the browser, no CDP,
// no MCP). The agent issues moves over plain HTTP; each carries an optional
// `reason` that the tab renders in the Codex bubble for a human to watch live.
//
// This file is also SERVED by the game (it lives in public/), so a player on a
// hosted build can fetch it and run it without cloning the repo:
//   curl -sO https://<the-game-origin>/bridge.mjs
//   node bridge.mjs --allow-origin https://<the-game-origin>   # run in background
// Locally: `pnpm bridge` (localhost origins are always allowed).
//
// HTTP API (agent side):
//   GET  /help                         -> this protocol, machine-readable
//   GET  /state                        -> latest JSON snapshot of the live game
//   GET  /do?fn=startWave&reason=...    -> run one action, returns {ok,result,error,state}
//   POST /do  {fn,args,reason}          -> same, JSON body form
//   GET  /                             -> health + whether a tab is connected
//
// Action vocab (fn / args): build [defId,col,row] · sell [towerId] ·
//   deploy [towerId,modelId] · upgradeHardware [towerId] · cycleRackRole [towerId] ·
//   buyUpgrade [upgradeId] · research [researchId] · postTrain [baseIds[],method,target,effort] ·
//   startWave · continueEndless · select [towerId] · startGame
import http from 'node:http'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const flagAll = (name) => {
  const out = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1])
  return out
}
const PORT = Number(flag('port', process.env.BRIDGE_PORT || 8799))
const HOST = '127.0.0.1'
const TOKEN = flag('token', process.env.BRIDGE_TOKEN || '')
const CMD_TIMEOUT_MS = 15000

const normOrigin = (o) => {
  try {
    return new URL(o).origin
  } catch {
    return ''
  }
}
// Extra origins allowed to reach the relay (a hosted game's origin). localhost is
// always allowed; everything else is rejected by the CSRF guard below.
const ALLOW_ORIGINS = new Set(
  [...flagAll('allow-origin'), process.env.BRIDGE_ALLOW_ORIGIN || '']
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normOrigin)
    .filter(Boolean),
)

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-bridge-token',
}

/** @type {import('node:http').ServerResponse | null} the single active game tab */
let tab = null
let lastState = null
let seq = 0
/** @type {Map<number, {res: import('node:http').ServerResponse, timer: NodeJS.Timeout}>} */
const pending = new Map()

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json', ...CORS })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 5_000_000) req.destroy() // hard cap; snapshots are small
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

function coerceArg(s) {
  const v = s.trim()
  if (v === '') return v
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (v === 'true') return true
  if (v === 'false') return false
  return v
}

function authOK(req, url) {
  if (!TOKEN) return true
  const t = url.searchParams.get('token') || req.headers['x-bridge-token']
  return t === TOKEN
}

// CSRF defense for a localhost relay: CORS blocks a cross-origin page from READING
// the reply, but the side-effecting request is still SENT — so a public website you
// happen to have open could otherwise drive or hijack the relay.
//   - Origin present → allow only localhost or an explicit --allow-origin.
//   - Origin absent  → legitimate for non-browser clients (curl sends no Sec-Fetch-*;
//     Node fetch sends Sec-Fetch-Mode: cors). A browser CSRF GET — e.g. a malicious
//     <img src=".../do?fn=startWave"> or a navigation — omits Origin but carries
//     Sec-Fetch-Mode "no-cors"/"navigate"; reject exactly those. (A real browser
//     cors request always carries an Origin, handled above.)
function originOK(req) {
  const o = req.headers.origin
  if (o) {
    let parsed
    try {
      parsed = new URL(o)
    } catch {
      return false
    }
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') return true
    return ALLOW_ORIGINS.has(parsed.origin)
  }
  const mode = req.headers['sec-fetch-mode']
  return !mode || mode === 'cors'
}

function failAllPending(error) {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    sendJSON(p.res, 503, { ok: false, error })
  }
  pending.clear()
}

const HELP = {
  about: 'GPTD agent bridge — drive an already-open game tab (?agent=1) over HTTP. The tab connects out; you issue moves here.',
  flow: [
    'GOAL: play the WHOLE run and survive as deep into the campaign as possible. Loop: in each build phase make good moves then startWave, poll /state until the wave clears, and repeat — keep going until phase is "won" or "lost". Do not stop to check in between waves.',
    'GET /state to read the live board (the decision context).',
    'POST /do {fn,args,reason,name} (or GET /do?fn=&args=&reason=&name=) to make one move.',
    'Pass `name` = your own name (e.g. Claude / Codex) on each move; it labels the in-game bubble so a viewer sees who is playing. Make each `reason` a one-sentence rationale (~15-25 words); it shows in the bubble.',
    'Do not hardcode ids: read defIds+costs from state.catalog, tiles from state.board.freeTiles, towerId from state.towers[].id, modelId from state.models[].id, upgrade/research ids from state.upgrades[]/state.research.options[].',
  ],
  actions: {
    build: '[defId, col, row]  — place a tower on a free integer tile (state.board.freeTiles)',
    sell: '[towerId]',
    deploy: '[towerId, modelId]  — deploy a checkpoint onto a rack (only models in its deployableModelIds fit)',
    upgradeHardware: '[towerId]  — upgrade a rack one GPU tier',
    cycleRackRole: '[towerId]  — cycle P/D disaggregation role (needs inf_disagg research)',
    buyUpgrade: '[upgradeId]  — needs a Lab',
    research: '[researchId]  — from state.research.options',
    postTrain: '[baseIds[], method, target, effort]  — derive a checkpoint in the Studio (see state.studio). Over GET, args=baseId,method,target,effort works for a SINGLE base; merge (2 bases) needs the POST JSON form with a nested array.',
    startWave: '[]  — build phase only',
    continueEndless: '[]  — after a win',
    select: '[towerId]  — highlight a rack in the inspect panel',
    startGame: '[]  — leave the menu',
  },
  onReject: 'A rejected /do returns {ok:false, error:"<why>"} — read error; it explains the exact gate that failed (cash, VRAM fit, phase, liquid loop, lab, prereqs, …).',
  stateKeys: [
    'phase, wave, totalWaves, isLastWave, waveActive, endless',
    'meters{cash,trust,sla,data}, power{used,cap}, cooling{used,cap}, flags{hasLab,hasLiquidLoop}, modifiers{buildCost,powerPrice,coolingCap,safetyDamage,volume,reward}',
    'incident{id,name,desc} | null, nextWave{name,brief,clearBonus,totalRequests,mix[]} | null (build phase)',
    'board{cols,rows,core,freeTiles[{col,row,nearLane}]}, towers[{id,defId,col,row,hwId,modelId,role,sellValue,nextHwId,upgradeCost,deployableModelIds}]',
    'catalog[], hardware[{id,name,hbmGb,cooling,deployableModelIds}], models[], upgrades[], research{infra,posttrain,eval,options[{id,name,desc,dataCost,requires}]}',
    'studio{available,baseModelIds,targets,effortNotches,methods[{id,name,allowedTargets,dataCost,unlocked,requiresTech}],activeRun}',
    'stats{served,sloMiss,bad,unservable,unsafe,overRefused,leaked,cashEarned,peakConcurrent,lastReportWave}',
  ],
  examples: [
    `curl -s http://${HOST}:${PORT}/state`,
    `curl -s "http://${HOST}:${PORT}/do?fn=build&args=srv_edge,4,2&reason=Cover+the+top+lane"`,
    `curl -s "http://${HOST}:${PORT}/do?fn=startWave&reason=Starter+fleet+online"`,
  ],
}

function dispatch(cmd) {
  if (!tab) {
    return {
      deferred: false,
      payload: { ok: false, error: 'no game tab connected — open the game with ?agent=1 in a browser on this machine' },
    }
  }
  const id = ++seq
  return { deferred: true, id, cmd }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  if (!authOK(req, url)) {
    sendJSON(res, 401, { ok: false, error: 'bad or missing token' })
    return
  }

  if (!originOK(req)) {
    sendJSON(res, 403, {
      ok: false,
      error: `cross-origin request rejected (CSRF guard). If this is the game origin, start the bridge with --allow-origin ${req.headers.origin}`,
    })
    return
  }

  // ---- self-describing protocol ----
  if (path === '/help' && req.method === 'GET') {
    sendJSON(res, 200, HELP)
    return
  }

  // ---- tab side: Server-Sent Events stream of commands ----
  if (path === '/events' && req.method === 'GET') {
    const wasConnected = !!tab
    if (tab && tab !== res) {
      // A new tab takes over as the single executor; fail anything we already
      // dispatched to the old tab so the agent doesn't hang on a dead stream.
      failAllPending('game tab was replaced by a new connection')
      tab.end()
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...CORS,
    })
    res.write('retry: 2000\n\n')
    res.write(': connected\n\n')
    tab = res
    if (!wasConnected) console.log('[bridge] game tab connected — ready to play')
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    req.on('close', () => {
      clearInterval(ping)
      if (tab === res) {
        tab = null
        // The active tab is gone — fail in-flight commands now instead of letting
        // the agent block for the full CMD_TIMEOUT_MS on a known-dead tab.
        failAllPending('game tab disconnected before responding')
      }
    })
    return
  }

  // ---- tab side: push the latest snapshot ----
  if (path === '/state' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const parsed = JSON.parse(body)
      if (parsed && parsed.state !== undefined) lastState = parsed.state
    } catch {
      /* ignore malformed */
    }
    sendJSON(res, 200, { ok: true })
    return
  }

  // ---- tab side: result of a command, unblocks the waiting agent request ----
  if (path === '/result' && req.method === 'POST') {
    const body = await readBody(req)
    try {
      const r = JSON.parse(body)
      if (r && r.state !== undefined) lastState = r.state
      const p = r && typeof r.id === 'number' ? pending.get(r.id) : undefined
      if (p) {
        clearTimeout(p.timer)
        pending.delete(r.id)
        sendJSON(p.res, 200, { ok: !!r.ok, result: r.result, error: r.error, state: r.state ?? lastState })
      }
    } catch {
      /* ignore malformed */
    }
    sendJSON(res, 200, { ok: true })
    return
  }

  // ---- agent side: read the latest snapshot ----
  if (path === '/state' && req.method === 'GET') {
    if (lastState == null) {
      sendJSON(res, 200, { waiting: true, error: 'no snapshot yet — is the game tab open at ?agent=1 ?' })
    } else {
      sendJSON(res, 200, lastState)
    }
    return
  }

  // ---- agent side: issue one action ----
  if (path === '/do' && (req.method === 'GET' || req.method === 'POST')) {
    let cmd = null
    if (url.searchParams.get('fn')) {
      const rawArgs = url.searchParams.get('args')
      cmd = {
        fn: url.searchParams.get('fn'),
        args: rawArgs ? rawArgs.split(',').map(coerceArg) : [],
        reason: url.searchParams.get('reason') || undefined,
        name: url.searchParams.get('name') || undefined,
      }
    } else if (req.method === 'POST') {
      const body = await readBody(req)
      try {
        cmd = JSON.parse(body)
      } catch {
        sendJSON(res, 400, { ok: false, error: 'invalid JSON body; expected {fn,args,reason}' })
        return
      }
    }
    if (!cmd || typeof cmd.fn !== 'string') {
      sendJSON(res, 400, { ok: false, error: 'missing fn (e.g. ?fn=startWave or {"fn":"build","args":["srv_edge",11,5]})' })
      return
    }

    const d = dispatch(cmd)
    if (!d.deferred) {
      sendJSON(res, 503, d.payload)
      return
    }
    const timer = setTimeout(() => {
      pending.delete(d.id)
      sendJSON(res, 504, { ok: false, error: 'timed out waiting for the game tab to respond' })
    }, CMD_TIMEOUT_MS)
    pending.set(d.id, { res, timer })
    // If the agent walks away (curl --max-time, Ctrl-C, dropped socket), free the
    // pending slot immediately instead of holding it until the timeout fires.
    res.on('close', () => {
      const p = pending.get(d.id)
      if (p) {
        clearTimeout(p.timer)
        pending.delete(d.id)
      }
    })
    tab.write(`data: ${JSON.stringify({ id: d.id, fn: cmd.fn, args: cmd.args ?? [], reason: cmd.reason, name: cmd.name })}\n\n`)
    return
  }

  // ---- health ----
  if (path === '/' || path === '/health') {
    sendJSON(res, 200, {
      ok: true,
      tabConnected: !!tab,
      hasState: lastState != null,
      pending: pending.size,
      auth: !!TOKEN,
      allowOrigins: [...ALLOW_ORIGINS],
      help: `http://${HOST}:${PORT}/help`,
    })
    return
  }

  sendJSON(res, 404, { ok: false, error: `no route for ${req.method} ${path}` })
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[bridge] port ${PORT} is already in use — another session is likely running. ` +
        `Reload the game tab with ?agent=auto to get a fresh random port, or pass --port <n>.`,
    )
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  const tokenQ = TOKEN ? `?token=${TOKEN}` : ''
  console.log(`[bridge] relay up at http://${HOST}:${PORT}  (protocol: GET /help)`)
  console.log(`[bridge] the already-open game tab connects on its own; then GET /state to read and /do to play`)
  console.log(`[bridge] e.g. curl -s http://${HOST}:${PORT}/state${tokenQ}`)
  if (ALLOW_ORIGINS.size) console.log(`[bridge] extra allowed origins: ${[...ALLOW_ORIGINS].join(', ')}`)
  if (TOKEN) console.log(`[bridge] token required: ${TOKEN}`)
})
