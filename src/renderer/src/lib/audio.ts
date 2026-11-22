import { DEFAULT_PEQ_FREQS, type AudioPreset, type PeqProfile } from '../store/settings'
import { computePeqResponse } from './replaygain'

interface Deck {
  el: HTMLAudioElement
  src: MediaElementAudioSourceNode | null
  deckGain: GainNode | null
  rgGain: GainNode | null
  trackId: string | null
  url: string
  rgLinear: number
  buffer: AudioBuffer | null
  bufSource: AudioBufferSourceNode | null
  bufOffset: number
  bufStartedAt: number
  bufPlaying: boolean
  bufRecoveryTried: boolean
  bufSerial: number
}

export interface AudioOutputDevice {
  deviceId: string
  label: string
}

export interface AudioEngineEvents {
  onPlay?: () => void
  onPlaying?: () => void
  onPause?: () => void
  onWaiting?: () => void
  onCanPlay?: () => void
  onDurationChange?: (duration: number) => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  onError?: (detail?: { code?: number; message?: string; trackId?: string | null }) => void
  /** Fired when Gapless or Crossfade seamlessly switches to the preloaded next deck */
  onSeamlessAdvance?: (nextTrackId: string) => void
  /** Fired when output device hot-plug state changes */
  onDeviceFallback?: (reason: 'disconnected' | 'reconnected', deviceLabel: string) => void
}

/**
 * Dual-Deck Web Audio Engine:
 * - Deck A & Deck B for true gapless pre-decoding and optional crossfade transitions
 * - Configurable DSP path:
 *   [Direct Mode]: Deck -> deckGain(1.0) -> rgGain(1.0) -> busIn -> masterGain -> analyser -> destination (PEQ physically bypassed)
 *   [DSP Mode]:    Deck -> deckGain -> rgGain -> busIn -> preampGain -> 10x BiquadFilterNode -> masterGain -> analyser -> destination
 * - Output device routing via setSinkId + hot-plug recovery
 */
class AudioEngine {
  private decks: [Deck, Deck]
  private activeIdx: 0 | 1 = 0
  private ctx: AudioContext | null = null
  private busIn: GainNode | null = null
  private preampGain: GainNode | null = null
  private filters: BiquadFilterNode[] = []
  private masterGain: GainNode | null = null
  analyser: AnalyserNode | null = null

  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private wave: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private fadeToken = 0
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private bufTimer: ReturnType<typeof setInterval> | null = null
  private transitioning = false
  private events: AudioEngineEvents = {}

  private preset: AudioPreset = 'daily'
  private peqProfile: PeqProfile | null = null
  private peqWired = false
  private userVolume = 0.8
  private gaplessEnabled = true
  private crossfadeSec = 0
  private preferredDeviceId = 'default'
  private preferredDeviceLabel = '跟随系统默认设备'
  private usingFallbackDefault = false

