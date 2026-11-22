export interface LyricWord {
  start: number
  end: number
  text: string
}

export interface LyricLine {
  time: number // seconds; -1 for unsynced
  endTime?: number
  text: string
  words?: LyricWord[]
  trans?: string
  roma?: string
  interlude?: boolean
}

export interface Lyrics {
  lines: LyricLine[]
  synced: boolean
  hasWordSync: boolean
  japanese: boolean
  hasTrans: boolean
  hasRoma: boolean
}

const TIME_RE = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const WORD_TAG_RE = /[<[](\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)[>\]]/g
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/
const LATIN_ONLY = /^[\x00-\x7f\u00c0-\u024f\u1e00-\u1eff\s'’"“”~\-…・·]+$/

interface RawEntry {
  time: number
  text: string
  words?: LyricWord[]
}

function parseTimeTag(minStr: string, secStr: string): number {
  return parseInt(minStr, 10) * 60 + parseFloat(secStr.replace(':', '.'))
}

/**
 * Parse inline word-level timestamps (<mm:ss.xx> or mid-line [mm:ss.xx]) if present.
 */
function parseInlineWords(body: string, lineStartTime: number, offsetSec: number): { cleanText: string; words?: LyricWord[] } {
  WORD_TAG_RE.lastIndex = 0
  const matches: { index: number; len: number; time: number }[] = []
  let m: RegExpExecArray | null
  while ((m = WORD_TAG_RE.exec(body)) !== null) {
    matches.push({
      index: m.index,
      len: m[0].length,
      time: Math.max(0, parseTimeTag(m[1], m[2]) - offsetSec)
    })
  }
  if (matches.length === 0) {
    return { cleanText: body.trim() }
  }

  const rawWords: { start: number; text: string }[] = []
  // Leading text before the first inline word tag
  if (matches[0].index > 0) {
    const pre = body.slice(0, matches[0].index)
    if (pre) rawWords.push({ start: Math.max(0, lineStartTime - offsetSec), text: pre })
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const nextIdx = i + 1 < matches.length ? matches[i + 1].index : body.length
    const seg = body.slice(cur.index + cur.len, nextIdx)
    rawWords.push({ start: cur.time, text: seg })
  }

  // Filter out trailing empty end-marker tag while using its time as the previous word's end
  const words: LyricWord[] = []
  for (let i = 0; i < rawWords.length; i++) {
    const cur = rawWords[i]
    if (!cur.text) continue
    let end = cur.start + 0.35
    for (let j = i + 1; j < rawWords.length; j++) {
      if (rawWords[j].start >= cur.start) {
        end = Math.max(cur.start + 0.05, rawWords[j].start)
        break
      }
    }
    words.push({ start: cur.start, end, text: cur.text })
  }

  const cleanText = words.map((w) => w.text).join('').trim()
  return {
    cleanText,
    words: words.length >= 2 ? words : undefined
  }
}

function parseRaw(text: string): { entries: RawEntry[]; plain: string[]; offset: number } {
  const entries: RawEntry[] = []
  const plain: string[] = []
  let offset = 0

  // First pass: check for [offset:...]
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const off = /^\[offset:\s*([+-]?\d+)\]$/i.exec(rawLine.trim())
    if (off) {
      offset = parseInt(off[1], 10) / 1000
      break
    }
  }

  for (let raw of text.replace(/\r/g, '').split('\n')) {
    raw = raw.trim()
    if (!raw) continue
    // NetEase json credit / YRC lines
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const j = JSON.parse(raw)
        if (typeof j.t === 'number' && Array.isArray(j.c)) {
          const lineStart = Math.max(0, j.t / 1000 - offset)
          const hasWordTiming = j.c.some((c: any) => typeof c.d === 'number' && c.d > 0)
          const words: LyricWord[] | undefined = hasWordTiming
            ? j.c
                .filter((c: any) => typeof c.tx === 'string' && c.tx.length > 0)
                .map((c: any) => {
                  const st = typeof c.t === 'number' ? Math.max(0, c.t / 1000 - offset) : lineStart
                  const dur = typeof c.d === 'number' ? Math.max(0.05, c.d / 1000) : 0.3
                  return { start: st, end: st + dur, text: c.tx }
                })
            : undefined
          entries.push({
            time: lineStart,
            text: j.c.map((c: any) => c.tx).join('').trim(),
            words: words && words.length >= 2 ? words : undefined
          })
          continue
        }
      } catch {
        /* fall through */
      }
    }
    if (/^\[offset:\s*([+-]?\d+)\]$/i.test(raw)) continue
    if (/^\[(ti|ar|al|by|re|ve|length|au|la|id|hash|sign|qq|total|kuwo|language):/i.test(raw)) continue

    // Support NetEase YRC style [startMs,durationMs](wordStartMs,wordDurMs,0)word...
    const yrcMatch = /^\[(\d+),(\d+)\](.+)$/.exec(raw)
    if (yrcMatch) {
      const lineStart = Math.max(0, parseInt(yrcMatch[1], 10) / 1000 - offset)
      const body = yrcMatch[3]
      const yrcWordRe = /\((\d+),(\d+),\d+\)([^(]*)/g
      const words: LyricWord[] = []
      let ym: RegExpExecArray | null
      while ((ym = yrcWordRe.exec(body)) !== null) {
        const st = Math.max(0, parseInt(ym[1], 10) / 1000 - offset)
        const dur = Math.max(0.04, parseInt(ym[2], 10) / 1000)
        const tx = ym[3]
        if (tx) words.push({ start: st, end: st + dur, text: tx })
      }
      if (words.length > 0) {
        entries.push({
          time: lineStart,
          text: words.map((w) => w.text).join('').trim(),
          words: words.length >= 2 ? words : undefined
        })
        continue
      }
    }

    const times: number[] = []
    TIME_RE.lastIndex = 0
    let m: RegExpExecArray | null
    let last = 0
    while ((m = TIME_RE.exec(raw)) && m.index === last) {
      times.push(parseTimeTag(m[1], m[2]))
      last = TIME_RE.lastIndex
    }
    if (times.length) {
      const rawBody = raw.slice(last)
      // If multiple leading [mm:ss.xx][mm:ss.xx] tags exist without text between them, it's a repeated chorus line
      for (const t of times) {
        const { cleanText, words } = parseInlineWords(rawBody, t, offset)
        entries.push({
          time: Math.max(0, t - offset),
          text: cleanText,
          words: times.length === 1 ? words : undefined
        })
      }
    } else if (!/^\[.*\]$/.test(raw)) {
      plain.push(raw)
    }
  }
  return { entries, plain, offset }
}

