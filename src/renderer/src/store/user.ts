import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SpectralVerdictCache, TrackCategory } from '../../../shared/types'

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

interface UserState {
  liked: string[]
  playlists: Playlist[]
  recent: string[]
  playCounts: Record<string, number>
  playDurations: Record<string, number>
  lyricOffsets: Record<string, number>
  customCategories: Record<string, TrackCategory>
  spectralCache: Record<string, SpectralVerdictCache>
  toggleLike: (id: string) => void
  createPlaylist: (name: string, trackIds?: string[]) => string
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (id: string, trackIds: string[]) => number
  removeFromPlaylist: (id: string, trackId: string) => void
  movePlaylistTrack: (id: string, from: number, to: number) => void
  markPlayed: (id: string) => void
  addListenTime: (id: string, deltaSec: number) => void
  setOffset: (id: string, offset: number) => void
  setTrackCategory: (id: string, category: TrackCategory | 'auto') => void
  setSpectralResult: (id: string, res: SpectralVerdictCache) => void
  clearRecent: () => void
}

export const useUser = create<UserState>()(
  persist(
    (set, get) => ({
      liked: [],
      playlists: [],
      recent: [],
      playCounts: {},
      playDurations: {},
      lyricOffsets: {},
      customCategories: {},
      spectralCache: {},
      toggleLike: (id) =>
        set((s) => ({ liked: s.liked.includes(id) ? s.liked.filter((x) => x !== id) : [id, ...s.liked] })),
      createPlaylist: (name, trackIds = []) => {
        const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const now = Date.now()
        set((s) => ({ playlists: [...s.playlists, { id, name, trackIds: [...new Set(trackIds)], createdAt: now, updatedAt: now }] }))
        return id
      },
      renamePlaylist: (id, name) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)) })),
      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
      addToPlaylist: (id, trackIds) => {
        const pl = get().playlists.find((p) => p.id === id)
        if (!pl) return 0
        const fresh = trackIds.filter((t) => !pl.trackIds.includes(t))
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, trackIds: [...p.trackIds, ...fresh], updatedAt: Date.now() } : p
          )
        }))
        return fresh.length
      },
      removeFromPlaylist: (id, trackId) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === id ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId), updatedAt: Date.now() } : p
          )
        })),
      movePlaylistTrack: (id, from, to) =>
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== id) return p
            const ids = p.trackIds.slice()
            const [x] = ids.splice(from, 1)
            ids.splice(to, 0, x)
            return { ...p, trackIds: ids, updatedAt: Date.now() }
          })
        })),
      markPlayed: (id) =>
        set((s) => ({
          recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, 200),
          playCounts: { ...s.playCounts, [id]: (s.playCounts[id] ?? 0) + 1 }
        })),
      addListenTime: (id, deltaSec) => {
        if (!id || !isFinite(deltaSec) || deltaSec <= 0) return
        set((s) => ({
          playDurations: { ...s.playDurations, [id]: Math.round(((s.playDurations[id] ?? 0) + deltaSec) * 10) / 10 }
        }))
      },
      setOffset: (id, offset) => set((s) => ({ lyricOffsets: { ...s.lyricOffsets, [id]: offset } })),
      setTrackCategory: (id, category) =>
        set((s) => {
          const next = { ...s.customCategories }
          if (category === 'auto') delete next[id]
          else next[id] = category
          return { customCategories: next }
        }),
      setSpectralResult: (id, res) =>
        set((s) => ({ spectralCache: { ...s.spectralCache, [id]: res } })),
      clearRecent: () => set({ recent: [] })
    }),
    {
      name: 'kaze-user',
      version: 3,
      migrate: (persisted: any) => {
        if (persisted && !persisted.playDurations) persisted.playDurations = {}
        if (persisted && !persisted.customCategories) persisted.customCategories = {}
        if (persisted && !persisted.spectralCache) persisted.spectralCache = {}
        return persisted
      }
    }
  )
)
