import { app, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { parseFile } from 'music-metadata'
import type { LibraryData, ScanProgress, Track } from '../shared/types'

export const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.webm'])
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart']

const dataDir = () => app.getPath('userData')
export const coversDir = () => path.join(dataDir(), 'covers')
export const wallpapersDir = () => path.join(dataDir(), 'wallpapers')
const libraryFile = () => path.join(dataDir(), 'library.json')

let library: LibraryData = { tracks: [], folders: [] }
let byId = new Map<string, Track>()
let saveTimer: NodeJS.Timeout | null = null

export const trackId = (p: string) =>
  crypto.createHash('sha1').update(path.normalize(p).toLowerCase()).digest('hex').slice(0, 16)

export async function loadLibrary(): Promise<LibraryData> {
  await fs.mkdir(coversDir(), { recursive: true })
  await fs.mkdir(wallpapersDir(), { recursive: true })
  try {
    const raw = await fs.readFile(libraryFile(), 'utf8')
    const parsed = JSON.parse(raw) as LibraryData
    library = { tracks: parsed.tracks ?? [], folders: parsed.folders ?? [] }
  } catch {
    library = { tracks: [], folders: [] }
  }
  reindex()
  return library
}

function reindex() {
  byId = new Map(library.tracks.map((t) => [t.id, t]))
}

export function getLibrary() {
  return library
}
export function getTrack(id: string) {
  return byId.get(id)
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNow()
  }, 400)
}

export async function saveNow() {
  const tmp = libraryFile() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(library), 'utf8')
  await fs.rename(tmp, libraryFile())
}

async function walk(dir: string, out: string[]) {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !e.name.startsWith('$')) await walk(full, out)
    } else if (e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(full)
    }
  }
}

async function saveCover(data: Uint8Array, format?: string): Promise<string> {
  const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 20)
  const ext = format?.includes('png') ? '.png' : '.jpg'
  const name = hash + ext
  const file = path.join(coversDir(), name)
  if (!existsSync(file)) await fs.writeFile(file, data)
  return name
}

const folderCoverCache = new Map<string, string | null>()
async function findFolderCover(dir: string): Promise<string | undefined> {
  if (folderCoverCache.has(dir)) return folderCoverCache.get(dir) ?? undefined
  let found: string | null = null
  try {
    const files = await fs.readdir(dir)
    const img = files.find((f) => {
      const ext = path.extname(f).toLowerCase()
      const base = path.basename(f, ext).toLowerCase()
      return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && COVER_NAMES.includes(base)
    })
    if (img) {
      const data = await fs.readFile(path.join(dir, img))
      found = await saveCover(data, path.extname(img))
    }
  } catch {
    /* ignore */
  }
  folderCoverCache.set(dir, found)
  return found ?? undefined
}

function guessFromFilename(file: string) {
  const base = path.basename(file, path.extname(file))
  const m = base.match(/^(?:\d+[\s.\-_]+)?(.+?)\s+-\s+(.+)$/)
  if (m) return { artist: m[1].trim(), title: m[2].trim() }
  return { title: base.replace(/^\d+[\s.\-_]+/, '').trim() }
}

export async function parseTrack(file: string, prev?: Track): Promise<Track | null> {
  try {
    const stat = await fs.stat(file)
    const meta = await parseFile(file, { duration: true, skipCovers: false })
    const c = meta.common
    const f = meta.format
    const guess = guessFromFilename(file)
    let cover: string | undefined
    const pic = c.picture?.find((p) => /front|cover/i.test(p.type ?? '')) ?? c.picture?.[0]
    if (pic) cover = await saveCover(pic.data, pic.format)
    else cover = await findFolderCover(path.dirname(file))

    const lyrics = (c.lyrics ?? []).some((l: unknown) => {
      if (typeof l === 'string') return l.trim().length > 0
      const obj = l as { text?: string; syncText?: unknown[] }
      return !!(obj?.text?.trim() || obj?.syncText?.length)
    })
    const sidecar = existsSync(file.replace(/\.[^.]+$/, '.lrc'))
    const artist = c.artists?.length ? c.artists.join(' / ') : c.artist || guess.artist || '未知艺人'
    return {
      id: trackId(file),
      path: file,
      title: c.title?.trim() || guess.title,
      artist,
      album: c.album?.trim() || '未知专辑',
      albumArtist: c.albumartist?.trim() || c.artist || artist,
      duration: f.duration ?? 0,
      year: c.year,
      trackNo: c.track?.no ?? undefined,
      discNo: c.disk?.no ?? undefined,
      genre: c.genre?.[0],
      cover,
      hasLyrics: lyrics || sidecar,
      format: (f.container || path.extname(file).slice(1)).toUpperCase(),
      bitrate: f.bitrate,
      sampleRate: f.sampleRate,
      bitsPerSample: f.bitsPerSample,
      lossless: f.lossless,
      size: stat.size,
      mtime: stat.mtimeMs,
      addedAt: prev?.addedAt ?? Date.now()
    }
  } catch (e) {
    console.warn('[library] failed to parse', file, e)
    return null
  }
}

