import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Disc3, Sparkles, MessageSquareQuote, ListMusic, FileMusic, SlidersHorizontal, RotateCcw } from 'lucide-react'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { useUI } from '../store/ui'
import { useSettings, type NpMode } from '../store/settings'
import { Segmented, Slider } from '../components/Controls'
import { Cover, LogoMark } from '../components/Cover'
import { TrafficLights, WinControls } from '../components/WindowControls'
import { QueuePanel } from '../components/Dialogs'
import { LyricStageMode, VinylMode, AuroraMode } from './Modes'
import { LyricsPanel } from './LyricsPanel'
import { useAutoHideChrome } from './hooks'
import './nowplaying.css'

type TransitionPhase = 'closed' | 'opening' | 'open' | 'closing'

interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

function readRect(selector: string): BoxRect | null {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function fallbackTargetRect(npMode: NpMode, showLyrics = true): BoxRect {
  const W = window.innerWidth
  const H = window.innerHeight
  if (npMode === 'vinyl') {
    const stageH = Math.max(200, H - 220)
    const S = Math.max(200, Math.min(stageH, (W - 80) * 0.9))
    const D = S * 0.56
    return { left: (W - D) / 2, top: 58 + (stageH - D) / 2, width: D, height: D }
  }
  if (npMode === 'aurora') {
    return { left: W * 0.06, top: 68, width: 56, height: 56 }
  }
  const size = Math.min(360, H * 0.42)
  const left = showLyrics ? W * 0.14 : (W - size) / 2
  return { left, top: (H - size) / 2 - 40, width: size, height: size }
}

export function NowPlaying() {
  const open = useUI((s) => s.nowPlaying)
  const setOpen = useUI((s) => s.setNowPlaying)
  const currentId = usePlayer((s) => s.currentId)
  const track = useLibrary((s) => (currentId ? s.byId.get(currentId) : undefined))
  const { npMode: rawMode, npShowLyrics, npBgBlur = 42, set, windowControls } = useSettings()
  const npMode: NpMode = (rawMode as string) === 'apple' ? 'lyric' : rawMode
  const queueOpen = useUI((s) => s.queueOpen)
  const toggleQueue = useUI((s) => s.toggleQueue)
  const lyricsPanel = useUI((s) => s.lyricsPanel)
  const setLyricsPanel = useUI((s) => s.setLyricsPanel)
  const menu = useUI((s) => s.menu)

  const [phase, setPhase] = useState<TransitionPhase>(open ? 'open' : 'closed')
  const [blurOpen, setBlurOpen] = useState(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const blurWrapRef = useRef<HTMLDivElement>(null)
  const morphRef = useRef<HTMLDivElement>(null)
  const morphAnimRef = useRef<Animation | null>(null)
  const sceneAnimRef = useRef<Animation | null>(null)
  const staggerAnimsRef = useRef<Animation[]>([])
  const inFlightRectRef = useRef<BoxRect | null>(null)
  const inFlightSceneOpacityRef = useRef<number | null>(null)

  useEffect(() => {
    if (open && !track) setOpen(false)
  }, [open, track, setOpen])

  // Close blur popover on mode switch or outside click / Escape
  useEffect(() => {
    if (npMode !== 'vinyl' && blurOpen) setBlurOpen(false)
  }, [npMode, blurOpen])

  useEffect(() => {
    if (!blurOpen) return
    const onDown = (e: MouseEvent) => {
      if (blurWrapRef.current && !blurWrapRef.current.contains(e.target as Node)) {
        setBlurOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setBlurOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [blurOpen])

  // Synchronize open boolean with transition phase and sample current visual state for interruption
  useLayoutEffect(() => {
    if (open && track) {
      if (phase === 'closing') {
        if (morphRef.current) {
          const r = morphRef.current.getBoundingClientRect()
          if (r.width > 0) {
            inFlightRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height }
          }
        }
        if (sceneRef.current) {
          const op = parseFloat(getComputedStyle(sceneRef.current).opacity)
          if (Number.isFinite(op)) inFlightSceneOpacityRef.current = op
        }
      }
      if (phase === 'closed' || phase === 'closing') {
        setPhase('opening')
      }
    } else if (!open) {
      if (phase === 'opening') {
        if (morphRef.current) {
          const r = morphRef.current.getBoundingClientRect()
          if (r.width > 0) {
            inFlightRectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height }
          }
        }
        if (sceneRef.current) {
          const op = parseFloat(getComputedStyle(sceneRef.current).opacity)
          if (Number.isFinite(op)) inFlightSceneOpacityRef.current = op
        }
      }
      if (phase === 'open' || phase === 'opening') {
        setBlurOpen(false)
        setPhase('closing')
      }
    }
  }, [open, Boolean(track)])

  // Keep html[data-np-morph='active'] strictly synchronized with React phase commits
  useLayoutEffect(() => {
    if (phase === 'opening' || phase === 'closing') {
      document.documentElement.dataset.npMorph = 'active'
    } else {
      delete document.documentElement.dataset.npMorph
    }
    return () => {
      delete document.documentElement.dataset.npMorph
    }
  }, [phase])

  // Execute compositor-driven WAAPI transition (0 React re-renders during flight)
  useLayoutEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return

    const cancelStaggers = () => {
      staggerAnimsRef.current.forEach((a) => a.cancel())
      staggerAnimsRef.current = []
    }

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reducedMotion) {
      const t = setTimeout(() => {
        setPhase(phase === 'opening' ? 'open' : 'closed')
      }, 120)
      return () => clearTimeout(t)
    }

    const miniRect = readRect('[data-cover-role="pb-mini-cover"]') ?? {
      left: 26,
      top: window.innerHeight - 68,
      width: 52,
      height: 52
    }
    const targetRect = readRect('[data-cover-role="np-target-cover"]') ?? fallbackTargetRect(npMode, npShowLyrics)

    const miniRadiusPct = (8 / Math.max(1, miniRect.width)) * 100
    const targetRadiusPct =
      npMode === 'vinyl'
        ? 50
        : npMode === 'aurora'
          ? (10 / Math.max(1, targetRect.width)) * 100
          : (16 / Math.max(1, targetRect.width)) * 100

    const inFlight = inFlightRectRef.current
    inFlightRectRef.current = null
    const startOpacity = inFlightSceneOpacityRef.current ?? (phase === 'opening' ? 0 : 1)
    inFlightSceneOpacityRef.current = null

    const startRect = inFlight ?? (phase === 'opening' ? miniRect : targetRect)
    const endRect = phase === 'opening' ? targetRect : miniRect

    const spanW = targetRect.width - miniRect.width
    const progressRatio =
      inFlight && Math.abs(spanW) > 1
        ? Math.max(0, Math.min(1, (inFlight.width - miniRect.width) / spanW))
        : phase === 'opening'
          ? 0
          : 1

    const startRadiusPct = inFlight
      ? miniRadiusPct + (targetRadiusPct - miniRadiusPct) * progressRatio
      : phase === 'opening'
        ? miniRadiusPct
        : targetRadiusPct
    const endRadiusPct = phase === 'opening' ? targetRadiusPct : miniRadiusPct

    const el = morphRef.current
    const sceneEl = sceneRef.current
    if (!el || !sceneEl) {
      setPhase(phase === 'opening' ? 'open' : 'closed')
      return
    }

    if (morphAnimRef.current) {
      morphAnimRef.current.cancel()
      morphAnimRef.current = null
    }
    if (sceneAnimRef.current) {
      sceneAnimRef.current.cancel()
      sceneAnimRef.current = null
    }
    cancelStaggers()

    // Anchor morph element at target dimensions centered on its own center for natural proportional zoom
    const baseW = Math.max(1, targetRect.width)
    const baseH = Math.max(1, targetRect.height)
    el.style.left = '0px'
    el.style.top = '0px'
    el.style.width = `${baseW}px`
    el.style.height = `${baseH}px`
    el.style.transformOrigin = 'center center'

    const toTransform = (r: BoxRect) => {
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const sx = r.width / baseW
      const sy = r.height / baseH
      return `translate3d(${(cx - baseW / 2).toFixed(2)}px, ${(cy - baseH / 2).toFixed(2)}px, 0) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`
    }

    const remaining = phase === 'opening' ? 1 - progressRatio : progressRatio
    const morphDuration =
      phase === 'opening'
        ? inFlight
          ? Math.max(220, Math.round(460 * Math.max(0.4, remaining)))
          : 460
        : inFlight
          ? Math.max(200, Math.round(360 * Math.max(0.4, remaining)))
          : 360

    // Balanced ease-out with smooth proportional deceleration (no overshoot, no tail stall)
    const morphEasing =
      phase === 'opening'
        ? 'cubic-bezier(0.25, 0.85, 0.35, 1)'
        : 'cubic-bezier(0.28, 0.82, 0.38, 1)'

    // 1. Cover flight: keep transform on its own pure GPU compositor animation
    const anim = el.animate(
      [
        { transform: toTransform(startRect) },
        { transform: toTransform(endRect) }
      ],
      { duration: morphDuration, easing: morphEasing, fill: 'forwards' }
    )
    const radiusAnim = el.animate(
      [
        { borderRadius: `${startRadiusPct.toFixed(2)}%` },
        { borderRadius: `${endRadiusPct.toFixed(2)}%` }
      ],
      { duration: morphDuration, easing: morphEasing, fill: 'forwards' }
    )
    morphAnimRef.current = anim

    // 2. Single unified scene backdrop & stage opacity (prevents any child canvas/ribbons from leaking on close)
    const sceneAnim = sceneEl.animate(
      [
        { opacity: startOpacity },
        { opacity: phase === 'opening' ? 1 : 0 }
      ],
      {
        duration: phase === 'opening' ? Math.round(morphDuration * 0.85) : Math.round(morphDuration * 0.9),
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards'
      }
    )
    sceneAnimRef.current = sceneAnim

    // 3. Staggered 50ms content fade-up on open (song info -> controls -> lyrics) without React re-renders
    if (phase === 'opening' && !inFlight) {
      const staggerGroups: Array<[string, number]> = [
        ['.np-top', 40],
        ['.np-stagger-1', 50],
        ['.np-stagger-2', 100],
        ['.np-stagger-3', 150]
      ]
      for (const [sel, delay] of staggerGroups) {
        const node = sceneEl.querySelector<HTMLElement>(sel)
        if (!node) continue
        const sa = node.animate(
          [
            { opacity: 0, transform: sel === '.np-top' ? 'translate3d(0, -8px, 0)' : 'translate3d(0, 12px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' }
          ],
          {
            duration: 320,
            delay,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'backwards'
          }
        )
        staggerAnimsRef.current.push(sa)
      }
    }

    let cancelled = false
    anim.onfinish = () => {
      if (cancelled) return
      morphAnimRef.current = null
      sceneAnimRef.current = null
      cancelStaggers()
      setPhase(phase === 'opening' ? 'open' : 'closed')
    }
    anim.oncancel = () => {
      if (cancelled) return
      morphAnimRef.current = null
    }

    return () => {
      cancelled = true
      anim.cancel()
      radiusAnim.cancel()
      sceneAnim.cancel()
      cancelStaggers()
    }
  }, [phase, npMode])

  const isVisible = phase !== 'closed' && Boolean(track)
  const autoHideEnabled = isVisible && (npMode === 'vinyl' || npMode === 'aurora')
  const externalHold = Boolean(lyricsPanel || queueOpen || blurOpen || menu)
  const { hidden: hideChrome, chromeProps } = useAutoHideChrome(5000, autoHideEnabled, externalHold)

  if (!isVisible || !track) return null

  const blurPct = Math.round((npBgBlur / 60) * 100)

  return (
    <div
      className={`np mode-${npMode} phase-${phase} ${hideChrome ? 'chrome-hidden' : ''}`}
      data-np-phase={phase}
    >
      <div className="np-scene" ref={sceneRef}>
        <AnimatePresence initial={false}>
          <motion.div
            key={npMode}
            className="np-mode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {npMode === 'lyric' && <LyricStageMode t={track} />}
            {npMode === 'vinyl' && <VinylMode t={track} chromeProps={chromeProps} />}
            {npMode === 'aurora' && <AuroraMode t={track} chromeProps={chromeProps} />}
          </motion.div>
        </AnimatePresence>

        <div className="np-top drag" {...chromeProps}>
          <div className="np-top-left no-drag">
            <button className="np-round-btn" onClick={() => setOpen(false)} title="收起 (Esc)" aria-label="收起播放界面">
              <ChevronDown size={20} />
            </button>
          </div>
          <div className="no-drag np-mode-switch">
            <Segmented<NpMode>
              layoutId="np-mode-seg"
              value={npMode}
              onChange={(v) => set({ npMode: v })}
              options={[
                { value: 'lyric', label: <LogoMark size={14} />, title: '灵动歌词' },
                { value: 'vinyl', label: <Disc3 size={14} />, title: '黑胶唱片' },
                { value: 'aurora', label: <Sparkles size={14} />, title: '流光舞台' }
              ]}
            />
          </div>
          <div className="np-top-right no-drag">
            {npMode === 'lyric' && (
              <button
                className={`np-round-btn ${npShowLyrics ? 'on' : ''}`}
                onClick={() => set({ npShowLyrics: !npShowLyrics })}
                title="显示/隐藏歌词"
                aria-label="显示或隐藏歌词"
              >
                <MessageSquareQuote size={16} />
              </button>
            )}
            {npMode === 'vinyl' && (
              <div className="np-blur-anchor" ref={blurWrapRef}>
                <button
                  className={`np-round-btn ${blurOpen ? 'on' : ''}`}
                  onClick={() => {
                    const next = !blurOpen
                    setBlurOpen(next)
                    if (next) {
                      setLyricsPanel(false)
                      toggleQueue(false)
                    }
                  }}
                  title="背景磨砂设置"
                  aria-label="背景磨砂设置"
                  aria-expanded={blurOpen}
                >
                  <SlidersHorizontal size={16} />
                </button>
                <AnimatePresence>
                  {blurOpen && (
                    <motion.div
                      className="np-blur-popover"
                      initial={{ opacity: 0, y: -6, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      {...chromeProps}
                    >
                      <div className="np-blur-head">
                        <span className="np-blur-title">背景磨砂</span>
                        <div className="np-blur-meta">
                          <span className="np-blur-val">
                            {blurPct}% ({Math.round(npBgBlur)}px)
                          </span>
                          <button
                            className="np-blur-reset"
                            onClick={() => set({ npBgBlur: 42 })}
                            disabled={Math.round(npBgBlur) === 42}
                            title="恢复默认值 (70% / 42px)"
                          >
                            <RotateCcw size={11} />
                            <span>恢复默认</span>
                          </button>
                        </div>
                      </div>
                      <Slider
                        className="np-blur-slider"
                        value={npBgBlur}
                        max={60}
                        thumb
                        wheelStep={2}
                        onChange={(v) => set({ npBgBlur: Math.round(v) })}
                      />
                      <div className="np-blur-ticks">
                        <button type="button" onClick={() => set({ npBgBlur: 0 })}>
                          清晰 0%
                        </button>
                        <button type="button" onClick={() => set({ npBgBlur: 24 })}>
                          柔和 40%
                        </button>
                        <button type="button" onClick={() => set({ npBgBlur: 42 })}>
                          默认 70%
                        </button>
                        <button type="button" onClick={() => set({ npBgBlur: 60 })}>
                          深磨砂 100%
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
            <button
              className={`np-round-btn ${lyricsPanel ? 'on' : ''}`}
              onClick={() => {
                const next = !lyricsPanel
                setLyricsPanel(next)
                if (next) {
                  toggleQueue(false)
                  setBlurOpen(false)
                }
              }}
              title="歌词搜索 / 下载 / 嵌入"
              aria-label="歌词搜索与嵌入"
            >
              <FileMusic size={16} />
            </button>
            <button
              className={`np-round-btn ${queueOpen ? 'on' : ''}`}
              onClick={() => {
                toggleQueue()
                if (!queueOpen) {
                  setLyricsPanel(false)
                  setBlurOpen(false)
                }
              }}
              title="播放队列"
              aria-label="播放队列"
            >
              <ListMusic size={16} />
            </button>
            {windowControls === 'mac' ? <TrafficLights /> : <WinControls />}
          </div>
        </div>
        <LyricsPanel t={track} />
        <QueuePanel onNp />
      </div>

      {/* Shared FLIP Morph Cover during open/close transitions */}
      {(phase === 'opening' || phase === 'closing') && (
        <div className="np-morph-cover" ref={morphRef} aria-hidden="true">
          <Cover eager cover={track.cover} iconSize={64} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
          {npMode === 'vinyl' && (
            <>
              <div className="vm-grooves" />
              <div className="vm-sheen" />
            </>
          )}
        </div>
      )}
    </div>
  )
}
