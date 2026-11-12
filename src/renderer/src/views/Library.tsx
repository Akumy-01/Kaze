import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Play, Shuffle, MoreHorizontal, FolderPlus, FileAudio, Music2, Heart, History, ListMusic, Pencil, Trash2 } from 'lucide-react'
import { useLibrary, type Album } from '../store/library'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { useUI, toast } from '../store/ui'
import { TrackList } from '../components/TrackList'
import { AlbumCard, ArtistCard } from '../components/Cards'
import { Cover } from '../components/Cover'
import { fmtDuration, greeting, collator, shuffleArray } from '../lib/format'
import { extractPalette } from '../lib/color'
import { collectionMenu } from '../lib/actions'
import type { Track } from '../../../shared/types'

/* ------------------------------------------------------------------ */

export async function importFolder() {
  const d = await window.akumy.library.importFolder()
  if (d) {
    useLibrary.getState().apply(d)
    toast(`资料库已更新，共 ${d.tracks.length} 首歌曲`, 'success')
  }
}
export async function importFiles() {
  const d = await window.akumy.library.importFiles()
  if (d) {
    useLibrary.getState().apply(d)
    toast(`资料库已更新，共 ${d.tracks.length} 首歌曲`, 'success')
  }
}

function EmptyLibrary() {
  return (
    <div className="empty" style={{ minHeight: '60vh' }}>
      <motion.div className="empty-icon" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <Music2 size={40} />
      </motion.div>
      <h2>欢迎使用 Akumy Music</h2>
      <p>导入本地音乐文件夹，开始你的聆听之旅。支持 MP3 / FLAC / M4A / OGG / OPUS / WAV。</p>
      <p style={{ fontSize: 12, color: 'var(--text-3)' }}>也可以直接把文件或文件夹拖拽到窗口中</p>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="btn primary lg" onClick={importFolder}>
          <FolderPlus size={16} />
          导入文件夹
        </button>
        <button className="btn lg" onClick={importFiles}>
          <FileAudio size={16} />
          导入文件
        </button>
      </div>
    </div>
  )
}

function PlayButtons({ ids, name }: { ids: string[]; name: string }) {
  const openMenu = useUI((s) => s.openMenu)
  const p = usePlayer.getState()
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button className="btn primary lg" disabled={!ids.length} onClick={() => p.playTracks(ids, 0, { shuffle: false })}>
        <Play size={15} fill="currentColor" />
        播放
      </button>
      <button className="btn tinted lg" disabled={!ids.length} onClick={() => p.playTracks(ids, 0, { shuffle: true })}>
        <Shuffle size={15} />
        随机播放
      </button>
      <button className="icon-btn" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--fill)' }} disabled={!ids.length} onClick={(e) => openMenu(e, collectionMenu(ids, name))}>
        <MoreHorizontal size={17} />
      </button>
    </div>
  )
}

function CollectionHeader({
  cover,
  kind,
  title,
  subtitle,
  meta,
  ids,
  round,
  icon,
  extra
}: {
  cover?: string
  kind: string
  title: string
  subtitle?: ReactNode
  meta?: string
  ids: string[]
  round?: boolean
  icon?: ReactNode
  extra?: ReactNode
}) {
  const [tint, setTint] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (cover) extractPalette(`akumy://cover/${cover}`).then((p) => alive && setTint(p.css[0]))
    else setTint(null)
    return () => {
      alive = false
    }
  }, [cover])
  return (
    <div style={{ position: 'relative', marginBottom: 22 }}>
      {tint && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            position: 'absolute',
            inset: '-120px -60px -40px',
            background: `radial-gradient(60% 80% at 20% 30%, ${tint.replace('rgb', 'rgba').replace(')', ',0.32)')}, transparent 70%)`,
            zIndex: -1,
            pointerEvents: 'none'
          }}
        />
      )}
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end' }}>
        <motion.div initial={{ opacity: 0, scale: 0.92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
          {icon ? (
            <div
              className="cover"
              style={{
                width: 220,
                borderRadius: 14,
                display: 'grid',
                placeItems: 'center',
                background: 'linear-gradient(135deg, rgba(var(--accent-rgb),1), rgba(var(--accent-rgb),0.45))',
                color: '#fff',
                boxShadow: 'var(--shadow-lg)'
              }}
            >
              {icon}
            </div>
          ) : (
            <Cover cover={cover} iconSize={60} style={{ width: 220, borderRadius: round ? '50%' : 14, boxShadow: 'var(--shadow-lg)' }} />
          )}
        </motion.div>
        <motion.div style={{ minWidth: 0, flex: 1, paddingBottom: 4 }} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05, duration: 0.4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kind}</div>
          <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.025em', margin: '4px 0 4px', lineHeight: 1.15, wordBreak: 'break-word' }}>{title}</h1>
          {subtitle && <div style={{ fontSize: 18, color: 'var(--accent)', fontWeight: 500 }}>{subtitle}</div>}
          {meta && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 6 }}>{meta}</div>}
          <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
            <PlayButtons ids={ids} name={title} />
            {extra}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

