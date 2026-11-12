import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Heart, MoreHorizontal, Loader2, Search } from 'lucide-react'
import type { Track } from '../../../shared/types'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { useUI } from '../store/ui'
import { useLyrics } from '../store/lyrics'
import { useSettings } from '../store/settings'
import { activeIndex, type Lyrics } from '../lib/lrc'
import { trackMenu } from '../lib/actions'
import { Cover } from '../components/Cover'
import { ProgressBar, Transport, VolumeControl } from '../components/PlayerBar'
import { LyricsView } from './LyricsView'
import { RadialVisualizer } from './Visualizer'
import { FlowingCover, BlurredCover, AuroraBackground, WaveRibbons } from './Backgrounds'
import { usePalette, useLyricClock, useRaf, useSize, useIdle } from './hooks'

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
  const split = showLyrics
  return (
    <div className={`np-lyric ${split ? 'split' : 'single'}`}>
      <FlowingCover cover={t.cover} playing={playing} />
      <motion.div layout className="am-left" transition={{ type: 'spring', stiffness: 200, damping: 30 }}>
        <motion.div
          layout
          className="am-cover"
          animate={{ scale: playing ? 1 : 0.84 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          style={{ boxShadow: playing ? '0 30px 80px rgba(0,0,0,.45)' : '0 12px 34px rgba(0,0,0,.3)' }}
        >
          <AnimatePresence initial={false}>
            <motion.div key={t.id} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              <Cover cover={t.cover} iconSize={80} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
        <motion.div layout className="am-controls">
          <TrackInfo t={t} />
          <ProgressBar className="np-progress" />
          <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 10px' }}>
            <Transport big />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <VolumeControl width={260} />
          </div>
        </motion.div>
      </motion.div>
      <AnimatePresence>
        {split && (
          <motion.div
            className="am-right"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: 'spring', stiffness: 200, damping: 28 }}
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
  const showRoma = useSettings((s) => s.showRoma)
  const showTrans = useSettings((s) => s.showTrans)
  useRaf(() => {
    if (!lyrics.synced) return
    const i = activeIndex(lyrics.lines, clock() + 0.2)
    if (i !== idx) setIdx(i)
  })
  const line = lyrics.synced ? lyrics.lines[idx] : undefined
  return (
    <div className="vm-lyric">
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
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

export function VinylMode({ t }: { t: Track }) {
  const playing = usePlayer((s) => s.playing)
  const lyrics = useLyrics((s) => s.lyrics)
  const vizStyle = useSettings((s) => s.vinylViz)
  const palette = usePalette(t.cover)
  const [stageRef, { w, h }] = useSize<HTMLDivElement>()
  const discRef = useRef<HTMLDivElement>(null)
  const S = Math.max(200, Math.min(h, w * 0.9))
  const D = S * 0.56

  return (
    <div className="np-vinyl">
      <BlurredCover cover={t.cover} dim={0.3} />
      <div className="vm-stage" ref={stageRef}>
        {w > 0 && (
          <>
            <RadialVisualizer
              size={S}
              radius={D / 2}
              palette={palette}
              style={vizStyle}
              onBass={(b) => {
                if (discRef.current) discRef.current.style.transform = `translate(-50%,-50%) scale(${1 + b * 0.05})`
              }}
            />
            <div className="vm-disc-wrap" ref={discRef} style={{ width: D, height: D }}>
              <div className={`vm-disc ${playing ? '' : 'paused'}`}>
                <AnimatePresence initial={false}>
                  <motion.div key={t.id} style={{ position: 'absolute', inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
                    <Cover cover={t.cover} iconSize={60} style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                  </motion.div>
                </AnimatePresence>
                <div className="vm-grooves" />
              </div>
              <div className="vm-sheen" />
              <div className="vm-hole" />
            </div>
          </>
        )}
      </div>
      <div className="vm-bottom">
        <TrackInfo t={t} center />
        {lyrics ? <CurrentLine lyrics={lyrics} /> : <div className="vm-lyric" />}
        <div className="vm-controls">
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

function KaraokeLines({ lyrics }: { lyrics: Lyrics }) {
  const clock = useLyricClock()
  const [idx, setIdx] = useState(-1)
  const fillRef = useRef<HTMLDivElement>(null)
  const showRoma = useSettings((s) => s.showRoma)
  const showTrans = useSettings((s) => s.showTrans)
  const scale = useSettings((s) => s.lyricScale)
  const lines = lyrics.lines
  useRaf(() => {
    const t = clock() + 0.15
    const i = activeIndex(lines, t)
    if (i !== idx) setIdx(i)
    const line = lines[i]
    if (fillRef.current && line) {
      const end = lines[i + 1]?.time ?? line.time + 5
      const dur = Math.max(0.3, Math.min(end - line.time, 12) * 0.92)
      const p = Math.max(0, Math.min(1, (t - line.time) / dur))
      fillRef.current.style.setProperty('--p', `${(p * 110).toFixed(2)}%`)
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
          initial={{ opacity: 0, y: 40, scale: 0.92, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -40, scale: 0.92, filter: 'blur(10px)' }}
          transition={{ type: 'spring', stiffness: 180, damping: 24 }}
        >
          {cur && !cur.interlude ? (
            <>
              {showRoma && cur.roma && <div className="au-roma">{cur.roma}</div>}
              <div className="au-text" ref={fillRef}>
                {cur.text}
              </div>
              {showTrans && cur.trans && <div className="au-trans">{cur.trans}</div>}
            </>
          ) : (
            <div className="au-text dots">• • •</div>
          )}
        </motion.div>
      </AnimatePresence>
      <div className="au-next">{next && !next.interlude ? next.text : ''}</div>
    </div>
  )
}

export function AuroraMode({ t }: { t: Track }) {
  const lyrics = useLyrics((s) => s.lyrics)
  const palette = usePalette(t.cover)
  const playing = usePlayer((s) => s.playing)
  const idle = useIdle(3000)
  return (
    <div className={`np-aurora ${idle && playing ? 'idle' : ''}`}>
      <AuroraBackground palette={palette} />
      <WaveRibbons palette={palette} height={220} />
      <div className="au-head">
        <Cover cover={t.cover} style={{ width: 56, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }} />
        <div style={{ minWidth: 0 }}>
          <div className="np-title" style={{ fontSize: 16 }}>
            {t.title}
          </div>
          <div className="np-artist" style={{ fontSize: 13 }}>
            {t.artist}
          </div>
        </div>
      </div>
      <div className="au-center">
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
      <div className="au-controls">
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
