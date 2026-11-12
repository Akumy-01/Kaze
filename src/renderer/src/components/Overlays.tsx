import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { useUI, type MenuItem } from '../store/ui'

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null)
  return (
    <>
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-divider" />
        ) : (
          <div key={i} style={{ position: 'relative' }} onMouseEnter={() => setSub(it.children ? i : null)}>
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
            {it.children && sub === i && <SubMenu items={it.children} onDone={onDone} />}
          </div>
        )
      )}
    </>
  )
}

function SubMenu({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s: React.CSSProperties = {}
    if (r.right > window.innerWidth - 8) {
      s.left = 'auto'
      s.right = '100%'
      s.marginRight = 4
    }
    if (r.bottom > window.innerHeight - 8) s.top = window.innerHeight - 8 - r.bottom - 5
    setStyle(s)
  }, [])
  return (
    <div ref={ref} className="menu submenu" style={{ ...style, position: 'absolute' }}>
      <MenuList items={items} onDone={onDone} />
    </div>
  )
}

export function ContextMenu() {
  const menu = useUI((s) => s.menu)
  const close = useUI((s) => s.closeMenu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
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
  }, [menu, close])

  return (
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
          onContextMenu={(e) => e.preventDefault()}
        >
          <MenuList items={menu.items} onDone={close} />
        </motion.div>
      )}
    </AnimatePresence>
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
