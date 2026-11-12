import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Lyrics, LyricLine } from '../lib/lrc'
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

export function LyricsView({ lyrics, anchor = 0.32, fontSize = 34, align, className = '' }: Props) {
  const s = useSettings()
  const al = align ?? s.lyricAlign
  const clock = useLyricClock()
  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const [tops, setTops] = useState<number[]>([])
  const [height, setHeight] = useState(0)
  const [manual, setManual] = useState(0)
  const [userScroll, setUserScroll] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const seek = usePlayer((st) => st.seek)
  const size = fontSize * s.lyricScale

  // track active line
  useRaf(() => {
    if (!lyrics.synced) return
    const idx = activeIndex(lyrics.lines, clock() + 0.25)
    if (idx !== active) setActive(idx)
  })

  // measure
  const measure = () => {
    const c = containerRef.current
    if (!c) return
    setHeight(c.clientHeight)
    setTops(lineRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0)))
  }
  useLayoutEffect(measure, [lyrics, size, s.showRoma, s.showTrans, al])
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const ro = new ResizeObserver(measure)
    ro.observe(c)
    return () => ro.disconnect()
  }, [lyrics]) // eslint-disable-line

  useEffect(() => {
    setManual(0)
    setUserScroll(false)
    lineRefs.current = []
  }, [lyrics])

  const onWheel = (e: React.WheelEvent) => {
    if (!lyrics.synced) return
    setUserScroll(true)
    setManual((m) => {
      const total = (tops[tops.length - 1] ?? 0) - (tops[0] ?? 0)
      const base = active >= 0 ? tops[active] - (tops[0] ?? 0) : 0
      return Math.max(-total + base - 40, Math.min(base + 40, m - e.deltaY))
    })
    clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      setUserScroll(false)
      setManual(0)
    }, 2600)
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
  const activeTop = active >= 0 ? tops[active] ?? 0 : (tops[0] ?? 0) - 40
  const baseY = anchorY - activeTop + manual

  return (
    <div ref={containerRef} className={`lyrics-view ${userScroll ? 'user-scroll' : ''} ${className}`} onWheel={onWheel} style={{ textAlign: al }}>
      <div className="lv-inner">
        {lyrics.lines.map((l, i) => {
          const dist = Math.abs(i - active)
          const delay = userScroll ? 0 : i >= active ? Math.min(i - active + (active < 0 ? 0 : 1), 9) * 0.05 : 0
          const blur = userScroll || dist === 0 ? 0 : Math.min(dist * 0.7, 3)
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
              far={dist > 12}
              showRoma={s.showRoma}
              showTrans={s.showTrans}
              align={al}
              onClick={() => {
                seek(l.time + 0.01)
                setUserScroll(false)
                setManual(0)
              }}
            />
          )
        })}
      </div>
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

const Line = memo(
  function Line({ line, next, active, passed, blur, size, y, delay, far, showRoma, showTrans, align, onClick, ref }: LineProps & { ref?: React.Ref<HTMLDivElement> }) {
    return (
      <div
        ref={ref}
        className={`lv-line ${active ? 'active' : ''} ${passed ? 'passed' : ''} ${line.interlude ? 'interlude' : ''}`}
        style={{
          transform: `translate3d(0, ${y}px, 0) scale(${active ? 1 : 0.94})`,
          transitionDelay: `${delay}s, ${delay}s, 0s, 0s`,
          filter: blur ? `blur(${blur}px)` : undefined,
          fontSize: size,
          transformOrigin: align === 'center' ? 'center center' : 'left center',
          visibility: far ? 'hidden' : undefined
        }}
        onClick={onClick}
      >
        {line.interlude ? (
          <InterludeDots active={active} start={line.time} end={next?.time ?? line.time + 5} />
        ) : (
          <>
            {showRoma && line.roma && <div className="lv-roma">{line.roma}</div>}
            <div className="lv-text">{line.text}</div>
            {showTrans && line.trans && <div className="lv-trans">{line.trans}</div>}
          </>
        )}
      </div>
    )
  }
)

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
