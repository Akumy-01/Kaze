import { create } from 'zustand'
import { engine } from '../lib/audio'
import { mediaUrl, coverUrl, shuffleArray } from '../lib/format'
import { coverDataUrl } from '../lib/color'
import { computeReplayGain } from '../lib/replaygain'
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
  abLoop: { a: number | null; b: number | null }
  sleepTimerEnd: number | null
  sleepAfterTrack: boolean
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
  toggleAbLoop: () => void
  clearAbLoop: () => void
  setSleepTimer: (mode: number | 'track-end' | null) => void
}

const PERSIST_KEY = 'kaze-player'

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

function syncEngineDspAndPreload() {
  const p = usePlayer.getState()
  const s = useSettings.getState()
  const curTrack = p.currentId ? getTrack(p.currentId) : undefined
  const curRg = computeReplayGain(curTrack, s, p.shuffle)

  engine.configureDsp({
    preset: s.audioPreset,
    gapless: s.gapless,
    crossfadeSec: s.crossfadeSec,
    peq: s.getPeqProfile(),
    activeRgLinear: curRg.linear
  })

  // Determine the next track to preload into the inactive deck
  if (!p.queue.length || p.index < 0 || p.sleepAfterTrack || (p.abLoop.a !== null && p.abLoop.b !== null)) {
    engine.preloadNext(null, null, 1)
    return
  }
  let nextIdx = -1
  if (p.repeat === 'one') {
    nextIdx = p.index
  } else if (p.index + 1 < p.queue.length) {
    nextIdx = p.index + 1
  } else if (p.repeat === 'all') {
    nextIdx = 0
  }
  if (nextIdx < 0) {
    engine.preloadNext(null, null, 1)
    return
  }
  const nextId = p.queue[nextIdx]
  const nextTrack = getTrack(nextId)
  if (!nextTrack) {
    engine.preloadNext(null, null, 1)
    return
  }
  const nextRg = computeReplayGain(nextTrack, s, p.shuffle)
  engine.preloadNext(mediaUrl(nextTrack.path), nextTrack.id, nextRg.linear)
}

export const usePlayer = create<PlayerState>((set, get) => {
  const loadIndex = (index: number, autoplay: boolean, startAt = 0) => {
    const { queue, shuffle } = get()
    const id = queue[index]
    const t = getTrack(id)
    if (!t) {
      set({ currentId: null, playing: false, index: -1 })
      engine.preloadNext(null, null, 1)
      return
    }
    const s = useSettings.getState()
    const rg = computeReplayGain(t, s, shuffle)
    set({
      index,
      currentId: id,
      currentTime: startAt,
      duration: t.duration,
      buffering: true,
      abLoop: { a: null, b: null }
    })
    engine.load(mediaUrl(t.path), t.id, rg.linear)
    if (startAt > 0) {
      const a = engine.audio
      const onMeta = () => {
        a.currentTime = startAt
        a.removeEventListener('loadedmetadata', onMeta)
      }
      a.addEventListener('loadedmetadata', onMeta)
    }
    if (autoplay) {
      engine.play(false).catch(() => {})
      useUser.getState().markPlayed(id)
    }
    syncEngineDspAndPreload()
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
    abLoop: { a: null, b: null },
    sleepTimerEnd: null,
    sleepAfterTrack: false,

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
      syncEngineDspAndPreload()
      toast(ids.length > 1 ? `已将 ${ids.length} 首歌曲设为下一首播放` : '将在下一首播放')
    },
    addToQueue: (ids) => {
      const { queue, index } = get()
      if (index < 0 || !queue.length) return get().playTracks(ids)
      set({ queue: [...queue, ...ids], baseQueue: [...get().baseQueue, ...ids] })
      syncEngineDspAndPreload()
      toast(`已添加 ${ids.length} 首歌曲到播放队列`)
    },
    jumpTo: (index) => loadIndex(index, true),
    removeAt: (i) => {
      const { queue, index } = get()
      if (i === index) return
      const q = queue.slice()
      q.splice(i, 1)
      set({ queue: q, index: i < index ? index - 1 : index })
      syncEngineDspAndPreload()
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
      syncEngineDspAndPreload()
    },
    clearQueue: () => {
      const { currentId } = get()
      set({ queue: currentId ? [currentId] : [], baseQueue: currentId ? [currentId] : [], index: currentId ? 0 : -1 })
      syncEngineDspAndPreload()
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
        engine.seek(0)
        engine.play(false)
        return
      }
      let ni = index + 1
      if (ni >= queue.length) {
        if (repeat === 'all' || !auto) ni = 0
        else {
          set({ playing: false })
          engine.seek(0)
          return
        }
      }
      loadIndex(ni, true)
    },
    prev: () => {
      const { queue, index } = get()
      if (!queue.length) return
      if (engine.currentTime > 3) {
        engine.seek(0)
        return
      }
      loadIndex(index - 1 < 0 ? queue.length - 1 : index - 1, true)
    },
    seek: (t) => {
      if (!get().currentId) return
      const d = engine.duration || get().duration
      const next = Math.max(0, Math.min(t, d - 0.1))
      engine.seek(next)
      set({ currentTime: next })
    },
    setVolume: (v) => {
      v = Math.max(0, Math.min(1, v))
      engine.setVolume(v)
      set({ volume: v, muted: false })
      engine.audio.muted = false
    },
    toggleMute: () => {
      const m = !get().muted
      engine.setVolume(m ? 0 : get().volume)
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
      syncEngineDspAndPreload()
    },
    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one']
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] })
      syncEngineDspAndPreload()
    },
    toggleAbLoop: () => {
      const { currentId, abLoop } = get()
      if (!currentId) return
      const curT = engine.currentTime || get().currentTime
      if (abLoop.a === null) {
        set({ abLoop: { a: curT, b: null } })
        toast('已设定 A 点，再次点击设定 B 点开启区间循环')
      } else if (abLoop.b === null) {
        let a = abLoop.a
        let b = curT
        if (Math.abs(b - a) < 0.4) {
          toast('B 点需与 A 点间隔至少 0.5 秒', 'error')
          return
        }
        if (b < a) [a, b] = [b, a]
        set({ abLoop: { a, b } })
        engine.seek(a)
        syncEngineDspAndPreload()
        toast('已开启 A-B 区间循环', 'success')
      } else {
        set({ abLoop: { a: null, b: null } })
        syncEngineDspAndPreload()
        toast('已关闭 A-B 区间循环')
      }
    },
    clearAbLoop: () => {
      set({ abLoop: { a: null, b: null } })
      syncEngineDspAndPreload()
    },
    setSleepTimer: (mode) => {
      if (mode === null) {
        set({ sleepTimerEnd: null, sleepAfterTrack: false })
        syncEngineDspAndPreload()
        toast('已取消定时睡眠关闭')
      } else if (mode === 'track-end') {
        set({ sleepTimerEnd: null, sleepAfterTrack: true })
        syncEngineDspAndPreload()
        toast('将在本首歌曲播完后自动暂停', 'success')
      } else {
        set({ sleepTimerEnd: Date.now() + mode * 60_000, sleepAfterTrack: false })
        syncEngineDspAndPreload()
        toast(`已设置 ${mode} 分钟后定时睡眠暂停`, 'success')
      }
    }
  }
})

