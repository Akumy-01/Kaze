import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Play, Shuffle, MoreHorizontal, FolderPlus, FileAudio, Music2, Heart, History, ListMusic, Pencil, Trash2, Plus, Trophy, Activity, Sparkles, Download } from 'lucide-react'
import { useLibrary, type Album } from '../store/library'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { useUI, toast } from '../store/ui'
import { useSettings } from '../store/settings'
import { TrackList } from '../components/TrackList'
import { AlbumCard, ArtistCard, ResponsiveShelf } from '../components/Cards'
import { Cover, DEFAULT_LOGO_URL } from '../components/Cover'
import { Segmented } from '../components/Controls'
import { fmtDuration, fmtTime, greeting, collator, shuffleArray, coverFileUrl } from '../lib/format'
import { extractPalette } from '../lib/color'
import { collectionMenu, trackMenu } from '../lib/actions'
import { classifyTrackCategory, buildLibraryCategoryContext, CATEGORY_LABELS, CATEGORY_ORDER } from '../lib/classify'
import { useLyrics, getCachedLyricSample } from '../store/lyrics'
import type { Track, TrackCategory } from '../../../shared/types'

/* ------------------------------------------------------------------ */

export async function importFolder() {
  const d = await window.kaze.library.importFolder()
  if (d) {
    useLibrary.getState().apply(d)
    toast(`资料库已更新，共 ${d.tracks.length} 首歌曲`, 'success')
  }
}
export async function importFiles() {
  const d = await window.kaze.library.importFiles()
  if (d) {
    useLibrary.getState().apply(d)
    toast(`资料库已更新，共 ${d.tracks.length} 首歌曲`, 'success')
  }
}

