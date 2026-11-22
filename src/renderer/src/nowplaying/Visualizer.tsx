import { useEffect, useRef } from 'react'
import { Spectrum, useRaf } from './hooks'
import { vivid, type Palette } from '../lib/color'

interface Props {
  size: number
  /** radius (css px) of the disc that bars surround */
  radius: number
  palette: Palette
  style: 'bars' | 'wave' | 'particles'
  onBass?: (v: number) => void
}

interface Particle {
  a: number
  r: number
  v: number
  life: number
  size: number
  c: number
}

export function RadialVisualizer({ size, radius, palette, style, onBass }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spec = useRef(new Spectrum(72, 36, 8600))
  const particles = useRef<Particle[]>([])
  const rot = useRef(0)
  const colors = useRef<string[]>([])

  useEffect(() => {
    colors.current = palette.colors.slice(0, 4).map((c) => {
      const [r, g, b] = vivid(c, 0.62)
      return `rgb(${r | 0},${g | 0},${b | 0})`
    })
  }, [palette])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !size) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size * dpr)
    c.height = Math.round(size * dpr)
  }, [size])

  useRaf((_, dt) => {
    const c = canvasRef.current
    if (!c || !size) return
    const isMorphing = document.documentElement.dataset.npMorph === 'active'
    if (isMorphing && rot.current > 0) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const sp = spec.current
    sp.update(dt)
    if (!isMorphing) {
      onBass?.(sp.bass)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const cx = size / 2
    const cy = size / 2
    const R = radius + 10
    const maxLen = Math.max(20, size / 2 - R - 6)
    const cols = colors.current.length ? colors.current : ['#fff']
    rot.current += dt * (0.05 + sp.energy * 0.35)

    // gradient around the circle
    let grad: CanvasGradient
    try {
      grad = ctx.createConicGradient(rot.current, cx, cy)
      cols.forEach((col, i) => grad.addColorStop(i / cols.length, col))
      grad.addColorStop(1, cols[0])
    } catch {
      grad = ctx.createLinearGradient(0, 0, size, size)
      cols.forEach((col, i) => grad.addColorStop(i / Math.max(1, cols.length - 1), col))
    }

    // soft glow ring
    const glowR = R + sp.bass * maxLen * 0.35
    const rg = ctx.createRadialGradient(cx, cy, radius * 0.9, cx, cy, glowR + maxLen * 0.6)
    rg.addColorStop(0, 'rgba(255,255,255,0)')
    rg.addColorStop(0.35, cols[0].replace('rgb', 'rgba').replace(')', `,${0.1 + sp.bass * 0.25})`))
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg
    ctx.beginPath()
    ctx.arc(cx, cy, glowR + maxLen * 0.6, 0, Math.PI * 2)
    ctx.fill()

    const N = sp.bands // 72 bands
    const half = N / 2 // 36 bands per quadrant
    const total = N * 2 // 144 radial bars (4 quadrants of 36 bars)

    /**
     * Balanced 4-Quadrant Radial Frequency Mapping:
     * Prevents dumping all low-energy ultra-high bins at the bottom (6 o'clock) of the ring.
     * - Top (12 o'clock) & Bottom (6 o'clock) anchor the low/low-mid and vocal-mid bands
     * - Left (9 o'clock) & Right (3 o'clock) anchor the upper-mid & presence bands blended with harmonic mids
     * - 100% driven by real FFT data (sp.values / sp.peaks), converging cleanly to 0 during silence/pause.
     */
    const sampleRadial = (k: number, arr: Float32Array) => {
      const quad = Math.floor(k / half) % 4
      const pos = k % half // 0 .. 35 within quadrant
      const t = pos / Math.max(1, half - 1) // 0 .. 1

      // Fold angle so q=0 goes 0->1, q=1 goes 1->0 (reaching 0 at 6 o'clock bottom), q=2 goes 0->1, q=3 goes 1->0
      const folded = quad % 2 === 0 ? t : 1 - t
      const isBottomHalf = quad === 1 || quad === 2

      // Primary index across the 72 spectrum bands
      // Top half emphasizes bands 0..64 (sub-bass to upper-mids), bottom half emphasizes bands 6..71 (punchy mid-bass & vocal mids to presence)
      const primaryPos = isBottomHalf ? 0.08 + folded * 0.88 : folded * 0.9
      const idxA = Math.min(N - 1, Math.floor(primaryPos * (N - 1)))
      const idxB = Math.min(N - 1, idxA + 1)
      const frac = primaryPos * (N - 1) - idxA
      const primary = arr[idxA] * (1 - frac) + arr[idxB] * frac

      // Complementary harmonic band so outer lateral regions (folded near 1) also reflect rhythmic mid energy
      const compPos = isBottomHalf ? (1 - folded) * 0.55 : 0.15 + (1 - folded) * 0.6
      const compIdx = Math.min(N - 1, Math.floor(compPos * (N - 1)))
      const comp = arr[compIdx]

      const mix = 0.28 * Math.sin(folded * Math.PI * 0.5)
      return primary * (1 - mix) + comp * mix
    }

    const value = (k: number) => sampleRadial(k, sp.values)
    const peak = (k: number) => sampleRadial(k, sp.peaks)

    if (style === 'bars') {
      const w = Math.max(2, ((2 * Math.PI * R) / total) * 0.5)
      ctx.lineCap = 'round'
      ctx.lineWidth = w
      ctx.strokeStyle = grad
      ctx.shadowColor = cols[0]
      ctx.shadowBlur = 14
      ctx.beginPath()
      for (let k = 0; k < total; k++) {
        const a = (k / total) * Math.PI * 2 - Math.PI / 2
        const len = 3 + value(k) * maxLen
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        ctx.moveTo(cx + cos * R, cy + sin * R)
        ctx.lineTo(cx + cos * (R + len), cy + sin * (R + len))
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      // outer peak dots
      ctx.fillStyle = 'rgba(255,255,255,0.78)'
      ctx.beginPath()
      for (let k = 0; k < total; k++) {
        const a = (k / total) * Math.PI * 2 - Math.PI / 2
        const r = R + 3 + peak(k) * maxLen + w * 1.4
        ctx.moveTo(cx + Math.cos(a) * r + w * 0.35, cy + Math.sin(a) * r)
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w * 0.35, 0, Math.PI * 2)
      }
      ctx.fill()
    } else if (style === 'wave') {
      const pts: [number, number][] = []
      for (let k = 0; k < total; k++) {
        const a = (k / total) * Math.PI * 2 - Math.PI / 2
        const r = R + 4 + value(k) * maxLen * 0.9
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
      const drawSmooth = (p: [number, number][]) => {
        ctx.beginPath()
        for (let i = 0; i < p.length; i++) {
          const p0 = p[i]
          const p1 = p[(i + 1) % p.length]
          const mx = (p0[0] + p1[0]) / 2
          const my = (p0[1] + p1[1]) / 2
          if (i === 0) ctx.moveTo(mx, my)
          else ctx.quadraticCurveTo(p0[0], p0[1], mx, my)
        }
        const p0 = p[0]
        const p1 = p[1]
        ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        ctx.closePath()
      }
      ctx.globalAlpha = 0.28
      ctx.fillStyle = grad
      drawSmooth(pts)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = 2.5
      ctx.strokeStyle = grad
      ctx.shadowColor = cols[0]
      ctx.shadowBlur = 18
      ctx.stroke()
      // second inner echo
      const pts2 = pts.map(([x, y]) => {
        const dx = x - cx
        const dy = y - cy
        const d = Math.hypot(dx, dy)
        const nr = R + (d - R) * 0.5
        return [cx + (dx / d) * nr, cy + (dy / d) * nr] as [number, number]
      })
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 1.5
      drawSmooth(pts2)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    } else {
      // particles
      const ps = particles.current
      const spawn = Math.floor(sp.energy * 14 + sp.bass * 10)
      for (let s = 0; s < spawn && ps.length < 700; s++) {
        const band = Math.floor(Math.random() * N)
        const v = sp.values[band]
        if (v < 0.08) continue
        const a = Math.random() * Math.PI * 2
        ps.push({ a, r: R + 2, v: 30 + v * 220 + sp.bass * 120, life: 1, size: 1 + v * 3, c: Math.floor(Math.random() * cols.length) })
      }
      ctx.globalCompositeOperation = 'lighter'
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.r += p.v * dt
        p.a += dt * 0.15
        p.life -= dt * (0.6 + (p.r - R) / maxLen)
        if (p.life <= 0 || p.r > size / 2) {
          ps.splice(i, 1)
          continue
        }
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = cols[p.c]
        ctx.beginPath()
        ctx.arc(cx + Math.cos(p.a) * p.r, cy + Math.sin(p.a) * p.r, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      // thin reactive ring
      ctx.lineWidth = 2
      ctx.strokeStyle = grad
      ctx.shadowColor = cols[0]
      ctx.shadowBlur = 16
      ctx.beginPath()
      for (let k = 0; k <= total; k++) {
        const a = (k / total) * Math.PI * 2 - Math.PI / 2
        const r = R + 2 + value(k % total) * 18
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  })

  return <canvas ref={canvasRef} style={{ width: size, height: size, position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} />
}
