import { app, net } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import type {
  FallbackTraceEntry,
  LyricCandidate,
  LyricPayload,
  MetadataCandidate,
  MetadataMatchBreakdown,
  MetadataSearchResult,
  ProviderConfig,
  ProviderHealth,
  ProviderKind,
  ProviderSnapshot,
  TitleLanguageVariant,
  TrackQuery
} from '../shared/types'

const UA_APP = 'Kaze/1.1 (https://github.com/Akumy-01/Kaze)'
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const COOLDOWN_MS = 60_000
const FAILURE_THRESHOLD = 3

/* ------------------------------------------------------------------ */
/* Normalization & High-Accuracy Multi-Dimensional Matching            */
/* ------------------------------------------------------------------ */

export function normalizeText(s: string): string {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\(\[（【].*?(feat|ft\.|cv|tv|ver|version|remaster|mix|edit|inst|off vocal).*?[\)\]）】]/gi, '')
    .replace(/[\s\-_~·・、,，.。!！?？'"“”‘’&＆/／\\()\[\]（）【】「」『』<>《》]/g, '')
}

function bigrams(s: string): Map<string, number> {
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

export function similarity(a: string, b: string): number {
  a = normalizeText(a)
  b = normalizeText(b)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.88
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  let total = 0
  for (const [g, n] of A) {
    total += n
    inter += Math.min(n, B.get(g) ?? 0)
  }
  for (const n of B.values()) total += n
  return total > 0 ? (2 * inter) / total : 0
}

export interface AliasPair {
  title: string
  artist: string
}

const nativeAliasCache = new Map<string, AliasPair[]>()

/**
 * Resolve cross-language native script metadata (e.g. English "Guitar, Loneliness and Blue Planet" ->
 * Japanese "ギターと孤独と蒼い惑星 / 結束バンド") via Apple iTunes Storefront Search so Asian lyric
 * providers (NetEase / QQ) match English/romanized audio tags reliably.
 */
async function resolveNativeAliases(q: TrackQuery): Promise<AliasPair[]> {
  const title = (q.title || '').trim()
  if (!title) return []
  const artist = q.artist && !/未知/.test(q.artist) ? q.artist.split(/[\/,&、;:]/)[0].replace(/[\(\[]?(?:feat|ft)\.?\s*[^\)\]]*[\)\]]?/gi, '').trim() : ''
  const key = `${title.toLowerCase()}|${artist.toLowerCase()}`
  const cached = nativeAliasCache.get(key)
  if (cached) return cached

  const hasNonLatin = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(title)
  const out: AliasPair[] = []
  if (!hasNonLatin) {
    const term = `${title} ${artist}`.trim()
    for (const country of ['jp', 'cn']) {
      try {
        const res = await getJSON(
          `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=5&country=${country}`,
          {},
          3200
        )
        const list: any[] = res?.results ?? []
        for (const item of list) {
          const tn = String(item?.trackName ?? '').trim()
          const an = String(item?.artistName ?? '').trim()
          const dur = typeof item?.trackTimeMillis === 'number' ? item.trackTimeMillis / 1000 : 0
          if (!tn) continue
          if (q.duration && dur && Math.abs(q.duration - dur) > 12) continue
          if (/piano|inst\.|instrumental|karaoke|off\s*vocal|music\s*box|remix/i.test(tn) && !/piano|inst|remix/i.test(title)) {
            continue
          }
          if (!out.some((x) => x.title === tn && x.artist === an)) {
            out.push({ title: tn, artist: an })
          }
          if (out.length >= 2) break
        }
        if (out.length) break
      } catch {
        /* non-fatal alias lookup failure */
      }
    }
  }
  if (nativeAliasCache.size > 300) nativeAliasCache.clear()
  nativeAliasCache.set(key, out)
  return out
}

const COVER_OR_INST_RE = /(?:piano\s*ver|piano\s*arr|music\s*box|off\s*vocal|instrumental|karaoke|8-?bit|lullaby|cover\b|伴奏|钢琴版|纯音乐|翻唱|八音盒)/i

export function scoreLyricCandidate(q: TrackQuery, c: LyricCandidate, aliases: AliasPair[] = []): number {
  const titleSims = [similarity(q.title, c.title), ...aliases.map((a) => similarity(a.title, c.title))]
  const title = Math.max(...titleSims)
  const artistQ = q.artist && !/未知/.test(q.artist) ? q.artist : ''
  const qArtists = artistQ ? artistQ.split(/[\/,&、;:]/).map((s) => s.trim()).filter(Boolean) : []
  const aliasArtists = aliases.map((a) => a.artist).filter(Boolean)
  const allArtists = [...qArtists, ...aliasArtists]
  const artist = allArtists.length ? Math.max(...allArtists.map((a) => similarity(a, c.artist))) : 0.5
  let dur = 0.5
  if (q.duration && c.duration) {
    const diff = Math.abs(q.duration - c.duration)
    dur = diff < 2 ? 1 : diff < 5 ? 0.8 : diff < 12 ? 0.4 : 0
  }
  const album = q.album && c.album && !/未知/.test(q.album) ? similarity(q.album, c.album) : 0.3
  const wantsInst = COVER_OR_INST_RE.test(`${q.title} ${q.artist}`)
  const coverPenalty = !wantsInst && COVER_OR_INST_RE.test(`${c.title} ${c.album ?? ''}`) ? -0.35 : 0
  // Prefer providers that supply bilingual Chinese translations (tlrc) on close matches
  const transSourceBonus = c.source === 'netease' ? 0.06 : c.source === 'qq' ? 0.05 : 0
  return Math.max(0, title * 0.5 + artist * 0.28 + dur * 0.17 + album * 0.05 + transSourceBonus + coverPenalty + (c.synced === false ? -0.1 : 0))
}

