import { app, BrowserWindow, ipcMain, dialog, protocol, shell, screen, nativeTheme, Tray, Menu, nativeImage, globalShortcut } from 'electron'
import http from 'http'
import path from 'path'
import { promises as fs, createReadStream, existsSync, readFileSync, writeFileSync } from 'fs'
import { Readable, Transform } from 'stream'
import crypto from 'crypto'
import vm from 'vm'
import {
  getDesktopLyricPersistedBounds,
  getDesktopLyricWindow,
  initDesktopLyric,
  moveDesktopLyricDrag,
  moveDesktopLyricResize,
  restoreDesktopLyricPersistedBounds,
  sendToDesktopLyric,
  setDesktopLyricAlwaysOnTop,
  setDesktopLyricLocked,
  setDesktopLyricSizePreset,
  startDesktopLyricDrag,
  startDesktopLyricResize,
  toggleDesktopLyricWindow
} from './desktopLyric'
import {
  loadLibrary,
  getLibrary,
  addPaths,
  rescan,
  removeFolder,
  removeTracks,
  updateReplayGain,
  getTrack,
  parseTrack,
  refreshTrack,
  resolveCoverPath,
  coversDir,
  wallpapersDir,
  saveNow,
  setLibraryWindow,
  AUDIO_EXTS
} from './library'
import { getLocalLyrics, searchLyrics, fetchLyrics, autoLyrics, translateLyricsToZh } from './lyrics'
import {
  createExampleProviderTemplate,
  exportProviderPrefs,
  getProviders,
  importProviderPrefs,
  lookupTitleVariants,
  moveProvider,
  reloadProviders,
  resetProviderHealth,
  searchMetadataWithFallback,
  updateProvider
} from './providers'
import { romanize, warmup } from './romaji'
import { embedLyrics, writeSidecar, writeTrackTags } from './tags'
import type {
  LyricCandidate,
  ReplayGainUpdate,
  SaveLyricsRequest,
  SaveLyricsResult,
  TagWriteRequest,
  TagWriteResult,
  TrackQuery
} from '../shared/types'

// Prevent Chromium from switching to scRGB float16 HDR composition on Windows HDR displays,
// which otherwise causes bright translucent glass and saturate() filters to blow out highlights.
app.commandLine.appendSwitch('force-color-profile', 'srgb')

const schemePrivileges = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
  bypassCSP: true
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'kaze', privileges: schemePrivileges },
  { scheme: 'akumy', privileges: schemePrivileges }
])

let win: BrowserWindow | null = null
let miniWin: BrowserWindow | null = null
const MINI_W = 368
const MINI_H = 132
let floatingBounds = {
  mini: null as { x: number; y: number } | null
}
let isFloatingProgrammaticMove = false
let tray: Tray | null = null
let minimizeToTrayPref = true
let isQuitting = false
let lastFloatingState: Record<string, unknown> | null = null
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
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.jfif': 'image/jpeg'
}

/** Migrate library, covers, wallpapers and window bounds from legacy Akumy Music userData on first run. */
async function migrateLegacyUserData() {
  const curDir = app.getPath('userData')
  const curLib = path.join(curDir, 'library.json')
  if (existsSync(curLib)) return

  const legacyDir = path.join(path.dirname(curDir), 'Akumy Music')
  if (!existsSync(path.join(legacyDir, 'library.json'))) return

  try {
    await fs.mkdir(curDir, { recursive: true })
    for (const file of ['library.json', 'window.json', 'providers.json']) {
      const src = path.join(legacyDir, file)
      const dst = path.join(curDir, file)
      if (existsSync(src) && !existsSync(dst)) {
        await fs.copyFile(src, dst)
      }
    }
    for (const sub of ['covers', 'wallpapers', 'providers']) {
      const srcSub = path.join(legacyDir, sub)
      const dstSub = path.join(curDir, sub)
      if (existsSync(srcSub)) {
        await fs.mkdir(dstSub, { recursive: true })
        const items = await fs.readdir(srcSub)
        for (const item of items) {
          const s = path.join(srcSub, item)
          const d = path.join(dstSub, item)
          if (!existsSync(d)) {
            const st = await fs.stat(s)
            if (st.isFile()) await fs.copyFile(s, d)
          }
        }
      }
    }
  } catch (e) {
    console.warn('[migrate] legacy userData copy skipped:', e)
  }
}

