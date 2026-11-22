import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react'
import { useLibrary } from './store/library'
import { usePlayer, initPlayer, restoreSession } from './store/player'
import { useLyrics } from './store/lyrics'
import { useUI, toast } from './store/ui'
import { Sidebar } from './components/Sidebar'
import { PlayerBar } from './components/PlayerBar'
import { Background, useThemeEffect } from './components/Background'
import { TrafficLights, WinControls, useWinStyle } from './components/WindowControls'
import { ContextMenu, Toasts } from './components/Overlays'
import { Dialogs, QueuePanel, ScanPill } from './components/Dialogs'
import { useFloatingSync } from './components/FloatingWindows'
import {
  HomeView,
  SongsView,
  AlbumsView,
  AlbumView,
  ArtistsView,
  ArtistView,
  PlaylistView,
  LikedView,
  RecentView,
  RankingView,
  SearchView
} from './views/Library'
import { SettingsView } from './views/Settings'
import { NowPlaying } from './nowplaying/NowPlaying'
import { ScrollContext } from './lib/scroll'

const VIEW_TITLE: Record<string, string> = {
  home: '现在就听',
  songs: '歌曲',
  albums: '专辑',
  album: '专辑',
  artists: '艺人',
  artist: '艺人',
  playlist: '歌单',
  liked: '喜欢的歌曲',
  recent: '最近播放',
  ranking: '听歌排行',
  search: '搜索',
  settings: '设置'
}

export default function App() {
  useFloatingSync()
  const { hasWallpaper } = useThemeEffect()
  const winStyle = useWinStyle()
  const view = useUI((s) => s.view)
  const back = useUI((s) => s.back)
  const forward = useUI((s) => s.forward)
  const goBack = useUI((s) => s.goBack)
  const goForward = useUI((s) => s.goForward)
  const nowPlaying = useUI((s) => s.nowPlaying)
  const queueOpen = useUI((s) => s.queueOpen)
  const currentId = usePlayer((s) => s.currentId)
  const [scrolled, setScrolled] = useState(false)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [focused, setFocused] = useState(true)
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)

  // boot
  useEffect(() => {
    initPlayer()
    const offProg = window.kaze.library.onProgress((p) => {
      useLibrary.getState().setProgress(p)
      if (p.phase === 'done') setTimeout(() => useLibrary.getState().setProgress(null), 500)
    })
    const offUpdated = window.kaze.library.onUpdated((d) => {
      useLibrary.getState().apply(d)
    })
    const openFiles = async (files: string[]) => {
      if (!files.length) return
      const d = await window.kaze.library.addPaths(files)
      useLibrary.getState().apply(d)
      const first = d.tracks.find((t) => files.some((f) => f.toLowerCase() === t.path.toLowerCase()))
      if (first) usePlayer.getState().playTracks([first.id], 0)
    }
    const offOpen = window.kaze.library.onOpenFiles(openFiles)
    ;(async () => {
      const d = await window.kaze.library.get()
      useLibrary.getState().apply(d)
      restoreSession()
      const pending = await window.kaze.library.pendingOpen()
      if (pending.length) await openFiles(pending)
    })()
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      offProg()
      offUpdated()
      offOpen()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // load lyrics whenever current track changes
  useEffect(() => {
    if (!currentId) {
      useLyrics.getState().clear()
      return
    }
    const t = useLibrary.getState().byId.get(currentId)
    if (t) void useLyrics.getState().load(t)
  }, [currentId])

  // scroll to top on view change
  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 })
    setScrolled(false)
  }, [view.name, view.param]) // eslint-disable-line

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        useUI.getState().setNowPlaying(false)
        window.dispatchEvent(new CustomEvent('kaze:focus-search'))
        return
      }
      if (e.key === 'Escape') {
        if (useUI.getState().lyricsPanel) useUI.getState().setLyricsPanel(false)
        else if (useUI.getState().queueOpen) useUI.getState().toggleQueue(false)
        else if (useUI.getState().nowPlaying) useUI.getState().setNowPlaying(false)
        return
      }
      if (inInput) return
      const p = usePlayer.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        p.toggle()
      } else if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey)) p.next()
      else if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey)) p.prev()
      else if (e.key === 'ArrowRight') p.seek(p.currentTime + 5)
      else if (e.key === 'ArrowLeft') p.seek(p.currentTime - 5)
      else if (e.key === 'ArrowUp') {
        e.preventDefault()
        p.setVolume(p.volume + 0.05)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        p.setVolume(p.volume - 0.05)
      } else if (e.key.toLowerCase() === 'm') p.toggleMute()
      else if (e.key.toLowerCase() === 'l' && p.currentId) useUI.getState().setNowPlaying(!useUI.getState().nowPlaying)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // drag and drop import
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current++
    setDropping(true)
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropping(false)
  }
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDropping(false)
    const files = Array.from(e.dataTransfer.files)
    const paths = files.map((f) => window.kaze.library.pathForFile(f)).filter(Boolean)
    if (!paths.length) return
    const prev = useLibrary.getState().tracks.length
    const d = await window.kaze.library.addPaths(paths)
    useLibrary.getState().apply(d)
    const diff = d.tracks.length - prev
    toast(diff > 0 ? `成功导入 ${diff} 首新歌曲` : `资料库已更新（共 ${d.tracks.length} 首）`, 'success')
  }

  return (
    <div
      className={`app ${focused ? 'focused' : ''} ${hasWallpaper ? 'has-wallpaper' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Background />
      <Sidebar />
      <main className="main">
        <header className={`topbar drag ${scrolled ? 'scrolled' : ''}`}>
          <button className="icon-btn no-drag" disabled={!back.length} onClick={goBack} title="后退" aria-label="后退">
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn no-drag" disabled={!forward.length} onClick={goForward} title="前进" aria-label="前进">
            <ChevronRight size={18} />
          </button>
          <span className="topbar-title">{VIEW_TITLE[view.name]}</span>
          <div className="spacer" />
          {winStyle === 'mac' ? <TrafficLights /> : <WinControls />}
        </header>

        <div
          ref={setScrollEl}
          className="main-scroll"
          onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 36)}
        >
          <ScrollContext.Provider value={scrollEl}>
            <div key={`${view.name}-${view.param ?? ''}`}>
              {view.name === 'home' && <HomeView />}
              {view.name === 'songs' && <SongsView />}
              {view.name === 'albums' && <AlbumsView />}
              {view.name === 'album' && <AlbumView id={view.param!} />}
              {view.name === 'artists' && <ArtistsView />}
              {view.name === 'artist' && <ArtistView id={view.param!} />}
              {view.name === 'playlist' && <PlaylistView id={view.param!} />}
              {view.name === 'liked' && <LikedView />}
              {view.name === 'recent' && <RecentView />}
              {view.name === 'ranking' && <RankingView />}
              {view.name === 'search' && <SearchView />}
              {view.name === 'settings' && <SettingsView />}
            </div>
          </ScrollContext.Provider>
        </div>

        <ScanPill />
        {!nowPlaying && queueOpen && <QueuePanel />}
        <PlayerBar />
      </main>

      <NowPlaying />
      <ContextMenu />
      <Dialogs />
      <Toasts />

      <AnimatePresence>
        {dropping && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="drop-box">
              <Upload size={42} />
              <span>松开即可导入音乐文件或文件夹</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