export function scoreMetadataMatch(
  q: TrackQuery,
  cand: Omit<MetadataCandidate, 'score' | 'confidence' | 'breakdown'>
): { score: number; confidence: 'high' | 'medium' | 'low'; breakdown: MetadataMatchBreakdown } {
  const title = similarity(q.title, cand.title)
  const artistQ = q.artist && !/未知/.test(q.artist) ? q.artist : ''
  const artistParts = artistQ ? artistQ.split(/[\/,&、;]/).map((s) => s.trim()).filter(Boolean) : []
  const candArtists = cand.artist ? cand.artist.split(/[\/,&、;]/).map((s) => s.trim()).filter(Boolean) : []
  let artist = 0.5
  if (artistParts.length && candArtists.length) {
    let best = 0
    for (const a of artistParts) {
      for (const b of candArtists) {
        best = Math.max(best, similarity(a, b))
      }
    }
    artist = Math.max(best, similarity(artistQ, cand.artist))
  } else if (artistQ && cand.artist) {
    artist = similarity(artistQ, cand.artist)
  }

  let duration = 0.65
  if (q.duration && cand.duration) {
    const diff = Math.abs(q.duration - cand.duration)
    duration = diff <= 1.5 ? 1 : diff <= 4 ? 0.86 : diff <= 10 ? 0.45 : diff <= 18 ? 0.18 : 0
  }

  const hasValidAlbumQ = q.album && !/未知/.test(q.album)
  const album = hasValidAlbumQ && cand.album ? similarity(q.album!, cand.album) : 0.45

  const qIsrc = q.isrc?.trim().toUpperCase()
  const cIsrc = cand.isrc?.trim().toUpperCase()
  const isrc = qIsrc && cIsrc ? (qIsrc === cIsrc ? 1 : 0) : 0

  let raw = title * 0.42 + artist * 0.28 + duration * 0.2 + album * 0.1
  if (isrc === 1) {
    raw = Math.min(1, raw * 0.7 + 0.35)
  }
  const score = Math.round(raw * 1000) / 1000
  const confidence: 'high' | 'medium' | 'low' =
    isrc === 1 || (score >= 0.84 && title >= 0.78 && duration >= 0.7)
      ? 'high'
      : score >= 0.64
        ? 'medium'
        : 'low'

  return {
    score,
    confidence,
    breakdown: {
      title: Math.round(title * 100),
      artist: Math.round(artist * 100),
      album: Math.round(album * 100),
      duration: Math.round(duration * 100),
      isrc: Math.round(isrc * 100)
    }
  }
}

/* ------------------------------------------------------------------ */
/* HTTP Fetch Helpers                                                  */
/* ------------------------------------------------------------------ */

