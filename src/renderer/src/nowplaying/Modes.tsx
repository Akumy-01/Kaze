import { useLayoutEffect, useRef, useState, type HTMLAttributes } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Heart, MoreHorizontal, Loader2, Search } from 'lucide-react'
import type { Track } from '../../../shared/types'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { useUI } from '../store/ui'
import { useLyrics } from '../store/lyrics'
import { useSettings } from '../store/settings'
import { activeIndex, type LyricLine, type Lyrics } from '../lib/lrc'
import { trackMenu } from '../lib/actions'
import { Cover } from '../components/Cover'
import { ProgressBar, Transport, VolumeControl } from '../components/PlayerBar'
import { LyricsView } from './LyricsView'
import { RadialVisualizer } from './Visualizer'
import { FlowingCover, BlurredCover, AuroraBackground, WaveRibbons } from './Backgrounds'
import { usePalette, useLyricClock, useRaf, useSize } from './hooks'

function TrackInfo({ t, center = false }: { t: Track; center?: boolean }) {
  const liked = useUser((s) => s.liked.includes(t.id))
  const toggleLike = useUser((s) => s.toggleLike)
  const openMenu = useUI((s) => s.openMenu)
  const navigate = useUI((s) => s.navigate)
  return (
    <div className="np-info" style={{ justifyContent: center ? 'center' : undefined, textAlign: center ? 'center' : undefined }}>
      {center && <div style={{ width: 64 }} />}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={t.id}
          className="np-info-text"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <div className="np-title">{t.title}</div>
          <div className="np-artist">
            <span className="hover-link" onClick={() => navigate({ name: 'artist', param: t.artist.split(/\s*\/\s*/)[0].toLowerCase() })}>
              {t.artist}
            </span>
            <span style={{ opacity: 0.5 }}> — </span>
            <span className="hover-link" onClick={() => navigate({ name: 'album', param: `${t.album.toLowerCase()}␟${(t.album === '未知专辑' ? '' : t.albumArtist).toLowerCase()}` })}>
              {t.album}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button className="np-round-btn" onClick={() => toggleLike(t.id)} style={{ color: liked ? 'var(--accent)' : undefined }}>
          <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button className="np-round-btn" onClick={(e) => openMenu(e, trackMenu(t))}>
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  )
}

function NoLyrics({ compact = false }: { compact?: boolean }) {
  const status = useLyrics((s) => s.status)
  const setPanel = useUI((s) => s.setLyricsPanel)
  if (status === 'loading')
    return (
      <div className="np-nolyrics">
        <Loader2 size={compact ? 16 : 22} className="spin" />
        <span>正在寻找歌词…</span>
      </div>
    )
  return (
    <div className="np-nolyrics">
      <span style={{ fontSize: compact ? 14 : 22, fontWeight: 700, opacity: 0.85 }}>{status === 'error' ? '歌词获取失败' : '暂无歌词'}</span>
      <button className="np-pill" onClick={() => setPanel(true)}>
        <Search size={13} />
        搜索在线歌词
      </button>
    </div>
  )
}

/* ================================================================== */
/* Lyric Stage mode                                                    */
/* ================================================================== */

