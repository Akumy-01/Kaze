import { net } from 'electron'
import { promises as fs } from 'fs'
import {
  ByteVector,
  File,
  Id3v2FrameClassType,
  Id3v2Tag,
  Id3v2UnsynchronizedLyricsFrame,
  Picture,
  PictureType,
  StringType,
  TagTypes
} from 'node-taglib-sharp'
import type { TagWriteRequest } from '../shared/types'

/** Embed (unsynchronised, LRC formatted) lyrics into an audio file. */
export async function embedLyrics(file: string, lrc: string): Promise<void> {
  const lower = file.toLowerCase()
  const f = File.createFromPath(file)
  try {
    if (lower.endsWith('.mp3')) {
      const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      const frames = tag.getFramesByClassType<Id3v2UnsynchronizedLyricsFrame>(
        Id3v2FrameClassType.UnsynchronizedLyricsFrame
      )
      for (const fr of frames) tag.removeFrame(fr)
      const frame = Id3v2UnsynchronizedLyricsFrame.fromData('', 'XXX', StringType.UTF8)
      frame.text = lrc
      tag.addFrame(frame)
    } else {
      f.tag.lyrics = lrc
    }
    f.save()
  } finally {
    f.dispose()
  }
}

export async function writeSidecar(file: string, lrc: string): Promise<string> {
  const target = file.replace(/\.[^.]+$/, '.lrc')
  await fs.writeFile(target, '\ufeff' + lrc, 'utf8')
  return target
}

async function fetchCoverBytes(url: string): Promise<{ data: Uint8Array; mime: string } | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': 'Kaze/1.1 (https://github.com/Akumy-01/Kaze)' },
      signal: ctrl.signal
    })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength < 64) return null
    const headerMime = res.headers.get('content-type')?.split(';')[0]?.trim()
    let mime = headerMime && headerMime.startsWith('image/') ? headerMime : 'image/jpeg'
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mime = 'image/png'
    else if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg'
    else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) mime = 'image/webp'
    return { data: buf, mime }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function splitArtistsList(s: string): string[] {
  return s
    .split(/\s*(?:\/|;|,|&|、)\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function readLocalCoverBytes(filePath: string): Promise<{ data: Uint8Array; mime: string } | null> {
  try {
    const raw = await fs.readFile(filePath)
    if (raw.byteLength < 64) return null
    let mime = 'image/jpeg'
    if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) mime = 'image/png'
    else if (raw[0] === 0xff && raw[1] === 0xd8) mime = 'image/jpeg'
    else if (raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46) mime = 'image/webp'
    else if (raw[0] === 0x42 && raw[1] === 0x4d) mime = 'image/bmp'
    return { data: new Uint8Array(raw), mime }
  } catch {
    return null
  }
}

/**
 * Write normalized metadata tags, ISRC, front cover artwork, and optional lyrics into a local audio file.
 */
export async function writeTrackTags(
  file: string,
  req: Omit<TagWriteRequest, 'trackId'>
): Promise<{ coverUpdated: boolean }> {
  let coverPayload: { data: Uint8Array; mime: string } | null = null
  if (req.coverPath) {
    coverPayload = await readLocalCoverBytes(req.coverPath)
  } else if (req.coverUrl) {
    coverPayload = await fetchCoverBytes(req.coverUrl)
  }

  const lower = file.toLowerCase()
  const f = File.createFromPath(file)
  let coverUpdated = false
  try {
    if (req.title !== undefined && req.title.trim()) f.tag.title = req.title.trim()
    if (req.artist !== undefined && req.artist.trim()) {
      const list = splitArtistsList(req.artist)
      f.tag.performers = list.length ? list : [req.artist.trim()]
    }
    if (req.album !== undefined && req.album.trim()) f.tag.album = req.album.trim()
    if (req.albumArtist !== undefined && req.albumArtist.trim()) {
      const list = splitArtistsList(req.albumArtist)
      f.tag.albumArtists = list.length ? list : [req.albumArtist.trim()]
    }
    if (typeof req.year === 'number' && Number.isFinite(req.year) && req.year > 1900) {
      f.tag.year = Math.round(req.year)
    }
    if (typeof req.trackNo === 'number' && Number.isFinite(req.trackNo) && req.trackNo > 0) {
      f.tag.track = Math.round(req.trackNo)
    }
    if (typeof req.discNo === 'number' && Number.isFinite(req.discNo) && req.discNo > 0) {
      f.tag.disc = Math.round(req.discNo)
    }
    if (req.genre !== undefined && req.genre.trim()) {
      f.tag.genres = [req.genre.trim()]
    }
    if (req.isrc !== undefined && req.isrc.trim()) {
      f.tag.isrc = req.isrc.trim().toUpperCase()
    }
    if (coverPayload) {
      const bv = ByteVector.fromByteArray(coverPayload.data)
      const pic = Picture.fromFullData(bv, PictureType.FrontCover, coverPayload.mime, 'Front Cover')
      const others = (f.tag.pictures ?? []).filter((p) => p.type !== PictureType.FrontCover)
      f.tag.pictures = [pic, ...others]
      coverUpdated = true
    }
    if (req.lrc && req.lrc.trim()) {
      if (lower.endsWith('.mp3')) {
        const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
        const frames = tag.getFramesByClassType<Id3v2UnsynchronizedLyricsFrame>(
          Id3v2FrameClassType.UnsynchronizedLyricsFrame
        )
        for (const fr of frames) tag.removeFrame(fr)
        const frame = Id3v2UnsynchronizedLyricsFrame.fromData('', 'XXX', StringType.UTF8)
        frame.text = req.lrc
        tag.addFrame(frame)
      } else {
        f.tag.lyrics = req.lrc
      }
    }
    f.save()
  } finally {
    f.dispose()
  }
  return { coverUpdated }
}
