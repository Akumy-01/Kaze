import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Disc3, Sparkles, Apple, MessageSquareQuote, ListMusic, FileMusic } from 'lucide-react'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { useUI } from '../store/ui'
import { useSettings, type NpMode } from '../store/settings'
import { Segmented } from '../components/Controls'
import { TrafficLights, WinControls } from '../components/WindowControls'
import { QueuePanel } from '../components/Dialogs'
import { AppleMode, VinylMode, AuroraMode } from './Modes'
import { LyricsPanel } from './LyricsPanel'
import { useIdle } from './hooks'
import './nowplaying.css'

export function NowPlaying() {
  const open = useUI((s) => s.nowPlaying)
  const setOpen = useUI((s) => s.setNowPlaying)
  const currentId = usePlayer((s) => s.currentId)
  const track = useLibrary((s) => (currentId ? s.byId.get(currentId) : undefined))
  const { npMode, npShowLyrics, set, windowControls } = useSettings()
  const queueOpen = useUI((s) => s.queueOpen)
  const toggleQueue = useUI((s) => s.toggleQueue)
  const lyricsPanel = useUI((s) => s.lyricsPanel)
  const setLyricsPanel = useUI((s) => s.setLyricsPanel)
  const idle = useIdle(3000)
  const playing = usePlayer((s) => s.playing)

  useEffect(() => {
    if (open && !track) setOpen(false)
  }, [open, track, setOpen])

  const hideChrome = idle && playing && npMode === 'aurora' && !lyricsPanel && !queueOpen

  return (
    <AnimatePresence>
      {open && track && (
        <motion.div
          className={`np mode-${npMode} ${hideChrome ? 'chrome-hidden' : ''}`}
          initial={{ y: '100%', borderRadius: 24 }}
          animate={{ y: 0, borderRadius: 0 }}
          exit={{ y: '100%', borderRadius: 24 }}
          transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={npMode}
              className="np-mode"
              initial={{ opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {npMode === 'apple' && <AppleMode t={track} />}
              {npMode === 'vinyl' && <VinylMode t={track} />}
              {npMode === 'aurora' && <AuroraMode t={track} />}
            </motion.div>
          </AnimatePresence>

          <div className="np-top drag">
            <div className="np-top-left no-drag">
              {windowControls === 'mac' && <TrafficLights />}
              <button className="np-round-btn" onClick={() => setOpen(false)} title="收起 (Esc)">
                <ChevronDown size={20} />
              </button>
            </div>
            <div className="no-drag np-mode-switch">
              <Segmented<NpMode>
                layoutId="np-mode-seg"
                value={npMode}
                onChange={(v) => set({ npMode: v })}
                options={[
                  { value: 'apple', label: <Apple size={14} />, title: 'Apple Music' },
                  { value: 'vinyl', label: <Disc3 size={14} />, title: '黑胶唱片' },
                  { value: 'aurora', label: <Sparkles size={14} />, title: '流光' }
                ]}
              />
            </div>
            <div className="np-top-right no-drag">
              {npMode === 'apple' && (
                <button className={`np-round-btn ${npShowLyrics ? 'on' : ''}`} onClick={() => set({ npShowLyrics: !npShowLyrics })} title="显示/隐藏歌词">
                  <MessageSquareQuote size={16} />
                </button>
              )}
              <button
                className={`np-round-btn ${lyricsPanel ? 'on' : ''}`}
                onClick={() => {
                  setLyricsPanel(!lyricsPanel)
                  if (!lyricsPanel) toggleQueue(false)
                }}
                title="歌词搜索 / 下载 / 嵌入"
              >
                <FileMusic size={16} />
              </button>
              <button
                className={`np-round-btn ${queueOpen ? 'on' : ''}`}
                onClick={() => {
                  toggleQueue()
                  if (!queueOpen) setLyricsPanel(false)
                }}
                title="播放队列"
              >
                <ListMusic size={16} />
              </button>
              {windowControls === 'windows' && <WinControls />}
            </div>
          </div>
          <LyricsPanel t={track} />
          <QueuePanel onNp />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
