import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FloatingLyricLine, FloatingPlayerState } from '../../../shared/types'
import '../styles/desktop-lyric.css'

export const DESKTOP_LYRICS_COLORS = [
  { name: '翡翠绿', value: '#07c556' },
  { name: '天依蓝', value: '#38bdf8' },
  { name: '初音青', value: '#00d2a8' },
  { name: '紫罗兰', value: '#a855f7' },
  { name: '流光粉', value: '#ff5c7c' },
  { name: '琥珀金', value: '#fbbf24' },
  { name: '纯白', value: '#ffffff' }
]

const sendCmd = (type: string, value?: unknown) => window.kaze.floating.sendCommand({ type, value })

/** Derive alpha-tinted text shadow variables for karaoke and line modes */
function buildColorVars(playedColor: string) {
  return {
    '--color-lyric-unplay': 'rgba(255, 255, 255, 1)',
    '--color-lyric-played': playedColor || '#07c556',
    '--color-lyric-shadow': 'rgba(0, 0, 0, 0.34)',
    '--color-lyric-shadow-font-mode': 'rgba(0, 0, 0, 0.22)'
  } as React.CSSProperties
}

/** Smooth cubic easeOut scroll */
function smoothScrollTo(
  el: HTMLElement,
  target: number,
  horizontal: boolean,
  duration = 280,
  cancelRef: React.MutableRefObject<(() => void) | null>
) {
  if (cancelRef.current) cancelRef.current()
  const start = horizontal ? el.scrollLeft : el.scrollTop
  const change = target - start
  if (Math.abs(change) < 1) {
    if (horizontal) el.scrollLeft = target
    else el.scrollTop = target
    return
  }
  const t0 = performance.now()
  let cancelled = false
  let raf = 0
  cancelRef.current = () => {
    cancelled = true
    cancelAnimationFrame(raf)
  }
  const step = (now: number) => {
    if (cancelled) return
    const p = Math.min(1, (now - t0) / duration)
    const eased = 1 - Math.pow(1 - p, 3)
    const val = start + change * eased
    if (horizontal) el.scrollLeft = val
    else el.scrollTop = val
    if (p < 1) raf = requestAnimationFrame(step)
    else cancelRef.current = null
  }
  raf = requestAnimationFrame(step)
}

function computeLineSweepPct(line: FloatingLyricLine, nowSec: number, fallbackEnd: number): number {
  const start = line.time
  const end = line.endTime && line.endTime > start + 0.1 ? line.endTime : Math.max(start + 2.8, fallbackEnd)
  if (nowSec <= start) return 0
  if (nowSec >= end) return 100

  if (line.words && line.words.length > 0) {
    const totalChars = line.words.reduce((acc, w) => acc + Math.max(1, w.text.length), 0)
    let passed = 0
    for (const w of line.words) {
      const len = Math.max(1, w.text.length)
      if (nowSec >= w.end) {
        passed += len
      } else if (nowSec > w.start) {
        const frac = (nowSec - w.start) / Math.max(0.05, w.end - w.start)
        passed += len * Math.max(0, Math.min(1, frac))
        break
      } else {
        break
      }
    }
    return Math.max(0, Math.min(100, (passed / totalChars) * 100))
  }

  return Math.max(0, Math.min(100, ((nowSec - start) / Math.max(0.25, end - start)) * 100))
}

