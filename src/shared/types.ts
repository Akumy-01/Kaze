export interface Track {
  id: string
  path: string
  title: string
  artist: string
  album: string
  albumArtist: string
  duration: number
  year?: number
  trackNo?: number
  discNo?: number
  genre?: string
  /** cover file name inside userData/covers */
  cover?: string
  hasLyrics: boolean
  format: string
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  lossless?: boolean
  size: number
  mtime: number
  addedAt: number
}

export interface LibraryData {
  tracks: Track[]
  folders: string[]
}

export interface ScanProgress {
  phase: 'collect' | 'parse' | 'done'
  current: number
  total: number
  file?: string
}

export type LyricSource = 'embedded' | 'sidecar' | 'netease' | 'lrclib' | 'kugou'

export interface LyricCandidate {
  source: 'netease' | 'lrclib' | 'kugou'
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  synced?: boolean
  score?: number
  /** pre-fetched payload for sources that return lyrics with search results */
  payload?: { lrc?: string; plain?: string }
}

export interface LyricPayload {
  source: LyricSource
  /** main lyric (LRC or plain text) */
  lrc: string
  /** translation LRC */
  tlrc?: string
  /** romaji LRC supplied by the provider */
  rlrc?: string
  candidate?: LyricCandidate
}

export interface SaveLyricsRequest {
  trackId: string
  lrc: string
  mode: 'embed' | 'sidecar' | 'both'
}

export interface SaveLyricsResult {
  ok: boolean
  embedded?: boolean
  sidecar?: string
  error?: string
}

export type OnlineLyricSource = 'all' | 'netease' | 'lrclib' | 'kugou'

export interface TrackQuery {
  title: string
  artist: string
  album?: string
  duration?: number
  source?: OnlineLyricSource
}
