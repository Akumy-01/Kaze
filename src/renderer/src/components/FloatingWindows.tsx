import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import type { DesktopLyricsAnimation, FloatingLyricLine, FloatingPlayerState } from '../../../shared/types'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { useLyrics } from '../store/lyrics'
import { useSettings } from '../store/settings'
import { activeIndex } from '../lib/lrc'
import { coverUrl, fmtTime } from '../lib/format'
import { DEFAULT_LOGO_URL } from './Cover'
import { DESKTOP_LYRICS_COLORS, DesktopLyricsWindow } from './DesktopLyricWindow'

export { DESKTOP_LYRICS_COLORS, DesktopLyricsWindow }

export const DESKTOP_LYRICS_ANIMS: { value: DesktopLyricsAnimation; label: string }[] = [
  { value: 'karaoke', label: '渐进扫光 (逐字)' },
  { value: 'none', label: '逐行高亮' }
]

/** Hook mounted once in the main Kaze window to sync playback/lyrics state with tray, shortcuts, Mini Player & Desktop Lyrics. */
export function useFloatingSync() {
  const currentId = usePlayer((s) => s.currentId)
  const playing = usePlayer((s) => s.playing)
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const track = useLibrary((s) => (currentId ? s.byId.get(currentId) : undefined))
  const lyrics = useLyrics((s) => s.lyrics)
  const minimizeToTray = useSettings((s) => s.minimizeToTray)
  const dlFontSize = useSettings((s) => s.desktopLyricsFontSize)
  const dlColor = useSettings((s) => s.desktopLyricsColor)
  const dlOpacity = useSettings((s) => s.desktopLyricsOpacity)
  const dlActiveZoom = useSettings((s) => s.desktopLyricsActiveZoom)
  const dlAnim = useSettings((s) => s.desktopLyricsAnimation)
  const dlLocked = useSettings((s) => s.desktopLyricsLocked)
  const dlRows = useSettings((s) => s.desktopLyricsRows)
  const dlWide = useSettings((s) => s.desktopLyricsWide)
  const dlDirection = useSettings((s) => s.desktopLyricsDirection)
  const dlAlwaysOnTop = useSettings((s) => s.desktopLyricsAlwaysOnTop)
  const dlHoverHide = useSettings((s) => s.desktopLyricsHoverHide)
  const dlPauseHide = useSettings((s) => s.desktopLyricsPauseHide)
  const dlBold = useSettings((s) => s.desktopLyricsBold)
  const showTrans = useSettings((s) => s.showTrans)
  const showRoma = useSettings((s) => s.showRoma)

  useEffect(() => {
    window.kaze.win.setMinimizeToTray(minimizeToTray)
  }, [minimizeToTray])

  useEffect(() => {
    window.kaze.floating.setDesktopLyricsLocked(dlLocked)
  }, [dlLocked])

  useEffect(() => {
    window.kaze.floating.setDesktopLyricsAlwaysOnTop(dlAlwaysOnTop)
  }, [dlAlwaysOnTop])

  useEffect(() => {
    window.kaze.floating.setDesktopLyricsSize({ rows: dlRows, wide: dlWide, fontSize: dlFontSize, direction: dlDirection })
  }, [dlRows, dlWide, dlFontSize, dlDirection])

  useEffect(() => {
    return window.kaze.floating.onCommand((cmd) => {
      const p = usePlayer.getState()
      if (cmd.type === 'toggle') p.toggle()
      else if (cmd.type === 'play') p.play()
      else if (cmd.type === 'pause') p.pause()
      else if (cmd.type === 'next') p.next()
      else if (cmd.type === 'prev') p.prev()
      else if (cmd.type === 'seek' && typeof cmd.value === 'number') p.seek(cmd.value)
      else if (cmd.type === 'unlockLyrics') useSettings.getState().set({ desktopLyricsLocked: false })
      else if (cmd.type === 'setLyricsConfig' && cmd.value && typeof cmd.value === 'object') {
        useSettings.getState().set(cmd.value as Partial<ReturnType<typeof useSettings.getState>>)
      }
    })
  }, [])

  const floatingLines = useMemo<FloatingLyricLine[] | undefined>(() => {
    if (!lyrics?.synced || !lyrics.lines.length) return undefined
    return lyrics.lines
      .filter((l) => !l.interlude && l.text.trim().length > 0)
      .map((l) => ({
        time: l.time,
        endTime: l.endTime,
        text: l.text,
        trans: l.trans,
        roma: l.roma,
        words: l.words
      }))
  }, [lyrics])

  useEffect(() => {
    let text = ''
    let trans = ''
    let roma = ''
    let nextText = ''
    let lyricProgress = 0
    let lineStartTime: number | undefined
    let lineEndTime: number | undefined
    let lyricWords: { start: number; end: number; text: string }[] | undefined
    let lyricLineKey = `${currentId ?? 'none'}`
    let activeLineIndex = -1

    if (floatingLines?.length) {
      activeLineIndex = activeIndex(floatingLines, currentTime + 0.08)
      const line = activeLineIndex >= 0 ? floatingLines[activeLineIndex] : undefined
      if (line) {
        text = line.text
        trans = line.trans ?? ''
        roma = line.roma ?? ''
        lyricWords = line.words?.length ? line.words : undefined
        lyricLineKey = `${currentId ?? 't'}-${activeLineIndex}-${line.time}`
        lineStartTime = line.time
        const nextLine = activeLineIndex + 1 < floatingLines.length ? floatingLines[activeLineIndex + 1] : undefined
        nextText = nextLine?.text ?? ''
        const candidateEnd = line.endTime ?? nextLine?.time ?? duration
        lineEndTime = candidateEnd > line.time + 0.25 ? candidateEnd : line.time + 3.5
        const span = Math.max(0.3, lineEndTime - line.time)
        lyricProgress = Math.max(0, Math.min(1, (currentTime - line.time) / span))
      } else {
        nextText = floatingLines[0].text
      }
    }
    const payload: FloatingPlayerState = {
      currentId,
      title: track?.title ?? 'Kaze',
      artist: track?.artist ?? '等待播放',
      album: track?.album ?? '',
      cover: track?.cover,
      playing,
      currentTime,
      duration,
      syncedAtMs: Date.now(),
      lyricText: text,
      lyricTrans: trans,
      lyricRoma: roma,
      nextLyricText: nextText,
      lyricProgress,
      lineStartTime,
      lineEndTime,
      lyricWords,
      lyricLineKey,
      lyricLines: floatingLines,
      activeLineIndex,
      desktopLyricsFontSize: dlFontSize,
      desktopLyricsColor: dlColor,
      desktopLyricsOpacity: dlOpacity,
      desktopLyricsActiveZoom: dlActiveZoom,
      desktopLyricsAnimation: dlAnim,
      desktopLyricsLocked: dlLocked,
      desktopLyricsRows: dlRows,
      desktopLyricsWide: dlWide,
      desktopLyricsDirection: dlDirection,
      desktopLyricsAlwaysOnTop: dlAlwaysOnTop,
      desktopLyricsHoverHide: dlHoverHide,
      desktopLyricsPauseHide: dlPauseHide,
      desktopLyricsBold: dlBold,
      desktopLyricsShowTrans: showTrans,
      desktopLyricsShowRoma: showRoma
    }
    window.kaze.floating.syncState(payload as unknown as Record<string, unknown>)
  }, [
    currentId,
    playing,
    Math.floor(currentTime * 4),
    duration,
    track?.title,
    track?.artist,
    track?.cover,
    floatingLines,
    dlFontSize,
    dlColor,
    dlOpacity,
    dlActiveZoom,
    dlAnim,
    dlLocked,
    dlRows,
    dlWide,
    dlDirection,
    dlAlwaysOnTop,
    dlHoverHide,
    dlPauseHide,
    dlBold,
    showTrans,
    showRoma
  ])
}

