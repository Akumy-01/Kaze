import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Home,
  Music2,
  Disc3,
  MicVocal,
  Heart,
  History,
  Trophy,
  ListMusic,
  Plus,
  Settings,
  Search,
  X,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'
import { useUI, type View } from '../store/ui'
import { useUser } from '../store/user'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { importFolder } from '../views/Library'
import { Cover, DEFAULT_LOGO_URL } from './Cover'

interface TipState {
  text: string
  top: number
  left: number
}

function NavItem({
  view,
  icon,
  label,
  collapsed,
  onContext,
  onTip
}: {
  view: View
  icon: ReactNode
  label: string
  collapsed: boolean
  onContext?: (e: React.MouseEvent) => void
  onTip: (t: TipState | null) => void
}) {
  const cur = useUI((s) => s.view)
  const navigate = useUI((s) => s.navigate)
  const active =
    cur.name === view.name && (view.param === undefined || cur.param === view.param)
      ? true
      : (view.name === 'albums' && cur.name === 'album') || (view.name === 'artists' && cur.name === 'artist')

  const showTip = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!collapsed) return
    const r = e.currentTarget.getBoundingClientRect()
    onTip({ text: label, top: r.top + r.height / 2, left: r.right + 10 })
  }

  return (
    <button
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={() => navigate(view)}
      onContextMenu={onContext}
      onMouseEnter={showTip}
      onMouseLeave={() => onTip(null)}
      onFocus={(e) => {
        if (!collapsed) return
        const r = e.currentTarget.getBoundingClientRect()
        onTip({ text: label, top: r.top + r.height / 2, left: r.right + 10 })
      }}
      onBlur={() => onTip(null)}
      aria-label={label}
    >
      {active && <motion.div layoutId="nav-active" className="nav-active-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      <span className="nav-icon">{icon}</span>
      <span className="nav-label" aria-hidden={collapsed}>
        {label}
      </span>
    </button>
  )
}

