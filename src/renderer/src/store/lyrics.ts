import { create } from 'zustand'
import type { LyricPayload, Track } from '../../../shared/types'
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

interface LyricsState {
  trackId: string | null
  status: Status
  lyrics: Lyrics | null
  payload: LyricPayload | null
  online: boolean
  romanizing: boolean
  saving: boolean
  load: (t: Track, force?: boolean) => Promise<void>
  applyPayload: (t: Track, p: LyricPayload, online: boolean) => Promise<void>
  save: (mode: Exclude<SaveMode, 'off'>, silent?: boolean) => Promise<boolean>
  clear: () => void
}

const cache = new Map<string, Entry>()
let loadToken = 0

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
  const roma = await window.akumy.lyrics.romanize(texts)
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

  clear: () => set({ trackId: null, status: 'idle', lyrics: null, payload: null, online: false }),

  load: async (t, force = false) => {
    const token = ++loadToken
    const cached = !force && cache.get(t.id)
    if (cached) {
      set({ trackId: t.id, status: 'ready', lyrics: cached.lyrics, payload: cached.payload, online: cached.online, romanizing: false })
      return
    }
    set({ trackId: t.id, status: 'loading', lyrics: null, payload: null, online: false, romanizing: false })
    try {
      let payload = force ? null : await window.akumy.lyrics.local(t.id)
      let online = false
      if (!payload && useSettings.getState().autoOnlineLyrics) {
        payload = await window.akumy.lyrics.auto(query(t))
        online = !!payload
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

  save: async (mode, silent = false) => {
    const { trackId, lyrics } = get()
    if (!trackId || !lyrics) return false
    const s = useSettings.getState()
    const lrc = serializeLyrics(lyrics, { roma: s.saveRoma, trans: s.saveTrans })
    set({ saving: true })
    try {
      const res = await window.akumy.lyrics.save({ trackId, lrc, mode })
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
