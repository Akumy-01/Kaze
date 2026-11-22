import { create } from 'zustand'
import type { LyricCandidate, LyricPayload, OnlineLyricSource, Track } from '../../../shared/types'
import { parseLyrics, serializeLyrics, type Lyrics } from '../lib/lrc'
import { useSettings, type SaveMode } from './settings'
import { useLibrary, getTrack } from './library'
import { toast } from './ui'

type Status = 'idle' | 'loading' | 'ready' | 'none' | 'error'

interface Entry {
  payload: LyricPayload
  lyrics: Lyrics
  online: boolean
}

export interface SearchCacheEntry {
  candidates: LyricCandidate[]
  searchedAll: boolean
  searchedSources: OnlineLyricSource[]
  title: string
  artist: string
}

interface LyricsState {
  trackId: string | null
  status: Status
  lyrics: Lyrics | null
  payload: LyricPayload | null
  online: boolean
  romanizing: boolean
  saving: boolean
  searchCacheEntry: SearchCacheEntry | null
  load: (t: Track, force?: boolean) => Promise<void>
  applyPayload: (t: Track, p: LyricPayload, online: boolean) => Promise<void>
  recordSearchResults: (
    trackId: string,
    title: string,
    artist: string,
    source: OnlineLyricSource,
    rows: LyricCandidate[],
    replaceForQuery?: boolean
  ) => void
  translateCurrent: () => Promise<boolean>
  save: (mode: Exclude<SaveMode, 'off'>, silent?: boolean) => Promise<boolean>
  clear: () => void
}

const cache = new Map<string, Entry>()
const searchResultCache = new Map<string, SearchCacheEntry>()
let loadToken = 0

