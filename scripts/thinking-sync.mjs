// Thinking-support sync — the evidence behind every checkpoint's `thinking` mode.
//
// Serving stacks switch a HYBRID model's thinking off per request (chat_template kwargs such as
// enable_thinking=False, thinking_mode="chat", reasoning_effort="no_think"), so the engine answers
// interactive traffic instantly and lets the model think on everything else. Whether a checkpoint
// CAN do that is a fact of its released chat template (or card / encoding script), recorded per
// Hugging Face repo in data/model-thinking.json:
//
//   mode        'hybrid' — thinking can be switched off (the `toggle`); 'always' — every answer
//               reasons first (a toggle only sets the effort); 'never' — an instruct deployment
//   default     the template's mode when a request sets nothing (hybrid only)
//   source      the file the evidence is read from (chat_template.jinja, tokenizer_config.json's
//               chat_template, chat_template.json, README.md or encoding/encoding_dsv4.py)
//   quote       a verbatim excerpt of `source` that shows the switch (or the absence of one)
//   noThinking  'never' only: the template has no thinking block at all
//   template    the template's own support when the roster entry is served differently (a hybrid
//               template whose roster pin is AA's Non-reasoning row is served thinking-off: 'never')
//
// The mode flows into the game through `node scripts/arch-sync.mjs build` (MODEL_ARCH.thinking);
// AA instant-mode cells for every hybrid come from `node scripts/aa-sync.mjs build`.
//
// Usage:
//   node scripts/thinking-sync.mjs fetch [repo…]   download each repo's template files + card into .cache/hf/
//   node scripts/thinking-sync.mjs verify [repo…] [--allow-uncached]
//                                                  every checkpoint has an entry; every quote (of the named repos, or
//                                                  of all) is still in its source; pins agree with the mode (a
//                                                  hybrid/always entry is not pinned on a Non-reasoning row); exits 1
//                                                  on a problem, and on any evidence source missing from .cache/hf
//                                                  unless --allow-uncached
//   node scripts/thinking-sync.mjs report          the mode table (mode, default, toggle, instant source)
//
// `dataProblems()` is the cache-free half of `verify` (entries, modes, evidence fields, pin vs mode);
// tests/models.test.ts runs it, so a pin that contradicts its checkpoint's mode fails the tests offline.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const THINKING = join(ROOT, 'data', 'model-thinking.json')
const ARCH = join(ROOT, 'data', 'model-arch.json')
const MAP = join(ROOT, 'data', 'roster-aa-map.json')
const CACHE = join(ROOT, '.cache', 'hf')
const FILES = ['tokenizer_config.json', 'chat_template.jinja', 'chat_template.json', 'README.md', 'encoding/encoding_dsv4.py']
const MODES = ['always', 'hybrid', 'never']
/** Markers of a thinking block in a template — a `noThinking` entry must have none. */
const THINK_MARKERS = /<think|enable_thinking|reasoning_effort|thinking_mode|\/no_think|reasoning_content/i

const dirOf = (repo) => join(CACHE, repo.replace('/', '__'))
const cachePath = (repo, file) => join(dirOf(repo), file.replace(/\//g, '__'))
const loadJson = (f) => JSON.parse(readFileSync(f, 'utf8'))

async function get(url) {
  const headers = process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow' })
      if ([401, 403, 404].includes(res.status)) return { status: res.status, text: '' }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { status: res.status, text: await res.text() }
    } catch (e) {
      if (i === 2) return { status: 0, text: '', error: String(e) }
    }
  }
}

