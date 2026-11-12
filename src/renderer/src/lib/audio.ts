/**
 * Thin wrapper around a single <audio> element with a Web Audio graph
 * (MediaElementSource -> fade gain -> analyser -> destination).
 */
class AudioEngine {
  readonly audio: HTMLAudioElement
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  analyser: AnalyserNode | null = null
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private wave: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private fadeToken = 0

  constructor() {
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'auto'
  }

  private ensureGraph() {
    if (this.ctx) return
    try {
      this.ctx = new AudioContext({ latencyHint: 'playback' })
      const src = this.ctx.createMediaElementSource(this.audio)
      this.gain = this.ctx.createGain()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.78
      src.connect(this.gain)
      this.gain.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      this.freq = new Uint8Array(this.analyser.frequencyBinCount)
      this.wave = new Uint8Array(this.analyser.fftSize)
    } catch (e) {
      console.warn('AudioContext unavailable', e)
    }
  }

  load(url: string) {
    this.ensureGraph()
    this.audio.src = url
    this.audio.load()
  }

  async play(fade = true) {
    this.ensureGraph()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
    const token = ++this.fadeToken
    if (fade && this.gain && this.ctx) {
      const g = this.gain.gain
      g.cancelScheduledValues(this.ctx.currentTime)
      g.setValueAtTime(0.0001, this.ctx.currentTime)
      g.exponentialRampToValueAtTime(1, this.ctx.currentTime + 0.35)
    } else if (this.gain) this.gain.gain.value = 1
    try {
      await this.audio.play()
    } catch (e) {
      if (token === this.fadeToken) throw e
    }
  }

  pause(fade = true): Promise<void> {
    const token = ++this.fadeToken
    if (!fade || !this.gain || !this.ctx || this.audio.paused) {
      this.audio.pause()
      return Promise.resolve()
    }
    const g = this.gain.gain
    const now = this.ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(Math.max(0.0001, g.value), now)
    g.exponentialRampToValueAtTime(0.0001, now + 0.25)
    return new Promise((resolve) => {
      setTimeout(() => {
        if (token === this.fadeToken) this.audio.pause()
        resolve()
      }, 260)
    })
  }

  setVolume(v: number) {
    // perceptual curve
    this.audio.volume = Math.max(0, Math.min(1, v * v))
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
    return this.ctx?.sampleRate ?? 44100
  }
}

export const engine = new AudioEngine()
