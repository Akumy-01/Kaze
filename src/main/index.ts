import { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen, nativeTheme } from 'electron'
import path from 'path'
import { promises as fs, createReadStream, existsSync, readFileSync, writeFileSync } from 'fs'
import { Readable } from 'stream'
import crypto from 'crypto'
import {
  loadLibrary,
  getLibrary,
  addPaths,
  rescan,
  removeFolder,
  removeTracks,
  getTrack,
  refreshTrack,
  resolveCoverPath,
  coversDir,
  wallpapersDir,
  saveNow,
  AUDIO_EXTS
} from './library'
import { getLocalLyrics, searchLyrics, fetchLyrics, autoLyrics } from './lyrics'
import { romanize, warmup } from './romaji'
import { embedLyrics, writeSidecar } from './tags'
import type { LyricCandidate, SaveLyricsRequest, SaveLyricsResult, TrackQuery } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'akumy',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true }
  }
])

let win: BrowserWindow | null = null
const pendingOpen: string[] = []

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

async function serveFile(file: string, req: Request): Promise<Response> {
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return new Response('not found', { status: 404 })
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const base = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': type.startsWith('image') ? 'public, max-age=31536000, immutable' : 'no-cache'
  }
  if (type.startsWith('image/')) {
    try {
      const buf = await fs.readFile(file)
      return new Response(buf, {
        status: 200,
        headers: { ...base, 'Content-Length': String(buf.byteLength) }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  }
  const range = req.headers.get('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1
    if (!m?.[1] && m?.[2]) {
      start = stat.size - parseInt(m[2], 10)
      end = stat.size - 1
    }
    end = Math.min(end, stat.size - 1)
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${stat.size}` } })
    }
    const stream = createReadStream(file, { start, end })
    return new Response(Readable.toWeb(stream) as any, {
      status: 206,
      headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}` }
    })
  }
  const stream = createReadStream(file)
  return new Response(Readable.toWeb(stream) as any, {
    status: 200,
    headers: { ...base, 'Content-Length': String(stat.size) }
  })
}

function registerProtocol() {
  protocol.handle('akumy', async (req) => {
    const url = new URL(req.url)
    const host = url.hostname
    if (host === 'media') {
      const p = url.searchParams.get('p')
      if (!p) return new Response('bad request', { status: 400 })
      return serveFile(p, req)
    }
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    if (name.includes('..')) return new Response('forbidden', { status: 403 })
    if (host === 'cover') {
      const resolved = await resolveCoverPath(name)
      if (resolved) return serveFile(resolved, req)
      const fallbackLogo = path.join(__dirname, '../../resources/icon.png')
      if (existsSync(fallbackLogo)) return serveFile(fallbackLogo, req)
      return new Response('not found', { status: 404 })
    }
    if (host === 'wallpaper') return serveFile(path.join(wallpapersDir(), name), req)
    return new Response('not found', { status: 404 })
  })
}

/* ---------------- window state ---------------- */
const stateFile = () => path.join(app.getPath('userData'), 'window.json')
interface WinState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}
function loadWinState(): WinState {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as WinState
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return s.x !== undefined && s.y !== undefined && s.x >= b.x - 50 && s.y >= b.y - 50 && s.x < b.x + b.width && s.y < b.y + b.height
    })
    if (!visible) {
      delete s.x
      delete s.y
    }
    return s
  } catch {
    return { width: 1280, height: 820 }
  }
}
function saveWinState() {
  if (!win) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  try {
    writeFileSync(stateFile(), JSON.stringify({ ...b, maximized }))
  } catch {
    /* ignore */
  }
}