interface FlacPatch {
  offset: number
  value: number
}

const flacPatchCache = new Map<string, FlacPatch[]>()

/** Append diagnostic playback errors to <userData>/logs/player.log for easy inspection. */
async function appendPlayerLog(line: string) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    await fs.mkdir(dir, { recursive: true })
    const logPath = path.join(dir, 'player.log')
    const stamp = new Date().toISOString()
    await fs.appendFile(logPath, `[${stamp}] ${line}\n`, 'utf8')
  } catch {
    /* ignore log write errors */
  }
}

/**
 * Scan FLAC metadata block headers and mask PICTURE blocks with missing MIME strings as PADDING
 * when streaming over kaze://media, fixing Chromium FFmpegDemuxer open failures non-destructively.
 */
async function getFlacHeaderPatches(file: string, size: number, mtimeMs: number): Promise<FlacPatch[]> {
  if (path.extname(file).toLowerCase() !== '.flac' || size < 42) return []
  const key = `${file}|${mtimeMs}|${size}`
  const cached = flacPatchCache.get(key)
  if (cached) return cached

  const patches: FlacPatch[] = []
  let fh: fs.FileHandle | null = null
  try {
    fh = await fs.open(file, 'r')
    const magic = Buffer.alloc(4)
    await fh.read(magic, 0, 4, 0)
    if (magic.toString('latin1') === 'fLaC') {
      let off = 4
      const buf = Buffer.alloc(12)
      while (off + 4 <= size && off < 2 * 1024 * 1024) {
        const { bytesRead } = await fh.read(buf, 0, 12, off)
        if (bytesRead < 4) break
        const hdr = buf[0]
        const isLast = (hdr & 0x80) !== 0
        const type = hdr & 0x7f
        const len = (buf[1] << 16) | (buf[2] << 8) | buf[3]
        if (type === 6 && len >= 32 && bytesRead >= 12) {
          const mimeLen = buf.readUInt32BE(8)
          if (mimeLen === 0 || mimeLen > len - 24) {
            patches.push({ offset: off, value: (hdr & 0x80) | 1 })
          }
        }
        off += 4 + len
        if (isLast) break
      }
    }
  } catch {
    /* fallback to unpatched stream */
  } finally {
    await fh?.close()
  }

  if (flacPatchCache.size > 500) flacPatchCache.clear()
  flacPatchCache.set(key, patches)
  return patches
}

function openMediaReadable(file: string, patches: FlacPatch[], start?: number, end?: number): Readable {
  const rs = createReadStream(file, start !== undefined ? { start, end } : undefined)
  const baseStart = start ?? 0
  const maxEnd = end ?? Number.MAX_SAFE_INTEGER
  const relevant = patches.filter((p) => p.offset >= baseStart && p.offset <= maxEnd)
  if (!relevant.length) return rs

  let pos = baseStart
  const tx = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      let out = chunk
      for (const p of relevant) {
        if (p.offset >= pos && p.offset < pos + chunk.length) {
          if (out === chunk) out = Buffer.from(chunk)
          out[p.offset - pos] = p.value
        }
      }
      pos += chunk.length
      cb(null, out)
    }
  })
  rs.on('error', (err) => tx.destroy(err))
  tx.on('close', () => {
    if (!rs.destroyed) rs.destroy()
  })
  return rs.pipe(tx)
}

