import { motion } from 'framer-motion'
import {
  Home,
  Music2,
  Disc3,
  MicVocal,
  Heart,
  History,
  ListMusic,
  Plus,
  Settings,
  Search,
  X,
  FolderPlus
} from 'lucide-react'
import { useUI, type View, toast } from '../store/ui'
import { useUser } from '../store/user'
import { useLibrary } from '../store/library'
import { DEFAULT_LOGO_URL } from './Cover'
import { TrafficLights, useWinStyle } from './WindowControls'
import type { ReactNode } from 'react'

function NavItem({ view, icon, label, onContext }: { view: View; icon: ReactNode; label: string; onContext?: (e: React.MouseEvent) => void }) {
  const cur = useUI((s) => s.view)
  const navigate = useUI((s) => s.navigate)
  const active =
    cur.name === view.name && (view.param === undefined || cur.param === view.param)
      ? true
      : (view.name === 'albums' && cur.name === 'album') || (view.name === 'artists' && cur.name === 'artist')
  return (
    <button className="nav-item" onClick={() => navigate(view)} onContextMenu={onContext}>
      {active && <motion.div layoutId="nav-active" className="nav-active-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </button>
  )
}

export function Sidebar() {
  const search = useUI((s) => s.search)
  const setSearch = useUI((s) => s.setSearch)
  const playlists = useUser((s) => s.playlists)
  const openDialog = useUI((s) => s.openDialog)
  const openMenu = useUI((s) => s.openMenu)
  const winStyle = useWinStyle()

  const importFolder = async () => {
    const d = await window.akumy.library.importFolder()
    if (d) {
      useLibrary.getState().apply(d)
      toast(`资料库已更新，共 ${d.tracks.length} 首歌曲`, 'success')
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        {winStyle === 'mac' && <TrafficLights />}
        <div className="sidebar-brand" style={{ marginLeft: winStyle === 'mac' ? 'auto' : 0 }}>
          <img src={DEFAULT_LOGO_URL} alt="Akumy Music" draggable={false} />
          <span>Akumy Music</span>
        </div>
      </div>
      <div className="sidebar-search">
        <Search size={14} />
        <input
          id="global-search"
          placeholder="搜索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
        />
        {search && (
          <button className="clear" onClick={() => setSearch('')}>
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </div>
      <nav className="sidebar-nav">
        <NavItem view={{ name: 'home' }} icon={<Home size={17} />} label="现在就听" />
        <div className="nav-section">资料库</div>
        <NavItem view={{ name: 'songs' }} icon={<Music2 size={17} />} label="歌曲" />
        <NavItem view={{ name: 'albums' }} icon={<Disc3 size={17} />} label="专辑" />
        <NavItem view={{ name: 'artists' }} icon={<MicVocal size={17} />} label="艺人" />
        <NavItem view={{ name: 'liked' }} icon={<Heart size={17} />} label="喜欢的歌曲" />
        <NavItem view={{ name: 'recent' }} icon={<History size={17} />} label="最近播放" />
        <div className="nav-section">
          歌单
          <button title="新建歌单" onClick={() => openDialog({ kind: 'newPlaylist' })}>
            <Plus size={14} />
          </button>
        </div>
        {playlists.map((p) => (
          <NavItem
            key={p.id}
            view={{ name: 'playlist', param: p.id }}
            icon={<ListMusic size={17} />}
            label={p.name}
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
        ))}
        {!playlists.length && (
          <button className="nav-item" style={{ color: 'var(--text-3)' }} onClick={() => openDialog({ kind: 'newPlaylist' })}>
            <span className="nav-icon" style={{ color: 'var(--text-3)' }}>
              <Plus size={17} />
            </span>
            <span className="nav-label">新建歌单</span>
          </button>
        )}
      </nav>
      <div style={{ padding: '8px 10px 14px', borderTop: '1px solid var(--sep)' }}>
        <button className="nav-item" onClick={importFolder}>
          <span className="nav-icon">
            <FolderPlus size={17} />
          </span>
          <span className="nav-label">导入音乐文件夹</span>
        </button>
        <NavItem view={{ name: 'settings' }} icon={<Settings size={17} />} label="设置" />
      </div>
    </aside>
  )
}