async function fetchAll(repos) {
  const list = repos.length ? repos : Object.keys(loadJson(ARCH).models)
  let i = 0
  const worker = async () => {
    while (i < list.length) {
      const repo = list[i++]
      mkdirSync(dirOf(repo), { recursive: true })
      const got = []
      for (const f of FILES) {
        const r = await get(`https://huggingface.co/${repo}/resolve/main/${f}`)
        if (r.text) writeFileSync(cachePath(repo, f), r.text)
        got.push(`${f.split('/').pop()} ${r.status}`)
      }
      console.log(`${repo.padEnd(56)} ${got.join(' · ')}`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
}

/** The text of one evidence source from the cache (the parsed chat_template for the JSON files). */
function sourceText(repo, file) {
  const p = cachePath(repo, file)
  if (!existsSync(p)) return null
  const raw = readFileSync(p, 'utf8')
  if (file === 'tokenizer_config.json' || file === 'chat_template.json') {
    const ct = JSON.parse(raw).chat_template
    if (Array.isArray(ct)) return ct.map((t) => t.template ?? '').join('\n')
    return typeof ct === 'string' ? ct : null
  }
  return raw
}

/**
 * Every check that needs no download: each checkpoint has an entry with a known mode and evidence,
 * and every AA pin is the variant the mode serves — a hybrid or always-thinker is never pinned on a
 * Non-reasoning row, and an `instant` pin belongs to a hybrid. Returns the problems (empty = clean).
 */
function dataProblems() {
  const thinking = loadJson(THINKING).models
  const arch = loadJson(ARCH).models
  const problems = []
  for (const repo of Object.keys(arch)) if (!thinking[repo]) problems.push(`${repo}: no entry`)
  for (const [repo, e] of Object.entries(thinking)) {
    if (!arch[repo]) problems.push(`${repo}: not a checkpoint of data/model-arch.json`)
    if (!MODES.includes(e.mode)) problems.push(`${repo}: mode '${e.mode}'`)
    if (e.mode === 'hybrid' && !['thinking', 'instant', 'adaptive'].includes(e.default)) problems.push(`${repo}: hybrid without a default`)
    if (!e.quote && !e.noThinking && !e.note) problems.push(`${repo}: no evidence (quote, noThinking or note)`)
  }
  // the AA pin must be the variant the mode serves: no Non-reasoning row behind a thinker
  const map = loadJson(MAP)
  const repoOf = new Map()
  for (const [repo, e] of Object.entries(arch)) for (const id of Object.values(e.aa ?? {})) repoOf.set(id, repo)
  const names = new Map()
  for (const f of [map.referenceSnapshot, 'data/aa-snapshot.json']) for (const m of loadJson(join(ROOT, f)).data) names.set(m.id, m.name)
  for (const [id, pin] of Object.entries(map.models)) {
    if (id.startsWith('_')) continue
    const mode = thinking[repoOf.get(pin.aaId)]?.mode
    if (!mode) continue
    if (mode !== 'never' && /non-reasoning/i.test(names.get(pin.aaId) ?? '')) problems.push(`${id}: '${mode}' but pinned on '${names.get(pin.aaId)}'`)
    if (pin.instant && mode !== 'hybrid') problems.push(`${id}: an instant pin on a '${mode}' checkpoint`)
    if (pin.instant && !/non-reasoning/i.test(names.get(pin.instant.aaId) ?? '')) problems.push(`${id}: instant pin '${names.get(pin.instant.aaId) ?? pin.instant.aaId}' is not a Non-reasoning row`)
  }
  return problems
}

function verify(args) {
  const allowUncached = args.includes('--allow-uncached')
  const only = args.filter((a) => !a.startsWith('--'))
  const thinking = loadJson(THINKING).models
  const problems = dataProblems()
  for (const repo of only) if (!thinking[repo]) problems.push(`${repo}: no entry`)
  let checked = 0
  const uncached = []
  let sources = 0
  for (const [repo, e] of Object.entries(thinking)) {
    if (!e.source || (only.length && !only.includes(repo))) continue
    sources++
    const text = sourceText(repo, e.source)
    if (text == null) {
      uncached.push(repo)
      continue
    }
    checked++
    if (e.quote && !text.includes(e.quote)) problems.push(`${repo}: quote not found in ${e.source}: ${e.quote}`)
    if (e.noThinking && THINK_MARKERS.test(text)) problems.push(`${repo}: noThinking, but ${e.source} has '${text.match(THINK_MARKERS)[0]}'`)
  }
  console.log(`checked ${checked}/${sources} evidence sources against .cache/hf (${uncached.length} not cached)`)
  if (uncached.length) console.log(`  uncached: ${uncached.slice(0, 12).join(', ')}${uncached.length > 12 ? ` … (+${uncached.length - 12})` : ''}`)
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  if (checked === 0 && sources > 0) {
    console.error(`✗ nothing verified: .cache/hf holds none of the ${only.length ? 'named ' : ''}evidence sources — run: node scripts/thinking-sync.mjs fetch ${only.join(' ')}`.trimEnd())
    process.exit(1)
  }
  if (uncached.length && !allowUncached) {
    console.error(`✗ ${uncached.length} evidence source(s) unverified (not cached) — run fetch (HF_TOKEN for gated repos), or pass --allow-uncached`)
    process.exit(1)
  }
  const n = Object.keys(thinking).length
  console.log(`✓ ${n} checkpoints: every mode has evidence and every pin agrees with it; ${checked}/${sources} evidence sources verified${uncached.length ? `, ${uncached.length} uncached (allowed)` : ''}`)
}

function report() {
  const thinking = loadJson(THINKING).models
  const map = loadJson(MAP)
  const arch = loadJson(ARCH).models
  const instantOf = new Map()
  for (const pin of Object.values(map.models)) {
    if (!pin?.aaId) continue
    const repo = Object.entries(arch).find(([, e]) => Object.values(e.aa ?? {}).includes(pin.aaId))?.[0]
    if (repo) instantOf.set(repo, pin.instant?.slug ?? null)
  }
  const count = Object.fromEntries(MODES.map((m) => [m, 0]))
  for (const [repo, e] of Object.entries(thinking)) {
    count[e.mode]++
    const inst = e.mode === 'hybrid' ? (instantOf.get(repo) ? `instant ← ${instantOf.get(repo)}` : 'instant ← pair fit') : ''
    console.log(`${repo.padEnd(52)} ${e.mode.padEnd(7)}${e.template ? ` (template ${e.template})` : ''} ${(e.default ?? '').padEnd(9)} ${e.toggle.padEnd(44)} ${inst}`)
  }
  console.log(`\n${Object.entries(count).map(([m, n]) => `${n} ${m}`).join(' · ')}`)
}

export { dataProblems }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...args] = process.argv.slice(2)
  try {
    if (cmd === 'fetch') await fetchAll(args)
    else if (cmd === 'verify') verify(args)
    else if (cmd === 'report') report()
    else {
      console.error('usage: node scripts/thinking-sync.mjs <fetch [repo…] | verify [repo…] [--allow-uncached] | report>')
      process.exit(1)
    }
  } catch (e) {
    console.error('✗', e.message)
    process.exit(1)
  }
}