export function Sidebar() {
  const search = useUI((s) => s.search)
  const setSearch = useUI((s) => s.setSearch)
  const navigate = useUI((s) => s.navigate)
  const playlists = useUser((s) => s.playlists)
  const byId = useLibrary((s) => s.byId)
  const openDialog = useUI((s) => s.openDialog)
  const openMenu = useUI((s) => s.openMenu)
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const setSettings = useSettings((s) => s.set)

  const [searchPopover, setSearchPopover] = useState(false)
  const [tip, setTip] = useState<TipState | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popInputRef = useRef<HTMLInputElement>(null)
  const searchBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setTip(null)
    if (!collapsed) setSearchPopover(false)
  }, [collapsed])

  useEffect(() => {
    if (!searchPopover) return
    const timer = setTimeout(() => popInputRef.current?.focus(), 20)
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popRef.current &&
        !popRef.current.contains(target) &&
        searchBtnRef.current &&
        !searchBtnRef.current.contains(target)
      ) {
        setSearchPopover(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSearchPopover(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [searchPopover])

  // Allow Ctrl+F to open the search popover when sidebar is collapsed
  useEffect(() => {
    const onOpenSearch = () => {
      if (useSettings.getState().sidebarCollapsed) {
        setSearchPopover(true)
        setTimeout(() => popInputRef.current?.focus(), 30)
      } else {
        document.getElementById('global-search')?.focus()
      }
    }
    window.addEventListener('kaze:focus-search', onOpenSearch)
    return () => window.removeEventListener('kaze:focus-search', onOpenSearch)
  }, [])

  const showBtnTip = (label: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!collapsed) return
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ text: label, top: r.top + r.height / 2, left: r.right + 10 })
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="主导航侧边栏">
      <div className="sidebar-top drag">
        <div
          className="sidebar-brand no-drag"
          onClick={() => navigate({ name: 'home' })}
          title="回到主页"
          role="button"
          tabIndex={0}
          aria-label="Kaze 主页"
          onKeyDown={(e) => e.key === 'Enter' && navigate({ name: 'home' })}
        >
          <img src={DEFAULT_LOGO_URL} alt="Kaze" draggable={false} />
        </div>
        <button
          className="icon-btn sidebar-toggle no-drag"
          onClick={() => {
            setTip(null)
            setSettings({ sidebarCollapsed: !collapsed })
          }}
          onMouseEnter={showBtnTip(collapsed ? '展开侧边栏' : '折叠侧边栏')}
          onMouseLeave={() => setTip(null)}
          title={!collapsed ? '折叠侧边栏' : '展开侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <div className="sidebar-search-wrap">
        <div
          className={`sidebar-search-bar ${collapsed && (searchPopover || search) ? 'active' : ''}`}
          onClick={() => {
            if (collapsed) {
              setTip(null)
              setSearchPopover((v) => !v)
            }
          }}
        >
          <button
            ref={searchBtnRef}
            type="button"
            className="sidebar-search-icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              if (collapsed) {
                setTip(null)
                setSearchPopover((v) => !v)
              } else {
                document.getElementById('global-search')?.focus()
              }
            }}
            onMouseEnter={showBtnTip(search ? `搜索：${search}` : '搜索')}
            onMouseLeave={() => setTip(null)}
            aria-label="搜索"
            aria-expanded={collapsed ? searchPopover : undefined}
          >
            <Search size={17} />
          </button>
          <input
            id="global-search"
            placeholder="搜索"
            aria-label="搜索"
            tabIndex={collapsed ? -1 : 0}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
          />
          {search && !collapsed && (
            <button
              className="clear"
              onClick={(e) => {
                e.stopPropagation()
                setSearch('')
              }}
              title="清空搜索"
              aria-label="清空搜索"
            >
              <X size={10} strokeWidth={3} />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {collapsed && searchPopover && (
          <motion.div
            ref={popRef}
            className="sidebar-search-popover no-drag"
            initial={{ opacity: 0, x: -8, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <Search size={15} className="ssp-icon" />
            <input
              ref={popInputRef}
              id="global-search-pop"
              placeholder="搜索歌曲、专辑、艺人…"
              aria-label="搜索歌曲、专辑、艺人"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchPopover(false)
              }}
            />
            {search && (
              <button
                className="clear"
                onClick={() => {
                  setSearch('')
                  popInputRef.current?.focus()
                }}
                title="清空搜索"
                aria-label="清空搜索"
              >
                <X size={10} strokeWidth={3} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="sidebar-nav" onScroll={() => setTip(null)}>
        <NavItem view={{ name: 'home' }} icon={<Home size={17} />} label="现在就听" collapsed={collapsed} onTip={setTip} />

        <div className="nav-section">
          <span className="nav-section-title">资料库</span>
          <span className="nav-section-line" role="separator" />
        </div>

        <NavItem view={{ name: 'songs' }} icon={<Music2 size={17} />} label="歌曲" collapsed={collapsed} onTip={setTip} />
        <NavItem view={{ name: 'albums' }} icon={<Disc3 size={17} />} label="专辑" collapsed={collapsed} onTip={setTip} />
        <NavItem view={{ name: 'artists' }} icon={<MicVocal size={17} />} label="艺人" collapsed={collapsed} onTip={setTip} />
        <NavItem view={{ name: 'liked' }} icon={<Heart size={17} />} label="喜欢的歌曲" collapsed={collapsed} onTip={setTip} />
        <NavItem view={{ name: 'recent' }} icon={<History size={17} />} label="最近播放" collapsed={collapsed} onTip={setTip} />
        <NavItem view={{ name: 'ranking' }} icon={<Trophy size={17} />} label="听歌排行" collapsed={collapsed} onTip={setTip} />

        <div className="nav-section">
          <span className="nav-section-title">
            <span>歌单</span>
            <button title="新建歌单" aria-label="新建歌单" onClick={() => openDialog({ kind: 'newPlaylist' })}>
              <Plus size={14} />
            </button>
          </span>
          <span className="nav-section-line" role="separator" />
        </div>

        <button
          className="nav-item"
          onClick={() => {
            setTip(null)
            openDialog({ kind: 'newPlaylist' })
          }}
          onMouseEnter={showBtnTip('新建歌单')}
          onMouseLeave={() => setTip(null)}
          aria-label="新建歌单"
        >
          <span className="nav-icon" style={{ color: 'var(--text-2)' }}>
            <Plus size={17} />
          </span>
          <span className="nav-label" aria-hidden={collapsed} style={{ color: 'var(--text-2)' }}>
            新建歌单
          </span>
        </button>

        {playlists.map((p) => {
          const plCover = p.trackIds.map((id) => byId.get(id)?.cover).find(Boolean)
          const iconNode =
            collapsed && plCover ? (
              <Cover cover={plCover} className="nav-pl-cover" />
            ) : (
              <ListMusic size={17} />
            )
          return (
            <NavItem
              key={p.id}
              view={{ name: 'playlist', param: p.id }}
              icon={iconNode}
              label={p.name}
              collapsed={collapsed}
              onTip={setTip}
              onContext={(e) => {
                e.preventDefault()
                openMenu(e, [
                  { label: '重命名', onClick: () => openDialog({ kind: 'rename', id: p.id, name: p.name }) },
                  {
                    label: '删除歌单',
                    danger: true,
                    onClick: () => {
                      useUser.getState().deletePlaylist(p.id)
                      const v = useUI.getState().view
                      if (v.name === 'playlist' && v.param === p.id) useUI.getState().navigate({ name: 'home' })
                    }
                  }
                ])
              }}
            />
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          className="nav-item"
          onClick={() => {
            setTip(null)
            void importFolder()
          }}
          onMouseEnter={showBtnTip('导入音乐文件夹')}
          onMouseLeave={() => setTip(null)}
          aria-label="导入音乐文件夹"
        >
          <span className="nav-icon">
            <FolderPlus size={17} />
          </span>
          <span className="nav-label" aria-hidden={collapsed}>
            导入音乐文件夹
          </span>
        </button>
        <NavItem view={{ name: 'settings' }} icon={<Settings size={17} />} label="设置" collapsed={collapsed} onTip={setTip} />
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {collapsed && tip && (
              <motion.div
                key={tip.text}
                className="sidebar-tooltip"
                style={{ top: tip.top, left: tip.left }}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                role="tooltip"
              >
                {tip.text}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </aside>
  )
}