function mergeCandidates(existing: LyricCandidate[], incoming: LyricCandidate[], source: OnlineLyricSource, replaceSource: boolean) {
  const base = replaceSource
    ? source === 'all'
      ? []
      : existing.filter((c) => c.source !== source)
    : existing.slice()
  const map = new Map<string, LyricCandidate>()
  for (const c of base) map.set(c.source + c.id, c)
  for (const c of incoming) map.set(c.source + c.id, c)
  return [...map.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

const query = (t: Track) => ({ title: t.title, artist: t.artist, album: t.album, duration: t.duration })

async function addRomaji(l: Lyrics): Promise<Lyrics> {
  if (!l.japanese || l.hasRoma) return l
  const idx: number[] = []
  const texts: string[] = []
  l.lines.forEach((line, i) => {
    if (line.text && !line.interlude) {
      idx.push(i)
      texts.push(line.text)
    }
  })
  const roma = await window.kaze.lyrics.romanize(texts)
  const lines = l.lines.map((x) => ({ ...x }))
  idx.forEach((i, k) => {
    if (roma[k] && roma[k].toLowerCase() !== lines[i].text.toLowerCase()) lines[i].roma = roma[k]
  })
  return { ...l, lines, hasRoma: lines.some((x) => !!x.roma) }
}

export const useLyrics = create<LyricsState>((set, get) => ({
  trackId: null,
  status: 'idle',
  lyrics: null,
  payload: null,
  online: false,
  romanizing: false,
  saving: false,
  searchCacheEntry: null,

  clear: () => set({ trackId: null, status: 'idle', lyrics: null, payload: null, online: false, searchCacheEntry: null }),

  recordSearchResults: (trackId, title, artist, source, rows, replaceForQuery = false) => {
    const prev = searchResultCache.get(trackId)
    const queryChanged = !!prev && (prev.title !== title || prev.artist !== artist)
    const shouldReplace = replaceForQuery || queryChanged
    const nextCandidates = mergeCandidates(
      queryChanged ? [] : prev?.candidates ?? [],
      rows,
      source,
      shouldReplace
    )
    const nextSources = queryChanged
      ? [source]
      : Array.from(new Set([...(prev?.searchedSources ?? []), source]))
    const nextEntry: SearchCacheEntry = {
      candidates: nextCandidates,
      searchedAll: source === 'all' || (!!prev?.searchedAll && !queryChanged),
      searchedSources: nextSources,
      title,
      artist
    }
    searchResultCache.set(trackId, nextEntry)
    if (get().trackId === trackId) set({ searchCacheEntry: nextEntry })
  },

  load: async (t, force = false) => {
    const token = ++loadToken
    const existingSearch = searchResultCache.get(t.id) ?? null
    const cached = !force && cache.get(t.id)
    if (cached) {
      set({
        trackId: t.id,
        status: 'ready',
        lyrics: cached.lyrics,
        payload: cached.payload,
        online: cached.online,
        romanizing: false,
        searchCacheEntry: existingSearch
      })
      return
    }
    set({
      trackId: t.id,
      status: 'loading',
      lyrics: null,
      payload: null,
      online: false,
      romanizing: false,
      searchCacheEntry: existingSearch
    })
    try {
      let payload = force ? null : await window.kaze.lyrics.local(t.id)
      let online = false
      const settings = useSettings.getState()
      const cleanArtist = /未知/.test(t.artist) ? '' : t.artist
      if (!payload && settings.autoOnlineLyrics) {
        payload = await window.kaze.lyrics.auto(query(t))
        online = !!payload
        if (payload?.candidates?.length) {
          get().recordSearchResults(t.id, t.title, cleanArtist, 'all', payload.candidates, true)
        } else if (!payload && token === loadToken) {
          // If auto-match couldn't pick a synced track, still surface all candidate matches cleanly
          const fallbackList = await window.kaze.lyrics.search({ ...query(t), source: 'all' })
          if (token === loadToken && fallbackList.length) {
            get().recordSearchResults(t.id, t.title, cleanArtist, 'all', fallbackList, true)
          }
        }
      } else if (payload && !payload.tlrc && settings.autoOnlineLyrics && settings.showTrans) {
        const localParsed = parseLyrics(payload.lrc, payload.tlrc, payload.rlrc)
        const rawText = (localParsed?.lines.map((l) => l.text).join('') ?? '')
        const isForeign =
          /[\u3040-\u30ff\uac00-\ud7af]/.test(rawText) ||
          (rawText.match(/[a-zA-Z]/g)?.length ?? 0) > (rawText.match(/[\u4e00-\u9fff]/g)?.length ?? 0) * 2
        if (localParsed && !localParsed.hasTrans && isForeign) {
          const netPayload = await window.kaze.lyrics.auto(query(t))
          if (token !== loadToken) return
          if (netPayload?.candidates?.length) {
            get().recordSearchResults(t.id, t.title, cleanArtist, 'all', netPayload.candidates, true)
          }
          if (netPayload?.tlrc) {
            const merged = parseLyrics(payload.lrc, netPayload.tlrc, payload.rlrc || netPayload.rlrc)
            const matchedCount = merged?.lines.filter((l) => !!l.trans).length ?? 0
            if (merged && localParsed.synced && matchedCount >= Math.max(2, localParsed.lines.length * 0.25)) {
              payload = { ...payload, tlrc: netPayload.tlrc, rlrc: payload.rlrc || netPayload.rlrc }
            } else {
              payload = netPayload
              online = true
            }
          }
        }
      }
      if (token !== loadToken) return
      if (!payload) {
        set({ status: 'none' })
        return
      }
      await get().applyPayload(t, payload, online)
      if (token !== loadToken) return
      const mode = useSettings.getState().autoSaveLyrics
      if (online && mode !== 'off') await get().save(mode, true)
    } catch (e) {
      console.warn(e)
      if (token === loadToken) set({ status: 'error' })
    }
  },

  applyPayload: async (t, payload, online) => {
    const parsed = parseLyrics(payload.lrc, payload.tlrc, payload.rlrc)
    if (!parsed) {
      if (get().trackId === t.id) set({ status: 'none' })
      return
    }
    const entry: Entry = { payload, lyrics: parsed, online }
    cache.set(t.id, entry)
    if (get().trackId === t.id) set({ status: 'ready', lyrics: parsed, payload, online })
    if (parsed.japanese && !parsed.hasRoma) {
      if (get().trackId === t.id) set({ romanizing: true })
      try {
        const withRoma = await addRomaji(parsed)
        entry.lyrics = withRoma
        if (get().trackId === t.id) set({ lyrics: withRoma })
      } catch (e) {
        console.warn('romanize failed', e)
      } finally {
        if (get().trackId === t.id) set({ romanizing: false })
      }
    }
  },

  translateCurrent: async () => {
    const { trackId, payload, online, lyrics } = get()
    if (!trackId || !payload?.lrc) return false
    const tlrc = await window.kaze.lyrics.translate(payload.lrc)
    if (!tlrc) {
      toast('暂未能获取中文翻译，请稍后重试', 'error')
      return false
    }
    const nextPayload: LyricPayload = { ...payload, tlrc }
    const parsed = parseLyrics(nextPayload.lrc, nextPayload.tlrc, nextPayload.rlrc)
    if (!parsed) return false
    const finalLyrics = lyrics?.hasRoma && !parsed.hasRoma ? await addRomaji(parsed) : parsed
    cache.set(trackId, { payload: nextPayload, lyrics: finalLyrics, online })
    if (get().trackId === trackId) set({ lyrics: finalLyrics, payload: nextPayload })
    useSettings.getState().set({ showTrans: true })
    toast('已生成逐行中文翻译', 'success')
    return true
  },

  save: async (mode, silent = false) => {
    const { trackId, lyrics } = get()
    if (!trackId || !lyrics) return false
    const s = useSettings.getState()
    const lrc = serializeLyrics(lyrics, { roma: s.saveRoma, trans: s.saveTrans })
    set({ saving: true })
    try {
      const res = await window.kaze.lyrics.save({ trackId, lrc, mode })
      if (!res.ok) {
        toast(`保存歌词失败：${res.error ?? '未知错误'}`, 'error')
        return false
      }
      if (res.track) useLibrary.getState().updateTrack(res.track)
      const entry = cache.get(trackId)
      if (entry) entry.online = false
      if (get().trackId === trackId) set({ online: false })
      const t = getTrack(trackId)
      if (!silent || true) {
        const what = mode === 'embed' ? '已嵌入到音乐文件' : mode === 'sidecar' ? '已保存为 .lrc 文件' : '已嵌入并保存 .lrc'
        toast(`「${t?.title ?? ''}」歌词${what}`, 'success')
      }
      return true
    } finally {
      set({ saving: false })
    }
  }
}))

export function invalidateLyrics(id: string) {
  cache.delete(id)
}

export function getCachedLyricSample(id: string): string | undefined {
  const entry = cache.get(id)
  if (!entry) return undefined
  return entry.lyrics.lines
    .filter((l) => l.text && !l.interlude)
    .slice(0, 10)
    .map((l) => l.text)
    .join(' ')
}