async function getJSON<T = any>(url: string, headers: Record<string, string> = {}, timeoutMs = 9000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': UA_BROWSER, ...headers },
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Built-in Lyrics Providers                                           */
/* ------------------------------------------------------------------ */

interface InternalLyricsProvider {
  config: ProviderConfig
  search: (q: TrackQuery) => Promise<LyricCandidate[]>
  fetch: (c: LyricCandidate) => Promise<Omit<LyricPayload, 'source'> | null>
}

interface InternalMetadataProvider {
  config: ProviderConfig
  search: (q: TrackQuery) => Promise<Omit<MetadataCandidate, 'score' | 'confidence' | 'breakdown'>[]>
}

const builtinLyricsProviders: InternalLyricsProvider[] = [
  {
    config: {
      id: 'netease',
      name: '网易云音乐',
      kind: 'lyrics',
      enabled: true,
      priority: 10,
      builtin: true,
      description: '中/日/韩及华语曲目覆盖率高，支持原词、翻译与罗马音',
      timeoutMs: 9000
    },
    async search(q) {
      const cleanArtist = q.artist && !/未知/.test(q.artist) ? q.artist.replace(/\(feat\.[^)]*\)/gi, '').trim() : ''
      const queries = [`${q.title} ${cleanArtist}`.trim()]
      const aliases = await resolveNativeAliases(q)
      for (const a of aliases) {
        const alt = `${a.title} ${a.artist}`.trim()
        if (alt && !queries.includes(alt)) queries.push(alt)
      }
      const seen = new Map<string, LyricCandidate>()
      const results = await Promise.allSettled(
        queries.map((kw) =>
          getJSON(
            `https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(kw)}&type=1&offset=0&limit=12`,
            { Referer: 'https://music.163.com/' },
            9000
          )
        )
      )
      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        const songs: any[] = r.value?.result?.songs ?? []
        for (const s of songs) {
          const id = String(s.id)
          if (seen.has(id)) continue
          seen.set(id, {
            source: 'netease',
            id,
            title: s.name,
            artist: (s.artists ?? s.ar ?? []).map((a: any) => a.name).join(' / '),
            album: s.album?.name ?? s.al?.name,
            duration: (s.duration ?? s.dt ?? 0) / 1000
          })
        }
      }
      return Array.from(seen.values())
    },
    async fetch(c) {
      const url = `https://music.163.com/api/song/lyric?id=${c.id}&lv=1&kv=1&tv=-1&rv=-1`
      const data = await getJSON(url, { Referer: 'https://music.163.com/' }, 9000)
      const hasBody = (s: string) => s.replace(/\[[^\]]*\]/g, '').trim().length > 0
      const lrc: string =
        (hasBody(String(data?.lrc?.lyric ?? '')) ? data.lrc.lyric : '') ||
        (hasBody(String(data?.yrc?.lyric ?? '')) ? data.yrc.lyric : '') ||
        (hasBody(String(data?.klyric?.lyric ?? '')) ? data.klyric.lyric : '')
      if (!lrc.trim()) return null
      const rawTlrc: string = data?.tlyric?.lyric ?? ''
      const rawRlrc: string = data?.romalrc?.lyric ?? ''
      return {
        lrc,
        tlrc: hasBody(rawTlrc) ? rawTlrc : undefined,
        rlrc: hasBody(rawRlrc) ? rawRlrc : undefined
      }
    }
  },
  {
    config: {
      id: 'qq',
      name: 'QQ 音乐',
      kind: 'lyrics',
      enabled: true,
      priority: 15,
      builtin: true,
      description: '华语/日韩/欧美流行同步歌词与官方中文翻译补全',
      timeoutMs: 9000
    },
    async search(q) {
      const cleanArtist = q.artist && !/未知/.test(q.artist) ? q.artist : ''
      const queries = [`${q.title} ${cleanArtist}`.trim()]
      const aliases = await resolveNativeAliases(q)
      for (const a of aliases) {
        const alt = `${a.title} ${a.artist}`.trim()
        if (alt && !queries.includes(alt)) queries.push(alt)
      }
      const seen = new Map<string, LyricCandidate>()
      const results = await Promise.allSettled(
        queries.map((kw) =>
          getJSON(
            `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(kw)}&format=json&p=1&n=10`,
            { Referer: 'https://y.qq.com/' },
            9000
          )
        )
      )
      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        const list: any[] = r.value?.data?.song?.list ?? []
        for (const s of list) {
          if (!s?.songmid) continue
          const id = String(s.songmid)
          if (seen.has(id)) continue
          seen.set(id, {
            source: 'qq',
            id,
            title: String(s.songname ?? ''),
            artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
            album: s.albumname || undefined,
            duration: Number(s.interval) || undefined
          })
        }
      }
      return Array.from(seen.values())
    },
    async fetch(c) {
      const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(c.id)}&format=json&nobase64=1`
      const data = await getJSON(url, { Referer: 'https://y.qq.com/' }, 9000)
      const unescapeHtml = (s: string) =>
        s
          .replace(/&apos;|&#39;/g, "'")
          .replace(/&quot;|&#34;/g, '"')
          .replace(/&lt;|&#60;/g, '<')
          .replace(/&gt;|&#62;/g, '>')
          .replace(/&amp;|&#38;/g, '&')
          .replace(/&#10;/g, '\n')
          .replace(/&#13;/g, '')
      const lrc = unescapeHtml(String(data?.lyric ?? ''))
      if (!lrc.trim()) return null
      const transRaw = unescapeHtml(String(data?.trans ?? ''))
      const hasBody = (s: string) => s.replace(/\[[^\]]*\]/g, '').trim().length > 0
      return {
        lrc,
        tlrc: hasBody(transRaw) ? transRaw : undefined
      }
    }
  },
  {
    config: {
      id: 'lrclib',
      name: 'LRCLIB',
      kind: 'lyrics',
      enabled: true,
      priority: 20,
      builtin: true,
      description: '开放社区同步歌词库，欧美、日语及独立发行命中率稳定',
      timeoutMs: 10000
    },
    async search(q) {
      const candidates: LyricCandidate[] = []
      const seen = new Set<string>()
      const addRecord = (d: any) => {
        if (!d || d.instrumental || (!d.syncedLyrics && !d.plainLyrics)) return
        const id = String(d.id ?? `${d.trackName}-${d.artistName}-${d.duration ?? 0}`)
        if (seen.has(id)) return
        seen.add(id)
        candidates.push({
          source: 'lrclib',
          id,
          title: d.trackName,
          artist: d.artistName,
          album: d.albumName,
          duration: d.duration,
          synced: !!d.syncedLyrics,
          payload: { lrc: d.syncedLyrics || undefined, plain: d.plainLyrics || undefined }
        })
      }

      // Exact duration-aware lookup first via LRCLIB /api/get
      if (q.title && q.artist && !/未知/.test(q.artist) && q.duration && q.duration > 0) {
        try {
          const exactParams = new URLSearchParams({
            track_name: q.title,
            artist_name: q.artist.split(/[\/,&、;]/)[0].trim(),
            duration: String(Math.round(q.duration))
          })
          if (q.album && !/未知/.test(q.album)) exactParams.set('album_name', q.album)
          const exact = await getJSON(`https://lrclib.net/api/get?${exactParams}`, { 'User-Agent': UA_APP }, 7000)
          addRecord(exact)
        } catch {
          /* continue to fuzzy search */
        }
      }

      const params = new URLSearchParams({ track_name: q.title })
      if (q.artist && !/未知/.test(q.artist)) params.set('artist_name', q.artist)
      let data: any[] = await getJSON(`https://lrclib.net/api/search?${params}`, { 'User-Agent': UA_APP }, 10000)
      if (!data?.length) {
        data = await getJSON(`https://lrclib.net/api/search?q=${encodeURIComponent(q.title)}`, { 'User-Agent': UA_APP }, 10000)
      }
      for (const d of (data ?? []).slice(0, 12)) addRecord(d)
      return candidates
    },
    async fetch(c) {
      if (c.payload?.lrc || c.payload?.plain) return { lrc: c.payload.lrc || c.payload.plain! }
      const d = await getJSON(`https://lrclib.net/api/get/${c.id}`, { 'User-Agent': UA_APP }, 9000)
      const lrc = d?.syncedLyrics || d?.plainLyrics
      return lrc ? { lrc } : null
    }
  },
  {
    config: {
      id: 'lyricsplus',
      name: 'Apple / Musixmatch / Spotify',
      kind: 'lyrics',
      enabled: true,
      priority: 25,
      builtin: true,
      description: '聚合 Apple Music、Musixmatch 与 Spotify 逐行/逐字时间轴歌词库',
      timeoutMs: 9000
    },
    async search(q) {
      if (!q.title.trim()) return []
      const baseTitle = q.title.replace(/\s*[\(\[]feat\.[^\)\]]*[\)\]]/gi, '').trim()
      const primaryArtist =
        q.artist && !/未知/.test(q.artist) ? q.artist.split(/[\/,&、;:]/)[0].trim() : ''
      const aliases = await resolveNativeAliases(q)
      const variants: { title: string; artist: string }[] = [
        { title: q.title.trim(), artist: primaryArtist }
      ]
      if (baseTitle && baseTitle !== q.title.trim()) {
        variants.push({ title: baseTitle, artist: primaryArtist })
      }
      for (const a of aliases) {
        if (!variants.some((v) => v.title === a.title && v.artist === a.artist)) {
          variants.push(a)
        }
      }

      const bases = [
        'https://lyricsplus.prjktla.my.id',
        'https://lyricsplus.binimum.org',
        'https://lyricsplus.atomix.one'
      ]
      let data: any = null
      let matchedVariant = variants[0]

      for (const v of variants) {
        const params = new URLSearchParams({
          title: v.title,
          artist: v.artist,
          source: 'apple,musixmatch,spotify,lyricsplus'
        })
        if (q.album && !/未知/.test(q.album)) params.set('album', q.album)
        if (q.duration && q.duration > 0) params.set('duration', String(Math.round(q.duration)))
        if (q.isrc?.trim()) params.set('isrc', q.isrc.trim())

        for (const base of bases) {
          try {
            const resp = await getJSON(`${base}/v2/lyrics/get?${params}`, { 'User-Agent': UA_APP }, 5500)
            if (resp?.lyrics?.length) {
              data = resp
              matchedVariant = v
              break
            }
          } catch {
            /* 404 or unreachable mirror: move on cleanly without tripping cooldown */
          }
        }
        if (data?.lyrics?.length) break
      }

      const lines: any[] = data?.lyrics ?? []
      if (!lines.length) return []

      const fmtTs = (ms: number) => {
        const totalSec = Math.max(0, ms) / 1000
        const m = Math.floor(totalSec / 60)
        const s = totalSec - m * 60
        return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
      }
      const lrcLines: string[] = []
      const tlrcLines: string[] = []
      const rlrcLines: string[] = []
      for (const ln of lines) {
        const lineTime = Number(ln.time) || 0
        const tag = `[${fmtTs(lineTime)}]`
        if (Array.isArray(ln.syllabus) && ln.syllabus.length > 0) {
          const wordTags = ln.syllabus
            .map((w: any) => `<${fmtTs(Number(w.time) || lineTime)}>${String(w.text ?? '')}`)
            .join('')
          lrcLines.push(`${tag}${wordTags}`)
        } else if (ln.text) {
          lrcLines.push(`${tag}${String(ln.text)}`)
        }
        const transText = String(ln.translation?.text ?? ln.tl ?? '').trim()
        if (transText) tlrcLines.push(`${tag}${transText}`)
        const romaText = String(ln.transliteration?.text ?? ln.romanization ?? ln.romaji ?? '').trim()
        if (romaText) rlrcLines.push(`${tag}${romaText}`)
      }
      const lrc = lrcLines.join('\n')
      if (!lrc.trim()) return []
      const tlrc = tlrcLines.length >= 2 ? tlrcLines.join('\n') : undefined
      const rlrc = rlrcLines.length >= 2 ? rlrcLines.join('\n') : undefined
      const upstreamSrc = data?.metadata?.source ? `Apple/MXM (${data.metadata.source})` : undefined

      return [
        {
          source: 'lyricsplus',
          id: `lp:${matchedVariant.title}:${matchedVariant.artist}`,
          title: matchedVariant.title,
          artist: matchedVariant.artist || '未知艺人',
          album: upstreamSrc || q.album,
          duration: q.duration,
          synced: true,
          payload: { lrc, tlrc, rlrc }
        }
      ]
    },
    async fetch(c) {
      if (c.payload?.lrc) {
        return {
          lrc: c.payload.lrc,
          tlrc: c.payload.tlrc,
          rlrc: c.payload.rlrc
        }
      }
      return null
    }
  },
  {
    config: {
      id: 'lyricsovh',
      name: 'Lyrics.ovh',
      kind: 'lyrics',
      enabled: true,
      priority: 35,
      builtin: true,
      description: '国际曲库公开兜底歌词接口（纯文本歌词）',
      timeoutMs: 8000
    },
    async search(q) {
      const artist = q.artist && !/未知/.test(q.artist) ? q.artist.split(/[\/,&、;]/)[0].trim() : ''
      if (!artist || !q.title.trim()) return []
      const data = await getJSON(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(q.title.trim())}`,
        { 'User-Agent': UA_APP },
        8000
      )
      const plain = String(data?.lyrics ?? '').trim()
      if (!plain) return []
      return [
        {
          source: 'lyricsovh',
          id: `ovh:${artist}:${q.title}`,
          title: q.title,
          artist,
          album: q.album,
          duration: q.duration,
          synced: false,
          payload: { plain }
        }
      ]
    },
    async fetch(c) {
      const txt = c.payload?.plain || c.payload?.lrc
      return txt ? { lrc: txt } : null
    }
  }
]

/* ------------------------------------------------------------------ */
/* Built-in Open Metadata Providers (MusicBrainz + Cover Art / iTunes) */
/* ------------------------------------------------------------------ */

let lastMbReqAt = 0
async function throttleMusicBrainz() {
  const wait = 1050 - (Date.now() - lastMbReqAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastMbReqAt = Date.now()
}

const builtinMetadataProviders: InternalMetadataProvider[] = [
  {
    config: {
      id: 'musicbrainz',
      name: 'MusicBrainz + Cover Art Archive',
      kind: 'metadata',
      enabled: true,
      priority: 10,
      builtin: true,
      description: '开放音乐百科规范元数据、ISRC、音轨号与高分辨率封面库',
      timeoutMs: 11000
    },
    async search(q) {
      await throttleMusicBrainz()
      const parts: string[] = []
      if (q.isrc?.trim()) {
        parts.push(`isrc:${q.isrc.trim().toUpperCase()}`)
      } else {
        if (q.title.trim()) parts.push(`recording:"${q.title.replace(/"/g, '')}"`)
        if (q.artist && !/未知/.test(q.artist)) {
          const primaryArtist = q.artist.split(/[\/,&、;]/)[0].trim()
          if (primaryArtist) parts.push(`artist:"${primaryArtist.replace(/"/g, '')}"`)
        }
        if (q.album && !/未知/.test(q.album)) {
          parts.push(`release:"${q.album.replace(/"/g, '')}"`)
        }
      }
      const queryStr = parts.join(' AND ') || q.title
      const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(queryStr)}&fmt=json&limit=10`
      const data = await getJSON(url, { 'User-Agent': UA_APP }, 11000)
      const recs: any[] = data?.recordings ?? []
      const out: Omit<MetadataCandidate, 'score' | 'confidence' | 'breakdown'>[] = []
      for (const r of recs) {
        const artistCredit = (r['artist-credit'] ?? [])
          .map((ac: any) => `${ac.name || ac.artist?.name || ''}${ac.joinphrase || ''}`)
          .join('')
          .trim()
        const rel =
          r.releases?.find((x: any) => x.status === 'Official' && x['release-group']?.['primary-type'] === 'Album') ??
          r.releases?.[0]
        const media = rel?.media?.[0]
        const trackEntry = media?.track?.[0]
        const dateStr: string | undefined = rel?.date || r['first-release-date']
        const year = dateStr && /^\d{4}/.test(dateStr) ? parseInt(dateStr.slice(0, 4), 10) : undefined
        const genreTag = (r.tags ?? [])
          .slice()
          .sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))[0]?.name
        const isrc = Array.isArray(r.isrcs) ? r.isrcs[0] : undefined
        const releaseId: string | undefined = rel?.id
        out.push({
          source: 'musicbrainz',
          sourceName: 'MusicBrainz',
          id: r.id,
          title: r.title,
          artist: artistCredit || '未知艺人',
          album: rel?.title || '未知专辑',
          albumArtist: artistCredit || undefined,
          year,
          trackNo: trackEntry?.number ? parseInt(String(trackEntry.number), 10) || undefined : undefined,
          discNo: media?.position ? Number(media.position) || undefined : undefined,
          genre: genreTag ? String(genreTag) : undefined,
          isrc,
          duration: typeof r.length === 'number' ? r.length / 1000 : undefined,
          releaseId,
          coverUrl: releaseId ? `https://coverartarchive.org/release/${releaseId}/front-500` : undefined
        })
      }
      return out
    }
  },
  {
    config: {
      id: 'itunes',
      name: 'iTunes Search (公开目录)',
      kind: 'metadata',
      enabled: true,
      priority: 20,
      builtin: true,
      description: '公开曲目目录检索，响应快，可提供清晰流派、发行年份与高分辨率专辑封面',
      timeoutMs: 9000
    },
    async search(q) {
      const kw = `${q.title} ${q.artist && !/未知/.test(q.artist) ? q.artist.split(/[\/,&、;]/)[0].trim() : ''}`.trim()
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(kw)}&entity=song&limit=10`
      const data = await getJSON(url, { 'User-Agent': UA_APP }, 9000)
      const list: any[] = data?.results ?? []
      return list.map((it) => {
        const year = it.releaseDate && /^\d{4}/.test(it.releaseDate) ? parseInt(it.releaseDate.slice(0, 4), 10) : undefined
        const art: string | undefined = typeof it.artworkUrl100 === 'string'
          ? it.artworkUrl100.replace(/100x100bb/i, '1000x1000bb')
          : undefined
        return {
          source: 'itunes',
          sourceName: 'iTunes Catalog',
          id: String(it.trackId),
          title: it.trackName,
          artist: it.artistName,
          album: it.collectionName || '未知专辑',
          albumArtist: it.collectionArtistName || it.artistName,
          year,
          trackNo: it.trackNumber || undefined,
          discNo: it.discNumber || undefined,
          genre: it.primaryGenreName || undefined,
          duration: typeof it.trackTimeMillis === 'number' ? it.trackTimeMillis / 1000 : undefined,
          coverUrl: art
        }
      })
    }
  }
]

/* ------------------------------------------------------------------ */
/* Custom Declarative HTTP Provider Extension Loader                   */
/* ------------------------------------------------------------------ */

interface CustomDeclarativeManifest {
  id: string
  name: string
  kind: ProviderKind
  description?: string
  searchUrl: string
  timeoutMs?: number
  listPath?: string
  fields: Record<string, string>
}

function getByPath(obj: any, p?: string): any {
  if (!p) return obj
  return p.split('.').reduce((acc, k) => (acc != null ? acc[k] : undefined), obj)
}

function isAllowedCustomUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl.replace(/\{query\}|\{title\}|\{artist\}|\{album\}/g, 'test'))
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
    return false
  } catch {
    return false
  }
}

export const customProvidersDir = () => path.join(app.getPath('userData'), 'providers')
const providersStateFile = () => path.join(app.getPath('userData'), 'providers.json')

const customMetadataProviders: InternalMetadataProvider[] = []
const customLyricsProviders: InternalLyricsProvider[] = []

async function loadCustomManifests() {
  customMetadataProviders.length = 0
  customLyricsProviders.length = 0
  const dir = customProvidersDir()
  await fs.mkdir(dir, { recursive: true })
  let files: string[] = []
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_example'))
  } catch {
    return
  }
  for (const file of files) {
    try {
      const m = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as CustomDeclarativeManifest
      if (!m?.id || !m?.name || !m?.searchUrl || !isAllowedCustomUrl(m.searchUrl)) continue
      const safeId = `ext:${m.id.replace(/[^a-z0-9_-]/gi, '')}`
      if (m.kind === 'metadata') {
        customMetadataProviders.push({
          config: {
            id: safeId,
            name: m.name,
            kind: 'metadata',
            enabled: true,
            priority: 100,
            builtin: false,
            description: m.description || `自定义元数据扩展 (${file})`,
            timeoutMs: m.timeoutMs ?? 9000
          },
          async search(q) {
            const url = m.searchUrl
              .replace(/\{query\}/g, encodeURIComponent(`${q.title} ${q.artist || ''}`.trim()))
              .replace(/\{title\}/g, encodeURIComponent(q.title))
              .replace(/\{artist\}/g, encodeURIComponent(q.artist || ''))
              .replace(/\{album\}/g, encodeURIComponent(q.album || ''))
            const data = await getJSON(url, { 'User-Agent': UA_APP }, m.timeoutMs ?? 9000)
            const arr: any[] = Array.isArray(getByPath(data, m.listPath)) ? getByPath(data, m.listPath) : []
            return arr.slice(0, 12).map((item, idx) => ({
              source: safeId,
              sourceName: m.name,
              id: String(getByPath(item, m.fields.id) ?? idx),
              title: String(getByPath(item, m.fields.title) ?? ''),
              artist: String(getByPath(item, m.fields.artist) ?? '未知艺人'),
              album: String(getByPath(item, m.fields.album) ?? '未知专辑'),
              albumArtist: getByPath(item, m.fields.albumArtist),
              year: Number(getByPath(item, m.fields.year)) || undefined,
              trackNo: Number(getByPath(item, m.fields.trackNo)) || undefined,
              discNo: Number(getByPath(item, m.fields.discNo)) || undefined,
              genre: getByPath(item, m.fields.genre),
              isrc: getByPath(item, m.fields.isrc),
              duration: Number(getByPath(item, m.fields.duration)) || undefined,
              coverUrl: getByPath(item, m.fields.coverUrl)
            })).filter((c) => !!c.title)
          }
        })
      } else if (m.kind === 'lyrics') {
        customLyricsProviders.push({
          config: {
            id: safeId,
            name: m.name,
            kind: 'lyrics',
            enabled: true,
            priority: 100,
            builtin: false,
            description: m.description || `自定义歌词扩展 (${file})`,
            timeoutMs: m.timeoutMs ?? 9000
          },
          async search(q) {
            const url = m.searchUrl
              .replace(/\{query\}/g, encodeURIComponent(`${q.title} ${q.artist || ''}`.trim()))
              .replace(/\{title\}/g, encodeURIComponent(q.title))
              .replace(/\{artist\}/g, encodeURIComponent(q.artist || ''))
              .replace(/\{album\}/g, encodeURIComponent(q.album || ''))
            const data = await getJSON(url, { 'User-Agent': UA_APP }, m.timeoutMs ?? 9000)
            const arr: any[] = Array.isArray(getByPath(data, m.listPath)) ? getByPath(data, m.listPath) : []
            return arr.slice(0, 12).map((item, idx) => {
              const lrcText = getByPath(item, m.fields.lrc)
              return {
                source: safeId,
                id: String(getByPath(item, m.fields.id) ?? idx),
                title: String(getByPath(item, m.fields.title) ?? ''),
                artist: String(getByPath(item, m.fields.artist) ?? ''),
                album: getByPath(item, m.fields.album),
                duration: Number(getByPath(item, m.fields.duration)) || undefined,
                synced: typeof lrcText === 'string' ? /\[\d+:\d+/.test(lrcText) : undefined,
                payload: typeof lrcText === 'string' ? { lrc: lrcText } : undefined
              }
            }).filter((c) => !!c.title && !!c.payload?.lrc)
          },
          async fetch(c) {
            return c.payload?.lrc ? { lrc: c.payload.lrc } : null
          }
        })
      }
    } catch {
      /* skip malformed manifest */
    }
  }
}

export async function createExampleProviderTemplate(): Promise<string> {
  const dir = customProvidersDir()
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, '_example-lyrics-provider.json')
  if (!existsSync(target)) {
    const sample: CustomDeclarativeManifest = {
      id: 'my-lrc-server',
      name: '示例自建歌词服务',
      kind: 'lyrics',
      description: '重命名并去除下划线前缀即可加载；仅支持 HTTPS 或 localhost JSON API',
      searchUrl: 'http://127.0.0.1:28883/lyrics?title={title}&artist={artist}',
      timeoutMs: 8000,
      listPath: 'results',
      fields: {
        id: 'id',
        title: 'title',
        artist: 'artist',
        album: 'album',
        duration: 'duration',
        lrc: 'lrc'
      }
    }
    await fs.writeFile(target, JSON.stringify(sample, null, 2), 'utf8')
  }
  return dir
}

/* ------------------------------------------------------------------ */
/* Persisted Provider Ordering & Health Registry                       */
/* ------------------------------------------------------------------ */

interface PersistedProviderPref {
  enabled: boolean
  priority: number
}

let prefs: Record<string, PersistedProviderPref> = {}
const healthMap = new Map<string, ProviderHealth>()
let initialized = false

function getHealth(id: string, enabled: boolean): ProviderHealth {
  let h = healthMap.get(id)
  if (!h) {
    h = { id, status: enabled ? 'ready' : 'disabled', failures: 0 }
    healthMap.set(id, h)
  }
  if (!enabled) {
    h.status = 'disabled'
  } else if (h.status === 'disabled') {
    h.status = 'ready'
  } else if (h.status === 'cooldown' && h.cooldownUntil && Date.now() >= h.cooldownUntil) {
    h.status = 'ready'
    h.failures = 0
    h.cooldownUntil = undefined
  }
  return { ...h }
}

function recordSuccess(id: string, latencyMs: number) {
  const cur = healthMap.get(id) ?? { id, status: 'ready', failures: 0 }
  cur.status = 'ready'
  cur.failures = 0
  cur.cooldownUntil = undefined
  cur.lastError = undefined
  cur.avgLatencyMs = cur.avgLatencyMs ? Math.round(cur.avgLatencyMs * 0.6 + latencyMs * 0.4) : Math.round(latencyMs)
  healthMap.set(id, cur)
}

function recordFailure(id: string, err: unknown) {
  const cur = healthMap.get(id) ?? { id, status: 'ready', failures: 0 }
  cur.failures += 1
  cur.lastError = err instanceof Error ? err.message : String(err)
  if (cur.failures >= FAILURE_THRESHOLD) {
    cur.status = 'cooldown'
    cur.cooldownUntil = Date.now() + COOLDOWN_MS
  }
  healthMap.set(id, cur)
}

async function ensureInit() {
  if (initialized) return
  initialized = true
  try {
    const raw = await fs.readFile(providersStateFile(), 'utf8')
    prefs = JSON.parse(raw)
  } catch {
    prefs = {}
  }
  await loadCustomManifests()
}

async function savePrefs() {
  const tmp = providersStateFile() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(prefs, null, 2), 'utf8')
  await fs.rename(tmp, providersStateFile())
}

function allProviders(): (InternalLyricsProvider | InternalMetadataProvider)[] {
  return [...builtinMetadataProviders, ...customMetadataProviders, ...builtinLyricsProviders, ...customLyricsProviders]
}

function effectiveConfig(p: InternalLyricsProvider | InternalMetadataProvider): ProviderConfig {
  const ov = prefs[p.config.id]
  return {
    ...p.config,
    enabled: ov?.enabled ?? p.config.enabled,
    priority: ov?.priority ?? p.config.priority
  }
}

export async function reloadProviders(): Promise<ProviderSnapshot[]> {
  await loadCustomManifests()
  return getProviders()
}

export async function exportProviderPrefs(): Promise<Record<string, PersistedProviderPref>> {
  await ensureInit()
  return JSON.parse(JSON.stringify(prefs))
}

export async function importProviderPrefs(incoming: unknown): Promise<ProviderSnapshot[]> {
  await ensureInit()
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    const next: Record<string, PersistedProviderPref> = { ...prefs }
    for (const [k, v] of Object.entries(incoming as Record<string, any>)) {
      if (v && typeof v === 'object' && typeof v.enabled === 'boolean' && typeof v.priority === 'number' && isFinite(v.priority)) {
        next[k] = { enabled: v.enabled, priority: v.priority }
      }
    }
    prefs = next
    await savePrefs()
  }
  return getProviders()
}

export async function getProviders(): Promise<ProviderSnapshot[]> {
  await ensureInit()
  return allProviders()
    .map((p) => {
      const cfg = effectiveConfig(p)
      return { ...cfg, health: getHealth(cfg.id, cfg.enabled) }
    })
    .sort((a, b) => (a.kind === b.kind ? a.priority - b.priority : a.kind.localeCompare(b.kind)))
}

export async function updateProvider(id: string, patch: { enabled?: boolean }): Promise<ProviderSnapshot[]> {
  await ensureInit()
  const found = allProviders().find((p) => p.config.id === id)
  if (!found) return getProviders()
  const cur = effectiveConfig(found)
  prefs[id] = {
    enabled: patch.enabled ?? cur.enabled,
    priority: cur.priority
  }
  if (patch.enabled) {
    healthMap.set(id, { id, status: 'ready', failures: 0 })
  }
  await savePrefs()
  return getProviders()
}

export async function moveProvider(id: string, dir: -1 | 1): Promise<ProviderSnapshot[]> {
  await ensureInit()
  const all = await getProviders()
  const found = all.find((p) => p.id === id)
  if (!found) return all
  const group = all.filter((p) => p.kind === found.kind)
  const idx = group.findIndex((p) => p.id === id)
  const swap = idx + dir
  if (idx < 0 || swap < 0 || swap >= group.length) return all
  const reordered = group.slice()
  ;[reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]]
  reordered.forEach((p, i) => {
    prefs[p.id] = { enabled: p.enabled, priority: (i + 1) * 10 }
  })
  await savePrefs()
  return getProviders()
}

export async function resetProviderHealth(id?: string): Promise<ProviderSnapshot[]> {
  await ensureInit()
  if (id) healthMap.delete(id)
  else healthMap.clear()
  return getProviders()
}

/* ------------------------------------------------------------------ */
/* Fallback Chain Execution: Lyrics & Metadata                         */
/* ------------------------------------------------------------------ */

export async function searchLyricsWithFallback(q: TrackQuery): Promise<LyricCandidate[]> {
  await ensureInit()
  const list = [...builtinLyricsProviders, ...customLyricsProviders]
    .map((p) => ({ provider: p, cfg: effectiveConfig(p) }))
    .sort((a, b) => a.cfg.priority - b.cfg.priority)

  const src = q.source ?? 'all'
  const filtered = list.filter(({ cfg }) => {
    if (src !== 'all') return cfg.id === src
    const h = getHealth(cfg.id, cfg.enabled)
    return cfg.enabled && h.status !== 'cooldown'
  })

  const tasks = filtered.map(async ({ provider, cfg }) => {
    const t0 = performance.now()
    try {
      const rows = await provider.search(q)
      recordSuccess(cfg.id, performance.now() - t0)
      return rows
    } catch (e) {
      recordFailure(cfg.id, e)
      throw e
    }
  })

  const [aliases, settled] = await Promise.all([resolveNativeAliases(q), Promise.allSettled(tasks)])
  const all: LyricCandidate[] = []
  for (const r of settled) if (r.status === 'fulfilled') all.push(...r.value)
  for (const c of all) c.score = scoreLyricCandidate(q, c, aliases)
  return all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

export async function fetchLyricsWithProvider(c: LyricCandidate): Promise<LyricPayload | null> {
  await ensureInit()
  const found = [...builtinLyricsProviders, ...customLyricsProviders].find((p) => p.config.id === c.source)
  if (!found) return null
  const t0 = performance.now()
  try {
    const res = await found.fetch(c)
    recordSuccess(found.config.id, performance.now() - t0)
    return res ? { ...res, source: c.source, candidate: c } : null
  } catch (e) {
    recordFailure(found.config.id, e)
    throw e
  }
}

/**
 * Search metadata using ordered Fallback Chain:
 * Queries active providers in priority order; returns once a high-confidence hit is found,
 * or aggregates candidates across fallback providers if top providers miss or have low confidence.
 */
export async function searchMetadataWithFallback(q: TrackQuery): Promise<MetadataSearchResult> {
  await ensureInit()
  const list = [...builtinMetadataProviders, ...customMetadataProviders]
    .map((p) => ({ provider: p, cfg: effectiveConfig(p) }))
    .sort((a, b) => a.cfg.priority - b.cfg.priority)

  const trace: FallbackTraceEntry[] = []
  const collected: MetadataCandidate[] = []

  for (const { provider, cfg } of list) {
    const h = getHealth(cfg.id, cfg.enabled)
    if (!cfg.enabled) {
      trace.push({ providerId: cfg.id, providerName: cfg.name, status: 'disabled', latencyMs: 0 })
      continue
    }
    if (h.status === 'cooldown') {
      trace.push({
        providerId: cfg.id,
        providerName: cfg.name,
        status: 'skipped-cooldown',
        latencyMs: 0,
        message: h.lastError
      })
      continue
    }

    const t0 = performance.now()
    try {
      const rawList = await provider.search(q)
      const ms = Math.round(performance.now() - t0)
      recordSuccess(cfg.id, ms)
      const scored = rawList.map((item) => {
        const s = scoreMetadataMatch(q, item)
        return { ...item, ...s }
      })
      collected.push(...scored)
      const topScore = scored.reduce((m, x) => Math.max(m, x.score), 0)
      trace.push({
        providerId: cfg.id,
        providerName: cfg.name,
        status: scored.length ? 'hit' : 'miss',
        latencyMs: ms,
        count: scored.length
      })
      // Early exit fallback chain when primary provider returns a high-confidence match with artwork
      if (scored.some((c) => c.confidence === 'high' && c.coverUrl)) {
        break
      }
      void topScore
    } catch (e) {
      const ms = Math.round(performance.now() - t0)
      recordFailure(cfg.id, e)
      trace.push({
        providerId: cfg.id,
        providerName: cfg.name,
        status: 'error',
        latencyMs: ms,
        message: e instanceof Error ? e.message : String(e)
      })
    }
  }

  collected.sort((a, b) => b.score - a.score)
  return { candidates: collected.slice(0, 16), trace }
}

function classifyTitleLang(s: string): { lang: TitleLanguageVariant['lang']; langLabel: string } {
  if (/[\u3040-\u30ff]/.test(s)) return { lang: 'ja', langLabel: '日本語原名' }
  if (/[\uac00-\ud7af]/.test(s)) return { lang: 'ko', langLabel: '한국어原名' }
  if (/[\u4e00-\u9fff]/.test(s)) return { lang: 'zh', langLabel: '中文名 / 译名' }
  if (/[a-zA-Z]/.test(s)) return { lang: 'en', langLabel: '英文 / 罗马音' }
  return { lang: 'other', langLabel: '其他语种' }
}

/**
 * Look up equivalent song titles across Japanese, Chinese, Korean, and English storefronts
 * so users can one-click restore native song titles on tracks tagged in English or romanized script.
 */
export async function lookupTitleVariants(q: TrackQuery): Promise<TitleLanguageVariant[]> {
  const cleanTitle = (q.title || '').trim()
  if (!cleanTitle) return []
  const cleanArtist =
    q.artist && !/未知/.test(q.artist)
      ? q.artist.split(/[\/,&、;:]/)[0].replace(/[\(\[]?(?:feat|ft)\.?\s*[^\)\]]*[\)\]]?/gi, '').trim()
      : ''

  const out: TitleLanguageVariant[] = []
  const seen = new Set<string>()
  const pushVariant = (v: TitleLanguageVariant) => {
    const t = v.title.trim()
    if (!t) return
    const key = `${v.lang}:${normalizeText(t)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ ...v, title: t })
  }

  const queries = [`${cleanTitle} ${cleanArtist}`.trim()]
  const aliases = await resolveNativeAliases(q)
  for (const a of aliases) {
    const alt = `${a.title} ${a.artist}`.trim()
    if (alt && !queries.includes(alt)) queries.push(alt)
  }

  const storefronts: Array<{ country: string; label: string }> = [
    { country: 'jp', label: 'Apple Music 日本区' },
    { country: 'cn', label: 'Apple Music 中国区' },
    { country: 'us', label: 'Apple Music 国际区' },
    { country: 'kr', label: 'Apple Music 韩国区' }
  ]

  const itunesTasks = storefronts.flatMap((sf) =>
    queries.slice(0, 2).map(async (term) => {
      try {
        const res = await getJSON(
          `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=4&country=${sf.country}`,
          {},
          4000
        )
        const list: any[] = res?.results ?? []
        for (const it of list) {
          const tn = String(it?.trackName ?? '').trim()
          const an = String(it?.artistName ?? '').trim()
          const alb = String(it?.collectionName ?? '').trim()
          const dur = typeof it?.trackTimeMillis === 'number' ? it.trackTimeMillis / 1000 : 0
          if (!tn) continue
          if (q.duration && dur && Math.abs(q.duration - dur) > 15) continue
          if (COVER_OR_INST_RE.test(tn) && !COVER_OR_INST_RE.test(cleanTitle)) continue
          const detected = classifyTitleLang(tn)
          const lang: TitleLanguageVariant['lang'] =
            sf.country === 'jp' && /[\u4e00-\u9fff]/.test(tn) && !/[a-zA-Z]/.test(tn) ? 'ja' : detected.lang
          pushVariant({
            lang,
            langLabel:
              sf.country === 'jp' && /[\u3040-\u30ff\u4e00-\u9fff]/.test(tn) ? '日本語原名' : detected.langLabel,
            title: tn,
            artist: an || undefined,
            album: alb || undefined,
            source: sf.label
          })
          break
        }
      } catch {
        /* ignore */
      }
    })
  )

  const neteaseTasks = queries.slice(0, 2).map(async (kw) => {
    try {
      const data = await getJSON(
        `https://music.163.com/api/search/get/web?csrf_token=&s=${encodeURIComponent(kw)}&type=1&offset=0&limit=6`,
        { Referer: 'https://music.163.com/' },
        5000
      )
      const songs: any[] = data?.result?.songs ?? []
      for (const s of songs) {
        const tn = String(s?.name ?? '').trim()
        const dur = (s?.duration ?? s?.dt ?? 0) / 1000
        if (!tn) continue
        if (q.duration && dur && Math.abs(q.duration - dur) > 15) continue
        if (COVER_OR_INST_RE.test(tn) && !COVER_OR_INST_RE.test(cleanTitle)) continue
        const an = (s.artists ?? s.ar ?? []).map((a: any) => a.name).join(' / ')
        const alb = s.album?.name ?? s.al?.name
        const detected = classifyTitleLang(tn)
        pushVariant({
          lang: detected.lang,
          langLabel: detected.langLabel,
          title: tn,
          artist: an || undefined,
          album: alb || undefined,
          source: '网易云音乐'
        })
        const tnsList: string[] = Array.isArray(s.tns) ? s.tns : Array.isArray(s.transNames) ? s.transNames : []
        for (const zhName of tnsList) {
          if (zhName?.trim()) {
            pushVariant({
              lang: 'zh',
              langLabel: '简体中文译名',
              title: zhName.trim(),
              artist: an || undefined,
              album: alb || undefined,
              source: '网易云译名'
            })
          }
        }
        break
      }
    } catch {
      /* ignore */
    }
  })

  await Promise.allSettled([...itunesTasks, ...neteaseTasks])
  const order: Record<TitleLanguageVariant['lang'], number> = { ja: 0, zh: 1, ko: 2, en: 3, romaji: 4, other: 5 }
  return out.sort((a, b) => order[a.lang] - order[b.lang])
}
