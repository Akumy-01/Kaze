export interface LyricLine {
  time: number // seconds; -1 for unsynced
  text: string
  trans?: string
  roma?: string
  interlude?: boolean
}

export interface Lyrics {
  lines: LyricLine[]
  synced: boolean
  japanese: boolean
  hasTrans: boolean
  hasRoma: boolean
}

const TIME_RE = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/
const LATIN_ONLY = /^[\x00-\x7f\u00c0-\u024f\u1e00-\u1eff\s'’"“”~\-…・·]+$/

interface RawEntry {
  time: number
  text: string
}

function parseRaw(text: string): { entries: RawEntry[]; plain: string[]; offset: number } {
  const entries: RawEntry[] = []
  const plain: string[] = []
  let offset = 0
  for (let raw of text.replace(/\r/g, '').split('\n')) {
    raw = raw.trim()
    if (!raw) continue
    // NetEase json credit lines
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const j = JSON.parse(raw)
        if (typeof j.t === 'number' && Array.isArray(j.c)) {
          entries.push({ time: j.t / 1000, text: j.c.map((c: any) => c.tx).join('') })
          continue
        }
      } catch {
        /* fall through */
      }
    }
    const off = /^\[offset:\s*([+-]?\d+)\]$/i.exec(raw)
    if (off) {
      offset = parseInt(off[1], 10) / 1000
      continue
    }
    if (/^\[(ti|ar|al|by|re|ve|length|au|la|id|hash|sign|qq|total|kuwo|language):/i.test(raw)) continue
    const times: number[] = []
    TIME_RE.lastIndex = 0
    let m: RegExpExecArray | null
    let last = 0
    while ((m = TIME_RE.exec(raw)) && m.index === last) {
      const sec = parseFloat(m[2].replace(':', '.'))
      times.push(parseInt(m[1], 10) * 60 + sec)
      last = TIME_RE.lastIndex
    }
    if (times.length) {
      const body = raw
        .slice(last)
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
        .trim()
      for (const t of times) entries.push({ time: t, text: body })
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

function groupByTime(entries: RawEntry[], offset: number) {
  const sorted = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.time - b.time || a.i - b.i)
  const groups: { time: number; texts: string[] }[] = []
  for (const e of sorted) {
    const g = groups[groups.length - 1]
    if (g && Math.abs(g.time - e.time) < 0.02) g.texts.push(e.text)
    else groups.push({ time: Math.max(0, e.time - offset), texts: [e.text] })
  }
  return groups
}

function mapByTime(src: string | undefined, offset = 0) {
  const map: { time: number; text: string }[] = []
  if (!src) return map
  const { entries, offset: o } = parseRaw(src)
  for (const g of groupByTime(entries, o || offset)) {
    const t = g.texts.find((x) => x.trim())
    if (t && !/^\/\/$/.test(t.trim())) map.push({ time: g.time, text: t.trim() })
  }
  return map
}

function attach(lines: LyricLine[], map: { time: number; text: string }[], key: 'trans' | 'roma') {
  if (!map.length) return
  let j = 0
  for (const line of lines) {
    while (j < map.length - 1 && map[j + 1].time <= line.time + 0.15) j++
    const c = map[j]
    if (c && Math.abs(c.time - line.time) < 0.6 && !line[key]) line[key] = c.text
  }
}

export function parseLyrics(lrc: string, tlrc?: string, rlrc?: string): Lyrics | null {
  if (!lrc || !lrc.trim()) return null
  const { entries, plain, offset } = parseRaw(lrc)
  let lines: LyricLine[]
  let synced = true
  if (entries.length >= 2) {
    const groups = groupByTime(entries, offset)
    const fullText = groups.map((g) => g.texts[0]).join('')
    const japanese = KANA.test(fullText)
    lines = []
    for (const g of groups) {
      const [main, ...rest] = g.texts.map((t) => t.trim())
      if (!main && rest.every((r) => !r)) {
        lines.push({ time: g.time, text: '', interlude: true })
        continue
      }
      const line: LyricLine = { time: g.time, text: main || rest.shift() || '' }
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
  }

  const japanese = KANA.test(lines.map((l) => l.text).join(''))
  return {
    lines,
    synced,
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
