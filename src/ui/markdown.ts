/**
 * Tiny, dependency-free Markdown → safe HTML renderer for the chat assistant
 * (src/ui/chat.ts). Supports the subset an LLM actually emits: headings, bold /
 * italic, inline code, fenced code blocks, unordered / ordered lists, blockquotes,
 * links, and paragraphs. Everything is HTML-escaped FIRST, so model output that
 * looks like markup can never inject nodes — only our own tags survive.
 *
 * It re-renders the whole (accumulated) message on each streamed delta; partial
 * markup mid-stream simply resolves as more tokens arrive.
 */
/** Sentinel wrapping a lifted code-block index; a NUL never appears in model text. */
const S = String.fromCharCode(0)

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline spans on an ALREADY-escaped string. */
function inline(s: string): string {
  // inline code first so its contents are not re-formatted
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => `<code class="md-code">${c}</code>`)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt: string, url: string) => {
    const safe = /^https?:\/\//.test(url) ? url : '#'
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${txt}</a>`
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')
  return s
}

/** Render a markdown string to safe HTML. */
export function renderMarkdown(src: string): string {
  // 1. lift fenced code blocks out so their contents aren't block-parsed
  const fences: string[] = []
  src = src.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    fences.push(`<pre class="md-pre"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)
    return `${S}${fences.length - 1}${S}`
  })

  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }

  for (const line of src.split('\n')) {
    if (line.length > 2 && line.startsWith(S) && line.endsWith(S)) {
      const idx = Number(line.slice(1, -1))
      if (Number.isInteger(idx) && fences[idx] !== undefined) {
        closeList()
        out.push(fences[idx])
        continue
      }
    }
    if (/^\s*$/.test(line)) {
      closeList()
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      closeList()
      out.push(`<div class="md-h md-h${h[1].length}">${inline(escapeHtml(h[2]))}</div>`)
      continue
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ul) {
      if (list !== 'ul') {
        closeList()
        out.push('<ul class="md-ul">')
        list = 'ul'
      }
      out.push(`<li>${inline(escapeHtml(ul[1]))}</li>`)
      continue
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      if (list !== 'ol') {
        closeList()
        out.push('<ol class="md-ol">')
        list = 'ol'
      }
      out.push(`<li>${inline(escapeHtml(ol[1]))}</li>`)
      continue
    }
    const bq = line.match(/^\s*>\s?(.*)$/)
    if (bq) {
      closeList()
      out.push(`<blockquote class="md-bq">${inline(escapeHtml(bq[1]))}</blockquote>`)
      continue
    }
    closeList()
    out.push(`<p class="md-p">${inline(escapeHtml(line))}</p>`)
  }
  closeList()
  return out.join('')
}

let injected = false
/** Inject the chat-markdown stylesheet once (scoped under .gptd-md). */
export function ensureMarkdownStyles(): void {
  if (injected) return
  injected = true
  const css = `
.gptd-md{white-space:normal;line-height:1.55}
.gptd-md>:first-child{margin-top:0}
.gptd-md>:last-child{margin-bottom:0}
.gptd-md .md-p{margin:0 0 8px}
.gptd-md .md-h{font-weight:700;color:#fff;margin:12px 0 6px;line-height:1.3}
.gptd-md .md-h1{font-size:16px}
.gptd-md .md-h2{font-size:15px}
.gptd-md .md-h3,.gptd-md .md-h4{font-size:13px;color:#cfe0f5}
.gptd-md .md-ul,.gptd-md .md-ol{margin:4px 0 8px;padding-left:20px}
.gptd-md li{margin:2px 0}
.gptd-md code.md-code{background:rgba(95,215,255,0.12);padding:1px 5px;border-radius:4px;font-size:0.92em}
.gptd-md pre.md-pre{background:#06090e;border:1px solid #21304a;border-radius:7px;padding:10px;overflow-x:auto;margin:6px 0}
.gptd-md pre.md-pre code{background:none;padding:0;font-size:12px;white-space:pre}
.gptd-md blockquote.md-bq{border-left:3px solid #21304a;margin:6px 0;padding:2px 0 2px 10px;color:#9fb0c8}
.gptd-md a{color:#5fd7ff}
.gptd-md strong{color:#fff}
`
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
