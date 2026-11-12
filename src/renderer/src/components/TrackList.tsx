import { memo, useMemo, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Heart, Play, MoreHorizontal, ChevronUp, ChevronDown } from 'lucide-react'
import type { Track } from '../../../shared/types'
import { Cover } from './Cover'
import { fmtTime, collator, splitArtists } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { useUI } from '../store/ui'
import { albumKey } from '../store/library'
import { trackMenu } from '../lib/actions'
import { useScrollParent } from '../lib/scroll'

type SortKey = 'default' | 'title' | 'artist' | 'album' | 'duration' | 'added'

interface Props {
  tracks: Track[]
  showAlbum?: boolean
  showCover?: boolean
  numbering?: 'index' | 'trackNo'
  playlistId?: string
  sortable?: boolean
  virtual?: boolean
}

export function TrackList({ tracks, showAlbum = true, showCover = true, numbering = 'index', playlistId, sortable = false, virtual = true }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'default', dir: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const scrollParent = useScrollParent()

  const sorted = useMemo(() => {
    if (sort.key === 'default') return tracks
    const arr = tracks.slice()
    const k = sort.key
    arr.sort((a, b) => {
      let r = 0
      if (k === 'title') r = collator.compare(a.title, b.title)
      else if (k === 'artist') r = collator.compare(a.artist, b.artist)
      else if (k === 'album') r = collator.compare(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0)
      else if (k === 'duration') r = a.duration - b.duration
      else if (k === 'added') r = a.addedAt - b.addedAt
      return r * sort.dir
    })
    return arr
  }, [tracks, sort])

  const ids = useMemo(() => sorted.map((t) => t.id), [sorted])

  const head = (key: SortKey, label: string) =>
    sortable ? (
      <button
        className="sortable"
        onClick={() =>
          setSort((s) => (s.key === key ? (s.dir === 1 ? { key, dir: -1 } : { key: 'default', dir: 1 }) : { key, dir: 1 }))
        }
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </button>
    ) : (
      <span>{label}</span>
    )

  const row = (i: number, t: Track) => (
    <Row
      key={t.id}
      t={t}
      i={i}
      ids={ids}
      showAlbum={showAlbum}
      showCover={showCover}
      numbering={numbering}
      playlistId={playlistId}
      selected={selected === t.id}
      onSelect={setSelected}
    />
  )

  return (
    <div className="tracklist">
      <div className={`tl-head ${showAlbum ? '' : 'no-album'}`}>
        <span style={{ textAlign: 'center' }}>#</span>
        {head('title', '标题')}
        {head('artist', '艺人')}
        {showAlbum && head('album', '专辑')}
        <span />
        <span style={{ textAlign: 'right' }}>{head('duration', '时长')}</span>
        <span />
      </div>
      {virtual && scrollParent && sorted.length > 60 ? (
        <Virtuoso customScrollParent={scrollParent} data={sorted} itemContent={row} computeItemKey={(_, t) => t.id} increaseViewportBy={400} />
      ) : (
        sorted.map((t, i) => row(i, t))
      )}
    </div>
  )
}

interface RowProps {
  t: Track
  i: number
  ids: string[]
  showAlbum: boolean
  showCover: boolean
  numbering: 'index' | 'trackNo'
  playlistId?: string
  selected: boolean
  onSelect: (id: string) => void
}

const Row = memo(function Row({ t, i, ids, showAlbum, showCover, numbering, playlistId, selected, onSelect }: RowProps) {
  const isCurrent = usePlayer((s) => s.currentId === t.id)
  const playing = usePlayer((s) => s.playing)
  const liked = useUser((s) => s.liked.includes(t.id))
  const toggleLike = useUser((s) => s.toggleLike)
  const navigate = useUI((s) => s.navigate)
  const openMenu = useUI((s) => s.openMenu)
  const play = () => usePlayer.getState().playTracks(ids, i)
  const menu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(t.id)
    openMenu(e, trackMenu(t, { list: ids, index: i, playlistId }))
  }
  const artists = splitArtists(t.artist)

  return (
    <div
      className={`tl-row ${showAlbum ? '' : 'no-album'} ${isCurrent ? 'playing' : ''} ${selected ? 'selected' : ''}`}
      onDoubleClick={play}
      onClick={() => onSelect(t.id)}
      onContextMenu={menu}
    >
      <div className="tl-index">
        {isCurrent ? (
          <div className={`eq ${playing ? '' : 'paused'}`}>
            <i />
            <i />
            <i />
          </div>
        ) : (
          <>
            <span className="num">{numbering === 'trackNo' ? t.trackNo ?? i + 1 : i + 1}</span>
            <button className="play-ico" onClick={play}>
              <Play size={13} fill="currentColor" />
            </button>
          </>
        )}
      </div>
      <div className="tl-title">
        {showCover && <Cover cover={t.cover} iconSize={16} />}
        <div className="tl-title-wrap">
          <div className="tl-title-text">{t.title}</div>
          {(t.lossless || t.hasLyrics) && (
            <div className="tl-badges">
              {t.lossless && <span className="badge accent">{(t.bitsPerSample ?? 16) > 16 || (t.sampleRate ?? 0) > 48000 ? 'HI-RES' : 'LOSSLESS'}</span>}
              {t.hasLyrics && <span className="badge">LRC</span>}
            </div>
          )}
        </div>
      </div>
      <div className="tl-cell">
        {artists.map((a, k) => (
          <span key={k}>
            {k > 0 && ' / '}
            <span className="link" onClick={(e) => (e.stopPropagation(), navigate({ name: 'artist', param: a.toLowerCase() }))}>
              {a}
            </span>
          </span>
        ))}
      </div>
      {showAlbum && (
        <div className="tl-cell link" onClick={(e) => (e.stopPropagation(), navigate({ name: 'album', param: albumKey(t) }))}>
          {t.album}
        </div>
      )}
      <button className={`tl-like ${liked ? '' : 'off'}`} onClick={(e) => (e.stopPropagation(), toggleLike(t.id))}>
        <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
      </button>
      <div className="tl-dur">{fmtTime(t.duration)}</div>
      <button className="icon-btn tl-more" onClick={menu}>
        <MoreHorizontal size={16} />
      </button>
    </div>
  )
})
