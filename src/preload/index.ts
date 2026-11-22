import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  LibraryData,
  LyricCandidate,
  LyricPayload,
  MetadataSearchResult,
  ProviderSnapshot,
  ReplayGainUpdate,
  SaveLyricsRequest,
  SaveLyricsResult,
  ScanProgress,
  TagWriteRequest,
  TagWriteResult,
  TitleLanguageVariant,
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

const mediaOrigin = (() => {
  try {
    return ipcRenderer.sendSync('media:origin') as { baseUrl?: string; token?: string } | null
  } catch {
    return null
  }
})()

const api = {
  mediaOrigin,
  library: {
    get: (): Promise<LibraryData> => ipcRenderer.invoke('library:get'),
    importFolder: (): Promise<LibraryData | null> => ipcRenderer.invoke('library:importFolder'),
    importFiles: (): Promise<LibraryData | null> => ipcRenderer.invoke('library:importFiles'),
    addPaths: (paths: string[]): Promise<LibraryData> => ipcRenderer.invoke('library:addPaths', paths),
    rescan: (): Promise<LibraryData> => ipcRenderer.invoke('library:rescan'),
    removeFolder: (f: string): Promise<LibraryData> => ipcRenderer.invoke('library:removeFolder', f),
    removeTracks: (ids: string[]): Promise<LibraryData> => ipcRenderer.invoke('library:removeTracks', ids),
    updateReplayGain: (updates: ReplayGainUpdate[]): Promise<LibraryData> => ipcRenderer.invoke('library:updateReplayGain', updates),
    pendingOpen: (): Promise<string[]> => ipcRenderer.invoke('library:pendingOpen'),
    onProgress: (cb: (p: ScanProgress) => void) => on('library:progress', cb),
    onUpdated: (cb: (d: LibraryData) => void) => on('library:updated', cb),
    onOpenFiles: (cb: (files: string[]) => void) => on('app:openFiles', cb),
    pathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  lyrics: {
    local: (id: string): Promise<LyricPayload | null> => ipcRenderer.invoke('lyrics:local', id),
    search: (q: TrackQuery): Promise<LyricCandidate[]> => ipcRenderer.invoke('lyrics:search', q),
    fetch: (c: LyricCandidate): Promise<LyricPayload | null> => ipcRenderer.invoke('lyrics:fetch', c),
    auto: (q: TrackQuery): Promise<LyricPayload | null> => ipcRenderer.invoke('lyrics:auto', q),
    translate: (lrc: string): Promise<string | null> => ipcRenderer.invoke('lyrics:translate', lrc),
    romanize: (lines: string[]): Promise<string[]> => ipcRenderer.invoke('lyrics:romanize', lines),
    save: (req: SaveLyricsRequest): Promise<SaveLyricsResult & { track?: Track }> => ipcRenderer.invoke('lyrics:save', req)
  },
  providers: {
    list: (): Promise<ProviderSnapshot[]> => ipcRenderer.invoke('providers:list'),
    reload: (): Promise<ProviderSnapshot[]> => ipcRenderer.invoke('providers:reload'),
    update: (id: string, patch: { enabled?: boolean }): Promise<ProviderSnapshot[]> =>
      ipcRenderer.invoke('providers:update', id, patch),
    move: (id: string, dir: -1 | 1): Promise<ProviderSnapshot[]> => ipcRenderer.invoke('providers:move', id, dir),
    resetHealth: (id?: string): Promise<ProviderSnapshot[]> => ipcRenderer.invoke('providers:resetHealth', id),
    openDir: (): Promise<string> => ipcRenderer.invoke('providers:openDir')
  },
  metadata: {
    search: (q: TrackQuery): Promise<MetadataSearchResult> => ipcRenderer.invoke('metadata:search', q),
    titleVariants: (q: TrackQuery): Promise<TitleLanguageVariant[]> => ipcRenderer.invoke('metadata:titleVariants', q),
    pickCover: (): Promise<{ filePath: string; dataUrl: string } | null> => ipcRenderer.invoke('metadata:pickCover'),
    saveCover: (trackId: string): Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('metadata:saveCover', trackId),
    readCoverDataUrl: (name: string): Promise<string | null> => ipcRenderer.invoke('metadata:readCoverDataUrl', name),
    writeTags: (req: TagWriteRequest): Promise<TagWriteResult> => ipcRenderer.invoke('metadata:writeTags', req)
  },
  pickAudioFile: (): Promise<Track | null> => ipcRenderer.invoke('dialog:pickAudioFile'),
  pickWallpaper: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickWallpaper'),
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  config: {
    exportJs: (payload: Record<string, unknown>): Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('config:exportJs', payload),
    importJs: (): Promise<{ ok: boolean; data?: Record<string, any>; filePath?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('config:importJs')
  },
  logPlayerError: (info: { title?: string; path?: string; code?: number; message?: string }) =>
    ipcRenderer.send('log:playerError', info),
  playlist: {
    exportM3u: (req: { name: string; items: { title: string; artist: string; duration: number; path: string }[] }): Promise<{ ok: boolean; filePath?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('playlist:exportM3u', req),
    importM3u: (): Promise<{ ok: boolean; name?: string; trackIds?: string[]; lib?: LibraryData; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('playlist:importM3u')
  },
  floating: {
    syncState: (state: Record<string, unknown>) => ipcRenderer.send('floating:syncState', state),
    getState: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('floating:getState'),
    onState: (cb: (state: any) => void) => on('floating:state', cb),
    sendCommand: (cmd: { type: string; value?: unknown }) => ipcRenderer.send('floating:command', cmd),
    onCommand: (cb: (cmd: { type: string; value?: unknown }) => void) => on('app:floatingCommand', cb),
    toggleMini: (open?: boolean): Promise<boolean> => ipcRenderer.invoke('win:toggleMiniPlayer', open),
    toggleDesktopLyrics: (open?: boolean): Promise<boolean> => ipcRenderer.invoke('win:toggleDesktopLyrics', open),
    setDesktopLyricsLocked: (locked: boolean) => ipcRenderer.send('desktopLyrics:setIgnoreMouse', locked),
    setDesktopLyricsAlwaysOnTop: (enabled: boolean) => ipcRenderer.send('desktopLyrics:setAlwaysOnTop', enabled),
    onUnlockHover: (cb: (hovered: boolean) => void) => on('desktopLyrics:unlockHover', cb),
    setDesktopLyricsSize: (opts: { rows?: number; wide?: boolean; fontSize?: number; direction?: 'horizontal' | 'vertical' }) =>
      ipcRenderer.send('desktopLyrics:setSize', opts),
    resizeStart: (edge: string) => ipcRenderer.send('desktopLyrics:resizeStart', edge),
    resizeMove: () => ipcRenderer.send('desktopLyrics:resizeMove'),
    dragStart: () => ipcRenderer.send('floating:dragStart'),
    dragMove: () => ipcRenderer.send('floating:dragMove')
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb: (v: boolean) => void) => on('win:maximized', cb),
    setTitle: (t: string) => ipcRenderer.send('win:setTitle', t),
    setProgress: (p: number) => ipcRenderer.send('win:progress', p),
    setMinimizeToTray: (enabled: boolean) => ipcRenderer.send('win:setMinimizeToTray', enabled)
  }
}

export type KazeAPI = typeof api
export type AkumyAPI = KazeAPI

contextBridge.exposeInMainWorld('kaze', api)
contextBridge.exposeInMainWorld('akumy', api)
