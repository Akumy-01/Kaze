import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import type { Lyrics, LyricLine, LyricWord } from '../lib/lrc'
import { activeIndex } from '../lib/lrc'
import { usePlayer } from '../store/player'
import { useSettings } from '../store/settings'
import { useLyricClock, useRaf } from './hooks'

interface Props {
  lyrics: Lyrics
  /** vertical anchor of active line as fraction of container height */
  anchor?: number
  fontSize?: number
  align?: 'left' | 'center'
  className?: string
}

export function LyricsView({ lyrics, anchor = 0.34, fontSize = 34, align, className = '' }: Props) {
  const s = useSettings()
  const al = align ?? s.lyricAlign
  const clock = useLyricClock()
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const activeRef = useRef(-1)
  const prevActiveRef = useRef(-1)
  const [active, setActive] = useState(-1)
  const [tops, setTops] = useState<number[]>([])
  const [height, setHeight] = useState(0)
  const [manual, setManual] = useState(0)
  const [userScroll, setUserScroll] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seek = usePlayer((st) => st.seek)
  const size = fontSize * s.lyricScale

  const syncActiveIndex = useCallback(() => {
    if (!lyrics.synced) return
    const idx = activeIndex(lyrics.lines, clock() + 0.05)
    if (idx !== activeRef.current) {
      prevActiveRef.current = activeRef.current
      activeRef.current = idx
      setActive(idx)
    }
  }, [lyrics, clock])

  // Track active line continuously from audio engine clock
  useRaf(syncActiveIndex, lyrics.synced)

  // Re-sync immediately when lyrics change
  useEffect(() => {
    activeRef.current = -1
    prevActiveRef.current = -1
    setManual(0)
    setUserScroll(false)
    lineRefs.current = []
    syncActiveIndex()
    return () => {
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
    }
  }, [lyrics, syncActiveIndex])

  // Measure line center positions accurately
  const measure = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    setHeight(c.clientHeight)
    setTops(lineRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0)))
  }, [])

  useLayoutEffect(() => {
    measure()
    if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
      ;(document as any).fonts.ready.then(() => measure()).catch(() => {})
    }
  }, [lyrics, size, s.showRoma, s.showTrans, al, measure])

  useEffect(() => {
    const c = containerRef.current
    const inner = innerRef.current
    if (!c) return
    const ro = new ResizeObserver(measure)
    ro.observe(c)
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [lyrics, measure])

  const resumeAutoFollow = useCallback(() => {
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    setUserScroll(false)
    setManual(0)
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    if (!lyrics.synced) return
    setUserScroll(true)
    setManual((m) => {
      const total = Math.max(0, (tops[tops.length - 1] ?? 0) - (tops[0] ?? 0))
      const base = active >= 0 ? (tops[active] ?? 0) - (tops[0] ?? 0) : 0
      return Math.max(-total + base - 80, Math.min(base + 80, m - e.deltaY))
    })
    if (scrollTimer.current) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      setUserScroll(false)
      setManual(0)
    }, 3200)
  }

  if (!lyrics.synced) {
    return (
      <div className={`lyrics-view unsynced ${className}`} style={{ textAlign: al }}>
        <div className="lv-hint">此歌词未同步时间轴</div>
        {lyrics.lines.map((l, i) => (
          <div key={i} className="lv-line static" style={{ fontSize: size * 0.72 }}>
            <div className="lv-text">{l.text}</div>
            {s.showRoma && l.roma && <div className="lv-roma">{l.roma}</div>}
            {s.showTrans && l.trans && <div className="lv-trans">{l.trans}</div>}
          </div>
        ))}
      </div>
    )
  }

  const anchorY = height * anchor
  const activeTop = active >= 0 ? tops[active] ?? 0 : Math.max(0, (tops[0] ?? 40) - 36)
  const baseY = anchorY - activeTop + manual
  const isStepAdvance = active - prevActiveRef.current === 1

  return (
    <div
      ref={containerRef}
      className={`lyrics-view ${userScroll ? 'user-scroll' : ''} ${className}`}
      onWheel={onWheel}
      style={{ textAlign: al }}
    >
      <div ref={innerRef} className="lv-inner">
        {lyrics.lines.map((l, i) => {
          const dist = Math.abs(i - active)
          const delay =
            !userScroll && isStepAdvance && i >= active && i - active <= 5
              ? (i - active) * 0.024
              : 0
          const blur = userScroll || dist === 0 ? 0 : Math.min(dist * 0.65, 2.8)
          return (
            <Line
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el
              }}
              line={l}
              next={lyrics.lines[i + 1]}
              active={i === active}
              passed={i < active}
              blur={blur}
              size={size}
              y={baseY}
              delay={delay}
              far={dist > 14}
              showRoma={s.showRoma}
              showTrans={s.showTrans}
              align={al}
              onClick={() => {
                seek(l.time + 0.01)
                resumeAutoFollow()
              }}
            />
          )
        })}
      </div>

      {userScroll && (
        <button
          className="lv-resume-btn no-drag"
          onClick={resumeAutoFollow}
          title="恢复自动跟随当前歌词"
        >
          <LocateFixed size={13} />
          <span>恢复跟随</span>
        </button>
      )}
    </div>
  )
}

