/**
 * Minimal browser OpenAI client for the in-game chat assistant (src/ui/chat.ts).
 *
 * Calls the Chat Completions endpoint directly from the tab with the PLAYER'S own
 * API key (their key, their bill, their risk — the key never leaves the browser
 * except to api.openai.com). Streams the answer token-by-token via SSE so the chat
 * feels live. Reasoning models (gpt-5.4-mini default) take `reasoning_effort`.
 */
export type ChatRole = 'system' | 'user' | 'assistant'
export interface ChatMsg {
  role: ChatRole
  content: string
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export interface StreamOpts {
  apiKey: string
  model: string
  reasoningEffort?: ReasoningEffort
  messages: ChatMsg[]
  signal?: AbortSignal
  /** Called with each streamed text fragment of the assistant's answer. */
  onDelta: (text: string) => void
}

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export class OpenAIChatError extends Error {
  readonly status: number
  readonly apiMessage: string | null

  constructor(status: number, apiMessage: string | null) {
    super(apiMessage ?? `OpenAI API error ${status}`)
    this.name = 'OpenAIChatError'
    this.status = status
    this.apiMessage = apiMessage
  }
}

/** Stream a chat completion; resolves when the stream ends, rejects on API error / abort. */
export async function streamChat(opts: StreamOpts): Promise<void> {
  const body: Record<string, unknown> = {
    model: opts.model,
    stream: true,
    messages: opts.messages,
  }
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok || !res.body) throw new OpenAIChatError(res.status, await apiErrorMessage(res))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // SSE: one JSON object per `data:` line; keep the trailing partial line for next read.
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const data = s.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) opts.onDelta(delta)
      } catch {
        /* a split chunk that isn't valid JSON yet — ignore, the next read completes it */
      }
    }
  }
}

/** Pull a human-readable message out of a non-OK response. */
async function apiErrorMessage(res: Response): Promise<string | null> {
  try {
    const json = (await res.json()) as { error?: { message?: string } }
    if (json.error?.message) return json.error.message
  } catch {
    /* not JSON */
  }
  return null
}