async function serveFile(file: string, req: Request): Promise<Response> {
  let stat
  try {
    stat = await fs.stat(file)
  } catch (e: any) {
    void appendPlayerLog(`serveFile 404 file="${file}" err=${e?.message ?? e}`)
    return new Response('not found', { status: 404 })
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const base = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    Vary: 'Origin, Access-Control-Request-Headers',
    'Cache-Control': type.startsWith('image') ? 'public, max-age=300' : 'no-cache'
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
  const patches = type === 'audio/flac' ? await getFlacHeaderPatches(file, stat.size, stat.mtimeMs) : []
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
    const stream = openMediaReadable(file, patches, start, end)
    return new Response(Readable.toWeb(stream) as any, {
      status: 206,
      headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${stat.size}` }
    })
  }
  const stream = openMediaReadable(file, patches)
  return new Response(Readable.toWeb(stream) as any, {
    status: 200,
    headers: { ...base, 'Content-Length': String(stat.size) }
  })
}

const MEDIA_TOKEN = crypto.randomBytes(16).toString('hex')
let mediaServer: http.Server | null = null
let mediaOriginInfo: { baseUrl: string; token: string } | null = null

async function startMediaServer(): Promise<void> {
  if (mediaServer) return
  await new Promise<void>((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        if (u.searchParams.get('token') !== MEDIA_TOKEN) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('forbidden')
          return
        }
        if (u.pathname.startsWith('/cover/')) {
          const name = decodeURIComponent(u.pathname.slice('/cover/'.length))
          if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
            res.writeHead(403)
            res.end('forbidden')
            return
          }
          const resolved = await resolveCoverPath(name)
          if (!resolved) {
            res.writeHead(404, { 'Access-Control-Allow-Origin': '*' })
            res.end('not found')
            return
          }
          const buf = await fs.readFile(resolved)
          const cType = MIME[path.extname(resolved).toLowerCase()] ?? 'image/jpeg'
          res.writeHead(200, {
            'Content-Type': cType,
            'Content-Length': buf.byteLength,
            'Access-Control-Allow-Origin': '*',
            Vary: 'Origin, Access-Control-Request-Headers',
            'Cache-Control': 'public, max-age=300'
          })
          res.end(req.method === 'HEAD' ? undefined : buf)
          return
        }
        if (u.pathname !== '/media') {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('not found')
          return
        }
        const file = u.searchParams.get('p')
        if (!file) {
          res.writeHead(400)
          res.end('bad request')
          return
        }
        let stat
        try {
          stat = await fs.stat(file)
        } catch {
          res.writeHead(404)
          res.end('not found')
          return
        }
        const ext = path.extname(file).toLowerCase()
        const type = MIME[ext] ?? 'application/octet-stream'
        const etag = `"${stat.size}-${Math.trunc(stat.mtimeMs)}"`
        const commonHeaders: Record<string, string | number> = {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
          ETag: etag,
          'Last-Modified': stat.mtime.toUTCString()
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { ...commonHeaders, 'Content-Length': stat.size })
          res.end()
          return
        }
        const patches = type === 'audio/flac' ? await getFlacHeaderPatches(file, stat.size, stat.mtimeMs) : []
        const range = req.headers.range
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range)
          let start = m && m[1] ? parseInt(m[1], 10) : 0
          let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1
          if (!m?.[1] && m?.[2]) {
            start = Math.max(0, stat.size - parseInt(m[2], 10))
            end = stat.size - 1
          }
          end = Math.min(end, stat.size - 1)
          if (start > end || start >= stat.size) {
            res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` })
            res.end()
            return
          }
          res.writeHead(206, {
            ...commonHeaders,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`
          })
          const stream = openMediaReadable(file, patches, start, end)
          const cleanup = () => {
            if (!stream.destroyed) stream.destroy()
          }
          req.on('close', cleanup)
          res.on('close', cleanup)
          stream.on('error', () => {
            if (!res.headersSent) res.writeHead(500)
            res.end()
          })
          stream.pipe(res)
          return
        }
        res.writeHead(200, { ...commonHeaders, 'Content-Length': stat.size })
        const stream = openMediaReadable(file, patches)
        const cleanup = () => {
          if (!stream.destroyed) stream.destroy()
        }
        req.on('close', cleanup)
        res.on('close', cleanup)
        stream.on('error', () => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
        stream.pipe(res)
      } catch {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    })
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        mediaOriginInfo = { baseUrl: `http://127.0.0.1:${addr.port}`, token: MEDIA_TOKEN }
      }
      mediaServer = srv
      resolve()
    })
    srv.on('error', () => resolve())
  })
}