function emitProgress(win: BrowserWindow | null, p: ScanProgress) {
  win?.webContents.send('library:progress', p)
}

async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let idx = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

/** Add files/folders to library. Folders are remembered for rescans. */
export async function addPaths(paths: string[], win: BrowserWindow | null, opts: { remember?: boolean } = {}) {
  const files: string[] = []
  emitProgress(win, { phase: 'collect', current: 0, total: 0 })
  for (const p of paths) {
    try {
      const st = await fs.stat(p)
      if (st.isDirectory()) {
        if (opts.remember !== false && !library.folders.some((f) => path.normalize(f) === path.normalize(p)))
          library.folders.push(p)
        await walk(p, files)
      } else if (AUDIO_EXTS.has(path.extname(p).toLowerCase())) files.push(p)
    } catch {
      /* skip */
    }
  }
  return scanFiles(files, win)
}

async function scanFiles(files: string[], win: BrowserWindow | null, force = false) {
  const unique = [...new Set(files)]
  let done = 0
  const total = unique.length
  const added: Track[] = []
  folderCoverCache.clear()
  await pool(unique, 6, async (file) => {
    const id = trackId(file)
    const prev = byId.get(id)
    let track: Track | null = prev ?? null
    if (!prev || force) {
      track = await parseTrack(file, prev)
    } else {
      try {
        const st = await fs.stat(file)
        if (st.mtimeMs !== prev.mtime || st.size !== prev.size) track = await parseTrack(file, prev)
      } catch {
        track = null
      }
    }
    if (track) {
      byId.set(track.id, track)
      added.push(track)
    }
    done++
    if (done % 5 === 0 || done === total) emitProgress(win, { phase: 'parse', current: done, total, file })
  })
  library.tracks = [...byId.values()]
  scheduleSave()
  emitProgress(win, { phase: 'done', current: total, total })
  return library
}

export async function rescan(win: BrowserWindow | null) {
  const files: string[] = []
  for (const f of library.folders) await walk(f, files)
  // keep individually-added tracks that still exist
  const set = new Set(files.map((f) => trackId(f)))
  for (const t of library.tracks) {
    if (!set.has(t.id) && existsSync(t.path)) files.push(t.path)
  }
  const present = new Set(files.map((f) => trackId(f)))
  for (const id of [...byId.keys()]) if (!present.has(id)) byId.delete(id)
  return scanFiles(files, win)
}

export function removeFolder(folder: string) {
  const norm = path.normalize(folder).toLowerCase()
  library.folders = library.folders.filter((f) => path.normalize(f).toLowerCase() !== norm)
  for (const [id, t] of byId) {
    if (path.normalize(t.path).toLowerCase().startsWith(norm + path.sep) || path.normalize(t.path).toLowerCase().startsWith(norm)) byId.delete(id)
  }
  library.tracks = [...byId.values()]
  scheduleSave()
  return library
}

export function removeTracks(ids: string[]) {
  for (const id of ids) byId.delete(id)
  library.tracks = [...byId.values()]
  scheduleSave()
  return library
}

export async function refreshTrack(id: string) {
  const prev = byId.get(id)
  if (!prev) return null
  const t = await parseTrack(prev.path, prev)
  if (t) {
    byId.set(id, t)
    library.tracks = [...byId.values()]
    scheduleSave()
  }
  return t
}
