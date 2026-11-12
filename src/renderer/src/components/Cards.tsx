import { memo } from 'react'
import { Play, MoreHorizontal } from 'lucide-react'
import { Cover } from './Cover'
import { usePlayer } from '../store/player'
import { useUI } from '../store/ui'
import { collectionMenu } from '../lib/actions'
import type { Album, Artist } from '../store/library'

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
