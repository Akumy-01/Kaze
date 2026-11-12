import { promises as fs } from 'fs'
import {
  File,
  TagTypes,
  Id3v2Tag,
  Id3v2UnsynchronizedLyricsFrame,
  Id3v2FrameClassType,
  StringType
} from 'node-taglib-sharp'

/** Embed (unsynchronised, LRC formatted) lyrics into an audio file. */
export async function embedLyrics(file: string, lrc: string): Promise<void> {
  const lower = file.toLowerCase()
  const f = File.createFromPath(file)
  try {
    if (lower.endsWith('.mp3')) {
      const tag = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      // remove previous USLT frames and write a single fresh one
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
