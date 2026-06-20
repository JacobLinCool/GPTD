// Tab-side agent connector. The already-open browser tab dials OUT to a tiny
// localhost relay (public/bridge.mjs) over Server-Sent Events, executes the
// whitelisted commands it receives against the live game, and posts results
// back. No inbound socket to the browser, no CDP, no MCP — the human keeps
// watching the same tab while the agent plays and narrates in the Codex bubble.
//
// On a hosted build the player has no repo, so this also renders a small DOM
// panel with the exact one-liner to paste to their Claude Code / Codex (it
// downloads public/bridge.mjs from this origin and runs it with the right
// --allow-origin), plus a live "bridge connected" status.
import type { Game } from '../game'

interface AgentCommand {
  id: number
  fn: string
  args?: unknown[]
  reason?: string
  name?: string
}

const STATE_PUSH_MS = 1000

export function attach(game: Game): void {
  const params = new URLSearchParams(window.location.search)
  const { base, port } = resolveBridge(params.get('agent') ?? '1', params.get('bridge'))
  const token = params.get('token') ?? ''
  const q = token ? `?token=${encodeURIComponent(token)}` : ''

  // text/plain keeps these as CORS "simple" requests (no preflight) since the
  // tab and the bridge are different origins.
  const post = (path: string, body: unknown): Promise<unknown> =>
    fetch(base + path + q, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(body),
    }).catch(() => undefined)

  const pushState = (): void => {
    void post('/state', { state: game.agentSnapshot() })
  }

  const panel = createPanel(base, token, port)

  let announced = false
  const connect = (): void => {
    const es = new EventSource(base + '/events' + q)

    es.onopen = (): void => {
      pushState()
      panel.setConnected(true)
      // Only narrate the connect note on the FIRST open; on auto-reconnect, keep
      // the agent's last reason visible in the Codex bubble instead of clobbering it.
      if (!announced) {
        announced = true
        game.agentNote('Bridge connected — waiting for the agent to make a move.')
      }
    }

    es.onmessage = (ev: MessageEvent): void => {
      let cmd: AgentCommand
      try {
        cmd = JSON.parse(String(ev.data)) as AgentCommand
      } catch {
        return
      }
      if (!cmd || typeof cmd.id !== 'number' || typeof cmd.fn !== 'string') return
      const res = game.agentAct({ fn: cmd.fn, args: cmd.args, reason: cmd.reason, name: cmd.name })
      panel.onMove(cmd.fn)
      void post('/result', { id: cmd.id, ...res, state: game.agentSnapshot() })
    }

    es.onerror = (): void => {
      // EventSource reconnects on its own; reflect the drop in the panel.
      panel.setConnected(false)
    }
  }

  connect()
  // Keep the bridge's cached snapshot fresh so `GET /state` reflects live numbers
  // (cash, served, leaked) even mid-wave when the agent isn't issuing actions.
  window.setInterval(() => {
    if (game.isAgentMode) pushState()
  }, STATE_PUSH_MS)
}