function EmptyLibrary() {
  return (
    <div className="empty" style={{ minHeight: '60vh' }}>
      <motion.div className="empty-icon logo" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <img src={DEFAULT_LOGO_URL} alt="Kaze" style={{ width: 64, height: 64, objectFit: 'contain' }} draggable={false} />
      </motion.div>
      <h2>欢迎使用 Kaze</h2>
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
    if (cover) extractPalette(coverFileUrl(cover)).then((p) => alive && setTint(p.css[0]))
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
  const likedCount = useUser((s) => s.liked.length)
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

      <div className="stat-grid">
        {[
          { label: '歌曲', value: tracks.length, icon: <Music2 size={18} />, go: 'songs' },
          { label: '专辑', value: albums.length, icon: <ListMusic size={18} />, go: 'albums' },
          { label: '喜欢', value: likedCount, icon: <Heart size={18} />, go: 'liked' },
          { label: '总时长', value: fmtDuration(totalDur(tracks)), icon: <History size={18} />, go: 'recent' }
        ].map((s, i) => (
          <motion.button
            key={s.label}
            className="stat-card"
            onClick={() => navigate({ name: s.go as any })}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 28 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
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
          <ResponsiveShelf>
            {recentTracks.map((t) => (
              <TrackTile key={t.id} t={t} list={recentTracks.map((x) => x.id)} />
            ))}
          </ResponsiveShelf>
        </>
      )}

      <div className="section-title">
        最近添加
        <button className="more" onClick={() => navigate({ name: 'albums' })}>
          查看全部
        </button>
      </div>
      <ResponsiveShelf>
        {recentAlbums.map((a) => (
          <AlbumCard key={a.key} album={a} />
        ))}
      </ResponsiveShelf>

      {top.length > 0 && (
        <>
          <div className="section-title">常听歌曲</div>
          <TrackList tracks={top} virtual={false} />
        </>
      )}

      {pick.length > 0 && (
        <>
          <div className="section-title">随便听听</div>
          <ResponsiveShelf>
            {pick.map((a) => (
              <AlbumCard key={a.key} album={a} />
            ))}
          </ResponsiveShelf>
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
  const customCategories = useUser((s) => s.customCategories)
  const spectralCache = useUser((s) => s.spectralCache)
  const lyricsTrackId = useLyrics((s) => s.trackId)
  const lyricsStatus = useLyrics((s) => s.status)
  const openDialog = useUI((s) => s.openDialog)
  const [catFilter, setCatFilter] = useState<'all' | TrackCategory>('all')
  const [specFilter, setSpecFilter] = useState<'all' | 'verified' | 'suspect'>('all')

  const categoryMap = useMemo(() => {
    const map = new Map<string, TrackCategory>()
    const { albumHints, artistHints } = buildLibraryCategoryContext(tracks)
    for (const t of tracks) {
      const aKey = t.album ? `${(t.albumArtist || t.artist || '').toLowerCase()}||${t.album.toLowerCase()}` : ''
      const pArt = (t.artist || '').split(/\s*[\/,&]\s*/)[0].trim().toLowerCase()
      map.set(
        t.id,
        classifyTrackCategory(t, customCategories, getCachedLyricSample(t.id), {
          albumLang: aKey ? albumHints.get(aKey) : undefined,
          artistLang: pArt ? artistHints.get(pArt) : undefined
        })
      )
    }
    return map
  }, [tracks, customCategories, lyricsTrackId, lyricsStatus])

  const catCounts = useMemo(() => {
    const counts: Record<TrackCategory, number> = {
      zh: 0,
      ja: 0,
      en: 0,
      ko: 0,
      instrumental: 0,
      other: 0
    }
    for (const cat of categoryMap.values()) counts[cat]++
    return counts
  }, [categoryMap])

  const spectralCount = useMemo(() => Object.keys(spectralCache).length, [spectralCache])

  const filtered = useMemo(() => {
    return tracks.filter((t) => {
      if (catFilter !== 'all' && categoryMap.get(t.id) !== catFilter) return false
      if (specFilter !== 'all') {
        const sc = spectralCache[t.id]
        if (specFilter === 'verified' && sc?.losslessStatus !== 'verified-lossless') return false
        if (specFilter === 'suspect' && !(sc?.losslessStatus === 'suspect' || sc?.losslessStatus?.startsWith('suspect-'))) return false
      }
      return true
    })
  }, [tracks, catFilter, specFilter, categoryMap, spectralCache])

  if (loaded && !tracks.length) return <EmptyLibrary />
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">歌曲</h1>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            {filtered.length === tracks.length ? `${tracks.length} 首歌曲` : `${filtered.length} / ${tracks.length} 首歌曲`} · {fmtDuration(totalDur(filtered))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            title="扫描全库音质并识别假无损"
            onClick={() => openDialog({ kind: 'audioQuality', tab: 'batch' })}
          >
            <Activity size={14} />
            全库频谱体检
          </button>
          <button
            className="btn"
            title="批量匹配封面与元数据标签"
            onClick={() =>
              openDialog({
                kind: 'batchMetadataMatch',
                trackIds: filtered.map((t) => t.id),
                title: catFilter === 'all' ? '全部歌曲' : `「${CATEGORY_LABELS[catFilter]}」分类`
              })
            }
          >
            <Sparkles size={14} />
            批量匹配标签
          </button>
          <PlayButtons ids={filtered.map((t) => t.id)} name="全部歌曲" />
        </div>
      </div>

      {/* Category & Spectral Health Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          className="btn"
          style={{
            height: 28,
            padding: '0 11px',
            fontSize: 12,
            borderRadius: 999,
            background: catFilter === 'all' ? 'rgba(var(--accent-rgb), 0.16)' : undefined,
            color: catFilter === 'all' ? 'var(--accent)' : undefined,
            borderColor: catFilter === 'all' ? 'rgba(var(--accent-rgb), 0.35)' : undefined
          }}
          onClick={() => setCatFilter('all')}
        >
          全部 ({tracks.length})
        </button>
        {CATEGORY_ORDER.filter((c) => catCounts[c] > 0 || catFilter === c).map((c) => {
          const active = catFilter === c
          return (
            <button
              key={c}
              className="btn"
              style={{
                height: 28,
                padding: '0 11px',
                fontSize: 12,
                borderRadius: 999,
                background: active ? 'rgba(var(--accent-rgb), 0.16)' : undefined,
                color: active ? 'var(--accent)' : undefined,
                borderColor: active ? 'rgba(var(--accent-rgb), 0.35)' : undefined
              }}
              onClick={() => setCatFilter(active ? 'all' : c)}
            >
              {CATEGORY_LABELS[c]} ({catCounts[c]})
            </button>
          )
        })}

        {spectralCount > 0 && (
          <>
            <span style={{ width: 1, height: 16, background: 'var(--sep)', margin: '0 4px' }} />
            <button
              className="btn"
              style={{
                height: 28,
                padding: '0 11px',
                fontSize: 12,
                borderRadius: 999,
                background: specFilter === 'verified' ? 'rgba(16, 185, 129, 0.18)' : undefined,
                color: specFilter === 'verified' ? '#10b981' : undefined,
                borderColor: specFilter === 'verified' ? 'rgba(16, 185, 129, 0.35)' : undefined
              }}
              onClick={() => setSpecFilter(specFilter === 'verified' ? 'all' : 'verified')}
            >
              真无损已验
            </button>
            <button
              className="btn"
              style={{
                height: 28,
                padding: '0 11px',
                fontSize: 12,
                borderRadius: 999,
                background: specFilter === 'suspect' ? 'rgba(245, 158, 11, 0.18)' : undefined,
                color: specFilter === 'suspect' ? '#f59e0b' : undefined,
                borderColor: specFilter === 'suspect' ? 'rgba(245, 158, 11, 0.35)' : undefined
              }}
              onClick={() => setSpecFilter(specFilter === 'suspect' ? 'all' : 'suspect')}
            >
              疑似假无损
            </button>
          </>
        )}
      </div>

      <TrackList tracks={filtered} sortable />
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
  const gapless = useSettings((s) => s.gapless)
  const crossfadeSec = useSettings((s) => s.crossfadeSec)
  const setSettings = useSettings((s) => s.set)
  if (!album) return <div className="empty">找不到该专辑</div>
  const discs = new Set(album.tracks.map((t) => t.discNo ?? 1))
  const genre = album.tracks.find((t) => t.genre)?.genre
  const lossless = album.tracks.every((t) => t.lossless)
  const transitionLabel = crossfadeSec > 0 ? `音轨淡接 ${crossfadeSec}s` : gapless ? '音轨无缝直连' : '标准切换'
  const cycleAlbumTransition = () => {
    if (crossfadeSec > 0) {
      setSettings({ gapless: true, crossfadeSec: 0 })
      toast('已切换为「音轨无缝直连 (Gapless)」')
    } else if (gapless) {
      setSettings({ gapless: true, crossfadeSec: 2 })
      toast('已开启「音轨交叉淡接 (2s)」')
    } else {
      setSettings({ gapless: true, crossfadeSec: 0 })
      toast('已切换为「音轨无缝直连 (Gapless)」')
    }
  }
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
        extra={
          <button
            className="btn"
            onClick={cycleAlbumTransition}
            title="切换专辑内曲目「按音轨无缝直连 / 交叉淡接 (Crossfade)」"
            style={
              gapless || crossfadeSec > 0
                ? {
                    background: 'rgba(var(--accent-rgb), 0.14)',
                    color: 'var(--accent)',
                    borderColor: 'rgba(var(--accent-rgb), 0.35)'
                  }
                : undefined
            }
          >
            <Sparkles size={14} />
            {transitionLabel}
          </button>
        }
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
      <div className="grid">
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
          <div className="grid">
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
            <button className="btn" onClick={() => openDialog({ kind: 'addToPlaylist', playlistId: pl.id })}>
              <Plus size={14} />
              添加歌曲
            </button>
            <button
              className="btn"
              title="导出为 .m3u8 通用歌单文件"
              onClick={async () => {
                const res = await window.kaze.playlist.exportM3u({
                  name: pl.name,
                  items: tracks.map((t) => ({ path: t.path, title: t.title, artist: t.artist, duration: t.duration }))
                })
                if (res.ok) toast(`已导出 ${tracks.length} 首歌曲到 .m3u8`, 'success')
              }}
            >
              <Download size={14} />
              导出 .m3u8
            </button>
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
          <p>这个歌单还是空的。点击下方按钮从曲库挑选歌曲，或在任意歌曲右键加入。</p>
          <button className="btn primary" style={{ marginTop: 12 }} onClick={() => openDialog({ kind: 'addToPlaylist', playlistId: pl.id })}>
            <Plus size={15} />
            从曲库添加歌曲
          </button>
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

function fmtListenDuration(sec: number) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rem = s % 60
  if (h > 0) return `${h} 小时 ${m} 分 ${rem} 秒`
  if (m > 0) return `${m} 分 ${rem} 秒`
  return `${rem} 秒`
}

export function RankingView() {
  const tracks = useLibrary((s) => s.tracks)
  const playCounts = useUser((s) => s.playCounts)
  const playDurations = useUser((s) => s.playDurations)
  const [sortBy, setSortBy] = useState<'duration' | 'count'>('duration')

  const ranked = useMemo(() => {
    const items = tracks
      .map((t) => ({
        track: t,
        count: playCounts[t.id] ?? 0,
        listenSec: playDurations[t.id] ?? 0
      }))
      .filter((x) => x.count > 0 || x.listenSec > 0)
    items.sort((a, b) =>
      sortBy === 'duration'
        ? b.listenSec - a.listenSec || b.count - a.count
        : b.count - a.count || b.listenSec - a.listenSec
    )
    return items
  }, [tracks, playCounts, playDurations, sortBy])

  const totalListenSec = useMemo(() => ranked.reduce((acc, x) => acc + x.listenSec, 0), [ranked])
  const totalPlays = useMemo(() => ranked.reduce((acc, x) => acc + x.count, 0), [ranked])
  const topMetric = useMemo(() => {
    if (!ranked.length) return 1
    return Math.max(1, sortBy === 'duration' ? ranked[0].listenSec : ranked[0].count)
  }, [ranked, sortBy])

  const ids = useMemo(() => ranked.map((r) => r.track.id), [ranked])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Trophy size={26} style={{ color: 'var(--accent)' }} />
            听歌排行
          </h1>
          <div className="page-sub" style={{ marginBottom: 0 }}>
            累计聆听 {fmtListenDuration(totalListenSec)} · 共播放 {totalPlays} 次 · 涉及 {ranked.length} 首曲目
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Segmented<'duration' | 'count'>
            layoutId="seg-rank-sort"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'duration', label: '按累计时长' },
              { value: 'count', label: '按播放次数' }
            ]}
          />
          <PlayButtons ids={ids} name="听歌排行" />
        </div>
      </div>

      {!ranked.length ? (
        <div className="empty" style={{ minHeight: '45vh' }}>
          <Trophy size={42} style={{ opacity: 0.35, marginBottom: 8 }} />
          <p>暂无播放统计记录。播放任意歌曲后，系统会自动精准累计聆听时长并生成你的专属排行榜。</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 20 }}>
          {ranked.map((item, idx) => {
            const { track: t, count, listenSec } = item
            const ratio = Math.max(4, Math.round(((sortBy === 'duration' ? listenSec : count) / topMetric) * 100))
            const medalColor = idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : idx === 2 ? '#d97706' : 'var(--text-3)'
            return (
              <div
                key={t.id}
                onDoubleClick={() => usePlayer.getState().playTracks(ids, idx)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  useUI.getState().openMenu(e, trackMenu(t, { list: ids, index: idx }))
                }}
                className="modal-list-row"
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '10px 14px',
                  borderRadius: 12,
                  overflow: 'hidden',
                  cursor: 'pointer'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${ratio}%`,
                    background: 'linear-gradient(90deg, rgba(var(--accent-rgb), 0.10), rgba(var(--accent-rgb), 0.02))',
                    pointerEvents: 'none'
                  }}
                />
                <div
                  style={{
                    width: 34,
                    textAlign: 'center',
                    fontSize: idx < 3 ? 17 : 14,
                    fontWeight: idx < 3 ? 800 : 600,
                    color: medalColor,
                    fontVariantNumeric: 'tabular-nums',
                    zIndex: 1
                  }}
                >
                  {idx + 1}
                </div>
                <Cover cover={t.cover} style={{ width: 48, height: 48, borderRadius: 8, zIndex: 1 }} />
                <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.artist} · {t.album}
                  </div>
                </div>
                <div style={{ textAlign: 'right', zIndex: 1, flexShrink: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtListenDuration(listenSec)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    播放 {count} 次 · 单曲时长 {fmtTime(t.duration)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
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
          <div className="grid">
            {res.ar.map((a) => (
              <ArtistCard key={a.name} artist={a} />
            ))}
          </div>
        </>
      )}
      {res.a.length > 0 && (
        <>
          <div className="section-title">专辑</div>
          <div className="grid">
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
