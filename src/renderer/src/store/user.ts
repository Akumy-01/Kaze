import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  lyricOffsets: Record<string, number>
  toggleLike: (id: string) => void
  createPlaylist: (name: string, trackIds?: string[]) => string
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (id: string, trackIds: string[]) => number
  removeFromPlaylist: (id: string, trackId: string) => void
  movePlaylistTrack: (id: string, from: number, to: number) => void
  markPlayed: (id: string) => void
  setOffset: (id: string, offset: number) => void
  clearRecent: () => void
}

export const useUser = create<UserState>()(
  persist(
    (set, get) => ({
      liked: [],
      playlists: [],
      recent: [],
      playCounts: {},
      lyricOffsets: {},
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
      setOffset: (id, offset) => set((s) => ({ lyricOffsets: { ...s.lyricOffsets, [id]: offset } })),
      clearRecent: () => set({ recent: [] })
    }),
    { name: 'akumy-user', version: 1 }
  )
)