interface LineProps {
  line: LyricLine
  next?: LyricLine
  active: boolean
  passed: boolean
  blur: number
  size: number
  y: number
  delay: number
  far: boolean
  showRoma: boolean
  showTrans: boolean
  align: 'left' | 'center'
  onClick: () => void
}

const Line = memo(function Line({
  line,
  next,
  active,
  passed,
  blur,
  size,
  y,
  delay,
  far,
  showRoma,
  showTrans,
  align,
  onClick,
  ref
}: LineProps & { ref?: React.Ref<HTMLDivElement> }) {
  const hasWords = !!(line.words && line.words.length > 0)
  return (
    <div
      ref={ref}
      className={`lv-line ${active ? 'active' : ''} ${passed ? 'passed' : ''} ${line.interlude ? 'interlude' : ''}`}
      style={{
        transform: `translate3d(0, ${y}px, 0) scale(${active ? 1 : 0.94})`,
        transitionDelay: delay > 0 ? `${delay}s, 0s, 0s, 0s` : undefined,
        filter: !far && blur ? `blur(${blur}px)` : undefined,
        fontSize: size,
        transformOrigin: align === 'center' ? 'center center' : 'left center',
        visibility: far ? 'hidden' : undefined
      }}
      onClick={onClick}
    >
      {line.interlude ? (
        <InterludeDots active={active} start={line.time} end={line.endTime ?? next?.time ?? line.time + 5} />
      ) : (
        <>
          {showRoma && line.roma && <div className="lv-roma">{line.roma}</div>}
          {hasWords && active ? (
            <WordSyncedLine words={line.words!} />
          ) : (
            <div className="lv-text">{line.text}</div>
          )}
          {showTrans && line.trans && <div className="lv-trans">{line.trans}</div>}
        </>
      )}
    </div>
  )
})

/**
 * True word-by-word progressive lyric highlight when word timestamps exist.
 */
function WordSyncedLine({ words }: { words: LyricWord[] }) {
  const clock = useLyricClock()
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])

  useRaf(() => {
    const t = clock() + 0.02
    for (let i = 0; i < words.length; i++) {
      const el = spanRefs.current[i]
      if (!el) continue
      const w = words[i]
      const dur = Math.max(0.04, w.end - w.start)
      const p = Math.max(0, Math.min(1, (t - w.start) / dur))
      el.style.setProperty('--wp', `${(p * 100).toFixed(1)}%`)
    }
  })

  return (
    <div className="lv-text lv-word-line">
      {words.map((w, i) => (
        <span
          key={i}
          ref={(el) => {
            spanRefs.current[i] = el
          }}
          className="lv-word"
        >
          {w.text}
        </span>
      ))}
    </div>
  )
}

function InterludeDots({ active, start, end }: { active: boolean; start: number; end: number }) {
  const clock = useLyricClock()
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  useRaf(() => {
    const p = Math.max(0, Math.min(1, (clock() - start) / Math.max(0.5, end - start - 0.3)))
    refs.current.forEach((el, i) => {
      if (!el) return
      const local = Math.max(0, Math.min(1, p * 3 - i))
      el.style.opacity = String(0.25 + local * 0.75)
    })
  }, active)
  return (
    <div className={`lv-dots ${active ? 'on' : ''}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
        />
      ))}
    </div>
  )
}
