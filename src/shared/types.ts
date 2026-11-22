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
  isrc?: string
  /** cover file name inside userData/covers */
  cover?: string
  hasLyrics: boolean
  format: string
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  lossless?: boolean
  replayGainTrackDb?: number
  replayGainTrackPeak?: number
  replayGainAlbumDb?: number
  replayGainAlbumPeak?: number
  size: number
  mtime: number
  addedAt: number
}

export interface ReplayGainUpdate {
  id: string
  replayGainTrackDb: number
  replayGainTrackPeak: number
  replayGainAlbumDb?: number
  replayGainAlbumPeak?: number
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

export type LyricSource = 'embedded' | 'sidecar' | 'netease' | 'qq' | 'lrclib' | 'lyricsplus' | 'lyricsovh' | (string & {})

export interface LyricCandidate {
  source: LyricSource
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  synced?: boolean
  score?: number
  /** pre-fetched payload for sources that return lyrics with search results */
  payload?: { lrc?: string; plain?: string; tlrc?: string; rlrc?: string }
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
  /** full online search candidate pool captured during auto-match */
  candidates?: LyricCandidate[]
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

export type OnlineLyricSource = 'all' | 'netease' | 'qq' | 'lrclib' | 'lyricsplus' | 'lyricsovh' | (string & {})

export interface TrackQuery {
  title: string
  artist: string
  album?: string
  duration?: number
  isrc?: string
  source?: OnlineLyricSource
}

/* ------------------------------------------------------------------ */
/* Pluggable Provider & Fallback Chain                                 */
/* ------------------------------------------------------------------ */

export type ProviderKind = 'lyrics' | 'metadata'

export interface ProviderConfig {
  id: string
  name: string
  kind: ProviderKind
  enabled: boolean
  priority: number
  builtin: boolean
  description: string
  timeoutMs?: number
}

export interface ProviderHealth {
  id: string
  status: 'ready' | 'cooldown' | 'disabled'
  failures: number
  lastError?: string
  cooldownUntil?: number
  avgLatencyMs?: number
}

export interface ProviderSnapshot extends ProviderConfig {
  health: ProviderHealth
}

export interface FallbackTraceEntry {
  providerId: string
  providerName: string
  status: 'hit' | 'miss' | 'error' | 'skipped-cooldown' | 'disabled'
  latencyMs: number
  count?: number
  message?: string
}

/* ------------------------------------------------------------------ */
/* High-Accuracy Metadata Matching & Tag Encapsulation                 */
/* ------------------------------------------------------------------ */

export interface MetadataMatchBreakdown {
  title: number
  artist: number
  album: number
  duration: number
  isrc: number
}

export interface MetadataCandidate {
  source: string
  sourceName: string
  id: string
  title: string
  artist: string
  album: string
  albumArtist?: string
  year?: number
  trackNo?: number
  discNo?: number
  genre?: string
  isrc?: string
  duration?: number
  coverUrl?: string
  releaseId?: string
  score: number
  confidence: 'high' | 'medium' | 'low'
  breakdown: MetadataMatchBreakdown
}

export interface MetadataSearchResult {
  candidates: MetadataCandidate[]
  trace: FallbackTraceEntry[]
}

export interface TagWriteRequest {
  trackId: string
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  year?: number
  trackNo?: number
  discNo?: number
  genre?: string
  isrc?: string
  coverUrl?: string
  coverPath?: string
  lrc?: string
}

export interface TitleLanguageVariant {
  lang: 'ja' | 'zh' | 'ko' | 'en' | 'romaji' | 'other'
  langLabel: string
  title: string
  artist?: string
  album?: string
  source: string
}

export interface TagWriteResult {
  ok: boolean
  track?: Track
  coverUpdated?: boolean
  error?: string
}

export type TrackCategory = 'zh' | 'ja' | 'en' | 'ko' | 'instrumental' | 'other'

export interface SpectralVerdictCache {
  losslessStatus: string
  hiResStatus: string
  cutoffKhz: number
  effectiveBits: number | null
  checkedAt: number
}

export type DesktopLyricsAnimation = 'fade' | 'slide' | 'scale' | 'karaoke' | 'none'

export interface FloatingLyricLine {
  time: number
  endTime?: number
  text: string
  trans?: string
  roma?: string
  words?: { start: number; end: number; text: string }[]
  interlude?: boolean
}

export interface FloatingPlayerState {
  currentId: string | null
  title: string
  artist: string
  album: string
  cover?: string
  playing: boolean
  currentTime: number
  duration: number
  syncedAtMs?: number
  lyricText: string
  lyricTrans: string
  lyricRoma: string
  nextLyricText?: string
  lyricProgress?: number
  lineStartTime?: number
  lineEndTime?: number
  lyricWords?: { start: number; end: number; text: string }[]
  lyricLineKey?: string
  lyricLines?: FloatingLyricLine[]
  activeLineIndex?: number
  desktopLyricsFontSize?: number
  desktopLyricsColor?: string
  desktopLyricsOpacity?: number
  desktopLyricsActiveZoom?: boolean
  desktopLyricsAnimation?: DesktopLyricsAnimation
  desktopLyricsLocked?: boolean
  desktopLyricsRows?: 1 | 2 | 3
  desktopLyricsWide?: boolean
  desktopLyricsDirection?: 'horizontal' | 'vertical'
  desktopLyricsAlwaysOnTop?: boolean
  desktopLyricsHoverHide?: boolean
  desktopLyricsPauseHide?: boolean
  desktopLyricsBold?: boolean
  desktopLyricsShowTrans?: boolean
  desktopLyricsShowRoma?: boolean
}
