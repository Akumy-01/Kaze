import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  ListMusic,
  MessageSquareQuote,
  Heart
} from 'lucide-react'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { useUser } from '../store/user'
import { useUI } from '../store/ui'
import { Cover } from './Cover'
import { Slider } from './Controls'
import { fmtTime } from '../lib/format'
import { trackMenu } from '../lib/actions'

export function PlayIcon({ playing, size = 22 }: { playing: boolean; size?: number }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={playing ? 'pause' : 'play'}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.4, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 30 }}
        style={{ display: 'grid', placeItems: 'center' }}
      >
        {playing ? <Pause size={size} fill="currentColor" strokeWidth={0} /> : <Play size={size} fill="currentColor" strokeWidth={0} style={{ marginLeft: size * 0.1 }} />}
      </motion.span>
    </AnimatePresence>
  )
}

export function VolumeIcon({ v, muted, size = 16 }: { v: number; muted: boolean; size?: number }) {
  if (muted || v === 0) return <VolumeX size={size} />
  if (v < 0.33) return <Volume size={size} />
  if (v < 0.66) return <Volume1 size={size} />
  return <Volume2 size={size} />
}

export function ProgressBar({ className = '' }: { className?: string }) {
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const seek = usePlayer((s) => s.seek)
  const [preview, setPreview] = useState<number | null>(null)
  const t = preview ?? currentTime
  return (
    <div className={`pb-progress ${className}`}>
      <span>{fmtTime(t)}</span>
      <Slider
        value={currentTime}
        max={duration || 1}
        onChange={setPreview}
        onCommit={(v) => {
          setPreview(null)
          seek(v)
        }}
      />
      <span>-{fmtTime(Math.max(0, duration - t))}</span>
    </div>
  )
}

export function Transport({ big = false }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const p = usePlayer.getState()
  const s = big ? 1.3 : 1
  return (
    <div className="pb-controls" style={{ gap: big ? 26 : 14 }}>
      <button className={`ctrl sm ${shuffle ? 'on' : ''}`} onClick={p.toggleShuffle} title="随机播放">
        <Shuffle size={15 * s} />
      </button>
      <button className="ctrl md" onClick={p.prev} title="上一首" style={big ? { width: 48, height: 48 } : undefined}>
        <SkipBack size={20 * s} fill="currentColor" strokeWidth={0} />
      </button>
      <button className="ctrl lg" onClick={p.toggle} title={playing ? '暂停' : '播放'} style={big ? { width: 64, height: 64 } : undefined}>
        <PlayIcon playing={playing} size={big ? 36 : 24} />
      </button>
      <button className="ctrl md" onClick={() => p.next()} title="下一首" style={big ? { width: 48, height: 48 } : undefined}>
        <SkipForward size={20 * s} fill="currentColor" strokeWidth={0} />
      </button>
      <button className={`ctrl sm ${repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} title={repeat === 'one' ? '单曲循环' : repeat === 'all' ? '列表循环' : '不循环'}>
        {repeat === 'one' ? <Repeat1 size={15 * s} /> : <Repeat size={15 * s} />}
      </button>
    </div>
  )
}

export function VolumeControl({ width = 130 }: { width?: number }) {
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const p = usePlayer.getState()
  return (
    <div className="pb-volume" style={{ width }}>
      <button className="ctrl sm" onClick={p.toggleMute} title={muted ? '取消静音' : '静音'}>
        <VolumeIcon v={volume} muted={muted} />
      </button>
      <Slider value={muted ? 0 : volume} onChange={p.setVolume} wheelStep={0.05} />
    </div>
  )
}

export function PlayerBar() {
  const currentId = usePlayer((s) => s.currentId)
  const track = useLibrary((s) => (currentId ? s.byId.get(currentId) : undefined))
  const liked = useUser((s) => (currentId ? s.liked.includes(currentId) : false))
  const toggleLike = useUser((s) => s.toggleLike)
  const setNowPlaying = useUI((s) => s.setNowPlaying)
  const queueOpen = useUI((s) => s.queueOpen)
  const toggleQueue = useUI((s) => s.toggleQueue)
  const openMenu = useUI((s) => s.openMenu)

  return (
    <motion.div
      className="player-bar"
      initial={{ y: 120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, delay: 0.1 }}
    >
      <div className="pb-left" onContextMenu={(e) => track && (e.preventDefault(), openMenu(e, trackMenu(track)))}>
        <motion.div layoutId="np-cover-mini" style={{ flexShrink: 0 }}>
          <Cover cover={track?.cover} className="pb-cover" onClick={() => track && setNowPlaying(true)} />
        </motion.div>
        <div className="pb-meta">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentId ?? 'none'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
            >
              <div className="pb-title">{track?.title ?? 'Akumy Music'}</div>
              <div className="pb-artist">{track ? `${track.artist} — ${track.album}` : '选择一首歌曲开始播放'}</div>
            </motion.div>
          </AnimatePresence>
        </div>
        {track && (
          <button className="ctrl sm" style={{ color: liked ? 'var(--accent)' : undefined, flexShrink: 0 }} onClick={() => toggleLike(track.id)}>
            <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="pb-center">
        <Transport />
        <ProgressBar />
      </div>
      <div className="pb-right">
        <button className="ctrl sm" title="歌词 / 播放界面" onClick={() => track && setNowPlaying(true)}>
          <MessageSquareQuote size={16} />
        </button>
        <button className={`ctrl sm ${queueOpen ? 'on' : ''}`} title="播放队列" onClick={() => toggleQueue()}>
          <ListMusic size={16} />
        </button>
        <VolumeControl />
      </div>
    </motion.div>
  )
}
