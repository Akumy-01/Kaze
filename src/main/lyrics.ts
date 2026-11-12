import { net } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { parseFile } from 'music-metadata'
import iconv from 'iconv-lite'
import type { LyricCandidate, LyricPayload, TrackQuery } from '../shared/types'

const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const UA_APP = 'AkumyMusic/1.0 (https://github.com/Akumy-01/akumy-music)'

async function getJSON<T = any>(url: string, headers: Record<string, string> = {}, timeout = 9000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA_BROWSER, ...headers }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    return JSON.parse(text) as T
  } finally {
    clearTimeout(t)
  }
}

/* ------------------------------------------------------------------ */
/* Local lyrics                                                        */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export function normalize(s: string) {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\(\[（【].*?(feat|ft\.|cv|tv|ver|version|remaster|mix|edit|inst|off vocal).*?[\)\]）】]/gi, '')
    .replace(/[\s\-_~·・、,，.。!！?？'"“”‘’&＆/／\\()\[\]（）【】「」『』<>《》]/g, '')
}

function bigrams(s: string) {
  const out = new Map<string, number>()
  if (s.length < 2) {
    out.set(s, 1)
    return out
  }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

export function similarity(a: string, b: string) {
  a = normalize(a)
  b = normalize(b)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.85
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  let total = 0
  for (const [g, n] of A) {
    total += n
    inter += Math.min(n, B.get(g) ?? 0)
  }
  for (const n of B.values()) total += n
  return (2 * inter) / total
}

function scoreCandidate(q: TrackQuery, c: LyricCandidate) {
  const title = similarity(q.title, c.title)
  const artistQ = q.artist && !/未知/.test(q.artist) ? q.artist : ''
  const artist = artistQ ? Math.max(...artistQ.split(/[\/,&、;]/).map((a) => similarity(a, c.artist))) : 0.5
  let dur = 0.5
  if (q.duration && c.duration) {
    const diff = Math.abs(q.duration - c.duration)
    dur = diff < 2 ? 1 : diff < 5 ? 0.8 : diff < 12 ? 0.4 : 0
  }
  const album = q.album && c.album ? similarity(q.album, c.album) : 0.3
  return title * 0.5 + artist * 0.28 + dur * 0.17 + album * 0.05 + (c.synced === false ? -0.1 : 0)
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

async function searchNetease(q: TrackQuery): Promise<LyricCandidate[]> {
  const kw = `${q.title} ${q.artist && !/未知/.test(q.artist) ? q.artist : ''}`.trim()
  const url = `https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(kw)}&type=1&offset=0&limit=12`
  const data = await getJSON(url, { Referer: 'https://music.163.com/' })
  const songs: any[] = data?.result?.songs ?? []
  return songs.map((s) => ({
    source: 'netease' as const,
    id: String(s.id),
    title: s.name,
    artist: (s.artists ?? s.ar ?? []).map((a: any) => a.name).join(' / '),
    album: s.album?.name ?? s.al?.name,
    duration: (s.duration ?? s.dt ?? 0) / 1000
  }))
}

async function fetchNetease(id: string): Promise<Omit<LyricPayload, 'source'> | null> {
  const url = `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1&rv=-1`
  const data = await getJSON(url, { Referer: 'https://music.163.com/' })
  const lrc: string = data?.lrc?.lyric ?? ''
  if (!lrc.trim()) return null
  return {
    lrc,
    tlrc: data?.tlyric?.lyric || undefined,
    rlrc: data?.romalrc?.lyric || undefined
  }
}

async function searchLrclib(q: TrackQuery): Promise<LyricCandidate[]> {
  const params = new URLSearchParams({ track_name: q.title })
  if (q.artist && !/未知/.test(q.artist)) params.set('artist_name', q.artist)
  let data: any[] = await getJSON(`https://lrclib.net/api/search?${params}`, { 'User-Agent': UA_APP }, 10000)
  if (!data?.length) data = await getJSON(`https://lrclib.net/api/search?q=${encodeURIComponent(q.title)}`, { 'User-Agent': UA_APP }, 10000)
  return (data ?? [])
    .filter((d) => !d.instrumental && (d.syncedLyrics || d.plainLyrics))
    .slice(0, 12)
    .map((d) => ({
      source: 'lrclib' as const,
      id: String(d.id),
      title: d.trackName,
      artist: d.artistName,
      album: d.albumName,
      duration: d.duration,
      synced: !!d.syncedLyrics,
      payload: { lrc: d.syncedLyrics || undefined, plain: d.plainLyrics || undefined }
    }))
}

async function fetchLrclib(c: LyricCandidate): Promise<Omit<LyricPayload, 'source'> | null> {
  if (c.payload?.lrc || c.payload?.plain) return { lrc: c.payload.lrc || c.payload.plain! }
  const d = await getJSON(`https://lrclib.net/api/get/${c.id}`, { 'User-Agent': UA_APP })
  const lrc = d?.syncedLyrics || d?.plainLyrics
  return lrc ? { lrc } : null
}

async function searchKugou(q: TrackQuery): Promise<LyricCandidate[]> {
  const kw = `${q.artist && !/未知/.test(q.artist) ? q.artist + ' - ' : ''}${q.title}`
  const data = await getJSON(
    `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}&page=1&pagesize=10&showtype=1`
  )
  const list: any[] = data?.data?.info ?? []
  return list.map((s) => ({
    source: 'kugou' as const,
    id: `${s.hash}|${s.duration}`,
    title: s.songname,
    artist: s.singername,
    album: s.album_name,
    duration: s.duration
  }))
}

async function fetchKugou(c: LyricCandidate): Promise<Omit<LyricPayload, 'source'> | null> {
  const [hash, duration] = c.id.split('|')
  const s = await getJSON(
    `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=${Number(duration) * 1000}&hash=${hash}`
  )
  const cand = s?.candidates?.[0]
  if (!cand) return null
  const d = await getJSON(
    `https://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`
  )
  if (!d?.content) return null
  const lrc = Buffer.from(d.content, 'base64').toString('utf8')
  return lrc.trim() ? { lrc } : null
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function searchLyrics(q: TrackQuery): Promise<LyricCandidate[]> {
  const src = q.source ?? 'all'
  const tasks: Promise<LyricCandidate[]>[] = []
  if (src === 'all' || src === 'netease') tasks.push(searchNetease(q))
  if (src === 'all' || src === 'lrclib') tasks.push(searchLrclib(q))
  if (src === 'all' || src === 'kugou') tasks.push(searchKugou(q))
  const results = await Promise.allSettled(tasks)
  const all: LyricCandidate[] = []
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value)
  for (const c of all) c.score = scoreCandidate(q, c)
  return all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

export async function fetchLyrics(c: LyricCandidate): Promise<LyricPayload | null> {
  let r: Omit<LyricPayload, 'source'> | null = null
  if (c.source === 'netease') r = await fetchNetease(c.id)
  else if (c.source === 'lrclib') r = await fetchLrclib(c)
  else if (c.source === 'kugou') r = await fetchKugou(c)
  return r ? { ...r, source: c.source, candidate: c } : null
}

const isSynced = (lrc: string) => /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(lrc)

/** Automatically find the best online lyric for a track. */
export async function autoLyrics(q: TrackQuery): Promise<LyricPayload | null> {
  const list = await searchLyrics(q)
  const good = list.filter((c) => (c.score ?? 0) >= 0.55).slice(0, 5)
  for (const c of good) {
    try {
      const r = await fetchLyrics(c)
      if (r && isSynced(r.lrc) && !/纯音乐，请欣赏/.test(r.lrc)) return r
    } catch {
      /* try next */
    }
  }
  return null
}
