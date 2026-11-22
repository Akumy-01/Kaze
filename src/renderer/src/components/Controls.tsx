import { useRef, useState, useCallback, type ReactNode } from 'react'
import { motion } from 'framer-motion'

interface SliderProps {
  value: number
  max?: number
  onChange?: (v: number) => void
  onCommit?: (v: number) => void
  className?: string
  thumb?: boolean
  wheelStep?: number
  overlay?: ReactNode
}

/** Smooth range slider. When onCommit is provided, onChange is only for preview during drag. */
export function Slider({ value, max = 1, onChange, onCommit, className = '', thumb = false, wheelStep, overlay }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const cur = drag ?? value
  const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) * 100 : 0

  const posToValue = useCallback(
    (clientX: number) => {
      const r = ref.current!.getBoundingClientRect()
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max
    },
    [max]
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const v = posToValue(e.clientX)
    setDrag(v)
    onChange?.(v)
    const move = (ev: PointerEvent) => {
      const nv = posToValue(ev.clientX)
      setDrag(nv)
      onChange?.(nv)
    }
    const up = (ev: PointerEvent) => {
      const nv = posToValue(ev.clientX)
      setDrag(null)
      onCommit?.(nv)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onWheel = wheelStep
    ? (e: React.WheelEvent) => {
        const v = Math.max(0, Math.min(max, value + (e.deltaY < 0 ? wheelStep : -wheelStep)))
        onChange?.(v)
        onCommit?.(v)
      }
    : undefined

  return (
    <div
      ref={ref}
      className={`slider ${thumb ? 'with-thumb' : ''} ${drag !== null ? 'dragging' : ''} ${className}`}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
        {overlay}
      </div>
      <div className="thumb" style={{ left: `${pct}%` }} />
    </div>
  )
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} />
}

interface SegOption<T> {
  value: T
  label: ReactNode
  title?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId,
  className = ''
}: {
  value: T
  options: SegOption<T>[]
  onChange: (v: T) => void
  layoutId: string
  className?: string
}) {
  return (
    <div className={`segmented ${className}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title}>
          {o.value === value && (
            <motion.div layoutId={layoutId} className="seg-thumb" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          {o.label}
        </button>
      ))}
    </div>
  )
}