/** Vector control icons */
function DlIcon({ name, size = 19 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
    unlock:
      'M18,20V10H6V20H18M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10A2,2 0 0,1 6,8H15V6A3,3 0 0,0 12,3A3,3 0 0,0 9,6H7A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,17A2,2 0 0,1 10,15A2,2 0 0,1 12,13A2,2 0 0,1 14,15A2,2 0 0,1 12,17Z',
    lock: 'M12,17C10.89,17 10,16.1 10,15C10,13.89 10.89,13 12,13A2,2 0 0,1 14,15A2,2 0 0,1 12,17M18,20V10H6V20H18M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6C4.89,22 4,21.1 4,20V10C4,8.89 4.89,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z',
    fontDec: 'M5.12,14L7.5,7.67L9.87,14M6.5,5L1,19H3.25L4.37,16H10.62L11.75,19H14L8.5,5H6.5M18,17L23,11.93L21.59,10.5L19,13.1V7H17V13.1L14.41,10.5L13,11.93L18,17Z',
    fontInc: 'M5.12,14L7.5,7.67L9.87,14M6.5,5L1,19H3.25L4.37,16H10.62L11.75,19H14L8.5,5H6.5M18,7L13,12.07L14.41,13.5L17,10.9V17H19V10.9L21.59,13.5L23,12.07L18,7Z',
    opInc:
      'M12,6A6,6 0 0,1 18,12C18,14.22 16.79,16.16 15,17.2V19A1,1 0 0,1 14,20H10A1,1 0 0,1 9,19V17.2C7.21,16.16 6,14.22 6,12A6,6 0 0,1 12,6M14,21V22A1,1 0 0,1 13,23H11A1,1 0 0,1 10,22V21H14M20,11H23V13H20V11M1,11H4V13H1V11M13,1V4H11V1H13M4.92,3.5L7.05,5.64L5.63,7.05L3.5,4.93L4.92,3.5M16.95,5.63L19.07,3.5L20.5,4.93L18.37,7.05L16.95,5.63Z',
    opDec:
      'M20,11H23V13H20V11M1,11H4V13H1V11M13,1V4H11V1H13M4.92,3.5L7.05,5.64L5.63,7.05L3.5,4.93L4.92,3.5M16.95,5.63L19.07,3.5L20.5,4.93L18.37,7.05L16.95,5.63M12,6A6,6 0 0,1 18,12C18,14.22 16.79,16.16 15,17.2V19A1,1 0 0,1 14,20H10A1,1 0 0,1 9,19V17.2C7.21,16.16 6,14.22 6,12A6,6 0 0,1 12,6M14,21V22A1,1 0 0,1 13,23H11A1,1 0 0,1 10,22V21H14M11,18H13V15.87C14.73,15.43 16,13.86 16,12A4,4 0 0,0 12,8A4,4 0 0,0 8,12C8,13.86 9.27,15.43 11,15.87V18Z',
    topOn: 'M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z',
    topOff: 'M2,5.27L3.28,4L20,20.72L18.73,22L12.8,16.07V22H11.2V16H6V14L8,12V11.27L2,5.27M16,12L18,14V16H17.82L8,6.18V4H7V2H17V4H16V12Z',
    theme:
      'M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z',
    zoomOn: 'M16,19H8V5H16M16.5,3H7.5A1.5,1.5 0 0,0 6,4.5V19.5A1.5,1.5 0 0,0 7.5,21H16.5A1.5,1.5 0 0,0 18,19.5V4.5A1.5,1.5 0 0,0 16.5,3M19,17H21V7H19M22,9V15H24V9M3,17H5V7H3M0,15H2V9H0V15Z',
    zoomOff:
      'M8.2,5L6.55,3.35C6.81,3.12 7.15,3 7.5,3H16.5A1.5,1.5 0 0,1 18,4.5V14.8L16,12.8V5H8.2M0,15H2V9H0V15M21,17V7H19V15.8L20.2,17H21M3,17H5V7H3V17M18,17.35L22.11,21.46L20.84,22.73L18,19.85C17.83,20.54 17.21,21 16.5,21H7.5A1.5,1.5 0 0,1 6,19.5V7.89L1.11,3L2.39,1.73L6.09,5.44L8,7.34L16,15.34L18,17.34V17.35M16,17.89L8,9.89V19H16V17.89M22,9V15H24V9H22Z',
    prev: 'M6,18V6H8V18H6M9.5,12L18,6V18L9.5,12Z',
    next: 'M16,18H18V6H16M6,18L14.5,12L6,6V18Z',
    play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
    pause: 'M14,19H18V5H14M6,19H10V5H6V19Z',
    dirH: 'M3,5H21V7H3V5M3,11H21V13H3V11M3,17H21V19H3V17Z',
    dirV: 'M5,3H7V21H5V3M11,3H13V21H11V3M17,3H19V21H17V3Z'
  }
  if (name === 'back') {
    return (
      <svg width={size} height={size} viewBox="0 0 512 512" fill="currentColor">
        <path d="M511.563,434.259c-1.728-142.329-124.42-258.242-277.087-263.419V95.999c0-17.645-14.342-31.999-31.974-31.999 c-7.931,0-15.591,3.042-21.524,8.562c0,0-134.828,124.829-173.609,163.755C2.623,241.109,0,248.088,0,255.994 c0,7.906,2.623,14.885,7.369,19.687c38.781,38.915,173.609,163.745,173.609,163.745c5.933,5.521,13.593,8.562,21.524,8.562 c17.631,0,31.974-14.354,31.974-31.999v-74.591c153.479,2.156,255.792,50.603,255.792,95.924c0,5.896,4.767,10.666,10.658,10.666 c0.167,0.021,0.333,0.01,0.416,0c5.891,0,10.658-4.771,10.658-10.666C512,436.259,511.854,435.228,511.563,434.259z" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d={paths[name] || ''} />
    </svg>
  )
}

export function DesktopLyricsWindow() {
  const [st, setSt] = useState<FloatingPlayerState | null>(null)
  const [unlockHover, setUnlockHover] = useState(false)
  const [showThemeBar, setShowThemeBar] = useState(false)
  const [mouseEnter, setMouseEnter] = useState(false)
  const [pauseHidden, setPauseHidden] = useState(false)
  const [draggingLyrics, setDraggingLyrics] = useState(false)
  const [smoothTime, setSmoothTime] = useState(0)

  const stageRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const cancelScrollRef = useRef<(() => void) | null>(null)
  const stopAutoScrollRef = useRef(false)
  const resumeTimerRef = useRef<number | null>(null)
  const draggingWinRef = useRef(false)
  const resizeEdgeRef = useRef<string | null>(null)
  const lyricDragRef = useRef<{ startCoord: number; startScroll: number } | null>(null)

  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'
    void window.kaze.floating.getState().then((v) => v && setSt(v as unknown as FloatingPlayerState))
    const u1 = window.kaze.floating.onState((v) => setSt(v as FloatingPlayerState))
    const u2 = window.kaze.floating.onUnlockHover((h) => setUnlockHover(h))
    return () => {
      u1()
      u2()
    }
  }, [])

  const isLocked = !!st?.desktopLyricsLocked
  const fontSize = Math.max(12, Math.min(80, st?.desktopLyricsFontSize ?? 24))
  const opacity = Math.max(6, Math.min(100, st?.desktopLyricsOpacity ?? 95)) / 100
  const color = st?.desktopLyricsColor ?? '#07c556'
  const activeZoom = st?.desktopLyricsActiveZoom ?? true
  const isFontMode = (st?.desktopLyricsAnimation ?? 'karaoke') === 'karaoke'
  const isVertical = st?.desktopLyricsDirection === 'vertical'
  const isAlwaysOnTop = st?.desktopLyricsAlwaysOnTop ?? true
  const isHoverHide = !!st?.desktopLyricsHoverHide
  const isPauseHide = !!st?.desktopLyricsPauseHide
  const isBold = !!st?.desktopLyricsBold

  // High-FPS smooth clock for karaoke gradient sweep
  useEffect(() => {
    const baseTime = st?.currentTime ?? 0
    const syncedAt = st?.syncedAtMs ?? Date.now()
    if (!st?.playing) {
      setSmoothTime(baseTime)
      return
    }
    let raf = 0
    const tick = () => {
      const next = baseTime + Math.max(0, (Date.now() - syncedAt) / 1000)
      setSmoothTime(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [st?.playing, st?.currentTime, st?.syncedAtMs])

  // Auto-hide on pause (200ms debounce)
  useEffect(() => {
    if (!isPauseHide) {
      setPauseHidden(false)
      return
    }
    if (st?.playing) {
      setPauseHidden(false)
      return
    }
    const t = window.setTimeout(() => setPauseHidden(true), 200)
    return () => window.clearTimeout(t)
  }, [isPauseHide, st?.playing])

  // Global mousemove/mouseup for drag & resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingWinRef.current) {
        window.kaze.floating.dragMove()
      } else if (resizeEdgeRef.current) {
        window.kaze.floating.resizeMove()
      } else if (lyricDragRef.current && stageRef.current) {
        stopAutoScrollRef.current = true
        const curCoord = isVertical ? e.clientX : e.clientY
        const delta = lyricDragRef.current.startCoord - curCoord
        if (isVertical) {
          stageRef.current.scrollLeft = lyricDragRef.current.startScroll + delta
        } else {
          stageRef.current.scrollTop = lyricDragRef.current.startScroll + delta
        }
      }
    }
    const onUp = () => {
      if (draggingWinRef.current) draggingWinRef.current = false
      if (resizeEdgeRef.current) resizeEdgeRef.current = null
      if (lyricDragRef.current) {
        lyricDragRef.current = null
        setDraggingLyrics(false)
        scheduleResumeScroll()
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isVertical])

  const lines = useMemo<FloatingLyricLine[]>(() => {
    if (st?.lyricLines?.length) return st.lyricLines
    if (st?.lyricText) {
      return [
        {
          time: st.lineStartTime ?? 0,
          endTime: st.lineEndTime,
          text: st.lyricText,
          trans: st.lyricTrans || undefined,
          roma: st.lyricRoma || undefined,
          words: st.lyricWords
        }
      ]
    }
    return [
      {
        time: 0,
        text: st?.title ? `${st.title}${st.artist ? ` - ${st.artist}` : ''}` : 'Kaze 桌面歌词'
      }
    ]
  }, [st?.lyricLines, st?.lyricText, st?.lineStartTime, st?.lineEndTime, st?.lyricTrans, st?.lyricRoma, st?.lyricWords, st?.title, st?.artist])

  const activeIdx = useMemo(() => {
    if (!st?.lyricLines?.length) return 0
    if (typeof st.activeLineIndex === 'number' && st.activeLineIndex >= 0) {
      return Math.min(lines.length - 1, st.activeLineIndex)
    }
    return 0
  }, [st?.lyricLines, st?.activeLineIndex, lines.length])

  const scrollToActive = useCallback(
    (duration = 280) => {
      const stage = stageRef.current
      if (!stage || stopAutoScrollRef.current) return
      const targetEl = lineRefs.current[activeIdx]
      if (!targetEl) {
        smoothScrollTo(stage, 0, isVertical, duration, cancelScrollRef)
        return
      }
      if (isVertical) {
        const dest = targetEl.offsetLeft - stage.clientWidth * 0.5 + targetEl.clientWidth / 2
        smoothScrollTo(stage, dest, true, duration, cancelScrollRef)
      } else {
        const dest = targetEl.offsetTop - stage.clientHeight * 0.5 + targetEl.clientHeight / 2
        smoothScrollTo(stage, Math.max(0, dest), false, duration, cancelScrollRef)
      }
    },
    [activeIdx, isVertical]
  )

  useEffect(() => {
    scrollToActive(300)
  }, [scrollToActive, fontSize, lines.length])

  const scheduleResumeScroll = () => {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = window.setTimeout(() => {
      stopAutoScrollRef.current = false
      scrollToActive(320)
    }, 3000)
  }

  const handleWheel = (e: React.WheelEvent) => {
    const stage = stageRef.current
    if (!stage || isLocked) return
    stopAutoScrollRef.current = true
    if (cancelScrollRef.current) cancelScrollRef.current()
    if (isVertical) stage.scrollLeft += e.deltaY * 0.6
    else stage.scrollTop += e.deltaY * 0.6
    scheduleResumeScroll()
  }

  const handleStageMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || isLocked) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button')) return
    if (target?.closest('.font-lrc') || target?.closest('.extended')) {
      if (!stageRef.current) return
      setDraggingLyrics(true)
      lyricDragRef.current = {
        startCoord: isVertical ? e.clientX : e.clientY,
        startScroll: isVertical ? stageRef.current.scrollLeft : stageRef.current.scrollTop
      }
    } else {
      draggingWinRef.current = true
      window.kaze.floating.dragStart()
    }
  }

  const startResize = (edge: string, e: React.MouseEvent) => {
    if (e.button !== 0 || isLocked) return
    e.stopPropagation()
    resizeEdgeRef.current = edge
    window.kaze.floating.resizeStart(edge)
  }

  const handleFontStep = (delta: number) => {
    sendCmd('setLyricsConfig', {
      desktopLyricsFontSize: Math.max(12, Math.min(80, fontSize + delta))
    })
  }

  const handleOpacityStep = (delta: number) => {
    const cur = st?.desktopLyricsOpacity ?? 95
    sendCmd('setLyricsConfig', {
      desktopLyricsOpacity: Math.max(6, Math.min(100, cur + delta))
    })
  }

  const showHoverHide = isHoverHide && mouseEnter
  const showTrans = st?.desktopLyricsShowTrans ?? true
  const showRoma = st?.desktopLyricsShowRoma ?? true

  return (
    <div
      className={`kaze-dl-container${isLocked ? ' lock' : ''}${pauseHidden || showHoverHide ? ' hide' : ''}`}
      style={buildColorVars(color)}
      onMouseEnter={() => setMouseEnter(true)}
      onMouseMove={() => !mouseEnter && setMouseEnter(true)}
      onMouseLeave={() => setMouseEnter(false)}
    >
      {/* Top unlock pill visible only when cursor hovers its hotzone while locked */}
      {isLocked && (
        <button
          className="kaze-dl-unlock-pill"
          style={{ opacity: unlockHover ? 1 : 0, pointerEvents: unlockHover ? 'auto' : 'none' }}
          title="解锁桌面歌词"
          onClick={() => sendCmd('setLyricsConfig', { desktopLyricsLocked: false })}
        >
          <DlIcon name="unlock" size={14} />
          <span>解锁</span>
        </button>
      )}

      <div className="kaze-dl-main">
        {/* Control Bar (top overlay shown on hover when unlocked) */}
        {!isLocked && (
          <div className={`kaze-dl-control-bar${showThemeBar ? ' pin' : ''}`}>
            {!showThemeBar ? (
              <div
                className="kaze-dl-btns"
                onMouseDown={(e) => {
                  const target = e.target as HTMLElement | null
                  if (e.button === 0 && !target?.closest('button')) {
                    draggingWinRef.current = true
                    window.kaze.floating.dragStart()
                  }
                }}
              >
                <button className="kaze-dl-btn" title="关闭桌面歌词" onClick={() => void window.kaze.floating.toggleDesktopLyrics(false)}>
                  <DlIcon name="close" />
                </button>
                <button className="kaze-dl-btn" title="锁定桌面歌词" onClick={() => sendCmd('setLyricsConfig', { desktopLyricsLocked: true })}>
                  <DlIcon name="lock" />
                </button>
                <button className="kaze-dl-btn" title="放大字体" onClick={() => handleFontStep(1)}>
                  <DlIcon name="fontInc" />
                </button>
                <button className="kaze-dl-btn" title="缩小字体" onClick={() => handleFontStep(-1)}>
                  <DlIcon name="fontDec" />
                </button>
                <button className="kaze-dl-btn" title="增加透明度" onClick={() => handleOpacityStep(10)}>
                  <DlIcon name="opInc" />
                </button>
                <button className="kaze-dl-btn" title="降低透明度" onClick={() => handleOpacityStep(-10)}>
                  <DlIcon name="opDec" />
                </button>
                <button
                  className={`kaze-dl-btn${activeZoom ? ' active' : ''}`}
                  title={activeZoom ? '关闭当前歌词缩放' : '开启当前歌词缩放'}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsActiveZoom: !activeZoom })}
                >
                  <DlIcon name={activeZoom ? 'zoomOff' : 'zoomOn'} />
                </button>
                <button
                  className={`kaze-dl-btn${isAlwaysOnTop ? ' active' : ''}`}
                  title={isAlwaysOnTop ? '取消置顶' : '窗口置顶'}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsAlwaysOnTop: !isAlwaysOnTop })}
                >
                  <DlIcon name={isAlwaysOnTop ? 'topOff' : 'topOn'} />
                </button>
                <button
                  className="kaze-dl-btn"
                  title={isVertical ? '切换横向歌词' : '切换竖向歌词'}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsDirection: isVertical ? 'horizontal' : 'vertical' })}
                >
                  <DlIcon name={isVertical ? 'dirH' : 'dirV'} />
                </button>
                <button className="kaze-dl-btn" title="歌词外观与选项" onClick={() => setShowThemeBar(true)}>
                  <DlIcon name="theme" />
                </button>

                <span className="kaze-dl-sep" />

                <button className="kaze-dl-btn" title="上一曲" onClick={() => sendCmd('prev')}>
                  <DlIcon name="prev" />
                </button>
                <button className="kaze-dl-btn" title={st?.playing ? '暂停' : '播放'} onClick={() => sendCmd('toggle')}>
                  <DlIcon name={st?.playing ? 'pause' : 'play'} />
                </button>
                <button className="kaze-dl-btn" title="下一曲" onClick={() => sendCmd('next')}>
                  <DlIcon name="next" />
                </button>
              </div>
            ) : (
              <div className="kaze-dl-theme-bar">
                <button className="kaze-dl-btn" style={{ minHeight: 24, padding: '0 6px' }} title="返回" onClick={() => setShowThemeBar(false)}>
                  <DlIcon name="back" size={14} />
                </button>
                {DESKTOP_LYRICS_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.name}
                    className={`kaze-dl-swatch${color === c.value ? ' selected' : ''}`}
                    style={{ background: c.value }}
                    onClick={() => sendCmd('setLyricsConfig', { desktopLyricsColor: c.value })}
                  />
                ))}
                <button
                  className={`kaze-dl-chip${isFontMode ? ' on' : ''}`}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsAnimation: isFontMode ? 'none' : 'karaoke' })}
                >
                  {isFontMode ? '逐字扫光' : '逐行高亮'}
                </button>
                <button
                  className={`kaze-dl-chip${isBold ? ' on' : ''}`}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsBold: !isBold })}
                >
                  加粗
                </button>
                <button
                  className={`kaze-dl-chip${isHoverHide ? ' on' : ''}`}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsHoverHide: !isHoverHide })}
                >
                  悬停隐藏
                </button>
                <button
                  className={`kaze-dl-chip${isPauseHide ? ' on' : ''}`}
                  onClick={() => sendCmd('setLyricsConfig', { desktopLyricsPauseHide: !isPauseHide })}
                >
                  暂停隐藏
                </button>
              </div>
            )}
          </div>
        )}

        {/* Lyric Stage */}
        <div
          ref={stageRef}
          className={`kaze-dl-lyric${isVertical ? ' vertical' : ''}${draggingLyrics ? ' dragging' : ''}${activeZoom ? ' zoom-active' : ''}${isBold ? ' bold-font' : ''}`}
          style={{ fontSize: `${fontSize}px`, opacity }}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
        >
          <div className="kaze-dl-lyric-space" />
          <div>
            {lines.map((line, idx) => {
              const isActive = idx === activeIdx
              const isPlayed = idx < activeIdx
              const nextLine = idx + 1 < lines.length ? lines[idx + 1] : undefined
              const fallbackEnd = nextLine ? nextLine.time : line.time + 3.8
              const pct = isActive ? computeLineSweepPct(line, smoothTime, fallbackEnd) : isPlayed ? 100 : 0
              const modeCls = isFontMode ? 'font-mode' : 'line-mode'
              const stateCls = isActive ? ' active' : isPlayed ? ' played' : ''

              return (
                <div
                  key={`${idx}-${line.time}`}
                  ref={(el) => {
                    lineRefs.current[idx] = el
                  }}
                  className={`kaze-dl-line-content ${modeCls}${stateCls}`}
                >
                  <div className="line">
                    {isFontMode ? (
                      <div className="lrc-wrap">
                        <div className="shadow" aria-hidden="true">
                          <span>{line.text}</span>
                        </div>
                        <div className="font-lrc">
                          <span style={{ backgroundSize: `${pct.toFixed(2)}% 100%` }}>{line.text}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="font-lrc">{line.text}</div>
                    )}
                  </div>
                  {showTrans && line.trans && (
                    <div className="extended">
                      <div className="font-lrc">{line.trans}</div>
                    </div>
                  )}
                  {showRoma && line.roma && (
                    <div className="extended">
                      <div className="font-lrc" style={{ opacity: 0.85, fontSize: '0.88em' }}>
                        {line.roma}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="kaze-dl-lyric-space" />
        </div>
      </div>

      {/* 8 Resize Handles (disabled when locked) */}
      {!isLocked && (
        <>
          <div className="kaze-dl-resize kaze-dl-resize-left" onMouseDown={(e) => startResize('left', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-right" onMouseDown={(e) => startResize('right', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-top" onMouseDown={(e) => startResize('top', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-bottom" onMouseDown={(e) => startResize('bottom', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-top-left" onMouseDown={(e) => startResize('top-left', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-top-right" onMouseDown={(e) => startResize('top-right', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-bottom-left" onMouseDown={(e) => startResize('bottom-left', e)} />
          <div className="kaze-dl-resize kaze-dl-resize-bottom-right" onMouseDown={(e) => startResize('bottom-right', e)} />
        </>
      )}
    </div>
  )
}
