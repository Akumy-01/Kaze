import { create } from 'zustand'
import type { ReactNode } from 'react'

export type ViewName =
  | 'home'
  | 'songs'
  | 'albums'
  | 'album'
  | 'artists'
  | 'artist'
  | 'playlist'
  | 'liked'
  | 'recent'
  | 'search'
  | 'settings'

export interface View {
  name: ViewName
  param?: string
}

export interface Toast {
  id: number
  text: string
  kind?: 'info' | 'success' | 'error'
}

export interface MenuItem {
  label?: string
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  onClick?: () => void
  children?: MenuItem[]
}

interface UIState {
  view: View
  back: View[]
  forward: View[]
  nowPlaying: boolean
  queueOpen: boolean
  lyricsPanel: boolean
  search: string
  toasts: Toast[]
  menu: { x: number; y: number; items: MenuItem[] } | null
  dialog: { kind: 'newPlaylist'; trackIds?: string[] } | { kind: 'rename'; id: string; name: string } | { kind: 'trackInfo'; id: string } | null
  navigate: (v: View) => void
  goBack: () => void
  goForward: () => void
  setNowPlaying: (v: boolean) => void
  toggleQueue: (v?: boolean) => void
  setLyricsPanel: (v: boolean) => void
  setSearch: (s: string) => void
  toast: (text: string, kind?: Toast['kind']) => void
  openMenu: (e: { clientX: number; clientY: number }, items: MenuItem[]) => void
  closeMenu: () => void
  openDialog: (d: UIState['dialog']) => void
}

let toastId = 0

export const useUI = create<UIState>((set, get) => ({
  view: { name: 'home' },
  back: [],
  forward: [],
  nowPlaying: false,
  queueOpen: false,
  lyricsPanel: false,
  search: '',
  toasts: [],
  menu: null,
  dialog: null,
  navigate: (v) => {
    const cur = get().view
    if (cur.name === v.name && cur.param === v.param) return
    set({ view: v, back: [...get().back, cur].slice(-50), forward: [], nowPlaying: false })
  },
  goBack: () => {
    const back = get().back.slice()
    const prev = back.pop()
    if (!prev) return
    set({ view: prev, back, forward: [get().view, ...get().forward] })
  },
  goForward: () => {
    const [next, ...rest] = get().forward
    if (!next) return
    set({ view: next, forward: rest, back: [...get().back, get().view] })
  },
  setNowPlaying: (v) => set({ nowPlaying: v, queueOpen: v ? get().queueOpen : get().queueOpen }),
  toggleQueue: (v) => set({ queueOpen: v ?? !get().queueOpen }),
  setLyricsPanel: (v) => set({ lyricsPanel: v }),
  setSearch: (s) => {
    set({ search: s })
    if (s && get().view.name !== 'search') get().navigate({ name: 'search' })
  },
  toast: (text, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
  openMenu: (e, items) => set({ menu: { x: e.clientX, y: e.clientY, items } }),
  closeMenu: () => set({ menu: null }),
  openDialog: (d) => set({ dialog: d })
}))

export const toast = (text: string, kind?: Toast['kind']) => useUI.getState().toast(text, kind)