const isCredit = (s: string) =>
  /^(作词|作曲|编曲|词|曲|编|制作人|混音|母带|和声|吉他|贝斯|鼓|录音|监制|出品|发行|演唱|原唱|翻唱|op|sp|lyricist|composer|arranger|producer|作詞|編曲)\s*[:：]/i.test(
    s.trim()
  )

function groupByTime(entries: RawEntry[]) {
  const sorted = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.time - b.time || a.i - b.i)
  const groups: { time: number; texts: string[]; words?: LyricWord[] }[] = []
  for (const e of sorted) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g.time - e.time) < 0.02) {
      g.texts.push(e.text)
      if (!g.words && e.words) g.words = e.words
    } else {
      groups.push({ time: e.time, texts: [e.text], words: e.words })
    }
  }
  return groups
}

function mapByTime(src: string | undefined) {
  const map: { time: number; text: string }[] = []
  if (!src) return map
  const { entries } = parseRaw(src)
  for (const g of groupByTime(entries)) {
    const t = g.texts.find((x) => x.trim())
    if (t && !/^\/\/$/.test(t.trim())) map.push({ time: g.time, text: t.trim() })
  }
  return map
}

function attach(lines: LyricLine[], map: { time: number; text: string }[], key: 'trans' | 'roma') {
  if (!map.length) return
  let j = 0
  for (const line of lines) {
    if (line[key] || line.interlude) continue
    while (j < map.length - 1 && map[j + 1].time <= line.time) j++
    const cur = map[j]
    const next = j + 1 < map.length ? map[j + 1] : undefined
    const dCur = cur ? Math.abs(cur.time - line.time) : Infinity
    const dNext = next ? Math.abs(next.time - line.time) : Infinity
    const best = dNext < dCur ? next : cur
    const bestDist = Math.min(dCur, dNext)
    if (best && bestDist < 1.6) {
      line[key] = best.text
      if (best === next) j++
    }
  }
}