export function LyricStageMode({ t }: { t: Track }) {
  const playing = usePlayer((s) => s.playing)
  const lyrics = useLyrics((s) => s.lyrics)
  const showLyrics = useSettings((s) => s.npShowLyrics)
  const setNowPlaying = useUI((s) => s.setNowPlaying)
  const split = showLyrics

  const leftRef = useRef<HTMLDivElement>(null)
  const prevLeftRef = useRef<{ split: boolean; left: number; width: number } | null>(null)
  const flipAnimRef = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const el = leftRef.current
    if (!el) return
    const cur = el.getBoundingClientRect()
    const prev = prevLeftRef.current
    prevLeftRef.current = { split, left: cur.left, width: cur.width }
    if (!prev || prev.split === split) return

    const dx = prev.left + prev.width / 2 - (cur.left + cur.width / 2)
    if (Math.abs(dx) < 1) return

    flipAnimRef.current?.cancel()
    flipAnimRef.current = el.animate(
      [
        { transform: `translate3d(${dx.toFixed(2)}px, 0, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      {
        duration: 420,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'none'
      }
    )
    flipAnimRef.current.onfinish = () => {
      flipAnimRef.current = null
    }
  }, [split])

  // Keep prevLeftRef accurate across window resizes so toggling split always glides from true visual origin
  useLayoutEffect(() => {
    const onResize = () => {
      if (!leftRef.current) return
      const r = leftRef.current.getBoundingClientRect()
      prevLeftRef.current = { split, left: r.left, width: r.width }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [split])

  return (
    <div className={`np-lyric ${split ? 'split' : 'single'}`}>
      <FlowingCover cover={t.cover} playing={playing} />
      <div ref={leftRef} className="am-left">
        <motion.div
          className="am-cover"
          data-cover-role="np-target-cover"
          onClick={() => setNowPlaying(false)}
          title="点击收起播放界面"
          initial={false}
          animate={{ scale: playing ? 1 : 0.88 }}
          transition={{ type: 'spring', stiffness: 240, damping: 24 }}
          style={{ cursor: 'pointer', boxShadow: playing ? '0 30px 80px rgba(0,0,0,.45)' : '0 14px 38px rgba(0,0,0,.32)' }}
        >
          <AnimatePresence initial={false}>
            <motion.div key={t.id} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
              <Cover eager cover={t.cover} iconSize={80} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
        <div className="am-controls">
          <div className="np-stagger-1">
            <TrackInfo t={t} />
          </div>
          <div className="np-stagger-2">
            <ProgressBar className="np-progress" />
            <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 10px' }}>
              <Transport big />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <VolumeControl width={260} />
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {split && (
          <motion.div
            key="lyric-pane"
            className="am-right np-stagger-3"
            initial={{ opacity: 0, x: 44 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 44 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {lyrics ? <LyricsView lyrics={lyrics} anchor={0.36} fontSize={32} /> : <NoLyrics />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Vinyl / CD mode                                                     */
/* ================================================================== */

function CurrentLine({ lyrics }: { lyrics: Lyrics }) {
  const clock = useLyricClock()
  const [idx, setIdx] = useState(-1)
  const idxRef = useRef(-1)
  const showRoma = useSettings((s) => s.showRoma)
  const showTrans = useSettings((s) => s.showTrans)
  useRaf(() => {
    if (!lyrics.synced) return
    const i = activeIndex(lyrics.lines, clock() + 0.06)
    if (i !== idxRef.current) {
      idxRef.current = i
      setIdx(i)
    }
  })
  const line = lyrics.synced ? lyrics.lines[idx] : undefined
  return (
    <div className="vm-lyric">
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 12, filter: 'blur(5px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -12, filter: 'blur(5px)' }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {line && !line.interlude ? (
            <>
              {showRoma && line.roma && <div className="vm-roma">{line.roma}</div>}
              <div className="vm-text">{line.text}</div>
              {showTrans && line.trans && <div className="vm-trans">{line.trans}</div>}
            </>
          ) : (
            <div className="vm-text" style={{ opacity: 0.5 }}>
              ♪
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function VinylMode({ t, chromeProps }: { t: Track; chromeProps?: HTMLAttributes<HTMLDivElement> }) {
  const playing = usePlayer((s) => s.playing)
  const lyrics = useLyrics((s) => s.lyrics)
  const vizStyle = useSettings((s) => s.vinylViz)
  const palette = usePalette(t.cover)
  const [stageRef, { w, h }] = useSize<HTMLDivElement>()
  const discRef = useRef<HTMLDivElement>(null)
  const spinRef = useRef<HTMLDivElement>(null)
  const angleRef = useRef(0)
  const omegaRef = useRef(playing ? 13.85 : 0)
  const S = Math.max(200, Math.min(h, w * 0.9))
  const D = S * 0.56

  // Smooth rotational inertia on play/pause without losing current angle
  useRaf((_, dt) => {
    const targetOmega = playing ? 13.85 : 0
    const rate = playing ? 3.8 : 3.2
    omegaRef.current += (targetOmega - omegaRef.current) * Math.min(1, dt * rate)
    if (!playing && Math.abs(omegaRef.current) < 0.02) {
      omegaRef.current = 0
    }
    if (omegaRef.current > 0 && spinRef.current) {
      angleRef.current = (angleRef.current + omegaRef.current * dt) % 360
      spinRef.current.style.transform = `rotate(${angleRef.current.toFixed(2)}deg)`
    }
  })

  return (
    <div className="np-vinyl">
      <BlurredCover cover={t.cover} dim={0.3} />
      <div className="vm-stage" ref={stageRef}>
        {w > 0 && (
          <RadialVisualizer
            size={S}
            radius={D / 2}
            palette={palette}
            style={vizStyle}
            onBass={(b) => {
              if (discRef.current) discRef.current.style.transform = `translate(-50%,-50%) scale(${(1 + b * 0.045).toFixed(4)})`
            }}
          />
        )}
        <div
          className="vm-disc-wrap"
          data-cover-role="np-target-cover"
          ref={discRef}
          onClick={() => useUI.getState().setNowPlaying(false)}
          title="点击收起播放界面"
          style={w > 0 ? { width: D, height: D, cursor: 'pointer' } : { cursor: 'pointer' }}
        >
          <div className="vm-disc" ref={spinRef}>
            <AnimatePresence initial={false}>
              <motion.div key={t.id} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}>
                <Cover cover={t.cover} iconSize={60} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
              </motion.div>
            </AnimatePresence>
            <div className="vm-grooves" />
          </div>
          <div className="vm-sheen" />
        </div>
      </div>
      <div className="vm-bottom" {...chromeProps}>
        <div className="np-stagger-1" style={{ width: '100%' }}>
          <TrackInfo t={t} center />
        </div>
        <div className="np-stagger-3" style={{ width: '100%' }}>
          {lyrics ? <CurrentLine lyrics={lyrics} /> : <div className="vm-lyric" />}
        </div>
        <div className="vm-controls np-stagger-2">
          <ProgressBar className="np-progress" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <div style={{ width: 160 }} />
            <Transport big />
            <VolumeControl width={160} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Aurora mode                                                         */
/* ================================================================== */

/**
 * Isolated per-line component so exiting `<motion.div>` instances inside
 * `<AnimatePresence mode="popLayout">` never clear the active line's DOM ref on unmount.
 */
function ActiveKaraokeLine({
  line,
  nextLine,
  clock,
  showRoma,
  showTrans
}: {
  line: LyricLine
  nextLine?: LyricLine
  clock: () => number
  showRoma: boolean
  showTrans: boolean
}) {
  const fillRef = useRef<HTMLSpanElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const words = line.words

  useRaf(() => {
    const t = clock() + 0.06
    if (words && words.length > 0) {
      for (let i = 0; i < words.length; i++) {
        const w = words[i]
        const el = wordRefs.current[i]
        if (!el) continue
        const dur = Math.max(0.05, w.end - w.start)
        const p = Math.max(0, Math.min(1, (t - w.start) / dur))
        el.style.setProperty('--wp', `${(p * 100).toFixed(1)}%`)
      }
      return
    }
    if (fillRef.current) {
      const end = line.endTime ?? nextLine?.time ?? line.time + 4.5
      const rawSpan = Math.max(0.4, end - line.time)
      // Complete highlight across the sung duration (capped for long instrumental tails)
      const dur = Math.max(0.35, Math.min(rawSpan, 9.5) * 0.92)
      const p = Math.max(0, Math.min(1, (t - line.time) / dur))
      fillRef.current.style.setProperty('--p', `${(p * 100).toFixed(2)}%`)
    }
  })

  return (
    <>
      {showRoma && line.roma && <div className="au-roma">{line.roma}</div>}
      <div className="au-text-wrap">
        {words && words.length > 0 ? (
          <span className="au-text-words">
            {words.map((w, wi) => (
              <span
                key={wi}
                ref={(el) => {
                  wordRefs.current[wi] = el
                }}
                className="au-word"
              >
                {w.text}
              </span>
            ))}
          </span>
        ) : (
          <span className="au-text" ref={fillRef}>
            {line.text}
          </span>
        )}
      </div>
      {showTrans && line.trans && <div className="au-trans">{line.trans}</div>}
    </>
  )
}

function KaraokeLines({ lyrics }: { lyrics: Lyrics }) {
  const clock = useLyricClock()
  const [idx, setIdx] = useState(-1)
  const idxRef = useRef(-1)
  const showRoma = useSettings((s) => s.showRoma)
  const showTrans = useSettings((s) => s.showTrans)
  const scale = useSettings((s) => s.lyricScale)
  const lines = lyrics.lines

  useRaf(() => {
    const t = clock() + 0.06
    const i = activeIndex(lines, t)
    if (i !== idxRef.current) {
      idxRef.current = i
      setIdx(i)
    }
  })

  const cur = lines[idx]
  const prev = lines[idx - 1]
  const next = lines[idx + 1]
  return (
    <div className="au-lines" style={{ fontSize: 46 * scale }}>
      <div className="au-prev">{prev && !prev.interlude ? prev.text : ''}</div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={idx}
          className="au-cur"
          initial={{ opacity: 0, y: 28, scale: 0.95, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -28, scale: 0.95, filter: 'blur(8px)' }}
          transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
        >
          {cur && !cur.interlude ? (
            <ActiveKaraokeLine line={cur} nextLine={next} clock={clock} showRoma={showRoma} showTrans={showTrans} />
          ) : (
            <div className="au-text dots">• • •</div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="au-next">{next && !next.interlude ? next.text : ''}</div>
    </div>
  )
}

export function AuroraMode({ t, chromeProps }: { t: Track; chromeProps?: HTMLAttributes<HTMLDivElement> }) {
  const lyrics = useLyrics((s) => s.lyrics)
  const palette = usePalette(t.cover)
  const playing = usePlayer((s) => s.playing)
  return (
    <div className="np-aurora">
      <AuroraBackground palette={palette} />
      <WaveRibbons palette={palette} height={220} />
      <div className="au-head np-stagger-1" {...chromeProps}>
        <Cover
          cover={t.cover}
          dataCoverRole="np-target-cover"
          onClick={() => useUI.getState().setNowPlaying(false)}
          style={{ width: 56, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.35)', cursor: 'pointer' }}
        />
        <div style={{ minWidth: 0 }}>
          <div className="np-title" style={{ fontSize: 16 }}>
            {t.title}
          </div>
          <div className="np-artist" style={{ fontSize: 13 }}>
            {t.artist}
          </div>
        </div>
      </div>
      <div className="au-center np-stagger-3">
        {lyrics?.synced ? (
          <KaraokeLines lyrics={lyrics} />
        ) : lyrics ? (
          <LyricsView lyrics={lyrics} align="center" />
        ) : (
          <div className="au-lines">
            <motion.div className="au-title-big" animate={{ scale: playing ? [1, 1.03, 1] : 1 }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}>
              {t.title}
            </motion.div>
            <div style={{ fontSize: 20, opacity: 0.7, marginTop: 10 }}>{t.artist}</div>
            <div style={{ marginTop: 24 }}>
              <NoLyrics compact />
            </div>
          </div>
        )}
      </div>
      <div className="au-controls np-stagger-2" {...chromeProps}>
        <ProgressBar className="np-progress" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <div style={{ width: 160 }} />
          <Transport big />
          <VolumeControl width={160} />
        </div>
      </div>
    </div>
  )
}