/* ---------------- Media session (SMTC) ---------------- */
let msToken = 0
async function updateMediaSession() {
  const t = getTrack(usePlayer.getState().currentId)
  if (!t || !('mediaSession' in navigator)) return
  const token = ++msToken
  window.kaze.win.setTitle(`${t.title} - ${t.artist} · Kaze`)
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
  const s = usePlayer.getState
  const initSettings = useSettings.getState()
  engine.setVolume(s().volume)
  void engine.setOutputDevice(initSettings.outputDeviceId, initSettings.outputDeviceLabel)
  syncEngineDspAndPreload()

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
      time: engine.currentTime || 0
    }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(data))
  }

  usePlayer.subscribe((st, prev) => {
    if (st.queue !== prev.queue || st.index !== prev.index || st.volume !== prev.volume || st.shuffle !== prev.shuffle || st.repeat !== prev.repeat)
      persist(true)
  })
  window.addEventListener('beforeunload', () => persist(true))

  // Reactively sync DSP & output device whenever audio settings or library ReplayGain tags update
  useSettings.subscribe((st, prev) => {
    if (st.outputDeviceId !== prev.outputDeviceId) {
      void engine.setOutputDevice(st.outputDeviceId, st.outputDeviceLabel)
    }
    if (
      st.audioPreset !== prev.audioPreset ||
      st.gapless !== prev.gapless ||
      st.crossfadeSec !== prev.crossfadeSec ||
      st.replayGainMode !== prev.replayGainMode ||
      st.replayGainPreampDb !== prev.replayGainPreampDb ||
      st.replayGainAntiClip !== prev.replayGainAntiClip ||
      st.peqByDevice !== prev.peqByDevice ||
      st.outputDeviceId !== prev.outputDeviceId
    ) {
      syncEngineDspAndPreload()
    }
  })

  useLibrary.subscribe((st, prev) => {
    if (st.tracks !== prev.tracks) {
      syncEngineDspAndPreload()
    }
  })

  let errorStreak = 0
let lastErrorTrackId: string | null = null
let lastErrorAt = 0
let trackedId: string | null = null
let lastTrackedAudioSec = 0
let bufferedListenSec = 0