function registerProtocol() {
  const handleCustomProtocol = async (req: Request): Promise<Response> => {
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
      return new Response('not found', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    }
    if (host === 'wallpaper') return serveFile(path.join(wallpapersDir(), name), req)
    return new Response('not found', { status: 404 })
  }

  protocol.handle('kaze', handleCustomProtocol)
  protocol.handle('akumy', handleCustomProtocol)
}

function clampFloatingPos(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const disp = screen.getDisplayMatching({ x: Math.round(x), y: Math.round(y), width, height })
  const wa = disp.workArea
  return {
    x: Math.max(wa.x - width + 80, Math.min(wa.x + wa.width - 80, Math.round(x))),
    y: Math.max(wa.y, Math.min(wa.y + wa.height - 40, Math.round(y)))
  }
}

/* ---------------- window state ---------------- */
const stateFile = () => path.join(app.getPath('userData'), 'window.json')
interface WinState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
  miniPos?: { x: number; y: number }
  lyricsPos?: { x: number; y: number }
  lyricsSize?: { width: number; height: number }
}
function loadWinState(): WinState {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as WinState
    const isVisible = (x?: number, y?: number) =>
      x !== undefined &&
      y !== undefined &&
      screen.getAllDisplays().some((d) => {
        const b = d.workArea
        return x >= b.x - 100 && y >= b.y - 50 && x < b.x + b.width && y < b.y + b.height
      })
    if (!isVisible(s.x, s.y)) {
      delete s.x
      delete s.y
    }
    if (s.miniPos && !isVisible(s.miniPos.x, s.miniPos.y)) delete s.miniPos
    if (s.lyricsPos && !isVisible(s.lyricsPos.x, s.lyricsPos.y)) delete s.lyricsPos
    restoreDesktopLyricPersistedBounds(s.lyricsPos, s.lyricsSize)
    floatingBounds.mini = s.miniPos ?? null
    return s
  } catch {
    return { width: 1280, height: 820 }
  }
}
function saveWinState() {
  if (!win) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  const lyricsPersist = getDesktopLyricPersistedBounds()
  try {
    writeFileSync(
      stateFile(),
      JSON.stringify({
        ...b,
        maximized,
        miniPos: floatingBounds.mini ?? undefined,
        lyricsPos: lyricsPersist.pos,
        lyricsSize: lyricsPersist.size
      })
    )
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
    title: 'Kaze',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  if (st.maximized) win.maximize()
  setLibraryWindow(win)
  win.once('ready-to-show', () => win?.show())
  win.on('maximize', () => win?.webContents.send('win:maximized', true))
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false))
  win.on('close', (e) => {
    saveWinState()
    if (!isQuitting && minimizeToTrayPref) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    miniWin?.close()
    getDesktopLyricWindow()?.close()
  })
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

function loadRouteWindow(target: BrowserWindow, hash: string) {
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    target.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    target.loadFile(path.join(__dirname, '../renderer/index.html'), { hash })
  }
}