// Resolve the relay base URL AND the port the bridge should bind, from the URL:
//   ?agent=1 (or bare)   → default 8799 (single session; works with `pnpm bridge`)
//   ?agent=auto          → a random high port (run many concurrent sessions, one per tab)
//   ?agent=<port>        → that explicit port
//   ?bridge=<url|port>   → explicit override (port extracted when localhost)
// The chosen port is echoed into the panel's command as `--port <port>` so the
// bridge the agent starts always binds exactly the port this tab connects to.
function resolveBridge(raw: string, bridge: string | null): { base: string; port: string | null } {
  const strip = (u: string): string => u.replace(/\/+$/, '')
  const portOf = (b: string): string | null => {
    try {
      return new URL(b).port || null
    } catch {
      return null
    }
  }
  if (bridge) {
    const base = strip(/^https?:\/\//.test(bridge) ? bridge : `http://127.0.0.1:${bridge}`)
    return { base, port: portOf(base) }
  }
  if (/^https?:\/\//.test(raw)) {
    const base = strip(raw)
    return { base, port: portOf(base) }
  }
  let port: string
  if (raw === 'auto' || raw === 'random') port = String(49152 + Math.floor(Math.random() * 16000))
  else if (/^\d+$/.test(raw) && raw !== '1') port = raw
  else port = '8799'
  return { base: `http://127.0.0.1:${port}`, port }
}

interface ConnectPanel {
  setConnected(on: boolean): void
  onMove(fn: string): void
}

/** Floating DOM panel: the paste-to-agent setup + live connection status. */
function createPanel(base: string, token: string, port: string | null): ConnectPanel {
  const origin = window.location.origin
  const downloadUrl = new URL('bridge.mjs', document.baseURI).href
  const portFlag = port ? ` --port ${port}` : ''
  const tokenFlag = token ? ` --token ${token}` : ''
  const tokenNote = token ? ` (append ?token=${token} to every request)` : ''
  const helpQ = token ? `?token=${token}` : ''
  const prompt =
    `Play GPTD in my browser and survive as deep into the campaign as you can.\n` +
    `In the background run:\n` +
    `  curl -sO ${downloadUrl} && node bridge.mjs${portFlag} --allow-origin ${origin}${tokenFlag}\n` +
    `Then curl ${base}/help${helpQ} for the protocol${tokenNote}. Drive the WHOLE run in a loop: ` +
    `read ${base}/state, in each build phase make good moves via ${base}/do — on every move include a ` +
    `name field set to your own name (e.g. Claude or Codex) and a one-sentence reason (~15-25 words) — ` +
    `then startWave, poll ${base}/state until the wave clears, and repeat. Keep going until the run ends ` +
    `(phase "won" or "lost"). Don't stop to check in between waves.`

  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'right:12px',
    'bottom:12px',
    'z-index:99999',
    'max-width:420px',
    'background:rgba(10,14,20,0.94)',
    'color:#cfe',
    'border:1px solid #2b4',
    'border-radius:8px',
    'padding:10px 12px',
    'font:12px ui-monospace,monospace',
    'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
  ].join(';')

  const head = document.createElement('div')
  head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px'
  const dot = document.createElement('span')
  dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#fb4;flex:none'
  const status = document.createElement('strong')
  status.textContent = 'Agent bridge — waiting for local bridge…'
  status.style.cssText = 'flex:1;font-weight:600'
  const close = document.createElement('button')
  close.textContent = '×'
  close.style.cssText = 'background:none;border:none;color:#9ab;cursor:pointer;font-size:16px;line-height:1'
  close.onclick = (): void => el.remove()
  head.append(dot, status, close)

  const help = document.createElement('div')
  help.textContent = 'Paste this to your Codex / Claude Code:'
  help.style.cssText = 'color:#9ab;margin-bottom:4px'

  const pre = document.createElement('pre')
  pre.textContent = prompt
  pre.style.cssText =
    'margin:0;white-space:pre-wrap;word-break:break-all;background:#06090e;padding:8px;border-radius:6px;max-height:160px;overflow:auto'

  const copy = document.createElement('button')
  copy.textContent = 'Copy setup'
  copy.style.cssText =
    'margin-top:6px;background:#1b5;border:none;color:#031;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer'
  const flashCopy = (label: string): void => {
    copy.textContent = label
    window.setTimeout(() => (copy.textContent = 'Copy setup'), 1600)
  }
  const selectPrompt = (): void => {
    // Insecure context (no navigator.clipboard): select the text so the player can
    // copy it manually, instead of the button silently doing nothing.
    const range = document.createRange()
    range.selectNodeContents(pre)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    flashCopy('Selected — press ⌘/Ctrl-C')
  }
  copy.onclick = (): void => {
    const clip = navigator.clipboard
    if (clip) void clip.writeText(prompt).then(() => flashCopy('Copied ✓'), selectPrompt)
    else selectPrompt()
  }

  const moves = document.createElement('div')
  moves.style.cssText = 'color:#9ab;margin-top:6px;min-height:14px'

  const tip = document.createElement('div')
  tip.textContent = 'Tip: open with ?agent=auto to get a random port — run several agents on different games at once.'
  tip.style.cssText = 'color:#678;margin-top:6px;font-size:11px'

  // The paste-prompt is only useful until the agent connects; collapse it once
  // connected so the panel becomes just a compact status + move counter.
  const setup = document.createElement('div')
  setup.append(help, pre, copy, tip)

  el.append(head, setup, moves)
  document.body.appendChild(el)

  let moveCount = 0
  return {
    setConnected(on: boolean): void {
      dot.style.background = on ? '#2d6' : '#fb4'
      status.textContent = on
        ? 'Agent bridge — connected ✓'
        : 'Agent bridge — waiting for local bridge…'
      setup.style.display = on ? 'none' : ''
    },
    onMove(fn: string): void {
      moveCount++
      moves.textContent = `moves: ${moveCount} · last: ${fn}`
    },
  }
}