function flushListenTime() {
  if (trackedId && bufferedListenSec >= 0.3) {
    useUser.getState().addListenTime(trackedId, bufferedListenSec)
  }
  bufferedListenSec = 0
}
  engine.setEvents({
    onPlay: () => {
      trackedId = s().currentId
      lastTrackedAudioSec = engine.currentTime
      usePlayer.setState({ playing: true })
    },
    onPlaying: () => {
      errorStreak = 0
      trackedId = s().currentId
      lastTrackedAudioSec = engine.currentTime
      usePlayer.setState({ playing: true, buffering: false })
    },
    onPause: () => {
      flushListenTime()
      usePlayer.setState({ playing: false })
    },
    onWaiting: () => usePlayer.setState({ buffering: true }),
    onCanPlay: () => usePlayer.setState({ buffering: false }),
    onDurationChange: (duration) => usePlayer.setState({ duration }),
    onTimeUpdate: (currentTime, duration) => {
      const st = s()
      const { a, b } = st.abLoop
      if (a !== null && b !== null && b > a && currentTime >= b) {
        engine.seek(a)
        usePlayer.setState({ currentTime: a })
        return
      }
      usePlayer.setState({ currentTime })
      const curId = st.currentId
      if (curId && st.playing && !engine.paused) {
        if (trackedId !== curId) {
          flushListenTime()
          trackedId = curId
          lastTrackedAudioSec = currentTime
        } else {
          const dt = currentTime - lastTrackedAudioSec
          if (dt > 0 && dt <= 2.5) {
            bufferedListenSec += dt
            if (bufferedListenSec >= 2) flushListenTime()
          }
          lastTrackedAudioSec = currentTime
        }
      }
      if (duration > 0) window.kaze.win.setProgress(currentTime / duration)
      persist()
    },
    onEnded: () => {
      flushListenTime()
      if (s().sleepAfterTrack) {
        usePlayer.setState({ sleepAfterTrack: false, playing: false })
        engine.seek(0)
        syncEngineDspAndPreload()
        toast('本首曲目已播完，定时睡眠已暂停')
        return
      }
      s().next(true)
    },
    onSeamlessAdvance: (nextTrackId) => {
      flushListenTime()
      trackedId = nextTrackId
      lastTrackedAudioSec = 0
      const st = s()
      let nextIdx = st.index
      if (st.repeat !== 'one') {
        if (st.index + 1 < st.queue.length && st.queue[st.index + 1] === nextTrackId) {
          nextIdx = st.index + 1
        } else {
          const found = st.queue.indexOf(nextTrackId)
          if (found >= 0) nextIdx = found
        }
      }
      const nextTrack = getTrack(nextTrackId)
      usePlayer.setState({
        index: nextIdx,
        currentId: nextTrackId,
        currentTime: 0,
        duration: nextTrack?.duration ?? engine.duration ?? 0,
        playing: true,
        buffering: false
      })
      useUser.getState().markPlayed(nextTrackId)
      syncEngineDspAndPreload()
      updateMediaSession()
    },
    onError: (detail) => {
      const curId = detail?.trackId ?? s().currentId
      if (!curId) return
      const t = getTrack(curId)
      window.kaze.logPlayerError({
        title: t?.title,
        path: t?.path,
        code: detail?.code,
        message: detail?.message
      })
      const now = Date.now()
      const duplicate = curId === lastErrorTrackId && now - lastErrorAt < 1200
      lastErrorTrackId = curId
      lastErrorAt = now
      if (!duplicate) {
        toast(`无法播放「${t?.title ?? '未知'}」，已跳过`, 'error')
      }
      errorStreak++
      if (!duplicate && errorStreak < 5 && s().queue.length > 1) setTimeout(() => s().next(false), 600)
    },
    onDeviceFallback: (reason, label) => {
      if (reason === 'disconnected') {
        toast(`输出设备「${label}」已断开，已自动切换至系统默认设备`, 'info')
      } else {
        toast(`输出设备「${label}」已重新连接，已恢复绑定输出`, 'success')
      }
    }
  })

  const ms = navigator.mediaSession
  if (ms) {
    ms.setActionHandler('play', () => s().play())
    ms.setActionHandler('pause', () => s().pause())
    ms.setActionHandler('previoustrack', () => s().prev())
    ms.setActionHandler('nexttrack', () => s().next())
    ms.setActionHandler('seekto', (d) => d.seekTime != null && s().seek(d.seekTime))
    ms.setActionHandler('stop', () => s().pause())
  }

  // Sleep Timer countdown checker (fades out softly via engine.pause(true) when expired)
  setInterval(() => {
    const { sleepTimerEnd, playing } = s()
    if (!sleepTimerEnd) return
    if (Date.now() >= sleepTimerEnd) {
      usePlayer.setState({ sleepTimerEnd: null })
      if (playing) {
        engine.pause(true)
        toast('定时睡眠时间到，已为您柔和暂停播放')
      }
    }
  }, 1000)
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
  const rg = computeReplayGain(t, useSettings.getState(), st.shuffle)
  usePlayer.setState({ index, currentId: id, duration: t.duration, currentTime: time })
  engine.load(mediaUrl(t.path), t.id, rg.linear)
  if (time > 0) {
    const a = engine.audio
    const onMeta = () => {
      a.currentTime = time
      a.removeEventListener('loadedmetadata', onMeta)
    }
    a.addEventListener('loadedmetadata', onMeta)
  }
  syncEngineDspAndPreload()
  updateMediaSession()
}

export const currentTrack = () => getTrack(usePlayer.getState().currentId)