export function parseLyrics(lrc: string, tlrc?: string, rlrc?: string): Lyrics | null {
  if (!lrc || !lrc.trim()) return null
  const { entries, plain } = parseRaw(lrc)
  let lines: LyricLine[]
  let synced = true
  if (entries.length >= 2) {
    const groups = groupByTime(entries)
    const fullText = groups.map((g) => g.texts[0]).join('')
    const japanese = KANA.test(fullText)
    lines = []
    for (const g of groups) {
      const [main, ...rest] = g.texts.map((t) => t.trim())
      if (!main && rest.every((r) => !r)) {
        lines.push({ time: g.time, text: '', interlude: true })
        continue
      }
      const line: LyricLine = {
        time: g.time,
        text: main || rest.shift() || '',
        words: g.words
      }
      for (const sub of rest) {
        if (!sub) continue
        if (japanese && !line.roma && LATIN_ONLY.test(sub) && !LATIN_ONLY.test(line.text)) line.roma = sub
        else if (!line.trans) line.trans = sub
        else if (!line.roma) line.roma = sub
      }
      lines.push(line)
    }
  } else {
    synced = false
    lines = (plain.length ? plain : lrc.split(/\r?\n/).filter((l) => l.trim())).map((t) => ({ time: -1, text: t.trim() }))
  }

  if (synced) {
    attach(lines, mapByTime(tlrc), 'trans')
    attach(lines, mapByTime(rlrc), 'roma')
    // collapse interludes: keep only gaps longer than 8s
    const out: LyricLine[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      if (l.interlude) {
        const next = lines.slice(i + 1).find((x) => !x.interlude)
        if (next && next.time - l.time >= 8 && out.length) out.push(l)
        continue
      }
      out.push(l)
    }
    lines = out
    // intro dots
    const first = lines.find((l) => !isCredit(l.text))
    if (first && first.time > 5) lines.unshift({ time: 0, text: '', interlude: true })

    // Compute accurate endTime for every line and bound word end times
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i]
      const next = lines[i + 1]
      const naturalSpan = Math.max(1.8, Math.min(8.5, cur.text.length * 0.22 + 1.4))
      cur.endTime = next ? Math.max(cur.time + 0.25, next.time) : cur.time + naturalSpan
      if (cur.words && cur.words.length > 0) {
        const lastW = cur.words[cur.words.length - 1]
        if (next && lastW.end > next.time) {
          lastW.end = Math.max(lastW.start + 0.05, next.time)
        } else if (lastW.end <= lastW.start + 0.36 && cur.endTime > lastW.start + 0.2) {
          lastW.end = Math.min(cur.endTime, lastW.start + 1.2)
        }
      }
    }
  }

  const japanese = KANA.test(lines.map((l) => l.text).join(''))
  const hasWordSync = lines.some((l) => !!l.words?.length)
  return {
    lines,
    synced,
    hasWordSync,
    japanese,
    hasTrans: lines.some((l) => !!l.trans),
    hasRoma: lines.some((l) => !!l.roma)
  }
}

export function fmtLrcTime(t: number) {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`
}

export function serializeLyrics(l: Lyrics, opts: { roma: boolean; trans: boolean }) {
  if (!l.synced) return l.lines.map((x) => x.text).join('\n')
  const out: string[] = []
  for (const line of l.lines) {
    const ts = fmtLrcTime(line.time)
    if (line.interlude) {
      out.push(ts)
      continue
    }
    out.push(ts + line.text)
    if (opts.roma && line.roma) out.push(ts + line.roma)
    if (opts.trans && line.trans) out.push(ts + line.trans)
  }
  return out.join('\n')
}

/** Find index of active line for time t (binary search). */
export function activeIndex(lines: LyricLine[], t: number) {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export function hasKana(s: string) {
  return KANA.test(s)
}