  constructor() {
    this.decks = [this.createDeck(0), this.createDeck(1)]
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        void this.handleDeviceChange()
      })
    }
  }

  private createDeck(idx: 0 | 1): Deck {
    const el = new Audio()
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    const deck: Deck = {
      el,
      src: null,
      deckGain: null,
      rgGain: null,
      trackId: null,
      url: '',
      rgLinear: 1,
      buffer: null,
      bufSource: null,
      bufOffset: 0,
      bufStartedAt: 0,
      bufPlaying: false,
      bufRecoveryTried: false,
      bufSerial: 0
    }

    el.addEventListener('play', () => {
      if (this.activeIdx === idx) this.events.onPlay?.()
    })
    el.addEventListener('playing', () => {
      if (this.activeIdx === idx) this.events.onPlaying?.()
    })
    el.addEventListener('pause', () => {
      if (this.activeIdx === idx && !this.transitioning) this.events.onPause?.()
    })
    el.addEventListener('waiting', () => {
      if (this.activeIdx === idx) this.events.onWaiting?.()
    })
    el.addEventListener('canplay', () => {
      if (this.activeIdx === idx) this.events.onCanPlay?.()
    })
    el.addEventListener('durationchange', () => {
      if (this.activeIdx === idx && isFinite(el.duration)) {
        this.events.onDurationChange?.(el.duration)
      }
    })
    el.addEventListener('timeupdate', () => {
      if (this.activeIdx !== idx) return
      const cur = el.currentTime
      const dur = el.duration
      this.events.onTimeUpdate?.(cur, isFinite(dur) ? dur : 0)
      this.checkSeamlessTransition(deck)
    })
    el.addEventListener('ended', () => {
      if (this.activeIdx !== idx) return
      if (this.tryCompleteGaplessOnEnded()) return
      this.events.onEnded?.()
    })
    el.addEventListener('error', () => {
      if (this.activeIdx !== idx || deck.buffer) return
      const errCode = el.error?.code
      const errMsg = el.error?.message
      const resumeAt = isFinite(el.currentTime) && el.currentTime > 0 ? el.currentTime : 0
      if (!deck.bufRecoveryTried && deck.url && (errCode === 3 || errCode === 4)) {
        deck.bufRecoveryTried = true
        void this.tryRecoverWithBuffer(deck, idx, resumeAt, true, errCode, errMsg)
        return
      }
      this.events.onError?.({
        code: errCode,
        message: errMsg,
        trackId: deck.trackId
      })
    })

    return deck
  }

  private stopBufferSource(deck: Deck) {
    deck.bufSerial++
    if (deck.bufSource) {
      try {
        deck.bufSource.onended = null
        deck.bufSource.stop()
        deck.bufSource.disconnect()
      } catch {
        /* already stopped */
      }
      deck.bufSource = null
    }
    deck.bufPlaying = false
  }

  private clearBufferDeck(deck: Deck) {
    this.stopBufferSource(deck)
    deck.buffer = null
    deck.bufOffset = 0
    deck.bufStartedAt = 0
    deck.bufRecoveryTried = false
  }

  private deckTime(deck: Deck): number {
    if (deck.buffer) {
      if (!deck.bufPlaying || !this.ctx) return deck.bufOffset
      return Math.min(deck.buffer.duration, deck.bufOffset + Math.max(0, this.ctx.currentTime - deck.bufStartedAt))
    }
    return deck.el.currentTime
  }

  private deckDuration(deck: Deck): number {
    if (deck.buffer) return deck.buffer.duration
    return isFinite(deck.el.duration) ? deck.el.duration : 0
  }

  private deckPaused(deck: Deck): boolean {
    if (deck.buffer) return !deck.bufPlaying
    return deck.el.paused
  }

  private ensureBufTicker() {
    if (this.bufTimer) return
    this.bufTimer = setInterval(() => {
      const active = this.decks[this.activeIdx]
      if (!active.buffer || !active.bufPlaying) return
      const cur = this.deckTime(active)
      const dur = active.buffer.duration
      this.events.onTimeUpdate?.(cur, dur)
      this.checkSeamlessTransition(active)
    }, 200)
  }

  private startBufferPlayback(deck: Deck, idx: 0 | 1, offsetSec: number) {
    this.ensureGraph()
    if (!this.ctx || !deck.buffer || !deck.deckGain) return
    this.stopBufferSource(deck)
    const clamped = Math.max(0, Math.min(offsetSec, Math.max(0, deck.buffer.duration - 0.01)))
    const src = this.ctx.createBufferSource()
    src.buffer = deck.buffer
    src.connect(deck.deckGain)
    const mySerial = ++deck.bufSerial
    deck.bufSource = src
    deck.bufOffset = clamped
    deck.bufStartedAt = this.ctx.currentTime
    deck.bufPlaying = true
    src.onended = () => {
      if (deck.bufSerial !== mySerial || !deck.bufPlaying) return
      deck.bufPlaying = false
      deck.bufSource = null
      deck.bufOffset = deck.buffer?.duration ?? 0
      if (this.activeIdx === idx) {
        if (this.tryCompleteGaplessOnEnded()) return
        this.events.onEnded?.()
      }
    }
    src.start(0, clamped)
    this.ensureBufTicker()
  }

  private async tryRecoverWithBuffer(
    deck: Deck,
    idx: 0 | 1,
    resumeAt: number,
    autoplay: boolean,
    origCode?: number,
    origMsg?: string
  ) {
    const targetUrl = deck.url
    const targetId = deck.trackId
    this.events.onWaiting?.()
    try {
      this.ensureGraph()
      if (!this.ctx) throw new Error('AudioContext unavailable')
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      const res = await fetch(targetUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const arr = await res.arrayBuffer()
      const decoded = await this.ctx.decodeAudioData(arr)
      if (deck.url !== targetUrl || deck.trackId !== targetId || this.activeIdx !== idx) return
      try {
        deck.el.pause()
        deck.el.removeAttribute('src')
        deck.el.load()
      } catch {
        /* ignore cleanup */
      }
      deck.buffer = decoded
      deck.bufOffset = Math.max(0, Math.min(resumeAt, Math.max(0, decoded.duration - 0.1)))
      this.events.onDurationChange?.(decoded.duration)
      this.events.onCanPlay?.()
      if (autoplay) {
        this.startBufferPlayback(deck, idx, deck.bufOffset)
        this.events.onPlay?.()
        this.events.onPlaying?.()
      }
    } catch {
      if (deck.url === targetUrl && deck.trackId === targetId && this.activeIdx === idx) {
        this.events.onError?.({
          code: origCode,
          message: origMsg,
          trackId: targetId
        })
      }
    }
  }

  get currentTime(): number {
    return this.deckTime(this.decks[this.activeIdx])
  }

  set currentTime(t: number) {
    this.seek(t)
  }

  get duration(): number {
    return this.deckDuration(this.decks[this.activeIdx])
  }

  get paused(): boolean {
    return this.deckPaused(this.decks[this.activeIdx])
  }

  seek(t: number) {
    const active = this.decks[this.activeIdx]
    const dur = this.deckDuration(active)
    const clamped = Math.max(0, dur > 0 ? Math.min(t, Math.max(0, dur - 0.05)) : Math.max(0, t))
    if (active.buffer) {
      const wasPlaying = active.bufPlaying
      this.stopBufferSource(active)
      active.bufOffset = clamped
      if (wasPlaying) this.startBufferPlayback(active, this.activeIdx, clamped)
      this.events.onTimeUpdate?.(clamped, active.buffer.duration)
    } else {
      active.el.currentTime = clamped
    }
  }

  setEvents(events: AudioEngineEvents) {
    this.events = events
  }

  /** Always returns the currently active HTMLAudioElement */
  get audio(): HTMLAudioElement {
    return this.decks[this.activeIdx].el
  }

  private ensureGraph() {
    if (this.ctx) return
    try {
      this.ctx = new AudioContext({ latencyHint: 'playback' })
      this.busIn = this.ctx.createGain()
      this.preampGain = this.ctx.createGain()
      this.masterGain = this.ctx.createGain()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.78

      this.filters = DEFAULT_PEQ_FREQS.map((freq, idx) => {
        const f = this.ctx!.createBiquadFilter()
        f.type = idx === 0 ? 'lowshelf' : idx === DEFAULT_PEQ_FREQS.length - 1 ? 'highshelf' : 'peaking'
        f.frequency.value = freq
        f.Q.value = idx === 0 || idx === DEFAULT_PEQ_FREQS.length - 1 ? 0.71 : 1.41
        f.gain.value = 0
        return f
      })

      // Connect internal filter chain: preampGain -> filters[0] -> ... -> filters[9]
      this.preampGain.connect(this.filters[0])
      for (let i = 0; i < this.filters.length - 1; i++) {
        this.filters[i].connect(this.filters[i + 1])
      }

      for (const d of this.decks) {
        d.src = this.ctx.createMediaElementSource(d.el)
        d.deckGain = this.ctx.createGain()
        d.rgGain = this.ctx.createGain()
        d.rgGain.gain.value = this.preset === 'direct' ? 1 : d.rgLinear
        d.src.connect(d.deckGain)
        d.deckGain.connect(d.rgGain)
        d.rgGain.connect(this.busIn)
      }

      this.masterGain.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)

      this.freq = new Uint8Array(this.analyser.frequencyBinCount)
      this.wave = new Uint8Array(this.analyser.fftSize)

      this.updateMasterVolumeGain(true)
      this.rewireDspBus(true)
      if (this.preferredDeviceId && this.preferredDeviceId !== 'default') {
        void this.applySinkId(this.preferredDeviceId)
      }
    } catch (e) {
      console.warn('AudioContext unavailable', e)
    }
  }

  /**
   * Physically connect or bypass the 10-band PEQ filter chain.
   * When bypassed (or in 'direct' preset), busIn connects straight to masterGain with zero filter phase shift.
   */
  private rewireDspBus(immediate = false) {
    if (!this.ctx || !this.busIn || !this.preampGain || !this.masterGain || !this.filters.length) return
    const shouldUsePeq = this.preset !== 'direct' && !!this.peqProfile?.enabled

    if (shouldUsePeq !== this.peqWired || immediate) {
      try {
        this.busIn.disconnect()
      } catch {
        /* ignore */
      }
      try {
        this.filters[this.filters.length - 1].disconnect()
      } catch {
        /* ignore */
      }

      if (shouldUsePeq) {
        this.busIn.connect(this.preampGain)
        this.filters[this.filters.length - 1].connect(this.masterGain)
        this.peqWired = true
      } else {
        this.busIn.connect(this.masterGain)
        this.peqWired = false
      }
    }

    if (shouldUsePeq && this.peqProfile) {
      this.applyPeqParameters(this.peqProfile, immediate)
    }
  }

  private applyPeqParameters(profile: PeqProfile, immediate = false) {
    if (!this.ctx || !this.preampGain || !this.filters.length) return
    const now = this.ctx.currentTime
    const checkFreqs = [20, 31, 45, 62, 90, 125, 180, 250, 350, 500, 700, 1000, 1400, 2000, 2800, 4000, 5600, 8000, 11200, 16000, 20000]
    const { effectivePreampDb } = computePeqResponse(profile, checkFreqs, this.ctx.sampleRate)
    const preampLinear = Math.pow(10, Math.max(-24, Math.min(12, effectivePreampDb)) / 20)

    if (immediate) {
      this.preampGain.gain.cancelScheduledValues(now)
      this.preampGain.gain.setValueAtTime(preampLinear, now)
    } else {
      this.preampGain.gain.setTargetAtTime(preampLinear, now, 0.018)
    }

    for (let i = 0; i < this.filters.length; i++) {
      const node = this.filters[i]
      const band = profile.bands[i]
      if (!band) continue
      if (node.type !== band.type) node.type = band.type
      const targetFreq = Math.max(20, Math.min(20000, band.freq))
      const targetQ = Math.max(0.1, Math.min(18, band.q))
      const targetGain = band.enabled ? Math.max(-15, Math.min(15, band.gain)) : 0
      if (immediate) {
        node.frequency.setValueAtTime(targetFreq, now)
        node.Q.setValueAtTime(targetQ, now)
        node.gain.setValueAtTime(targetGain, now)
      } else {
        node.frequency.setTargetAtTime(targetFreq, now, 0.015)
        node.Q.setTargetAtTime(targetQ, now, 0.015)
        node.gain.setTargetAtTime(targetGain, now, 0.015)
      }
    }
  }

  /**
   * Configure DSP preset, Gapless/Crossfade, and PEQ profile.
   */
  configureDsp(opts: {
    preset: AudioPreset
    gapless: boolean
    crossfadeSec: number
    peq: PeqProfile
    activeRgLinear?: number
  }) {
    this.preset = opts.preset
    this.gaplessEnabled = opts.gapless
    this.crossfadeSec = opts.preset === 'direct' ? 0 : Math.max(0, Math.min(12, opts.crossfadeSec))
    this.peqProfile = opts.peq

    const activeDeck = this.decks[this.activeIdx]
    if (opts.activeRgLinear !== undefined) {
      activeDeck.rgLinear = opts.activeRgLinear
    }
    if (this.ctx) {
      const now = this.ctx.currentTime
      for (const d of this.decks) {
        if (d.rgGain) {
          const targetRg = this.preset === 'direct' ? 1 : d.rgLinear
          d.rgGain.gain.setTargetAtTime(targetRg, now, 0.02)
        }
      }
      this.rewireDspBus(false)
    }
  }

  /**
   * Load a track into the currently active deck.
   */
  load(url: string, trackId: string | null = null, rgLinear = 1) {
    this.ensureGraph()
    this.transitioning = false
    ++this.fadeToken
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
    // Stop and clear the inactive deck if it was mid-crossfade
    const inactive = this.decks[(1 - this.activeIdx) as 0 | 1]
    if (!inactive.el.paused) {
      inactive.el.pause()
    }
    this.stopBufferSource(inactive)
    const active = this.decks[this.activeIdx]
    this.clearBufferDeck(active)
    active.trackId = trackId
    active.url = url
    active.rgLinear = rgLinear
    if (active.rgGain && this.ctx) {
      const targetRg = this.preset === 'direct' ? 1 : rgLinear
      active.rgGain.gain.cancelScheduledValues(this.ctx.currentTime)
      active.rgGain.gain.setValueAtTime(targetRg, this.ctx.currentTime)
    }
    if (active.deckGain && this.ctx) {
      active.deckGain.gain.cancelScheduledValues(this.ctx.currentTime)
      active.deckGain.gain.setValueAtTime(1, this.ctx.currentTime)
    }
    active.el.src = url
    active.el.load()
  }

  /**
   * Preload the next track into the inactive deck for Gapless or Crossfade transition.
   */
  preloadNext(url: string | null, trackId: string | null, rgLinear = 1) {
    const inactive = this.decks[(1 - this.activeIdx) as 0 | 1]
    if (!url || !trackId) {
      this.clearBufferDeck(inactive)
      inactive.trackId = null
      inactive.url = ''
      inactive.rgLinear = 1
      return
    }
    if (inactive.url === url && inactive.trackId === trackId) {
      inactive.rgLinear = rgLinear
      if (inactive.rgGain && this.ctx) {
        inactive.rgGain.gain.setTargetAtTime(this.preset === 'direct' ? 1 : rgLinear, this.ctx.currentTime, 0.02)
      }
      return
    }
    this.clearBufferDeck(inactive)
    inactive.trackId = trackId
    inactive.url = url
    inactive.rgLinear = rgLinear
    if (inactive.rgGain && this.ctx) {
      inactive.rgGain.gain.setValueAtTime(this.preset === 'direct' ? 1 : rgLinear, this.ctx.currentTime)
    }
    inactive.el.src = url
    inactive.el.load()
  }

  private checkSeamlessTransition(activeDeck: Deck) {
    if (this.transitioning) return
    const inactiveIdx = (1 - this.activeIdx) as 0 | 1
    const nextDeck = this.decks[inactiveIdx]
    if (!nextDeck.trackId || !nextDeck.url) return

    const dur = this.deckDuration(activeDeck)
    const cur = this.deckTime(activeDeck)
    if (!isFinite(dur) || dur <= 2) return
    const remaining = dur - cur

    // 1. Crossfade transition (when crossfadeSec > 0 and not in 'direct' mode)
    if (this.crossfadeSec > 0 && this.preset !== 'direct' && dur > this.crossfadeSec * 2) {
      if (remaining <= this.crossfadeSec && remaining > 0.15 && nextDeck.el.readyState >= 2) {
        void this.startCrossfade(activeDeck, nextDeck, inactiveIdx, remaining)
        return
      }
    }

    // 2. Gapless transition (when gaplessEnabled is true and crossfadeSec === 0)
    if (this.gaplessEnabled && this.crossfadeSec === 0) {
      if (remaining <= 0.06 && remaining > 0 && nextDeck.el.readyState >= 2) {
        void this.startInstantGapless(activeDeck, nextDeck, inactiveIdx)
      }
    }
  }

  private tryCompleteGaplessOnEnded(): boolean {
    if (this.transitioning) return true
    if (!this.gaplessEnabled) return false
    const inactiveIdx = (1 - this.activeIdx) as 0 | 1
    const nextDeck = this.decks[inactiveIdx]
    if (!nextDeck.trackId || !nextDeck.url || nextDeck.el.readyState < 2) return false
    const activeDeck = this.decks[this.activeIdx]
    void this.startInstantGapless(activeDeck, nextDeck, inactiveIdx)
    return true
  }

  private async startInstantGapless(outDeck: Deck, inDeck: Deck, nextIdx: 0 | 1) {
    if (this.transitioning) return
    this.transitioning = true
    try {
      if (inDeck.deckGain && this.ctx) {
        inDeck.deckGain.gain.cancelScheduledValues(this.ctx.currentTime)
        inDeck.deckGain.gain.setValueAtTime(1, this.ctx.currentTime)
      }
      if (inDeck.rgGain && this.ctx) {
        inDeck.rgGain.gain.cancelScheduledValues(this.ctx.currentTime)
        inDeck.rgGain.gain.setValueAtTime(this.preset === 'direct' ? 1 : inDeck.rgLinear, this.ctx.currentTime)
      }
      inDeck.el.currentTime = 0
      this.activeIdx = nextIdx
      await inDeck.el.play()
      outDeck.el.pause()
      this.clearBufferDeck(outDeck)
      outDeck.trackId = null
      outDeck.url = ''
      if (inDeck.trackId) {
        this.events.onSeamlessAdvance?.(inDeck.trackId)
      }
    } catch {
      this.transitioning = false
      this.events.onEnded?.()
      return
    }
    this.transitioning = false
  }

  private async startCrossfade(outDeck: Deck, inDeck: Deck, nextIdx: 0 | 1, fadeDuration: number) {
    if (this.transitioning || !this.ctx) return
    this.transitioning = true
    const dur = Math.max(0.4, Math.min(12, fadeDuration))
    const now = this.ctx.currentTime

    try {
      if (inDeck.deckGain && outDeck.deckGain) {
        inDeck.deckGain.gain.cancelScheduledValues(now)
        inDeck.deckGain.gain.setValueAtTime(0.0001, now)
        inDeck.deckGain.gain.exponentialRampToValueAtTime(1, now + dur)

        outDeck.deckGain.gain.cancelScheduledValues(now)
        outDeck.deckGain.gain.setValueAtTime(Math.max(0.0001, outDeck.deckGain.gain.value), now)
        outDeck.deckGain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
      }
      inDeck.el.currentTime = 0
      this.activeIdx = nextIdx
      await inDeck.el.play()
      if (inDeck.trackId) {
        this.events.onSeamlessAdvance?.(inDeck.trackId)
      }
      setTimeout(() => {
        outDeck.el.pause()
        this.clearBufferDeck(outDeck)
        if (outDeck.deckGain && this.ctx) {
          outDeck.deckGain.gain.cancelScheduledValues(this.ctx.currentTime)
          outDeck.deckGain.gain.setValueAtTime(1, this.ctx.currentTime)
        }
        outDeck.trackId = null
        outDeck.url = ''
        this.transitioning = false
      }, dur * 1000 + 60)
    } catch {
      this.transitioning = false
    }
  }

  async play(fade = true) {
    this.ensureGraph()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    const token = ++this.fadeToken
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
    const active = this.decks[this.activeIdx]
    const shouldFade = fade && this.preset !== 'direct'
    const isPaused = this.deckPaused(active)
    if (shouldFade && active.deckGain && this.ctx) {
      const g = active.deckGain.gain
      const now = this.ctx.currentTime
      const startGain = isPaused ? 0.0001 : Math.max(0.0001, g.value)
      g.cancelScheduledValues(now)
      g.setValueAtTime(startGain, now)
      g.exponentialRampToValueAtTime(1, now + 0.42)
    } else if (active.deckGain && this.ctx) {
      active.deckGain.gain.cancelScheduledValues(this.ctx.currentTime)
      active.deckGain.gain.setValueAtTime(1, this.ctx.currentTime)
    }
    if (active.buffer) {
      if (!active.bufPlaying) {
        this.startBufferPlayback(active, this.activeIdx, active.bufOffset)
        this.events.onPlay?.()
        this.events.onPlaying?.()
      }
      return
    }
    try {
      await active.el.play()
    } catch (e) {
      if (token === this.fadeToken) throw e
    }
  }

  pause(fade = true): Promise<void> {
    const token = ++this.fadeToken
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
    const active = this.decks[this.activeIdx]
    const pauseDeck = () => {
      if (active.buffer) {
        if (active.bufPlaying) {
          active.bufOffset = this.deckTime(active)
          this.stopBufferSource(active)
          this.events.onPause?.()
        }
      } else {
        active.el.pause()
      }
    }
    const shouldFade = fade && this.preset !== 'direct'
    if (!shouldFade || !active.deckGain || !this.ctx || this.deckPaused(active)) {
      pauseDeck()
      return Promise.resolve()
    }
    const g = active.deckGain.gain
    const now = this.ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(Math.max(0.0001, g.value), now)
    g.exponentialRampToValueAtTime(0.0001, now + 0.32)
    return new Promise((resolve) => {
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null
        if (token === this.fadeToken) pauseDeck()
        resolve()
      }, 335)
    })
  }

  setVolume(v: number) {
    this.userVolume = Math.max(0, Math.min(1, v))
    this.updateMasterVolumeGain(false)
  }

  private updateMasterVolumeGain(immediate = false) {
    // Perceptual quadratic volume curve
    const linear = Math.max(0, Math.min(1, this.userVolume * this.userVolume))
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime
      if (immediate) {
        this.masterGain.gain.cancelScheduledValues(now)
        this.masterGain.gain.setValueAtTime(linear, now)
      } else {
        this.masterGain.gain.setTargetAtTime(linear, now, 0.015)
      }
      // Keep underlying HTMLAudioElement at unity (1.0) so Web Audio masterGain controls volume cleanly
      for (const d of this.decks) d.el.volume = 1
    } else {
      for (const d of this.decks) d.el.volume = linear
    }
  }

  /**
   * Enumerate available Windows audio output devices (WASAPI endpoints exposed via Chromium).
   */
  async listOutputDevices(): Promise<AudioOutputDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return []
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      return all
        .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'communications')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.deviceId === 'default' ? `跟随系统默认设备 (${d.label.replace(/^默认\s*-\s*|^Default\s*-\s*/i, '') || '默认输出'})` : d.label || `音频输出设备 (${d.deviceId.slice(0, 6)})`
        }))
    } catch {
      return []
    }
  }

  async setOutputDevice(deviceId: string, label?: string): Promise<boolean> {
    this.preferredDeviceId = deviceId || 'default'
    if (label) this.preferredDeviceLabel = label
    this.usingFallbackDefault = false
    return this.applySinkId(this.preferredDeviceId)
  }

  private async applySinkId(deviceId: string): Promise<boolean> {
    const sinkId = deviceId === 'default' ? '' : deviceId
    try {
      if (this.ctx && typeof (this.ctx as any).setSinkId === 'function') {
        await (this.ctx as any).setSinkId(sinkId)
      } else {
        for (const d of this.decks) {
          if (typeof (d.el as any).setSinkId === 'function') {
            await (d.el as any).setSinkId(sinkId)
          }
        }
      }
      return true
    } catch (e) {
      console.warn('[AudioEngine] Failed to setSinkId, falling back to default device', e)
      try {
        if (this.ctx && typeof (this.ctx as any).setSinkId === 'function') {
          await (this.ctx as any).setSinkId('')
        }
      } catch {
        /* ignore */
      }
      return false
    }
  }

  private async handleDeviceChange() {
    if (this.preferredDeviceId === 'default') return
    const devices = await this.listOutputDevices()
    const found = devices.find((d) => d.deviceId === this.preferredDeviceId)
    if (!found && !this.usingFallbackDefault) {
      this.usingFallbackDefault = true
      await this.applySinkId('default')
      this.events.onDeviceFallback?.('disconnected', this.preferredDeviceLabel)
    } else if (found && this.usingFallbackDefault) {
      this.usingFallbackDefault = false
      await this.applySinkId(this.preferredDeviceId)
      this.events.onDeviceFallback?.('reconnected', found.label)
    }
  }

  getFrequency(): Uint8Array {
    if (this.analyser) this.analyser.getByteFrequencyData(this.freq)
    return this.freq
  }

  getWaveform(): Uint8Array {
    if (this.analyser) this.analyser.getByteTimeDomainData(this.wave)
    return this.wave
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000
  }
}

export const engine = new AudioEngine()
