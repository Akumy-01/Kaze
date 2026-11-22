import { Children, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Play, MoreHorizontal } from 'lucide-react'
import { Cover } from './Cover'
import { usePlayer } from '../store/player'
import { useUI } from '../store/ui'
import { collectionMenu } from '../lib/actions'
import type { Album, Artist } from '../store/library'

/**
 * Responsive single-row shelf:
 * Dynamically adapts both column count and card size to the available viewport width
 * so every album cover renders 100% completely without horizontal clipping or masks.
 */
export function ResponsiveShelf({ children, minCardWidth = 166, gap = 20 }: { children: ReactNode; minCardWidth?: number; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(5)

  const recalc = useCallback(() => {
    const el = ref.current
    if (!el) return
    const w = el.clientWidth
    if (w <= 0) return
    const nextCols = Math.max(2, Math.floor((w + gap) / (minCardWidth + gap)))
    setCols((prev) => (prev === nextCols ? prev : nextCols))
  }, [minCardWidth, gap])

  useEffect(() => {
    recalc()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(recalc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [recalc])

  const visible = Children.toArray(children).slice(0, cols)

  return (
    <div
      ref={ref}
      className="shelf-grid"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap
      }}
    >
      {visible}
    </div>
  )
}

export const AlbumCard = memo(function AlbumCard({ album, showArtist = true }: { album: Album; showArtist?: boolean }) {
  const navigate = useUI((s) => s.navigate)
  const openMenu = useUI((s) => s.openMenu)
  const ids = album.tracks.map((t) => t.id)
  return (
    <div
      className="card"
      onClick={() => navigate({ name: 'album', param: album.key })}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e, collectionMenu(ids, album.name))
      }}
    >
      <div className="card-cover">
        <Cover cover={album.cover} iconSize={40} />
        <button
          className="card-more"
          onClick={(e) => {
            e.stopPropagation()
            openMenu(e, collectionMenu(ids, album.name))
          }}
        >
          <MoreHorizontal size={15} />
        </button>
        <button
          className="card-play"
          onClick={(e) => {
            e.stopPropagation()
            usePlayer.getState().playTracks(ids, 0)
          }}
        >
          <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />
        </button>
      </div>
      <div className="card-title">{album.name}</div>
      <div className="card-sub">
        {showArtist ? album.artist : album.year ?? `${album.tracks.length} 首歌曲`}
      </div>
    </div>
  )
})

export const ArtistCard = memo(function ArtistCard({ artist }: { artist: Artist }) {
  const navigate = useUI((s) => s.navigate)
  const openMenu = useUI((s) => s.openMenu)
  const ids = artist.tracks.map((t) => t.id)
  return (
    <div
      className="card round"
      onClick={() => navigate({ name: 'artist', param: artist.name.toLowerCase() })}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e, collectionMenu(ids, artist.name))
      }}
    >
      <div className="card-cover">
        <Cover cover={artist.cover} iconSize={40} />
      </div>
      <div className="card-title">{artist.name}</div>
      <div className="card-sub">{artist.tracks.length} 首歌曲</div>
    </div>
  )
})
