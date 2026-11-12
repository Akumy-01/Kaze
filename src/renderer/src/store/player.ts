import { create } from 'zustand'
import { engine } from '../lib/audio'
import { mediaUrl, coverUrl, shuffleArray } from '../lib/format'
import { coverDataUrl } from '../lib/color'
import { getTrack, useLibrary } from './library'
import { useSettings } from './settings'
import { useUser } from './user'
import { toast } from './ui'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: string[]
  baseQueue: string[]
  index: number
  currentId: string | null
  playing: boolean
  buffering: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  playTracks: (ids: string[], start?: number, opts?: { shuffle?: boolean }) => void
  playNext: (ids: string[]) => void
  addToQueue: (ids: string[]) => void
  jumpTo: (index: number) => void
  removeAt: (index: number) => void
  moveInQueue: (from: number, to: number) => void
  clearQueue: () => void
  toggle: () => void
  play: () => void
  pause: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
}

const PERSIST_KEY = 'akumy-player'

interface Persisted {
  queue: string[]
  baseQueue: string[]
  index: number
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  time: number
}

function loadPersisted(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}')
  } catch {
    return {}
  }
}

const saved = loadPersisted()

export const usePlayer = create<PlayerState>((set, get) => {
  const loadIndex = (index: number, autoplay: boolean, startAt = 0) => {
    const { queue } = get()
    const id = queue[index]
    const t = getTrack(id)
    if (!t) {
      set({ currentId: null, playing: false, index: -1 })
      return
    }
    set({ index, currentId: id, currentTime: startAt, duration: t.duration, buffering: true })
    engine.load(mediaUrl(t.path))
    if (startAt > 0) {
      const onMeta = () => {
        engine.audio.currentTime = startAt
        engine.audio.removeEventListener('loadedmetadata', onMeta)
      }
      engine.audio.addEventListener('loadedmetadata', onMeta)
    }
    if (autoplay) {
      engine.play(false).catch(() => {})
      useUser.getState().markPlayed(id)
    }
    updateMediaSession()
  }

  return {
    queue: saved.queue ?? [],
    baseQueue: saved.baseQueue ?? saved.queue ?? [],
    index: saved.index ?? -1,
    currentId: null,
    playing: false,
    buffering: false,
    currentTime: 0,
    duration: 0,
    volume: saved.volume ?? 0.8,
    muted: false,
    shuffle: saved.shuffle ?? false,
    repeat: saved.repeat ?? 'off',

    playTracks: (ids, start = 0, opts) => {
      if (!ids.length) return
      const shuffle = opts?.shuffle ?? get().shuffle
      let queue = ids.slice()
      let index = Math.max(0, Math.min(start, ids.length - 1))
      if (shuffle) {
        const startId = opts?.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[index]
        queue = [startId, ...shuffleArray(ids.filter((x) => x !== startId))]
        index = 0
      }
      set({ queue, baseQueue: ids.slice(), shuffle })
      loadIndex(index, true)
    },
    playNext: (ids) => {
      const { queue, index, baseQueue } = get()
      if (index < 0 || !queue.length) return get().playTracks(ids)
      const q = queue.slice()
      q.splice(index + 1, 0, ...ids)
      set({ queue: q, baseQueue: [...baseQueue, ...ids.filter((x) => !baseQueue.includes(x))] })
      toast(ids.length > 1 ? `已将 ${ids.length} 首歌曲设为下一首播放` : '将在下一首播放')
    },
    addToQueue: (ids) => {
      const { queue, index } = get()
      if (index < 0 || !queue.length) return get().playTracks(ids)
      set({ queue: [...queue, ...ids], baseQueue: [...get().baseQueue, ...ids] })
      toast(`已添加 ${ids.length} 首歌曲到播放队列`)
    },
    jumpTo: (index) => loadIndex(index, true),
    removeAt: (i) => {
      const { queue, index } = get()
      if (i === index) return
      const q = queue.slice()
      q.splice(i, 1)
      set({ queue: q, index: i < index ? index - 1 : index })
    },
    moveInQueue: (from, to) => {
      const { queue, index } = get()
      const q = queue.slice()
      const [x] = q.splice(from, 1)
      q.splice(to, 0, x)
      let ni = index
      if (from === index) ni = to
      else if (from < index && to >= index) ni = index - 1
      else if (from > index && to <= index) ni = index + 1
      set({ queue: q, index: ni })
    },
    clearQueue: () => {
      const { currentId } = get()
      set({ queue: currentId ? [currentId] : [], baseQueue: currentId ? [currentId] : [], index: currentId ? 0 : -1 })
    },
    toggle: () => (get().playing ? get().pause() : get().play()),
    play: () => {
      const { currentId, queue, index } = get()
      if (!currentId) {
        if (queue.length) loadIndex(Math.max(0, index), true)
        else {
          const all = useLibrary.getState().tracks.map((t) => t.id)
          if (all.length) get().playTracks(all, 0, { shuffle: true })
        }
        return
      }
      engine.play(useSettings.getState().fadeOnPause).catch((e) => console.warn(e))
    },
    pause: () => {
      engine.pause(useSettings.getState().fadeOnPause)
    },
    next: (auto = false) => {
      const { queue, index, repeat } = get()
      if (!queue.length) return
      if (auto && repeat === 'one') {
        engine.audio.currentTime = 0
        engine.play(false)
        return
      }
      let ni = index + 1
      if (ni >= queue.length) {
        if (repeat === 'all' || !auto) ni = 0
        else {
          set({ playing: false })
          engine.audio.currentTime = 0
          return
        }
      }
      loadIndex(ni, true)
    },
    prev: () => {
      const { queue, index } = get()
      if (!queue.length) return
      if (engine.audio.currentTime > 3) {
        engine.audio.currentTime = 0
        return
      }
      loadIndex(index - 1 < 0 ? queue.length - 1 : index - 1, true)
    },
    seek: (t) => {
      if (!get().currentId) return
      const d = engine.audio.duration || get().duration
      engine.audio.currentTime = Math.max(0, Math.min(t, d - 0.1))
      set({ currentTime: engine.audio.currentTime })
    },
    setVolume: (v) => {
      v = Math.max(0, Math.min(1, v))
      engine.setVolume(v)
      set({ volume: v, muted: false })
      engine.audio.muted = false
    },
    toggleMute: () => {
      const m = !get().muted
      engine.audio.muted = m
      set({ muted: m })
    },
    toggleShuffle: () => {
      const { shuffle, queue, index, baseQueue, currentId } = get()
      if (!shuffle) {
        const rest = queue.filter((_, i) => i !== index)
        const q = currentId ? [currentId, ...shuffleArray(rest)] : shuffleArray(queue)
        set({ shuffle: true, queue: q, index: currentId ? 0 : -1, baseQueue: baseQueue.length ? baseQueue : queue })
      } else {
        const base = baseQueue.length ? baseQueue : queue
        const ni = currentId ? base.indexOf(currentId) : -1
        set({ shuffle: false, queue: base, index: ni })
      }
    },
    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one']
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] })
    }
  }
})

