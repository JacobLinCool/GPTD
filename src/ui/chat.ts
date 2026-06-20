/**
 * In-Codex chat assistant — a DOM overlay rendered over the Codex body region
 * (the Chat tab in browsers.ts). DOM (not Pixi) because it needs a real text
 * input; the agent connector (src/agent/connector.ts) sets the precedent for DOM
 * overlays in this canvas game.
 *
 * The overlay is positioned + uniformly scaled to track the Pixi panel: the Game
 * calls layout(left, top, scale, w, h) each frame with the body rect mapped to
 * screen px, and the root uses `transform: translate(...) scale(...)` so its
 * design-px internals line up visually with the surrounding Pixi UI.
 *
 * The player supplies their OWN OpenAI API key (kept in localStorage, sent only
 * to api.openai.com). Default model gpt-5.4-mini with reasoning_effort high.
 */
import { buildSystemPrompt } from '../ai/context'
import { OpenAIChatError, streamChat, type ChatMsg, type ReasoningEffort } from '../ai/openai'
import { t } from '../i18n'
import { ensureMarkdownStyles, renderMarkdown } from './markdown'
import { FONT } from './theme'

const KEY_LS = 'gptd_openai_key'
const MODEL_LS = 'gptd_openai_model'
const EFFORT_LS = 'gptd_openai_effort'
const DEFAULT_MODEL = 'gpt-5.4-mini'
const DEFAULT_EFFORT: ReasoningEffort = 'high'
/** Keep the last N turns of context so token usage stays bounded. */
const HISTORY_CAP = 24

const C = {
  text: '#d7e3f4',
  dim: '#7a8aa3',
  bright: '#ffffff',
  accent: '#5fd7ff',
  good: '#57e39b',
  danger: '#ff5d5d',
  edge: '#21304a',
  panel: '#0b1320',
  field: '#06090e',
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.style.cssText = css
  if (text != null) node.textContent = text
  return node
}

export class ChatPanel {
  readonly root: HTMLDivElement
  private setupView: HTMLDivElement
  private chatView: HTMLDivElement
  private keyInput!: HTMLInputElement
  private modelInput!: HTMLInputElement
  private effortSel!: HTMLSelectElement
  private setupTitle!: HTMLDivElement
  private setupBlurb!: HTMLDivElement
  private setupSave!: HTMLButtonElement
  private setupNote!: HTMLDivElement
  private setupLink!: HTMLAnchorElement
  private list!: HTMLDivElement
  private input!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private headStatus!: HTMLSpanElement
  private headKeyBtn!: HTMLButtonElement
  private headClearBtn!: HTMLButtonElement

  private apiKey = ''
  private model = DEFAULT_MODEL
  private effort: ReasoningEffort = DEFAULT_EFFORT
  private history: ChatMsg[] = []
  private streaming = false
  private abort: AbortController | null = null
  private _visible = false