function createWindow() {
  const st = loadWinState()
  win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    title: 'Akumy Music',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  if (st.maximized) win.maximize()
  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => win?.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false))
  win.on('close', saveWinState)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function collectAudioArgs(argv: string[]) {
  return argv.filter((a) => !a.startsWith('-') && AUDIO_EXTS.has(path.extname(a).toLowerCase()) && existsSync(a))
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.handle('library:get', () => getLibrary())
  ipcMain.handle('library:importFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: '选择音乐文件夹', properties: ['openDirectory', 'multiSelections'] })
    if (r.canceled || !r.filePaths.length) return null
    return addPaths(r.filePaths, win)
  })
  ipcMain.handle('library:importFiles', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择音乐文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '音频文件', extensions: [...AUDIO_EXTS].map((e) => e.slice(1)) }]
    })
    if (r.canceled || !r.filePaths.length) return null
    return addPaths(r.filePaths, win)
  })
  ipcMain.handle('library:addPaths', (_e, paths: string[]) => addPaths(paths, win))
  ipcMain.handle('library:rescan', () => rescan(win))
  ipcMain.handle('library:removeFolder', (_e, f: string) => removeFolder(f))
  ipcMain.handle('library:removeTracks', (_e, ids: string[]) => removeTracks(ids))
  ipcMain.handle('library:pendingOpen', () => pendingOpen.splice(0))

  ipcMain.handle('lyrics:local', async (_e, id: string) => {
    const t = getTrack(id)
    return t ? getLocalLyrics(t.path) : null
  })
  ipcMain.handle('lyrics:search', (_e, q: TrackQuery) => searchLyrics(q))
  ipcMain.handle('lyrics:fetch', (_e, c: LyricCandidate) => fetchLyrics(c))
  ipcMain.handle('lyrics:auto', (_e, q: TrackQuery) => autoLyrics(q))
  ipcMain.handle('lyrics:romanize', (_e, lines: string[]) => romanize(lines))
  ipcMain.handle('lyrics:save', async (_e, req: SaveLyricsRequest): Promise<SaveLyricsResult & { track?: unknown }> => {
    const t = getTrack(req.trackId)
    if (!t) return { ok: false, error: '找不到该歌曲' }
    const res: SaveLyricsResult = { ok: true }
    try {
      if (req.mode === 'sidecar' || req.mode === 'both') res.sidecar = await writeSidecar(t.path, req.lrc)
      if (req.mode === 'embed' || req.mode === 'both') {
        await embedLyrics(t.path, req.lrc)
        res.embedded = true
      }
    } catch (e: any) {
      return { ok: false, error: e?.code === 'EBUSY' || e?.code === 'EPERM' ? '文件被占用或没有写入权限' : String(e?.message ?? e) }
    }
    const track = await refreshTrack(t.id)
    return { ...res, track }
  })

  ipcMain.handle('dialog:pickWallpaper', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择壁纸图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const src = r.filePaths[0]
    const data = await fs.readFile(src)
    const name = crypto.createHash('sha1').update(data).digest('hex').slice(0, 16) + path.extname(src).toLowerCase()
    await fs.writeFile(path.join(wallpapersDir(), name), data)
    return `akumy://wallpaper/${name}`
  })

  ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.on('win:minimize', () => win?.minimize())
  ipcMain.on('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
  ipcMain.on('win:close', () => win?.close())
  ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false)
  ipcMain.on('win:setTitle', (_e, title: string) => win?.setTitle(title))
  ipcMain.on('win:progress', (_e, p: number) => win?.setProgressBar(p < 0 ? -1 : p, { mode: p < 0 ? 'none' : 'normal' }))
}

/* ---------------- lifecycle ---------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      const files = collectAudioArgs(argv)
      if (files.length) win.webContents.send('app:openFiles', files)
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.akumy.music')
    pendingOpen.push(...collectAudioArgs(process.argv.slice(1)))
    await loadLibrary()
    registerProtocol()
    registerIpc()
    createWindow()
    setTimeout(warmup, 3000)
  })

  app.on('before-quit', () => {
    void saveNow()
  })
  app.on('window-all-closed', () => app.quit())
}