/** JS pointer drag handler locking fixed window bounds in main process to prevent Windows DPI resize bugs. */
function useWindowDrag(enabled = true) {
  const draggingRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return
      const target = e.target as HTMLElement | null
      if (target?.closest('button, input, [data-nodrag="true"]')) return
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      window.kaze.floating.dragStart()
    },
    [enabled]
  )

  const onPointerMove = useCallback(() => {
    if (!draggingRef.current) return
    window.kaze.floating.dragMove()
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp }
}

export function MiniPlayerWindow() {
  const [st, setSt] = useState<FloatingPlayerState | null>(null)
  const [dragPct, setDragPct] = useState<number | null>(null)
  const [barHovered, setBarHovered] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const windowDrag = useWindowDrag(true)

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    void window.kaze.floating.getState().then((v) => v && setSt(v as unknown as FloatingPlayerState))
    return window.kaze.floating.onState((v) => setSt(v as FloatingPlayerState))
  }, [])

  const dur = st?.duration ?? 0
  const basePct = st && dur > 0 ? Math.max(0, Math.min(100, (st.currentTime / dur) * 100)) : 0
  const displayPct = dragPct ?? basePct
  const shownTime = dragPct !== null ? (dragPct / 100) * dur : (st?.currentTime ?? 0)
  const img = coverUrl({ cover: st?.cover }) ?? DEFAULT_LOGO_URL

  const calcPct = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100))
  }

  return (
    <div
      {...windowDrag}
      style={{
        width: '100vw',
        height: '100vh',
        borderRadius: 18,
        background: 'linear-gradient(145deg, rgba(24, 26, 33, 0.94), rgba(15, 17, 23, 0.92))',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        color: '#f5f5f7',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '12px 14px 10px',
        overflow: 'hidden',
        boxSizing: 'border-box',
        cursor: 'grab'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
          src={img}
          alt=""
          draggable={false}
          style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.35)' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {st?.title || 'Kaze'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(245,245,247,0.72)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {st?.artist || '本地高解析播放器'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => window.kaze.floating.sendCommand({ type: 'prev' })}
              style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff' }}
              title="上一首"
            >
              <SkipBack size={15} />
            </button>
            <button
              onClick={() => window.kaze.floating.sendCommand({ type: 'toggle' })}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                background: '#fff',
                color: '#111'
              }}
              title={st?.playing ? '暂停' : '播放'}
            >
              {st?.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 1 }} />}
            </button>
            <button
              onClick={() => window.kaze.floating.sendCommand({ type: 'next' })}
              style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#fff' }}
              title="下一首"
            >
              <SkipForward size={15} />
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'rgba(245,245,247,0.65)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtTime(shownTime)} / {fmtTime(dur)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start' }}>
          <button
            onClick={() => window.kaze.floating.toggleMini(false)}
            style={{ width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.75)' }}
            title="关闭迷你窗"
          >
            <X size={13} />
          </button>
          <button
            onClick={() => window.kaze.floating.sendCommand({ type: 'showMain' })}
            style={{ width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.75)' }}
            title="回到主窗口"
          >
            <Maximize2 size={12} />
          </button>
        </div>
      </div>

      {/* Interactive scrubbable progress track */}
      <div
        ref={barRef}
        data-nodrag="true"
        onMouseEnter={() => setBarHovered(true)}
        onMouseLeave={() => setBarHovered(false)}
        onPointerDown={(e) => {
          if (dur <= 0) return
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragPct(calcPct(e.clientX))
        }}
        onPointerMove={(e) => {
          if (dragPct === null) return
          setDragPct(calcPct(e.clientX))
        }}
        onPointerUp={(e) => {
          if (dragPct === null) return
          const pct = calcPct(e.clientX)
          setDragPct(null)
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
          if (dur > 0) {
            window.kaze.floating.sendCommand({ type: 'seek', value: (pct / 100) * dur })
          }
        }}
        style={{
          position: 'relative',
          height: 16,
          display: 'flex',
          alignItems: 'center',
          cursor: dur > 0 ? 'pointer' : 'default'
        }}
        title="点击或拖动调节播放进度"
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: barHovered || dragPct !== null ? 5 : 3.5,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.18)',
            transition: 'height 0.14s'
          }}
        >
          <div
            style={{
              width: `${displayPct}%`,
              height: '100%',
              borderRadius: 999,
              background: 'var(--accent, #fa2d48)',
              transition: dragPct !== null ? 'none' : 'width 0.2s linear'
            }}
          />
          {(barHovered || dragPct !== null) && dur > 0 && (
            <div
              style={{
                position: 'absolute',
                left: `${displayPct}%`,
                top: '50%',
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                transform: 'translate(-50%, -50%)'
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