  constructor() {
    ensureMarkdownStyles()
    this.apiKey = localStorage.getItem(KEY_LS) ?? ''
    this.model = localStorage.getItem(MODEL_LS) || DEFAULT_MODEL
    this.effort = (localStorage.getItem(EFFORT_LS) as ReasoningEffort) || DEFAULT_EFFORT

    this.root = el(
      'div',
      [
        'position:fixed',
        'left:0',
        'top:0',
        'transform-origin:0 0',
        'display:none',
        'flex-direction:column',
        'box-sizing:border-box',
        'z-index:1000',
        'padding:6px 4px 4px 4px',
        `font:14px ${FONT}`,
        `color:${C.text}`,
      ].join(';'),
    )
    // Stop typed keystrokes from leaking to the game's window hotkeys (also guarded
    // game-side); let Escape through so the system Esc-to-close still works.
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') e.stopPropagation()
    })

    this.setupView = this.buildSetup()
    this.chatView = this.buildChat()
    this.root.append(this.setupView, this.chatView)
    document.body.appendChild(this.root)

    this.refreshText()
  }

  // ----------------------------------------------------------------- setup view
  private buildSetup(): HTMLDivElement {
    const wrap = el('div', 'flex:1;display:flex;align-items:center;justify-content:center')
    const card = el(
      'div',
      [
        'width:460px',
        'max-width:90%',
        `background:${C.panel}`,
        `border:1px solid ${C.edge}`,
        'border-radius:10px',
        'padding:22px 24px',
        'display:flex',
        'flex-direction:column',
        'gap:12px',
      ].join(';'),
    )
    this.setupTitle = el('div', `font-size:18px;font-weight:700;color:${C.bright}`)
    this.setupBlurb = el('div', `font-size:13px;line-height:1.5;color:${C.dim}`)

    const keyRow = el('label', `display:flex;flex-direction:column;gap:5px;font-size:12px;color:${C.dim}`)
    const keyLbl = el('span', '', 'OpenAI API key')
    keyLbl.dataset.role = 'keyLbl'
    this.keyInput = el(
      'input',
      [
        `background:${C.field}`,
        `border:1px solid ${C.edge}`,
        'border-radius:7px',
        `color:${C.text}`,
        'padding:9px 11px',
        `font:13px ${FONT}`,
      ].join(';'),
    ) as HTMLInputElement
    this.keyInput.type = 'password'
    this.keyInput.placeholder = 'sk-...'
    this.keyInput.value = this.apiKey
    this.keyInput.autocomplete = 'off'
    keyRow.append(keyLbl, this.keyInput)

    const optRow = el('div', 'display:flex;gap:10px')
    const modelRow = el('label', `flex:2;display:flex;flex-direction:column;gap:5px;font-size:12px;color:${C.dim}`)
    const modelLbl = el('span', '', 'Model')
    modelLbl.dataset.role = 'modelLbl'
    this.modelInput = el(
      'input',
      [
        `background:${C.field}`,
        `border:1px solid ${C.edge}`,
        'border-radius:7px',
        `color:${C.text}`,
        'padding:9px 11px',
        `font:13px ${FONT}`,
      ].join(';'),
    ) as HTMLInputElement
    this.modelInput.value = this.model
    this.modelInput.placeholder = DEFAULT_MODEL
    modelRow.append(modelLbl, this.modelInput)

    const effRow = el('label', `flex:1;display:flex;flex-direction:column;gap:5px;font-size:12px;color:${C.dim}`)
    const effLbl = el('span', '', 'Reasoning')
    effLbl.dataset.role = 'effLbl'
    this.effortSel = el(
      'select',
      [
        `background:${C.field}`,
        `border:1px solid ${C.edge}`,
        'border-radius:7px',
        `color:${C.text}`,
        'padding:9px 8px',
        `font:13px ${FONT}`,
      ].join(';'),
    ) as HTMLSelectElement
    for (const v of ['minimal', 'low', 'medium', 'high'] as ReasoningEffort[]) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = this.effortLabel(v)
      if (v === this.effort) o.selected = true
      this.effortSel.append(o)
    }
    effRow.append(effLbl, this.effortSel)
    optRow.append(modelRow, effRow)

    this.setupSave = el(
      'button',
      [
        `background:${C.accent}`,
        'border:none',
        'border-radius:7px',
        'color:#04222e',
        'font-weight:700',
        'padding:10px',
        'cursor:pointer',
        `font:14px ${FONT}`,
      ].join(';'),
    ) as HTMLButtonElement
    this.setupSave.onclick = () => this.saveSetup()

    this.setupNote = el('div', `font-size:11px;line-height:1.5;color:${C.dim}`)
    this.setupLink = el(
      'a',
      `font-size:11px;color:${C.accent};text-decoration:underline;cursor:pointer`,
    ) as HTMLAnchorElement
    this.setupLink.href = 'https://platform.openai.com/api-keys'
    this.setupLink.target = '_blank'
    this.setupLink.rel = 'noopener noreferrer'

    card.append(this.setupTitle, this.setupBlurb, keyRow, optRow, this.setupSave, this.setupNote, this.setupLink)
    wrap.append(card)
    return wrap
  }

  private saveSetup(): void {
    const key = this.keyInput.value.trim()
    if (!key) {
      this.keyInput.style.borderColor = C.danger
      return
    }
    this.apiKey = key
    this.model = this.modelInput.value.trim() || DEFAULT_MODEL
    this.effort = (this.effortSel.value as ReasoningEffort) || DEFAULT_EFFORT
    localStorage.setItem(KEY_LS, this.apiKey)
    localStorage.setItem(MODEL_LS, this.model)
    localStorage.setItem(EFFORT_LS, this.effort)
    this.syncView()
  }

  // ------------------------------------------------------------------ chat view
  private buildChat(): HTMLDivElement {
    const wrap = el('div', 'flex:1;min-height:0;display:flex;flex-direction:column;gap:8px')

    const head = el(
      'div',
      'display:flex;align-items:center;gap:10px;padding:2px 4px 0 4px;flex:none',
    )
    this.headStatus = el('span', `flex:1;font-size:12px;color:${C.dim}`)
    const btnCss = [
      'background:none',
      `border:1px solid ${C.edge}`,
      'border-radius:6px',
      `color:${C.dim}`,
      'padding:4px 9px',
      'cursor:pointer',
      `font:11px ${FONT}`,
    ].join(';')
    this.headClearBtn = el('button', btnCss) as HTMLButtonElement
    this.headClearBtn.onclick = () => this.clearConversation()
    this.headKeyBtn = el('button', btnCss) as HTMLButtonElement
    this.headKeyBtn.onclick = () => this.syncView(true)
    head.append(this.headStatus, this.headClearBtn, this.headKeyBtn)

    this.list = el(
      'div',
      [
        'flex:1',
        'min-height:0',
        'overflow-y:auto',
        'display:flex',
        'flex-direction:column',
        'gap:10px',
        'padding:8px',
        `background:${C.field}`,
        `border:1px solid ${C.edge}`,
        'border-radius:9px',
      ].join(';'),
    )

    const composer = el('div', 'display:flex;gap:8px;align-items:flex-end;flex:none')
    this.input = el(
      'textarea',
      [
        'flex:1',
        'resize:none',
        'height:58px',
        `background:${C.field}`,
        `border:1px solid ${C.edge}`,
        'border-radius:8px',
        `color:${C.text}`,
        'padding:9px 11px',
        `font:13px ${FONT}`,
        'line-height:1.4',
      ].join(';'),
    ) as HTMLTextAreaElement
    this.input.rows = 2
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.send()
      }
    })
    this.sendBtn = el(
      'button',
      [
        `background:${C.accent}`,
        'border:none',
        'border-radius:8px',
        'color:#04222e',
        'font-weight:700',
        'padding:0 18px',
        'height:58px',
        'cursor:pointer',
        `font:14px ${FONT}`,
        'flex:none',
      ].join(';'),
    ) as HTMLButtonElement
    this.sendBtn.onclick = () => (this.streaming ? this.stop() : this.send())
    composer.append(this.input, this.sendBtn)

    wrap.append(head, this.list, composer)
    return wrap
  }

  private addMsg(role: 'user' | 'assistant', text: string): HTMLDivElement {
    const isUser = role === 'user'
    const row = el('div', `display:flex;${isUser ? 'justify-content:flex-end' : 'justify-content:flex-start'}`)
    const bubble = el(
      'div',
      [
        'max-width:82%',
        // assistant bubbles hold rendered markdown (block HTML); user stays literal
        isUser ? 'white-space:pre-wrap' : 'white-space:normal',
        'word-break:break-word',
        'line-height:1.5',
        'font-size:13px',
        'padding:9px 12px',
        'border-radius:10px',
        isUser ? 'background:rgba(95,215,255,0.12)' : 'background:rgba(33,48,74,0.45)',
        isUser ? `border:1px solid rgba(95,215,255,0.35)` : `border:1px solid ${C.edge}`,
        isUser ? `color:${C.bright}` : `color:${C.text}`,
      ].join(';'),
    )
    if (isUser) bubble.textContent = text
    else this.setMarkdown(bubble, text)
    row.append(bubble)
    this.list.append(row)
    this.scrollDown()
    return bubble
  }

  /** Render markdown into an assistant bubble (safe — escaped before formatting). */
  private setMarkdown(bubble: HTMLDivElement, text: string): void {
    bubble.classList.add('gptd-md')
    bubble.style.color = C.text
    bubble.innerHTML = renderMarkdown(text)
  }

  private scrollDown(): void {
    this.list.scrollTop = this.list.scrollHeight
  }

  private async send(): Promise<void> {
    if (this.streaming) return
    const text = this.input.value.trim()
    if (!text) return
    this.input.value = ''
    this.addMsg('user', text)
    this.history.push({ role: 'user', content: text })

    const bubble = this.addMsg('assistant', '')
    bubble.style.color = C.dim
    bubble.textContent = '…'
    let acc = ''

    this.setStreaming(true)
    this.abort = new AbortController()
    const messages: ChatMsg[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...this.history.slice(-HISTORY_CAP),
    ]
    try {
      await streamChat({
        apiKey: this.apiKey,
        model: this.model,
        reasoningEffort: this.effort,
        messages,
        signal: this.abort.signal,
        onDelta: (d) => {
          acc += d
          this.setMarkdown(bubble, acc)
          this.scrollDown()
        },
      })
      if (!acc) bubble.textContent = t('chat.empty', undefined, '(no response)')
      this.history.push({ role: 'assistant', content: acc })
    } catch (err) {
      if (this.abort?.signal.aborted) {
        // user pressed Stop: keep whatever streamed so far
        if (acc) this.history.push({ role: 'assistant', content: acc })
        else bubble.remove()
      } else {
        bubble.style.color = C.danger
        bubble.textContent = '⚠ ' + this.errorText(err)
      }
    } finally {
      this.setStreaming(false)
      this.abort = null
      this.scrollDown()
    }
  }

  private stop(): void {
    this.abort?.abort()
  }

  private errorText(err: unknown): string {
    if (err instanceof OpenAIChatError) {
      if (err.apiMessage) return err.apiMessage
      if (err.status === 401) return t('chat.error.401', undefined, 'Invalid API key (401). Check your OpenAI key.')
      if (err.status === 429) return t('chat.error.429', undefined, 'Rate limited or out of quota (429).')
      return t('chat.error.api', { status: err.status }, `OpenAI API error ${err.status}`)
    }
    return err instanceof Error ? err.message : String(err)
  }

  private effortLabel(v: ReasoningEffort): string {
    return t(`chat.effort.${v}`, undefined, v)
  }

  private setStreaming(on: boolean): void {
    this.streaming = on
    this.sendBtn.textContent = on ? t('chat.stop', undefined, 'Stop') : t('chat.send', undefined, 'Send')
    this.sendBtn.style.background = on ? C.danger : C.accent
    this.input.disabled = on
  }

  private clearConversation(): void {
    this.abort?.abort()
    this.history = []
    this.list.replaceChildren()
    this.greet()
  }

  private greet(): void {
    const b = this.addMsg('assistant', t('chat.greet', undefined, GREET))
    b.style.color = C.text
  }

  // -------------------------------------------------------------------- chrome
  /** Switch between setup and chat depending on whether a key is set. */
  private syncView(forceSetup = false): void {
    const showSetup = forceSetup || !this.apiKey
    this.setupView.style.display = showSetup ? 'flex' : 'none'
    this.chatView.style.display = showSetup ? 'none' : 'flex'
    if (!showSetup) {
      this.headStatus.textContent = t('chat.using', { model: this.model, effort: this.effortLabel(this.effort) }, `${this.model} · reasoning ${this.effort}`)
      if (!this.list.childElementCount) this.greet()
      window.setTimeout(() => this.input.focus(), 0)
    } else {
      this.keyInput.value = this.apiKey
      this.modelInput.value = this.model
      this.keyInput.style.borderColor = C.edge
    }
  }

  refreshText(): void {
    this.setupTitle.textContent = t('chat.setup.title', undefined, 'Ask the Codex')
    this.setupBlurb.textContent = t('chat.setup.blurb', undefined, SETUP_BLURB)
    this.setupSave.textContent = t('chat.setup.save', undefined, 'Save & start chatting')
    this.setupNote.textContent = t('chat.setup.note', undefined, SETUP_NOTE)
    this.setupLink.textContent = t('chat.setup.getkey', undefined, 'Get an API key ↗')
    const keyLbl = this.setupView.querySelector('[data-role="keyLbl"]')
    if (keyLbl) keyLbl.textContent = t('chat.setup.key', undefined, 'OpenAI API key')
    const modelLbl = this.setupView.querySelector('[data-role="modelLbl"]')
    if (modelLbl) modelLbl.textContent = t('chat.setup.model', undefined, 'Model')
    const effLbl = this.setupView.querySelector('[data-role="effLbl"]')
    if (effLbl) effLbl.textContent = t('chat.setup.effort', undefined, 'Reasoning')
    for (const opt of Array.from(this.effortSel.options)) {
      opt.textContent = this.effortLabel(opt.value as ReasoningEffort)
    }
    this.headClearBtn.textContent = t('chat.clear', undefined, 'Clear')
    this.headKeyBtn.textContent = t('chat.changekey', undefined, 'API key')
    this.input.placeholder = t('chat.placeholder', undefined, 'Ask about models, hardware, requests, strategy…')
    this.setStreaming(this.streaming)
    if (this.apiKey && this.headStatus) {
      this.headStatus.textContent = t('chat.using', { model: this.model, effort: this.effortLabel(this.effort) }, `${this.model} · reasoning ${this.effort}`)
    }
  }

  // ----------------------------------------------------------------- lifecycle
  show(): void {
    this._visible = true
    this.root.style.display = 'flex'
    this.syncView()
  }

  hide(): void {
    this._visible = false
    this.root.style.display = 'none'
  }

  get visible(): boolean {
    return this._visible
  }

  /** Position + uniformly scale the overlay to the Pixi body rect (screen px + design size). */
  layout(left: number, top: number, scale: number, w: number, h: number): void {
    this.root.style.width = w + 'px'
    this.root.style.height = h + 'px'
    this.root.style.transform = `translate(${left}px, ${top}px) scale(${scale})`
  }

  destroy(): void {
    this.abort?.abort()
    this.root.remove()
  }
}

const GREET =
  'Hi — I’m your in-game guide. Ask me anything about GPTD: which model to deploy, ' +
  'how the request types differ, what to research next, or how to survive deeper waves.'

const SETUP_BLURB =
  'Chat with an assistant that knows this game — the models, hardware, request types, ' +
  'and research tree. It runs on your own OpenAI API key.'

const SETUP_NOTE =
  'Your key is stored only in this browser (localStorage) and sent directly to the OpenAI API — never to any GPTD server. Your usage is billed to your own account.'