function toggleMiniPlayerWindow(forceOpen?: boolean): boolean {
  if (miniWin && !miniWin.isDestroyed()) {
    if (forceOpen === true) {
      miniWin.show()
      miniWin.focus()
      return true
    }
    miniWin.close()
    miniWin = null
    return false
  }
  if (forceOpen === false) return false
  const wa = screen.getPrimaryDisplay().workArea
  const startPos = floatingBounds.mini
    ? clampFloatingPos(floatingBounds.mini.x, floatingBounds.mini.y, MINI_W, MINI_H)
    : { x: wa.x + wa.width - (MINI_W + 24), y: wa.y + wa.height - (MINI_H + 24) }
  floatingBounds.mini = startPos
  miniWin = new BrowserWindow({
    width: MINI_W,
    height: MINI_H,
    minWidth: MINI_W,
    minHeight: MINI_H,
    maxWidth: MINI_W,
    maxHeight: MINI_H,
    useContentSize: true,
    roundedCorners: false,
    x: startPos.x,
    y: startPos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webgl: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  miniWin.setAlwaysOnTop(true, 'floating')
  miniWin.on('will-resize', (e) => e.preventDefault())
  miniWin.on('move', () => {
    if (!miniWin || miniWin.isDestroyed() || isFloatingProgrammaticMove || !floatingBounds.mini) return
    if (process.platform === 'win32') {
      isFloatingProgrammaticMove = true
      miniWin.setBounds({ x: floatingBounds.mini.x, y: floatingBounds.mini.y, width: MINI_W, height: MINI_H })
      isFloatingProgrammaticMove = false
    }
  })
  miniWin.on('closed', () => {
    saveWinState()
    miniWin = null
  })
  miniWin.webContents.on('did-finish-load', () => {
    if (lastFloatingState) miniWin?.webContents.send('floating:state', lastFloatingState)
  })
  loadRouteWindow(miniWin, 'mini')
  return true
}

function createTrayAndShortcuts() {
  const iconPath = path.join(__dirname, '../../resources/icon.png')
  if (existsSync(iconPath) && !tray) {
    const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.setToolTip('Kaze')
    const menu = Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (win) {
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
          }
        }
      },
      { type: 'separator' },
      { label: '播放 / 暂停', click: () => win?.webContents.send('app:floatingCommand', { type: 'toggle' }) },
      { label: '上一首', click: () => win?.webContents.send('app:floatingCommand', { type: 'prev' }) },
      { label: '下一首', click: () => win?.webContents.send('app:floatingCommand', { type: 'next' }) },
      { type: 'separator' },
      { label: '迷你浮窗', click: () => toggleMiniPlayerWindow() },
      { label: '桌面悬浮歌词', click: () => toggleDesktopLyricWindow() },
      {
        label: '解锁桌面歌词交互',
        click: () => {
          setDesktopLyricLocked(false)
          win?.webContents.send('app:floatingCommand', { type: 'unlockLyrics' })
        }
      },
      { type: 'separator' },
      {
        label: '退出 Kaze',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
    tray.setContextMenu(menu)
    tray.on('double-click', () => {
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
  }

  try {
    globalShortcut.register('MediaPlayPause', () => win?.webContents.send('app:floatingCommand', { type: 'toggle' }))
    globalShortcut.register('MediaNextTrack', () => win?.webContents.send('app:floatingCommand', { type: 'next' }))
    globalShortcut.register('MediaPreviousTrack', () => win?.webContents.send('app:floatingCommand', { type: 'prev' }))
    globalShortcut.register('MediaStop', () => win?.webContents.send('app:floatingCommand', { type: 'pause' }))
  } catch {
    /* ignore hardware media key conflict */
  }
}

function collectAudioArgs(argv: string[]) {
  return argv.filter((a) => !a.startsWith('-') && AUDIO_EXTS.has(path.extname(a).toLowerCase()) && existsSync(a))
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.on('media:origin', (e) => {
    e.returnValue = mediaOriginInfo
  })
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
  ipcMain.handle('library:updateReplayGain', (_e, updates: ReplayGainUpdate[]) => updateReplayGain(updates))
  ipcMain.handle('library:pendingOpen', () => pendingOpen.splice(0))

  ipcMain.handle('dialog:pickAudioFile', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择音频文件进行分析',
      properties: ['openFile'],
      filters: [{ name: '音频文件', extensions: [...AUDIO_EXTS].map((e) => e.slice(1)) }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return parseTrack(r.filePaths[0])
  })

  ipcMain.handle('lyrics:local', async (_e, id: string) => {
    const t = getTrack(id)
    return t ? getLocalLyrics(t.path) : null
  })
  ipcMain.handle('lyrics:search', (_e, q: TrackQuery) => searchLyrics(q))
  ipcMain.handle('lyrics:fetch', (_e, c: LyricCandidate) => fetchLyrics(c))
  ipcMain.handle('lyrics:auto', (_e, q: TrackQuery) => autoLyrics(q))
  ipcMain.handle('lyrics:translate', (_e, lrc: string) => translateLyricsToZh(lrc))
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

  /* ---------------- Providers & Metadata Tagging ---------------- */
  ipcMain.handle('providers:list', () => getProviders())
  ipcMain.handle('providers:reload', () => reloadProviders())
  ipcMain.handle('providers:update', (_e, id: string, patch: { enabled?: boolean }) => updateProvider(id, patch))
  ipcMain.handle('providers:move', (_e, id: string, dir: -1 | 1) => moveProvider(id, dir))
  ipcMain.handle('providers:resetHealth', (_e, id?: string) => resetProviderHealth(id))
  ipcMain.handle('providers:openDir', async () => {
    const dir = await createExampleProviderTemplate()
    await shell.openPath(dir)
    return dir
  })

  ipcMain.handle('metadata:search', (_e, q: TrackQuery) => searchMetadataWithFallback(q))
  ipcMain.handle('metadata:titleVariants', async (_e, q: TrackQuery) => {
    const list = await lookupTitleVariants(q)
    const jaItems = list.filter((x) => x.lang === 'ja')
    if (jaItems.length > 0 && !list.some((x) => x.lang === 'romaji')) {
      try {
        const [romaTitle] = await romanize([jaItems[0].title])
        if (romaTitle && romaTitle.trim() && romaTitle.toLowerCase() !== jaItems[0].title.toLowerCase()) {
          list.push({
            lang: 'romaji',
            langLabel: '日语罗马音',
            title: romaTitle.trim(),
            artist: jaItems[0].artist,
            album: jaItems[0].album,
            source: 'Kuroshiro 罗马音'
          })
        }
      } catch {
        /* optional */
      }
    }
    return list
  })
  ipcMain.handle('metadata:pickCover', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择专辑封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const filePath = r.filePaths[0]
    try {
      const buf = await fs.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : 'image/jpeg'
      return { filePath, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch {
      return null
    }
  })
  ipcMain.handle('metadata:saveCover', async (_e, trackId: string): Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }> => {
    const t = getTrack(trackId)
    if (!t) return { ok: false, error: '找不到该歌曲' }
    let coverPath: string | null = t.cover ? await resolveCoverPath(t.cover) : null
    if (!coverPath) {
      const refreshed = await refreshTrack(t.id)
      if (refreshed?.cover) coverPath = await resolveCoverPath(refreshed.cover)
    }
    if (!coverPath) return { ok: false, error: '该歌曲暂无可导出的专辑封面' }
    const ext = path.extname(coverPath) || '.jpg'
    const baseName = `${t.title || 'cover'}${t.artist ? ` - ${t.artist}` : ''}`.replace(/[\\/:*?"<>|]/g, '_')
    const r = await dialog.showSaveDialog(win!, {
      title: '另存专辑封面',
      defaultPath: `${baseName}${ext}`,
      filters: [{ name: '图片文件', extensions: [ext.replace('.', ''), 'jpg', 'png', 'webp'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    await fs.copyFile(coverPath, r.filePath)
    return { ok: true, filePath: r.filePath }
  })
  ipcMain.handle('metadata:readCoverDataUrl', async (_e, name: string): Promise<string | null> => {
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null
    const resolved = await resolveCoverPath(name)
    if (!resolved) return null
    try {
      const buf = await fs.readFile(resolved)
      const mime = MIME[path.extname(resolved).toLowerCase()] ?? 'image/jpeg'
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })
  ipcMain.handle('metadata:writeTags', async (_e, req: TagWriteRequest): Promise<TagWriteResult> => {
    const t = getTrack(req.trackId)
    if (!t) return { ok: false, error: '找不到该歌曲' }
    try {
      const { coverUpdated } = await writeTrackTags(t.path, req)
      const track = await refreshTrack(t.id)
      return { ok: true, track: track ?? undefined, coverUpdated }
    } catch (e: any) {
      return {
        ok: false,
        error: e?.code === 'EBUSY' || e?.code === 'EPERM' ? '文件被占用或没有写入权限（请暂停播放后重试）' : String(e?.message ?? e)
      }
    }
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
    return `kaze://wallpaper/${name}`
  })

  ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('config:exportJs', async (_e, payload: Record<string, unknown>) => {
    const providerPrefs = await exportProviderPrefs()
    const full = {
      schema: 'kaze-config-v1',
      exportedAt: new Date().toISOString(),
      ...payload,
      providers: providerPrefs
    }
    const r = await dialog.showSaveDialog(win!, {
      title: '导出 Kaze 配置 (.js)',
      defaultPath: 'kaze-config.js',
      filters: [{ name: 'JavaScript 配置文件', extensions: ['js'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    const jsContent =
      `// Kaze 配置文件 · 导出时间：${full.exportedAt}\n` +
      `// 支持通过「设置 -> 配置备份与恢复 -> 从 JS 文件导入配置」直接还原\n` +
      `export default ${JSON.stringify(full, null, 2)};\n`
    await fs.writeFile(r.filePath, jsContent, 'utf8')
    return { ok: true, filePath: r.filePath }
  })

  ipcMain.handle('config:importJs', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '选择 Kaze 配置文件 (.js / .json)',
      properties: ['openFile'],
      filters: [{ name: '配置文件 (*.js, *.json)', extensions: ['js', 'json'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    try {
      const raw = await fs.readFile(r.filePaths[0], 'utf8')
      let parsed: any = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        const cleaned = raw
          .replace(/^\uFEFF/, '')
          .replace(/^\s*(?:export\s+default|module\.exports\s*=|(?:const|let|var)\s+\w+\s*=|window\.[A-Za-z0-9_$]+\s*=)\s*/m, '')
          .replace(/;\s*$/, '')
          .trim()
        try {
          parsed = JSON.parse(cleaned)
        } catch {
          parsed = vm.runInNewContext(`(${cleaned})`, Object.create(null), {
            timeout: 100
          })
        }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: '配置文件格式无效：根节点必须是配置对象' }
      }
      if (parsed.providers) {
        await importProviderPrefs(parsed.providers)
      }
      return { ok: true, data: parsed, filePath: r.filePaths[0] }
    } catch (e: any) {
      return { ok: false, error: `解析配置失败：${String(e?.message ?? e)}` }
    }
  })
  ipcMain.on('log:playerError', (_e, info: { title?: string; path?: string; code?: number; message?: string }) => {
    void appendPlayerLog(
      `playbackError title="${info?.title ?? ''}" code=${info?.code ?? 'unknown'} msg="${info?.message ?? ''}" path="${info?.path ?? ''}"`
    )
  })

  ipcMain.handle('playlist:exportM3u', async (_e, req: { name: string; items: { title: string; artist: string; duration: number; path: string }[] }) => {
    const safeName = (req.name || 'playlist').replace(/[\\/:*?"<>|]/g, '_')
    const r = await dialog.showSaveDialog(win!, {
      title: '导出歌单为 .m3u8',
      defaultPath: `${safeName}.m3u8`,
      filters: [{ name: 'M3U8 歌单', extensions: ['m3u8', 'm3u'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    const lines = ['#EXTM3U']
    for (const item of req.items) {
      lines.push(`#EXTINF:${Math.round(item.duration || 0)},${item.artist} - ${item.title}`)
      lines.push(item.path)
    }
    await fs.writeFile(r.filePath, lines.join('\n') + '\n', 'utf8')
    return { ok: true, filePath: r.filePath }
  })

  ipcMain.handle('playlist:importM3u', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '导入 .m3u / .m3u8 歌单',
      properties: ['openFile'],
      filters: [{ name: 'M3U 歌单', extensions: ['m3u8', 'm3u'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
    const filePath = r.filePaths[0]
    const dir = path.dirname(filePath)
    const raw = await fs.readFile(filePath, 'utf8')
    const rawPaths = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => (path.isAbsolute(l) ? l : path.resolve(dir, l)))
      .filter((p) => existsSync(p) && AUDIO_EXTS.has(path.extname(p).toLowerCase()))

    if (!rawPaths.length) return { ok: false, error: '歌单内没有可访问的本地音频文件' }
    const lib = await addPaths(rawPaths, win)
    const pathSet = new Set(rawPaths.map((p) => p.toLowerCase()))
    const trackIds = lib.tracks.filter((t) => pathSet.has(t.path.toLowerCase())).map((t) => t.id)
    const name = path.basename(filePath, path.extname(filePath))
    return { ok: true, name, trackIds, lib }
  })

  ipcMain.on('floating:syncState', (_e, state: Record<string, unknown>) => {
    lastFloatingState = state
    if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('floating:state', state)
    sendToDesktopLyric('floating:state', state)
  })
  ipcMain.handle('floating:getState', () => lastFloatingState)
  ipcMain.on('floating:command', (_e, cmd: Record<string, unknown>) => {
    if (cmd?.type === 'showMain' && win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }
    win?.webContents.send('app:floatingCommand', cmd)
  })
  ipcMain.handle('win:toggleMiniPlayer', (_e, open?: boolean) => toggleMiniPlayerWindow(open))
  ipcMain.handle('win:toggleDesktopLyrics', (_e, open?: boolean) => toggleDesktopLyricWindow(open))
  const miniDragAnchors = new WeakMap<
    Electron.WebContents,
    { winX: number; winY: number; cursorX: number; cursorY: number }
  >()
  ipcMain.on('floating:dragStart', (e) => {
    const target = BrowserWindow.fromWebContents(e.sender)
    if (!target || target.isDestroyed()) return
    if (target === getDesktopLyricWindow()) {
      startDesktopLyricDrag()
      return
    }
    const [curX, curY] = target.getPosition()
    const winX = floatingBounds.mini?.x ?? curX
    const winY = floatingBounds.mini?.y ?? curY
    const cursor = screen.getCursorScreenPoint()
    miniDragAnchors.set(e.sender, { winX, winY, cursorX: cursor.x, cursorY: cursor.y })
  })
  ipcMain.on('floating:dragMove', (e) => {
    const target = BrowserWindow.fromWebContents(e.sender)
    if (!target || target.isDestroyed()) return
    if (target === getDesktopLyricWindow()) {
      moveDesktopLyricDrag()
      return
    }
    const anchor = miniDragAnchors.get(e.sender)
    if (!anchor) return
    const cur = screen.getCursorScreenPoint()
    const nextPos = clampFloatingPos(
      anchor.winX + (cur.x - anchor.cursorX),
      anchor.winY + (cur.y - anchor.cursorY),
      MINI_W,
      MINI_H
    )
    floatingBounds.mini = nextPos
    isFloatingProgrammaticMove = true
    target.setBounds({ x: nextPos.x, y: nextPos.y, width: MINI_W, height: MINI_H })
    isFloatingProgrammaticMove = false
  })
  ipcMain.on('desktopLyrics:setSize', (_e, opts: { rows?: number; wide?: boolean; fontSize?: number; direction?: 'horizontal' | 'vertical' }) => {
    setDesktopLyricSizePreset(opts)
  })
  ipcMain.on('desktopLyrics:resizeStart', (_e, edge: string) => {
    startDesktopLyricResize(edge)
  })
  ipcMain.on('desktopLyrics:resizeMove', () => {
    moveDesktopLyricResize()
  })
  ipcMain.on('desktopLyrics:setIgnoreMouse', (_e, locked: boolean) => {
    setDesktopLyricLocked(!!locked)
  })
  ipcMain.on('desktopLyrics:setAlwaysOnTop', (_e, enabled: boolean) => {
    setDesktopLyricAlwaysOnTop(!!enabled)
  })
  ipcMain.on('win:setMinimizeToTray', (_e, enabled: boolean) => {
    minimizeToTrayPref = !!enabled
  })

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
      win.show()
      win.focus()
      const files = collectAudioArgs(argv)
      if (files.length) win.webContents.send('app:openFiles', files)
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.kaze.music')
    pendingOpen.push(...collectAudioArgs(process.argv.slice(1)))
    await migrateLegacyUserData()
    await loadLibrary()
    await startMediaServer()
    registerProtocol()
    initDesktopLyric({
      loadRoute: loadRouteWindow,
      onSaveState: saveWinState,
      getInitialFloatingState: () => lastFloatingState
    })
    registerIpc()
    createWindow()
    createTrayAndShortcuts()
    setTimeout(warmup, 3000)
  })

  app.on('before-quit', () => {
    isQuitting = true
    void saveNow()
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    tray?.destroy()
    tray = null
    mediaServer?.close()
    mediaServer = null
  })
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit()
  })
}
