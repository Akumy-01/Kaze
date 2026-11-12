import type { Track } from '../../../shared/types'

export const mediaUrl = (p: string) => `akumy://media/?p=${encodeURIComponent(p)}`
export const coverUrl = (t?: Pick<Track, 'cover'> | null) => (t?.cover ? `akumy://cover/${t.cover}` : undefined)

export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

export function fmtSize(bytes: number) {
  if (bytes > 1 << 30) return (bytes / (1 << 30)).toFixed(2) + ' GB'
  return (bytes / (1 << 20)).toFixed(1) + ' MB'
}

export function qualityLabel(t: Track) {
  if (t.lossless) {
    if ((t.bitsPerSample ?? 16) > 16 || (t.sampleRate ?? 44100) > 48000) return 'Hi-Res 无损'
    return '无损'
  }
  if (t.bitrate) return `${Math.round(t.bitrate / 1000)} kbps`
  return t.format
}

export const splitArtists = (s: string) =>
  s
    .split(/\s*(?:\/|、|;|；|,|，|&|＆| feat\. | ft\. | x | × )\s*/i)
    .map((x) => x.trim())
    .filter(Boolean)

export function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}

export function shuffleArray<T>(arr: T[]) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export const collator = new Intl.Collator(['zh-CN', 'ja', 'en'], { numeric: true, sensitivity: 'base' })
