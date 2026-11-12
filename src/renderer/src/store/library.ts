import { create } from 'zustand'
import type { LibraryData, ScanProgress, Track } from '../../../shared/types'
import { collator, splitArtists } from '../lib/format'

export interface Album {
  key: string
  name: string
  artist: string
  year?: number
  cover?: string
  tracks: Track[]
  duration: number
  addedAt: number
}

export interface Artist {
  name: string
  tracks: Track[]
  albums: Album[]
  cover?: string
}

interface LibraryState {
  loaded: boolean
  tracks: Track[]
  byId: Map<string, Track>
  folders: string[]
  albums: Album[]
  albumMap: Map<string, Album>
  artists: Artist[]
  artistMap: Map<string, Artist>
  progress: ScanProgress | null
  apply: (d: LibraryData) => void
  updateTrack: (t: Track) => void
  setProgress: (p: ScanProgress | null) => void
}

export const albumKey = (t: Pick<Track, 'album' | 'albumArtist'>) =>
  `${t.album.toLowerCase()}␟${(t.album === '未知专辑' ? '' : t.albumArtist).toLowerCase()}`

function derive(tracks: Track[]) {
  const albumMap = new Map<string, Album>()
  for (const t of tracks) {
    const k = albumKey(t)
    let a = albumMap.get(k)
    if (!a) {
      a = { key: k, name: t.album, artist: t.albumArtist, year: t.year, cover: t.cover, tracks: [], duration: 0, addedAt: t.addedAt }
      albumMap.set(k, a)
    }
    a.tracks.push(t)
    a.duration += t.duration
    if (!a.cover && t.cover) a.cover = t.cover
    if (!a.year && t.year) a.year = t.year
    a.addedAt = Math.max(a.addedAt, t.addedAt)
  }
  for (const a of albumMap.values()) {
    a.tracks.sort(
      (x, y) => (x.discNo ?? 1) - (y.discNo ?? 1) || (x.trackNo ?? 999) - (y.trackNo ?? 999) || collator.compare(x.title, y.title)
    )
  }
  const albums = [...albumMap.values()].sort((a, b) => collator.compare(a.name, b.name))

  const artistMap = new Map<string, Artist>()
  for (const t of tracks) {
    for (const name of splitArtists(t.artist)) {
      const k = name.toLowerCase()
      let ar = artistMap.get(k)
      if (!ar) {
        ar = { name, tracks: [], albums: [] }
        artistMap.set(k, ar)
      }
      ar.tracks.push(t)
      if (!ar.cover && t.cover) ar.cover = t.cover
    }
  }
  for (const a of albums) {
    for (const name of splitArtists(a.artist)) {
      const ar = artistMap.get(name.toLowerCase())
      if (ar && !ar.albums.includes(a)) ar.albums.push(a)
    }
  }
  for (const ar of artistMap.values()) {
    if (!ar.albums.length) {
      const seen = new Set<string>()
      for (const t of ar.tracks) {
        const k = albumKey(t)
        if (!seen.has(k)) {
          seen.add(k)
          const al = albumMap.get(k)
          if (al) ar.albums.push(al)
        }
      }
    }
  }
  const artists = [...artistMap.values()].sort((a, b) => collator.compare(a.name, b.name))
  return { albums, albumMap, artists, artistMap }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  tracks: [],
  byId: new Map(),
  folders: [],
  albums: [],
  albumMap: new Map(),
  artists: [],
  artistMap: new Map(),
  progress: null,
  apply: (d) => {
    const tracks = d.tracks.slice().sort((a, b) => collator.compare(a.title, b.title))
    set({ loaded: true, tracks, byId: new Map(tracks.map((t) => [t.id, t])), folders: d.folders, ...derive(tracks) })
  },
  updateTrack: (t) => {
    const tracks = get().tracks.map((x) => (x.id === t.id ? t : x))
    set({ tracks, byId: new Map(tracks.map((x) => [x.id, x])), ...derive(tracks) })
  },
  setProgress: (progress) => set({ progress })
}))

export const getTrack = (id?: string | null) => (id ? useLibrary.getState().byId.get(id) : undefined)
