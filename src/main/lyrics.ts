import { promises as fs, existsSync } from 'fs'
import { net } from 'electron'
import { parseFile } from 'music-metadata'
import iconv from 'iconv-lite'
import type { LyricCandidate, LyricPayload, TrackQuery } from '../shared/types'
import {
  fetchLyricsWithProvider,
  normalizeText,
  searchLyricsWithFallback,
  similarity
} from './providers'

export { normalizeText as normalize, similarity }

export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    const gbk = iconv.decode(buf, 'gbk')
    const sjis = iconv.decode(buf, 'shift_jis')
    const bad = (s: string) => (s.match(/\uFFFD/g) ?? []).length
    return bad(sjis) < bad(gbk) ? sjis : gbk
  }
}

const fmtTime = (ms: number) => {
  const total = Math.max(0, ms) / 1000
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

export async function getLocalLyrics(file: string): Promise<LyricPayload | null> {
  const sidecar = file.replace(/\.[^.]+$/, '.lrc')
  if (existsSync(sidecar)) {
    try {
      const text = decodeText(await fs.readFile(sidecar))
      if (text.trim()) return { source: 'sidecar', lrc: text }
    } catch {
      /* ignore */
    }
  }
  try {
    const meta = await parseFile(file, { skipCovers: true, duration: false })
    const list = (meta.common.lyrics ?? []) as unknown[]
    for (const item of list) {
      if (typeof item === 'string') {
        if (item.trim()) return { source: 'embedded', lrc: item }
        continue
      }
      const l = item as { text?: string; syncText?: { text: string; timestamp?: number }[] }
      if (l.syncText?.length) {
        const lrc = l.syncText.map((s) => `[${fmtTime(s.timestamp ?? 0)}]${s.text}`).join('\n')
        return { source: 'embedded', lrc }
      }
      if (l.text?.trim()) return { source: 'embedded', lrc: l.text }
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function searchLyrics(q: TrackQuery): Promise<LyricCandidate[]> {
  return searchLyricsWithFallback(q)
}

export async function fetchLyrics(c: LyricCandidate): Promise<LyricPayload | null> {
  return fetchLyricsWithProvider(c)
}

const isSynced = (lrc: string) => /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(lrc)
const stripLrcTags = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim()
const hasTranslationBody = (tlrc?: string) => !!tlrc && stripLrcTags(tlrc).length > 0
const needsChineseTranslation = (lrc: string) => {
  const plain = stripLrcTags(lrc)
  if (!plain) return false
  if (/[\u3040-\u30ff\uac00-\ud7af]/.test(plain)) return true
  const han = (plain.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (plain.match(/[a-zA-Z]/g) ?? []).length
  return latin > han * 2
}

interface ParsedTimedLine {
  timeMs: number
  tag: string
  text: string
}

function parseTimedLines(lrc: string): ParsedTimedLine[] {
  const out: ParsedTimedLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/)
    if (!m) continue
    const min = parseInt(m[1], 10)
    const sec = parseInt(m[2], 10)
    const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0
    const timeMs = (min * 60 + sec) * 1000 + frac
    const tag = `[${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}${m[3] ? `.${m[3]}` : '.00'}]`
    const text = stripLrcTags(m[4])
    if (text) out.push({ timeMs, tag, text })
  }
  return out
}

/** Graft translated lines from another provider onto the primary synced LRC timeline by nearest timestamp. */
function alignTranslationTimestamps(primaryLrc: string, externalTlrc: string): string | null {
  const base = parseTimedLines(primaryLrc)
  const trans = parseTimedLines(externalTlrc)
  if (!base.length || !trans.length) return null

  const out: string[] = []
  let j = 0
  let matchedCount = 0
  for (const line of base) {
    while (j + 1 < trans.length && Math.abs(trans[j + 1].timeMs - line.timeMs) <= Math.abs(trans[j].timeMs - line.timeMs)) {
      j++
    }
    const diff = Math.abs(trans[j].timeMs - line.timeMs)
    if (diff <= 1800) {
      out.push(`${line.tag}${trans[j].text}`)
      matchedCount++
    }
  }
  return matchedCount >= Math.max(2, Math.floor(base.length * 0.35)) ? out.join('\n') : null
}

/** Batch-translate LRC lines into Simplified Chinese while keeping exact timestamps intact. */
export async function translateLyricsToZh(lrc: string): Promise<string | null> {
  const lines = parseTimedLines(lrc)
  if (!lines.length) return null

  const translateChunk = async (texts: string[]): Promise<string[] | null> => {
    const joined = texts.join('\n')
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 6500)
      try {
        const res = await net.fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(joined)}`,
          { signal: ctrl.signal }
        )
        if (res.ok) {
          const data = (await res.json()) as any
          const combined = Array.isArray(data?.[0]) ? data[0].map((seg: any) => String(seg?.[0] ?? '')).join('') : ''
          const split = combined.split(/\r?\n/)
          if (split.length === texts.length) return split
        }
      } finally {
        clearTimeout(timer)
      }
    } catch {
      /* fallback below */
    }
    return null
  }

  const outLines: string[] = []
  const chunkSize = 24
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize)
    const translated = await translateChunk(chunk.map((c) => c.text))
    if (!translated) return null
    for (let k = 0; k < chunk.length; k++) {
      const tr = translated[k]?.trim()
      if (tr) outLines.push(`${chunk[k].tag}${tr}`)
    }
  }
  return outLines.length ? outLines.join('\n') : null
}

/** Automatically find the best online lyric via provider fallback chain, grafting or translating Chinese translations when missing. */
export async function autoLyrics(q: TrackQuery): Promise<LyricPayload | null> {
  const list = await searchLyricsWithFallback(q)
  const sortedGood = list.filter((c) => (c.score ?? 0) >= 0.55)
  // Ensure top candidates include bilingual Chinese providers (NetEase / QQ) alongside primary sources
  const head = sortedGood.slice(0, 6)
  const extraBilingual = sortedGood
    .filter((c) => (c.source === 'netease' || c.source === 'qq') && !head.includes(c))
    .slice(0, 4)
  const pool = [...head, ...extraBilingual]

  let fallbackSynced: LyricPayload | null = null
  const withPool = (res: LyricPayload | null): LyricPayload | null => (res ? { ...res, candidates: list } : null)

  for (const c of pool) {
    try {
      const r = await fetchLyricsWithProvider(c)
      if (!r || !isSynced(r.lrc) || /纯音乐，请欣赏/.test(r.lrc)) continue
      if (hasTranslationBody(r.tlrc)) {
        // If we haven't picked a higher-priority synced source yet, return bilingual directly;
        // otherwise graft its translation onto our best synced timeline if timestamps align well.
        if (!fallbackSynced) return withPool(r)
        const aligned = alignTranslationTimestamps(fallbackSynced.lrc, r.tlrc!)
        if (aligned) {
          return withPool({ ...fallbackSynced, tlrc: aligned })
        }
        return withPool(r)
      }
      if (!fallbackSynced) {
        fallbackSynced = r
        if (!needsChineseTranslation(r.lrc)) return withPool(r)
      }
    } catch {
      /* fallback to next candidate */
    }
  }

  if (fallbackSynced && !hasTranslationBody(fallbackSynced.tlrc) && needsChineseTranslation(fallbackSynced.lrc)) {
    const autoTranslated = await translateLyricsToZh(fallbackSynced.lrc)
    if (autoTranslated) {
      fallbackSynced = { ...fallbackSynced, tlrc: autoTranslated }
    }
  }
  return withPool(fallbackSynced)
}