const totalDur = (ts: Track[]) => ts.reduce((a, t) => a + t.duration, 0)

/* ------------------------------------------------------------------ */

export function HomeView() {
  const tracks = useLibrary((s) => s.tracks)
  const albums = useLibrary((s) => s.albums)
  const byId = useLibrary((s) => s.byId)
  const recent = useUser((s) => s.recent)
  const playCounts = useUser((s) => s.playCounts)
  const loaded = useLibrary((s) => s.loaded)
  const navigate = useUI((s) => s.navigate)

  const recentAlbums = useMemo(() => albums.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 16), [albums])
  const recentTracks = useMemo(() => recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 12) as Track[], [recent, byId])
  const top = useMemo(
    () =>
      Object.entries(playCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId.get(id))
        .filter(Boolean)
        .slice(0, 8) as Track[],
    [playCounts, byId]
  )
  const pick = useMemo(() => shuffleArray(albums).slice(0, 8), [albums.length]) // eslint-disable-line

  if (!loaded) return null
  if (!tracks.length) return <EmptyLibrary />

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
          <h1 className="page-title">{greeting()}</h1>
        </div>
        <button className="btn primary lg" onClick={() => usePlayer.getState().playTracks(tracks.map((t) => t.id), 0, { shuffle: true })}>
          <Shuffle size={15} />
          随机播放全部
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 6 }}>
        {[
          { label: '歌曲', value: tracks.length, icon: <Music2 size={18} />, go: 'songs' },
          { label: '专辑', value: albums.length, icon: <ListMusic size={18} />, go: 'albums' },
          { label: '喜欢', value: useUser.getState().liked.length, icon: <Heart size={18} />, go: 'liked' },
          { label: '总时长', value: fmtDuration(totalDur(tracks)), icon: <History size={18} />, go: 'recent' }
        ].map((s, i) => (
          <motion.button
            key={s.label}
            onClick={() => navigate({ name: s.go as any })}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 28 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            style={{
              textAlign: 'left',
              padding: '14px 16px',
              borderRadius: 14,
              background: 'var(--surface)',
              backdropFilter: 'blur(20px)',
              boxShadow: 'var(--shadow-sm)',
              border: '1px solid var(--sep)'
            }}
          >
            <div style={{ color: 'var(--accent)' }}>{s.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.label}</div>
          </motion.button>
        ))}
      </div>

      {recentTracks.length > 0 && (
        <>
          <div className="section-title">
            最近播放
            <button className="more" onClick={() => navigate({ name: 'recent' })}>
              查看全部
            </button>
          </div>
          <div className="hscroll">
            {recentTracks.map((t) => (
              <TrackTile key={t.id} t={t} list={recentTracks.map((x) => x.id)} />
            ))}
          </div>
        </>
      )}

      <div className="section-title">
        最近添加
        <button className="more" onClick={() => navigate({ name: 'albums' })}>
          查看全部
        </button>
      </div>
      <div className="hscroll">
        {recentAlbums.map((a) => (
          <AlbumCard key={a.key} album={a} />
        ))}
      </div>

      {top.length > 0 && (
        <>
          <div className="section-title">常听歌曲</div>
          <TrackList tracks={top} virtual={false} />
        </>
      )}

      {pick.length > 0 && (
        <>
          <div className="section-title">随便听听</div>
          <div className="hscroll">
            {pick.map((a) => (
              <AlbumCard key={a.key} album={a} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TrackTile({ t, list }: { t: Track; list: string[] }) {
  return (
    <div className="card" onClick={() => usePlayer.getState().playTracks(list, list.indexOf(t.id))}>
      <div className="card-cover">
        <Cover cover={t.cover} iconSize={40} />
        <button className="card-play">
          <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />
        </button>
      </div>
      <div className="card-title">{t.title}</div>
      <div className="card-sub">{t.artist}</div>
    </div>
  )
}

export function SongsView() {
  const tracks = useLibrary((s) => s.tracks)
  const loaded = useLibrary((s) => s.loaded)
  if (loaded && !tracks.length) return <EmptyLibrary />
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">歌曲</h1>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            {tracks.length} 首歌曲 · {fmtDuration(totalDur(tracks))}
          </div>
        </div>
        <PlayButtons ids={tracks.map((t) => t.id)} name="全部歌曲" />
      </div>
      <TrackList tracks={tracks} sortable />
    </div>
  )
}

export function AlbumsView() {
  const albums = useLibrary((s) => s.albums)
  const [sort, setSort] = useState<'name' | 'artist' | 'added' | 'year'>('name')
  const sorted = useMemo(() => {
    const a = albums.slice()
    if (sort === 'artist') a.sort((x, y) => collator.compare(x.artist, y.artist))
    if (sort === 'added') a.sort((x, y) => y.addedAt - x.addedAt)
    if (sort === 'year') a.sort((x, y) => (y.year ?? 0) - (x.year ?? 0))
    return a
  }, [albums, sort])
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">专辑</h1>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            {albums.length} 张专辑
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(
            [
              ['name', '名称'],
              ['artist', '艺人'],
              ['added', '最近添加'],
              ['year', '年份']
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`chip ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid">
        {sorted.map((a) => (
          <AlbumCard key={a.key} album={a} />
        ))}
      </div>
    </div>
  )
}

export function AlbumView({ id }: { id: string }) {
  const album = useLibrary((s) => s.albumMap.get(id))
  const navigate = useUI((s) => s.navigate)
  if (!album) return <div className="empty">找不到该专辑</div>
  const discs = new Set(album.tracks.map((t) => t.discNo ?? 1))
  const genre = album.tracks.find((t) => t.genre)?.genre
  const lossless = album.tracks.every((t) => t.lossless)
  return (
    <div className="page">
      <CollectionHeader
        cover={album.cover}
        kind="专辑"
        title={album.name}
        subtitle={
          <span style={{ cursor: 'pointer' }} onClick={() => navigate({ name: 'artist', param: album.artist.split(/\s*\/\s*/)[0].toLowerCase() })}>
            {album.artist}
          </span>
        }
        meta={[genre, album.year, `${album.tracks.length} 首歌曲`, fmtDuration(album.duration), lossless ? '无损' : null].filter(Boolean).join(' · ')}
        ids={album.tracks.map((t) => t.id)}
      />
      {discs.size > 1 ? (
        [...discs].sort().map((d) => (
          <div key={d}>
            <div className="section-title" style={{ fontSize: 15, margin: '18px 0 6px' }}>
              碟 {d}
            </div>
            <TrackList tracks={album.tracks.filter((t) => (t.discNo ?? 1) === d)} showAlbum={false} showCover={false} numbering="trackNo" virtual={false} />
          </div>
        ))
      ) : (
        <TrackList tracks={album.tracks} showAlbum={false} showCover={false} numbering="trackNo" virtual={false} />
      )}
      <MoreFromArtist album={album} />
    </div>
  )
}

function MoreFromArtist({ album }: { album: Album }) {
  const artist = useLibrary((s) => s.artistMap.get(album.artist.split(/\s*\/\s*/)[0].toLowerCase()))
  const others = artist?.albums.filter((a) => a.key !== album.key) ?? []
  if (!others.length) return null
  return (
    <>
      <div className="section-title">{artist!.name} 的更多专辑</div>
      <div className="hscroll">
        {others.map((a) => (
          <AlbumCard key={a.key} album={a} showArtist={false} />
        ))}
      </div>
    </>
  )
}

export function ArtistsView() {
  const artists = useLibrary((s) => s.artists)
  return (
    <div className="page">
      <h1 className="page-title">艺人</h1>
      <div className="page-sub">{artists.length} 位艺人</div>
      <div className="grid">
        {artists.map((a) => (
          <ArtistCard key={a.name} artist={a} />
        ))}
      </div>
    </div>
  )
}

export function ArtistView({ id }: { id: string }) {
  const artist = useLibrary((s) => s.artistMap.get(id))
  if (!artist) return <div className="empty">找不到该艺人</div>
  return (
    <div className="page">
      <CollectionHeader
        cover={artist.cover}
        round
        kind="艺人"
        title={artist.name}
        meta={`${artist.albums.length} 张专辑 · ${artist.tracks.length} 首歌曲 · ${fmtDuration(totalDur(artist.tracks))}`}
        ids={artist.tracks.map((t) => t.id)}
      />
      {artist.albums.length > 0 && (
        <>
          <div className="section-title">专辑</div>
          <div className="hscroll">
            {artist.albums.map((a) => (
              <AlbumCard key={a.key} album={a} showArtist={false} />
            ))}
          </div>
        </>
      )}
      <div className="section-title">歌曲</div>
      <TrackList tracks={artist.tracks} sortable />
    </div>
  )
}

export function PlaylistView({ id }: { id: string }) {
  const pl = useUser((s) => s.playlists.find((p) => p.id === id))
  const byId = useLibrary((s) => s.byId)
  const openDialog = useUI((s) => s.openDialog)
  if (!pl) return <div className="empty">歌单不存在</div>
  const tracks = pl.trackIds.map((i) => byId.get(i)).filter(Boolean) as Track[]
  const cover = tracks.find((t) => t.cover)?.cover
  return (
    <div className="page">
      <CollectionHeader
        cover={cover}
        icon={!cover ? <ListMusic size={80} strokeWidth={1.4} /> : undefined}
        kind="歌单"
        title={pl.name}
        meta={`${tracks.length} 首歌曲 · ${fmtDuration(totalDur(tracks))} · 更新于 ${new Date(pl.updatedAt).toLocaleDateString('zh-CN')}`}
        ids={tracks.map((t) => t.id)}
        extra={
          <>
            <button className="icon-btn" title="重命名" onClick={() => openDialog({ kind: 'rename', id: pl.id, name: pl.name })}>
              <Pencil size={15} />
            </button>
            <button
              className="icon-btn"
              title="删除歌单"
              onClick={() => {
                useUser.getState().deletePlaylist(pl.id)
                useUI.getState().navigate({ name: 'home' })
                toast(`已删除歌单「${pl.name}」`)
              }}
            >
              <Trash2 size={15} />
            </button>
          </>
        }
      />
      {tracks.length ? (
        <TrackList tracks={tracks} playlistId={pl.id} sortable />
      ) : (
        <div className="empty">
          <p>这个歌单还是空的。在任意歌曲上右键 → 「添加到歌单」即可添加。</p>
        </div>
      )}
    </div>
  )
}

export function LikedView() {
  const liked = useUser((s) => s.liked)
  const byId = useLibrary((s) => s.byId)
  const tracks = liked.map((i) => byId.get(i)).filter(Boolean) as Track[]
  return (
    <div className="page">
      <CollectionHeader icon={<Heart size={80} fill="currentColor" strokeWidth={0} />} kind="歌单" title="喜欢的歌曲" meta={`${tracks.length} 首歌曲 · ${fmtDuration(totalDur(tracks))}`} ids={tracks.map((t) => t.id)} />
      {tracks.length ? <TrackList tracks={tracks} sortable /> : <div className="empty">点击歌曲旁的 ♥ 即可收藏到这里</div>}
    </div>
  )
}

export function RecentView() {
  const recent = useUser((s) => s.recent)
  const byId = useLibrary((s) => s.byId)
  const tracks = recent.map((i) => byId.get(i)).filter(Boolean) as Track[]
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">最近播放</h1>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            {tracks.length} 首歌曲
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => useUser.getState().clearRecent()} disabled={!tracks.length}>
            清除记录
          </button>
          <PlayButtons ids={tracks.map((t) => t.id)} name="最近播放" />
        </div>
      </div>
      {tracks.length ? <TrackList tracks={tracks} /> : <div className="empty">还没有播放记录</div>}
    </div>
  )
}

export function SearchView() {
  const q = useUI((s) => s.search).trim().toLowerCase()
  const tracks = useLibrary((s) => s.tracks)
  const albums = useLibrary((s) => s.albums)
  const artists = useLibrary((s) => s.artists)
  const res = useMemo(() => {
    if (!q) return { t: [], a: [], ar: [] }
    const terms = q.split(/\s+/)
    const match = (s: string) => terms.every((term) => s.toLowerCase().includes(term))
    return {
      t: tracks.filter((t) => match(`${t.title} ${t.artist} ${t.album}`)).slice(0, 200),
      a: albums.filter((a) => match(`${a.name} ${a.artist}`)).slice(0, 24),
      ar: artists.filter((a) => match(a.name)).slice(0, 24)
    }
  }, [q, tracks, albums, artists])
  if (!q)
    return (
      <div className="page">
        <h1 className="page-title">搜索</h1>
        <div className="page-sub">在左上角输入关键词，搜索歌曲、专辑、艺人</div>
      </div>
    )
  const none = !res.t.length && !res.a.length && !res.ar.length
  return (
    <div className="page">
      <h1 className="page-title">“{q}” 的搜索结果</h1>
      {none && <div className="empty">没有找到相关内容</div>}
      {res.ar.length > 0 && (
        <>
          <div className="section-title">艺人</div>
          <div className="hscroll">
            {res.ar.map((a) => (
              <ArtistCard key={a.name} artist={a} />
            ))}
          </div>
        </>
      )}
      {res.a.length > 0 && (
        <>
          <div className="section-title">专辑</div>
          <div className="hscroll">
            {res.a.map((a) => (
              <AlbumCard key={a.key} album={a} />
            ))}
          </div>
        </>
      )}
      {res.t.length > 0 && (
        <>
          <div className="section-title">歌曲</div>
          <TrackList tracks={res.t} />
        </>
      )}
    </div>
  )
}