/* ---------------- Media session (SMTC) ---------------- */
let msToken = 0
async function updateMediaSession() {
  const t = getTrack(usePlayer.getState().currentId)
  if (!t || !('mediaSession' in navigator)) return
  const token = ++msToken
  window.akumy.win.setTitle(`${t.title} - ${t.artist} · Akumy Music`)
  const art = await coverDataUrl(coverUrl(t))
  if (token !== msToken) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: art ? [{ src: art, sizes: '256x256', type: 'image/jpeg' }] : []
  })
}

/* ---------------- wiring ---------------- */
let wired = false
export function initPlayer() {
  if (wired) return
  wired = true
  const a = engine.audio
  const s = usePlayer.getState
  engine.setVolume(s().volume)

  let lastSave = 0
  const persist = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSave < 3000) return
    lastSave = now
    const st = s()
    const data: Persisted = {
      queue: st.queue,
      baseQueue: st.baseQueue,
      index: st.index,
      volume: st.volume,
      shuffle: st.shuffle,
      repeat: st.repeat,
      time: a.currentTime || 0
    }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data))
  }
  usePlayer.subscribe((st, prev) => {
    if (st.queue !== prev.queue || st.index !== prev.index || st.volume !== prev.volume || st.shuffle !== prev.shuffle || st.repeat !== prev.repeat)
      persist(true)
  })
  window.addEventListener('beforeunload', () => persist(true))

  a.addEventListener('play', () => usePlayer.setState({ playing: true }))
  a.addEventListener('playing', () => usePlayer.setState({ playing: true, buffering: false }))
  a.addEventListener('pause', () => usePlayer.setState({ playing: false }))
  a.addEventListener('waiting', () => usePlayer.setState({ buffering: true }))
  a.addEventListener('canplay', () => usePlayer.setState({ buffering: false }))
  a.addEventListener('durationchange', () => {
    if (isFinite(a.duration)) usePlayer.setState({ duration: a.duration })
  })
  a.addEventListener('timeupdate', () => {
    usePlayer.setState({ currentTime: a.currentTime })
    const d = a.duration
    if (d && isFinite(d)) window.akumy.win.setProgress(a.currentTime / d)
    persist()
  })
  a.addEventListener('ended', () => s().next(true))
  let errorStreak = 0
  a.addEventListener('error', () => {
    if (!s().currentId) return
    const t = getTrack(s().currentId)
    toast(`无法播放「${t?.title ?? '未知'}」，已跳过`, 'error')
    errorStreak++
    if (errorStreak < 5 && s().queue.length > 1) setTimeout(() => s().next(false), 600)
  })
  a.addEventListener('playing', () => (errorStreak = 0))

  const ms = navigator.mediaSession
  if (ms) {
    ms.setActionHandler('play', () => s().play())
    ms.setActionHandler('pause', () => s().pause())
    ms.setActionHandler('previoustrack', () => s().prev())
    ms.setActionHandler('nexttrack', () => s().next())
    ms.setActionHandler('seekto', (d) => d.seekTime != null && s().seek(d.seekTime))
    ms.setActionHandler('stop', () => s().pause())
  }
}

/** Restore last session (without autoplay) once library has loaded. */
export function restoreSession() {
  const st = usePlayer.getState()
  const byId = useLibrary.getState().byId
  const queue = st.queue.filter((id) => byId.has(id))
  const baseQueue = st.baseQueue.filter((id) => byId.has(id))
  if (!queue.length) {
    usePlayer.setState({ queue: [], baseQueue: [], index: -1 })
    return
  }
  const oldId = st.queue[st.index]
  let index = queue.indexOf(oldId)
  const time = index >= 0 ? saved.time ?? 0 : 0
  if (index < 0) index = 0
  usePlayer.setState({ queue, baseQueue })
  const id = queue[index]
  const t = getTrack(id)!
  usePlayer.setState({ index, currentId: id, duration: t.duration, currentTime: time })
  engine.load(mediaUrl(t.path))
  if (time > 0) {
    const onMeta = () => {
      engine.audio.currentTime = time
      engine.audio.removeEventListener('loadedmetadata', onMeta)
    }
    engine.audio.addEventListener('loadedmetadata', onMeta)
  }
  updateMediaSession()
}

export const currentTrack = () => getTrack(usePlayer.getState().currentId)
