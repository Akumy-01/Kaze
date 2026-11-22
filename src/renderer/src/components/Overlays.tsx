import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useUI, type MenuItem } from '../store/ui'

interface OpenSubState {
  items: MenuItem[]
  anchorRect: DOMRect
  menuRect: DOMRect
}

function MenuList({
  items,
  onDone,
  onOpenSub,
  onScheduleCloseSub,
  onCancelCloseSub
}: {
  items: MenuItem[]
  onDone: () => void
  onOpenSub?: (sub: OpenSubState | null) => void
  onScheduleCloseSub?: () => void
  onCancelCloseSub?: () => void
}) {
  return (
    <>
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-divider" />
        ) : (
          <div
            key={i}
            style={{ position: 'relative' }}
            onMouseEnter={(e) => {
              onCancelCloseSub?.()
              if (it.children?.length && onOpenSub) {
                const anchorRect = e.currentTarget.getBoundingClientRect()
                const menuEl = e.currentTarget.closest('.menu')
                const menuRect = menuEl ? menuEl.getBoundingClientRect() : anchorRect
                onOpenSub({ items: it.children, anchorRect, menuRect })
              } else {
                onScheduleCloseSub?.()
              }
            }}
          >
            <button
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                if (it.children) return
                onDone()
                it.onClick?.()
              }}
            >
              <span className="mi-icon">{it.icon}</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{it.label}</span>
              {it.children && <ChevronRight size={13} className="mi-arrow" />}
            </button>
          </div>
        )
      )}
    </>
  )
}

function SubMenuLayer({
  sub,
  onDone,
  onCancelClose,
  onScheduleClose
}: {
  sub: OpenSubState
  onDone: () => void
  onCancelClose: () => void
  onScheduleClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [nested, setNested] = useState<OpenSubState | null>(null)
  const nestedTimer = useRef<number | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({ left: 0, top: 0, ready: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 0
    let left = sub.menuRect.right + gap
    if (left + r.width > window.innerWidth - 8) {
      left = Math.max(8, sub.menuRect.left - r.width - gap)
    }
    let top = sub.anchorRect.top - 5
    if (top + r.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - 8 - r.height)
    }
    setPos({ left, top, ready: true })
  }, [sub])

  const cancelNested = useCallback(() => {
    if (nestedTimer.current) {
      clearTimeout(nestedTimer.current)
      nestedTimer.current = null
    }
  }, [])

  const scheduleNested = useCallback(() => {
    cancelNested()
    nestedTimer.current = window.setTimeout(() => setNested(null), 140)
  }, [cancelNested])

  return (
    <>
      {createPortal(
        <div
          ref={ref}
          className="menu submenu"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            visibility: pos.ready ? 'visible' : 'hidden'
          }}
          onMouseEnter={() => {
            onCancelClose()
            cancelNested()
          }}
          onMouseLeave={() => {
            onScheduleClose()
            scheduleNested()
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <MenuList
            items={sub.items}
            onDone={onDone}
            onOpenSub={(s) => {
              cancelNested()
              setNested(s)
            }}
            onCancelCloseSub={cancelNested}
            onScheduleCloseSub={scheduleNested}
          />
        </div>,
        document.body
      )}
      {nested && (
        <SubMenuLayer
          sub={nested}
          onDone={onDone}
          onCancelClose={() => {
            onCancelClose()
            cancelNested()
          }}
          onScheduleClose={() => {
            scheduleNested()
            onScheduleClose()
          }}
        />
      )}
    </>
  )
}

export function ContextMenu() {
  const menu = useUI((s) => s.menu)
  const close = useUI((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [sub, setSub] = useState<OpenSubState | null>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelCloseSub = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleCloseSub = useCallback(() => {
    cancelCloseSub()
    closeTimer.current = window.setTimeout(() => setSub(null), 140)
  }, [cancelCloseSub])

  useLayoutEffect(() => {
    setSub(null)
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const y =
      menu.align === 'above'
        ? Math.max(8, menu.y - r.height)
        : menu.y + r.height > window.innerHeight - 8
          ? Math.max(8, menu.y - r.height)
          : menu.y
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y
    })
  }, [menu])

  useEffect(() => {
    if (!menu) {
      cancelCloseSub()
      setSub(null)
      return
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (ref.current?.contains(target) || target.closest('.submenu'))) return
      close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, close, cancelCloseSub])

  return (
    <>
      <AnimatePresence>
        {menu && (
          <motion.div
            ref={ref}
            key={`${menu.x}-${menu.y}`}
            className="menu"
            style={{ left: pos.x, top: pos.y, transformOrigin: 'top left' }}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 700, damping: 40 }}
            onMouseLeave={scheduleCloseSub}
            onContextMenu={(e) => e.preventDefault()}
          >
            <MenuList
              items={menu.items}
              onDone={close}
              onOpenSub={(s) => {
                cancelCloseSub()
                setSub(s)
              }}
              onCancelCloseSub={cancelCloseSub}
              onScheduleCloseSub={scheduleCloseSub}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {menu && sub && (
        <SubMenuLayer
          sub={sub}
          onDone={close}
          onCancelClose={cancelCloseSub}
          onScheduleClose={scheduleCloseSub}
        />
      )}
    </>
  )
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast ${t.kind ?? ''}`}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          >
            {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
