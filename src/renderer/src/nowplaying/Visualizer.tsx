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
  const spec = useRef(new Spectrum(72))
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
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = size * dpr
    c.height = size * dpr
  }, [size])

  useRaf((_, dt) => {
    const c = canvasRef.current
    if (!c || !size) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const sp = spec.current
    sp.update(dt)
    onBass?.(sp.bass)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const cx = size / 2
    const cy = size / 2
    const R = radius + 10
    const maxLen = Math.max(20, size / 2 - R - 6)
    const cols = colors.current.length ? colors.current : ['#fff']
    rot.current += dt * (0.05 + sp.energy * 0.4)

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

    const N = sp.bands
    const total = N * 2
    const value = (k: number) => {
      // mirror: 0..N-1 then N-1..0
      const i = k < N ? k : total - 1 - k
      return sp.values[i]
    }

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
      // peak dots
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.beginPath()
      for (let k = 0; k < total; k++) {
        const i = k < N ? k : total - 1 - k
        const a = (k / total) * Math.PI * 2 - Math.PI / 2
        const r = R + 3 + sp.peaks[i] * maxLen + w * 1.4
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
