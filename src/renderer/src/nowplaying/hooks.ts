import { useEffect, useRef, useState } from 'react'
import { extractPalette, DEFAULT_PALETTE, type Palette } from '../lib/color'
import { engine } from '../lib/audio'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'

export function usePalette(cover?: string): Palette {
  const [p, setP] = useState<Palette>(DEFAULT_PALETTE)
  useEffect(() => {
    let alive = true
    extractPalette(cover ? `akumy://cover/${encodeURIComponent(cover)}` : undefined).then((x) => alive && setP(x))
    return () => {
      alive = false
    }
  }, [cover])
  return p
}

/** Returns a getter for precise playback time including per-track lyric offset. */
export function useLyricClock() {
  const id = usePlayer((s) => s.currentId)
  const offset = useUser((s) => (id ? s.lyricOffsets[id] ?? 0 : 0))
  const ref = useRef(offset)
  ref.current = offset
  return () => engine.audio.currentTime + ref.current / 1000
}

/** rAF loop helper */
export function useRaf(cb: (t: number, dt: number) => void, active = true) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000)
      last = t
      ref.current(t, dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active])
}

/** true when mouse has been idle for `ms` */
export function useIdle(ms = 2800) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const wake = () => {
      setIdle(false)
      clearTimeout(t)
      t = setTimeout(() => setIdle(true), ms)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('mousedown', wake)
    window.addEventListener('keydown', wake)
    window.addEventListener('wheel', wake)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('mousedown', wake)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('wheel', wake)
    }
  }, [ms])
  return idle
}

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/** Compute smoothed log-scaled spectrum bands from analyser data. */
export class Spectrum {
  values: Float32Array
  peaks: Float32Array
  bass = 0
  energy = 0
  private edges: number[] = []
  constructor(public bands: number, private minHz = 35, private maxHz = 14000) {
    this.values = new Float32Array(bands)
    this.peaks = new Float32Array(bands)
  }
  update(dt: number) {
    const data = engine.getFrequency()
    const n = data.length
    if (!n) {
      for (let i = 0; i < this.bands; i++) this.values[i] *= 0.9
      this.bass *= 0.9
      return
    }
    if (this.edges.length !== this.bands + 1) {
      const nyq = engine.sampleRate / 2
      this.edges = []
      for (let i = 0; i <= this.bands; i++) {
        const hz = this.minHz * Math.pow(this.maxHz / this.minHz, i / this.bands)
        this.edges.push(Math.max(1, Math.min(n - 1, Math.round((hz / nyq) * n))))
      }
    }
    const playing = !engine.audio.paused
    let energy = 0
    for (let i = 0; i < this.bands; i++) {
      let a = this.edges[i]
      let b = Math.max(a + 1, this.edges[i + 1])
      let sum = 0
      let max = 0
      for (let k = a; k < b; k++) {
        sum += data[k]
        if (data[k] > max) max = data[k]
      }
      let v = ((sum / (b - a)) * 0.5 + max * 0.5) / 255
      // tilt: boost highs a little
      v = Math.pow(v, 1.6) * (0.85 + (i / this.bands) * 0.6)
      if (!playing) v = 0
      const cur = this.values[i]
      this.values[i] = v > cur ? cur + (v - cur) * Math.min(1, dt * 28) : cur + (v - cur) * Math.min(1, dt * 7)
      this.peaks[i] = Math.max(this.values[i], this.peaks[i] - dt * 0.5)
      energy += this.values[i]
    }
    this.energy = energy / this.bands
    let bass = 0
    for (let i = 0; i < Math.max(2, Math.floor(this.bands * 0.08)); i++) bass += this.values[i]
    bass /= Math.max(2, Math.floor(this.bands * 0.08))
    this.bass += (bass - this.bass) * Math.min(1, dt * (bass > this.bass ? 20 : 6))
  }
}
