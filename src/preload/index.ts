import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  LibraryData,
  LyricCandidate,
  LyricPayload,
  SaveLyricsRequest,
  SaveLyricsResult,
  ScanProgress,
  Track,
  TrackQuery
} from '../shared/types'

const on = <T>(channel: string, cb: (v: T) => void) => {
  const fn = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, fn)
  return () => {
    ipcRenderer.removeListener(channel, fn)
  }
}

const api = {
  library: {
    get: (): Promise<LibraryData> => ipcRenderer.invoke('library:get'),
    importFolder: (): Promise<LibraryData | null> => ipcRenderer.invoke('library:importFolder'),
    importFiles: (): Promise<LibraryData | null> => ipcRenderer.invoke('library:importFiles'),
    addPaths: (paths: string[]): Promise<LibraryData> => ipcRenderer.invoke('library:addPaths', paths),
    rescan: (): Promise<LibraryData> => ipcRenderer.invoke('library:rescan'),
    removeFolder: (f: string): Promise<LibraryData> => ipcRenderer.invoke('library:removeFolder', f),
    removeTracks: (ids: string[]): Promise<LibraryData> => ipcRenderer.invoke('library:removeTracks', ids),
    pendingOpen: (): Promise<string[]> => ipcRenderer.invoke('library:pendingOpen'),
    onProgress: (cb: (p: ScanProgress) => void) => on('library:progress', cb),
    onOpenFiles: (cb: (files: string[]) => void) => on('app:openFiles', cb),
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  lyrics: {
    local: (id: string): Promise<LyricPayload | null> => ipcRenderer.invoke('lyrics:local', id),
    search: (q: TrackQuery): Promise<LyricCandidate[]> => ipcRenderer.invoke('lyrics:search', q),
    fetch: (c: LyricCandidate): Promise<LyricPayload | null> => ipcRenderer.invoke('lyrics:fetch', c),
    auto: (q: TrackQuery): Promise<LyricPayload | null> => ipcRenderer.invoke('lyrics:auto', q),
    romanize: (lines: string[]): Promise<string[]> => ipcRenderer.invoke('lyrics:romanize', lines),
    save: (req: SaveLyricsRequest): Promise<SaveLyricsResult & { track?: Track }> => ipcRenderer.invoke('lyrics:save', req)
  },
  pickWallpaper: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickWallpaper'),
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb: (v: boolean) => void) => on('win:maximized', cb),
    setTitle: (t: string) => ipcRenderer.send('win:setTitle', t),
    setProgress: (p: number) => ipcRenderer.send('win:progress', p)
  }
}

export type AkumyAPI = typeof api

contextBridge.exposeInMainWorld('akumy', api)
