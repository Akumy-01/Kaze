import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { extractPalette, DEFAULT_PALETTE, type Palette } from '../lib/color'
import { engine } from '../lib/audio'
import { coverFileUrl } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'

export function usePalette(cover?: string): Palette {
  const [p, setP] = useState<Palette>(DEFAULT_PALETTE)
  useEffect(() => {
    let alive = true
    extractPalette(coverFileUrl(cover)).then((x) => alive && setP(x))
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
  return useCallback(() => engine.currentTime + ref.current / 1000, [])
}

/** rAF loop helper that automatically pauses when document is hidden/minimized */
export function useRaf(cb: (t: number, dt: number) => void, active = true) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    let visible = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'

    const loop = (t: number) => {
      if (!visible) {
        raf = 0
        return
      }
      const dt = Math.min(0.1, Math.max(0.001, (t - last) / 1000))
      last = t
      ref.current(t, dt)
      raf = requestAnimationFrame(loop)
    }

    const onVisChange = () => {
      visible = document.visibilityState !== 'hidden'
      if (visible && !raf) {
        last = performance.now()
        raf = requestAnimationFrame(loop)
      } else if (!visible && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    if (visible) {
      raf = requestAnimationFrame(loop)
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [active])
}

/**
 * Unified auto-hide controller for NowPlaying top/bottom chrome (5000ms default).
 * - Starts visible on mount or mode switch.
 * - Hides after `ms` of no real user interaction.
 * - Ignores stationary cursor synthetic mousemove events.
 * - Suspends hiding while hovering controls, focusing controls via keyboard, dragging sliders, or holding popovers/menus open.
 */
export function useAutoHideChrome(ms = 5000, enabled = true, externalHold = false) {
  const [hidden, setHidden] = useState(false)
  const pointerDraggingRef = useRef(false)
  const externalHoldRef = useRef(externalHold)
  externalHoldRef.current = externalHold
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastMousePos = useRef<{ x: number; y: number } | null>(null)

  const isHeld = useCallback(() => {
    const hovered =
      typeof document !== 'undefined' &&
      document.querySelectorAll('[data-chrome-zone="true"]:hover').length > 0
    const focusedByKeyboard =
      typeof document !== 'undefined' &&
      Boolean(
        document.activeElement?.matches?.(':focus-visible') &&
          document.activeElement?.closest?.('[data-chrome-zone="true"]')
      )
    return hovered || focusedByKeyboard || pointerDraggingRef.current || externalHoldRef.current
  }, [])

  const scheduleTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!enabled) {
      setHidden(false)
      return
    }
    if (isHeld()) {
      setHidden(false)
      return
    }
    timerRef.current = setTimeout(() => {
      if (!isHeld() && enabled) {
        setHidden(true)
      }
    }, ms)
  }, [enabled, isHeld, ms])

  const wake = useCallback(() => {
    setHidden(false)
    scheduleTimer()
  }, [scheduleTimer])

  useEffect(() => {
    setHidden(false)
    scheduleTimer()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, externalHold, scheduleTimer])

  useEffect(() => {
    if (!enabled) {
      setHidden(false)
      return
    }

    const onMouseMove = (e: MouseEvent) => {
      const prev = lastMousePos.current
      lastMousePos.current = { x: e.clientX, y: e.clientY }
      // Ignore stationary mouse synthetic events
      if (prev && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 2) {
        return
      }
      wake()
    }
    const onMouseDown = () => wake()
    const onTouchStart = () => wake()
    const onWheel = () => wake()
    const onKeyDown = () => wake()
    const onPointerUp = () => {
      if (pointerDraggingRef.current) {
        pointerDraggingRef.current = false
        scheduleTimer()
      }
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    window.addEventListener('mousedown', onMouseDown, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [enabled, wake, scheduleTimer])

  const chromeProps = {
    'data-chrome-zone': 'true',
    onMouseEnter: () => {
      wake()
    },
    onMouseLeave: () => {
      scheduleTimer()
    },
    onPointerDownCapture: () => {
      pointerDraggingRef.current = true
      wake()
    },
    onFocusCapture: () => {
      wake()
    },
    onBlurCapture: () => {
      scheduleTimer()
    }
  }

  return { hidden: enabled ? hidden : false, wake, chromeProps }
}

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw > 0 || ch > 0) {
      setSize({ w: cw, h: ch })
    }
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * Compute smoothed log-scaled spectrum bands from real Web Audio AnalyserNode data.
 * Features:
 * - Musical frequency range (36 Hz – 8600 Hz) with fractional FFT bin interpolation at low frequencies
 * - Pink-noise perceptual tilt compensation (+3.5 dB/oct) so mids & highs have natural visual presence
 * - Noise floor gate so silence / quiet intervals drop cleanly to 0 without amplifying noise
 * - Bounded adaptive envelope normalization ([0.45, 0.98]) for natural dynamic range across quiet and loud tracks
 * - Separate fast attack and smooth release
 */
export class Spectrum {
  values: Float32Array
  peaks: Float32Array
  private rawTargets: Float32Array
  bass = 0
  energy = 0
  private runningPeak = 0.65
  private freqPoints: number[] = []
  private lastSampleRate = 0

  constructor(public bands: number, private minHz = 36, private maxHz = 8600) {
    this.values = new Float32Array(bands)
    this.peaks = new Float32Array(bands)
    this.rawTargets = new Float32Array(bands)
  }

  private buildFrequencyMap(n: number, sr: number) {
    this.lastSampleRate = sr
    const nyq = sr / 2
    this.freqPoints = []
    for (let i = 0; i <= this.bands; i++) {
      const t = i / this.bands
      // Slightly denser allocation in the vocal/instrument core (80 Hz - 4.5 kHz)
      const shaped = Math.pow(t, 0.92)
      const hz = this.minHz * Math.pow(this.maxHz / this.minHz, shaped)
      const exactBin = Math.max(1, Math.min(n - 1, (hz / nyq) * n))
      this.freqPoints.push(exactBin)
    }
  }

  update(dt: number) {
    const data = engine.getFrequency()
    const n = data.length
    const playing = !engine.paused

    if (!n || !playing) {
      const decay = Math.min(1, dt * 8.5)
      let e = 0
      for (let i = 0; i < this.bands; i++) {
        this.values[i] += (0 - this.values[i]) * decay
        if (this.values[i] < 0.001) this.values[i] = 0
        this.peaks[i] = Math.max(this.values[i], this.peaks[i] - dt * 0.45)
        e += this.values[i]
      }
      this.energy = e / this.bands
      this.bass += (0 - this.bass) * decay
      return
    }

    if (this.freqPoints.length !== this.bands + 1 || this.lastSampleRate !== engine.sampleRate) {
      this.buildFrequencyMap(n, engine.sampleRate)
    }

    let frameMax = 0
    for (let i = 0; i < this.bands; i++) {
      const b0 = this.freqPoints[i]
      const b1 = this.freqPoints[i + 1]
      let rawVal = 0

      if (b1 - b0 < 1.2) {
        // Fractional bin linear interpolation for smooth low-frequency progression
        const idx0 = Math.floor(b0)
        const idx1 = Math.min(n - 1, idx0 + 1)
        const frac = b0 - idx0
        rawVal = (data[idx0] * (1 - frac) + data[idx1] * frac) / 255
      } else {
        const start = Math.floor(b0)
        const end = Math.min(n - 1, Math.ceil(b1))
        let sum = 0
        let max = 0
        let count = 0
        for (let k = start; k <= end; k++) {
          const val = data[k]
          sum += val
          if (val > max) max = val
          count++
        }
        const avg = count > 0 ? sum / count : 0
        rawVal = (avg * 0.42 + max * 0.58) / 255
      }

      // Noise gate so silence stays strictly at 0
      const gate = 0.035
      let v = rawVal <= gate ? 0 : (rawVal - gate) / (1 - gate)

      if (v > 0) {
        // Pink-noise perceptual slope compensation: boost mid-high & high bands naturally
        const pos = i / Math.max(1, this.bands - 1)
        const tilt = 0.8 + Math.pow(pos, 0.82) * 0.92
        v = Math.pow(v, 1.12) * tilt
      }

      this.rawTargets[i] = v
      if (v > frameMax) frameMax = v
    }

    // Update bounded adaptive normalizer ([0.46, 0.98])
    if (frameMax > this.runningPeak) {
      this.runningPeak += (frameMax - this.runningPeak) * Math.min(1, dt * 5.0)
    } else {
      this.runningPeak += (Math.max(0.46, frameMax) - this.runningPeak) * Math.min(1, dt * 0.55)
    }
    const normCeiling = Math.max(0.46, Math.min(0.98, this.runningPeak))

    // 3-tap spatial smoothing + attack/release envelope
    let energy = 0
    for (let i = 0; i < this.bands; i++) {
      const prev = this.rawTargets[Math.max(0, i - 1)]
      const curr = this.rawTargets[i]
      const next = this.rawTargets[Math.min(this.bands - 1, i + 1)]
      const smoothed = prev * 0.18 + curr * 0.64 + next * 0.18
      // Soft knee compression near 1.0
      const normalized = Math.min(1, (smoothed / normCeiling) * 0.92)

      const old = this.values[i]
      const rate = normalized > old ? dt * 30 : dt * 6.8
      this.values[i] = old + (normalized - old) * Math.min(1, rate)
      if (this.values[i] < 0.001) this.values[i] = 0
      this.peaks[i] = Math.max(this.values[i], this.peaks[i] - dt * 0.42)
      energy += this.values[i]
    }

    this.energy = energy / this.bands
    let bass = 0
    const bassBands = Math.max(3, Math.floor(this.bands * 0.12))
    for (let i = 0; i < bassBands; i++) bass += this.values[i]
    bass /= bassBands
    this.bass += (bass - this.bass) * Math.min(1, dt * (bass > this.bass ? 22 : 6.5))
  }
}
