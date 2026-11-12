import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Spectrum, useRaf } from './hooks'
import type { Palette } from '../lib/color'
import { DEFAULT_LOGO_URL } from '../components/Cover'

function useCoverOrLogoUrl(cover?: string) {
  const raw = cover ? `akumy://cover/${encodeURIComponent(cover)}` : DEFAULT_LOGO_URL
  const [url, setUrl] = useState(raw)
  useEffect(() => {
    setUrl(cover ? `akumy://cover/${encodeURIComponent(cover)}` : DEFAULT_LOGO_URL)
  }, [cover])
  return { url, onError: () => setUrl(DEFAULT_LOGO_URL) }
}

/** Flowing blurred cover background for Lyric Stage mode. */
export function FlowingCover({ cover, playing }: { cover?: string; playing: boolean }) {
  const { url, onError } = useCoverOrLogoUrl(cover)
  return (
    <div className="np-bg">
      <AnimatePresence>
        <motion.div
          key={url}
          className="flow-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
        >
          <div className={`flow ${playing ? '' : 'paused'}`}>
            <img src={url} className="f1" onError={onError} alt="" />
            <img src={url} className="f2" onError={onError} alt="" />
            <img src={url} className="f3" onError={onError} alt="" />
            <img src={url} className="f4" onError={onError} alt="" />
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="np-bg-dim" />
    </div>
  )
}

export function BlurredCover({ cover, dim = 0.35 }: { cover?: string; dim?: number }) {
  const { url, onError } = useCoverOrLogoUrl(cover)
  return (
    <div className="np-bg">
      <AnimatePresence>
        <motion.div key={url} className="blur-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }}>
          <img src={url} onError={onError} alt="" />
        </motion.div>
      </AnimatePresence>
      <div className="np-bg-dim" style={{ background: `radial-gradient(circle at 50% 45%, rgba(0,0,0,${dim * 0.5}), rgba(0,0,0,${dim + 0.25}))` }} />
    </div>
  )
}

/** Aurora: low-res canvas with drifting colour fields, upscaled for free blur. Audio reactive. */
export function AuroraBackground({ palette }: { palette: Palette }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const spec = useRef(new Spectrum(24))
  const t0 = useRef(Math.random() * 100)
  const blobs = useRef(
    Array.from({ length: 6 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      sx: 0.03 + Math.random() * 0.05,
      sy: 0.02 + Math.random() * 0.05,
      ph: Math.random() * 10,
      r: 0.45 + Math.random() * 0.35,
      c: i % 4
    }))
  )
  useEffect(() => {
    const c = ref.current!
    c.width = 96
    c.height = 60
  }, [])
  useRaf((_, dt) => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const sp = spec.current
    sp.update(dt)
    t0.current += dt * (0.4 + sp.energy * 2.2)
    const t = t0.current
    const W = c.width
    const H = c.height
    const base = palette.colors[3] ?? [20, 20, 30]
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgb(${base[0] * 0.25},${base[1] * 0.25},${base[2] * 0.3})`
    ctx.fillRect(0, 0, W, H)
    ctx.globalCompositeOperation = 'lighter'
    for (const b of blobs.current) {
      const x = (0.5 + 0.45 * Math.sin(t * b.sx * 3 + b.ph)) * W
      const y = (0.5 + 0.45 * Math.cos(t * b.sy * 3 + b.ph * 1.3)) * H
      const r = (b.r + sp.bass * 0.25) * W * 0.55
      const [cr, cg, cb] = palette.colors[b.c] ?? [120, 80, 200]
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const a = 0.42 + sp.energy * 0.4
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`)
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
  })
  return (
    <div className="np-bg">
      <canvas ref={ref} className="aurora-canvas" />
      <div className="np-bg-dim" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.15), rgba(0,0,0,.35))' }} />
    </div>
  )
}

/** Flowing ribbons along the bottom, driven by spectrum */
export function WaveRibbons({ palette, height = 180 }: { palette: Palette; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const spec = useRef(new Spectrum(48, 40, 9000))
  const phase = useRef(0)
  useRaf((_, dt) => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(height * dpr)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, height)
    const sp = spec.current
    sp.update(dt)
    phase.current += dt * (0.6 + sp.energy * 3)
    const layers = 4
    ctx.globalCompositeOperation = 'lighter'
    for (let L = 0; L < layers; L++) {
      const [r, g, b] = palette.colors[L % palette.colors.length]
      const amp = height * (0.12 + 0.55 * sp.values[Math.floor((L / layers) * sp.bands * 0.6)] + 0.15 * sp.bass)
      const grad = ctx.createLinearGradient(0, height, 0, height - amp * 1.8)
      grad.addColorStop(0, `rgba(${r},${g},${b},0.0)`)
      grad.addColorStop(0.6, `rgba(${r},${g},${b},0.22)`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0.0)`)
      ctx.beginPath()
      ctx.moveTo(0, height)
      const steps = 64
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w
        const k = i / steps
        const band = sp.values[Math.floor(k * (sp.bands - 1))]
        const y =
          height * 0.72 -
          Math.sin(k * Math.PI * (1.5 + L * 0.6) + phase.current * (1 + L * 0.3) + L) * amp * 0.5 -
          band * height * 0.35 * Math.sin(k * Math.PI)
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, height)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
      ctx.strokeStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},0.55)`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w
        const k = i / steps
        const band = sp.values[Math.floor(k * (sp.bands - 1))]
        const y =
          height * 0.72 -
          Math.sin(k * Math.PI * (1.5 + L * 0.6) + phase.current * (1 + L * 0.3) + L) * amp * 0.5 -
          band * height * 0.35 * Math.sin(k * Math.PI)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  })
  return <canvas ref={ref} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, width: '100%', height, pointerEvents: 'none' }} />
}
