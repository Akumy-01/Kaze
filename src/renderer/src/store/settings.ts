import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DesktopLyricsAnimation } from '../../../shared/types'

export type ThemeMode = 'light' | 'dark' | 'system'
export type BgType = 'default' | 'accent' | 'image' | 'cover'
export type NpMode = 'vinyl' | 'lyric' | 'aurora'
export type SaveMode = 'off' | 'sidecar' | 'embed' | 'both'
export type AudioPreset = 'daily' | 'direct' | 'custom'
export type ReplayGainMode = 'off' | 'auto' | 'track' | 'album'
export type PeqFilterType = 'lowshelf' | 'peaking' | 'highshelf'

export interface PeqBand {
  type: PeqFilterType
  freq: number
  gain: number
  q: number
  enabled: boolean
}

export interface PeqProfile {
  enabled: boolean
  preampDb: number
  autoHeadroom: boolean
  presetName: string
  bands: PeqBand[]
}

export const DEFAULT_PEQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const

export function createDefaultBands(gains: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], qs?: number[]): PeqBand[] {
  return DEFAULT_PEQ_FREQS.map((freq, idx) => ({
    type: idx === 0 ? 'lowshelf' : idx === DEFAULT_PEQ_FREQS.length - 1 ? 'highshelf' : 'peaking',
    freq,
    gain: gains[idx] ?? 0,
    q: qs?.[idx] ?? (idx === 0 || idx === DEFAULT_PEQ_FREQS.length - 1 ? 0.71 : 1.41),
    enabled: true
  }))
}

export const PEQ_PRESETS: { id: string; name: string; desc: string; preampDb: number; bands: PeqBand[] }[] = [
  {
    id: 'flat',
    name: '平坦 (Flat)',
    desc: '0 dB 无染色基准曲线',
    preampDb: 0,
    bands: createDefaultBands([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  },
  {
    id: 'harman',
    name: '哈曼目标微调 (Harman Inspired)',
    desc: '增强极低频下潜与 3kHz 耳廓谐振清晰度，适合监听/平直耳机日常听感补偿',
    preampDb: -3.5,
    bands: createDefaultBands([3.2, 2.6, 0.5, -0.8, -0.4, 0.6, 2.2, 2.8, 1.0, 1.5], [0.71, 1.1, 1.41, 1.41, 1.41, 1.41, 1.2, 1.3, 1.41, 0.71])
  },
  {
    id: 'vocal',
    name: '清澈人声 (Vocal Clear)',
    desc: '收敛 125–250Hz 驻波浑浊感，柔和凸显人声中频密度与换气细节',
    preampDb: -2.8,
    bands: createDefaultBands([-1.0, -0.8, -1.5, -1.2, 0.8, 2.2, 2.6, 1.8, 0.8, 0.5])
  },
  {
    id: 'bass',
    name: '低频饱满 (Warm Bass)',
    desc: '适度提升低架与中低频弹性，自动预留前级余量防止低频削波失真',
    preampDb: -4.5,
    bands: createDefaultBands([4.2, 3.6, 2.0, 0.5, -0.4, 0, 0.5, 0.8, 1.0, 0.8])
  },
  {
    id: 'acoustic',
    name: '古典与原声 (Classical / Acoustic)',
    desc: '开阔自然的器乐泛音与高频空气感，保留大动态舞台层次',
    preampDb: -2.5,
    bands: createDefaultBands([1.5, 1.2, 0.4, -0.4, 0, 0.5, 1.2, 1.8, 2.2, 2.4])
  },
  {
    id: 'warm',
    name: '柔和耐听 (Smooth & Warm)',
    desc: '抑制 4kHz–8kHz 齿音与高频毛刺，适合亮声耳机长时间聆听',
    preampDb: -2.0,
    bands: createDefaultBands([1.6, 1.8, 1.2, 0.6, 0.2, -0.4, -1.2, -2.4, -1.8, -0.8])
  }
]

export function createDefaultPeqProfile(): PeqProfile {
  return {
    enabled: false,
    preampDb: 0,
    autoHeadroom: true,
    presetName: 'flat',
    bands: createDefaultBands()
  }
}

export const ACCENTS = [
  { name: '回响红', value: '#fa2d48' },
  { name: '粉红', value: '#ff375f' },
  { name: '橙色', value: '#ff9f0a' },
  { name: '流金黄', value: '#ffcc00' },
  { name: '绿色', value: '#30d158' },
  { name: '薄荷', value: '#00c7be' },
  { name: '天蓝', value: '#64d2ff' },
  { name: '深海蓝', value: '#0a84ff' },
  { name: '靛蓝', value: '#5e5ce6' },
  { name: '紫色', value: '#bf5af2' },
  { name: '石墨', value: '#8e8e93' }
]

export interface SettingsState {
  themeMode: ThemeMode
  accent: string
  bgType: BgType
  wallpaper: string | null
  blur: number
  dim: number
  windowControls: 'mac' | 'windows'
  sidebarCollapsed: boolean
  npMode: NpMode
  npShowLyrics: boolean
  npBgBlur: number
  vinylViz: 'bars' | 'wave' | 'particles'
  showRoma: boolean
  showTrans: boolean
  lyricScale: number
  lyricAlign: 'left' | 'center'
  autoOnlineLyrics: boolean
  autoSaveLyrics: SaveMode
  saveRoma: boolean
  saveTrans: boolean
  fadeOnPause: boolean
  reduceMotion: boolean
  minimizeToTray: boolean
  desktopLyricsLocked: boolean
  desktopLyricsFontSize: number
  desktopLyricsColor: string
  desktopLyricsOpacity: number
  desktopLyricsActiveZoom: boolean
  desktopLyricsAnimation: DesktopLyricsAnimation
  desktopLyricsRows: 1 | 2 | 3
  desktopLyricsWide: boolean
  desktopLyricsDirection: 'horizontal' | 'vertical'
  desktopLyricsAlwaysOnTop: boolean
  desktopLyricsHoverHide: boolean
  desktopLyricsPauseHide: boolean
  desktopLyricsBold: boolean
  // Audio Pipeline & DSP Settings
  audioPreset: AudioPreset
  outputDeviceId: string
  outputDeviceLabel: string
  gapless: boolean
  crossfadeSec: number
  replayGainMode: ReplayGainMode
  replayGainPreampDb: number
  replayGainAntiClip: boolean
  peqByDevice: Record<string, PeqProfile>
  set: (patch: Partial<Omit<SettingsState, 'set' | 'getPeqProfile' | 'setPeqProfile' | 'applyAudioPreset'>>) => void
  getPeqProfile: (deviceId?: string) => PeqProfile
  setPeqProfile: (patch: Partial<PeqProfile>, deviceId?: string) => void
  applyAudioPreset: (preset: AudioPreset) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      themeMode: 'system',
      accent: '#fa2d48',
      bgType: 'default',
      wallpaper: null,
      blur: 24,
      dim: 35,
      windowControls: 'mac',
      sidebarCollapsed: false,
      npMode: 'lyric',
      npShowLyrics: true,
      npBgBlur: 42,
      vinylViz: 'bars',
      showRoma: true,
      showTrans: true,
      lyricScale: 1,
      lyricAlign: 'left',
      autoOnlineLyrics: true,
      autoSaveLyrics: 'off',
      saveRoma: true,
      saveTrans: true,
      fadeOnPause: true,
      reduceMotion: false,
      minimizeToTray: true,
      desktopLyricsLocked: false,
      desktopLyricsFontSize: 24,
      desktopLyricsColor: '#07c556',
      desktopLyricsOpacity: 95,
      desktopLyricsActiveZoom: true,
      desktopLyricsAnimation: 'karaoke',
      desktopLyricsRows: 2,
      desktopLyricsWide: false,
      desktopLyricsDirection: 'horizontal',
      desktopLyricsAlwaysOnTop: true,
      desktopLyricsHoverHide: false,
      desktopLyricsPauseHide: false,
      desktopLyricsBold: false,
      // Audio Pipeline Defaults ("日常" preset)
      audioPreset: 'daily',
      outputDeviceId: 'default',
      outputDeviceLabel: '跟随系统默认设备',
      gapless: true,
      crossfadeSec: 0,
      replayGainMode: 'auto',
      replayGainPreampDb: 0,
      replayGainAntiClip: true,
      peqByDevice: {
        default: createDefaultPeqProfile()
      },
      set: (patch) => set(patch),
      getPeqProfile: (deviceId) => {
        const st = get()
        const key = deviceId ?? st.outputDeviceId ?? 'default'
        return st.peqByDevice[key] ?? st.peqByDevice['default'] ?? createDefaultPeqProfile()
      },
      setPeqProfile: (patch, deviceId) => {
        const st = get()
        const key = deviceId ?? st.outputDeviceId ?? 'default'
        const cur = st.peqByDevice[key] ?? createDefaultPeqProfile()
        const next: PeqProfile = {
          ...cur,
          ...patch,
          bands: patch.bands ? patch.bands.map((b) => ({ ...b })) : cur.bands.map((b) => ({ ...b }))
        }
        set({
          peqByDevice: {
            ...st.peqByDevice,
            [key]: next
          },
          audioPreset: st.audioPreset === 'direct' ? 'custom' : st.audioPreset
        })
      },
      applyAudioPreset: (preset) => {
        if (preset === 'daily') {
          set({
            audioPreset: 'daily',
            gapless: true,
            crossfadeSec: 0,
            replayGainMode: 'auto',
            replayGainPreampDb: 0,
            replayGainAntiClip: true,
            fadeOnPause: true
          })
        } else if (preset === 'direct') {
          set({
            audioPreset: 'direct',
            gapless: true,
            crossfadeSec: 0,
            fadeOnPause: false
          })
        } else {
          set({ audioPreset: 'custom' })
        }
      }
    }),
    {
      name: 'kaze-settings',
      version: 7,
      migrate: (persisted: any) => {
        if (persisted && persisted.npMode === 'apple') persisted.npMode = 'lyric'
        if (persisted && !persisted.peqByDevice) {
          persisted.peqByDevice = { default: createDefaultPeqProfile() }
        }
        if (persisted && typeof persisted.minimizeToTray !== 'boolean') persisted.minimizeToTray = true
        if (persisted && typeof persisted.desktopLyricsLocked !== 'boolean') persisted.desktopLyricsLocked = false
        if (persisted && typeof persisted.desktopLyricsFontSize !== 'number') persisted.desktopLyricsFontSize = 26
        if (persisted && typeof persisted.desktopLyricsColor !== 'string') persisted.desktopLyricsColor = '#07c556'
        if (persisted && typeof persisted.desktopLyricsOpacity !== 'number') persisted.desktopLyricsOpacity = 95
        if (persisted && typeof persisted.desktopLyricsActiveZoom !== 'boolean') persisted.desktopLyricsActiveZoom = true
        if (persisted && typeof persisted.desktopLyricsAnimation !== 'string') persisted.desktopLyricsAnimation = 'karaoke'
        if (persisted && ![1, 2, 3].includes(persisted.desktopLyricsRows)) persisted.desktopLyricsRows = 2
        if (persisted && typeof persisted.desktopLyricsWide !== 'boolean') persisted.desktopLyricsWide = false
        if (persisted && persisted.desktopLyricsDirection !== 'vertical') persisted.desktopLyricsDirection = 'horizontal'
        if (persisted && typeof persisted.desktopLyricsAlwaysOnTop !== 'boolean') persisted.desktopLyricsAlwaysOnTop = true
        if (persisted && typeof persisted.desktopLyricsHoverHide !== 'boolean') persisted.desktopLyricsHoverHide = false
        if (persisted && typeof persisted.desktopLyricsPauseHide !== 'boolean') persisted.desktopLyricsPauseHide = false
        if (persisted && typeof persisted.desktopLyricsBold !== 'boolean') persisted.desktopLyricsBold = false
        if (persisted && !persisted.audioPreset) {
          persisted.audioPreset = 'daily'
          persisted.outputDeviceId = 'default'
          persisted.outputDeviceLabel = '跟随系统默认设备'
          persisted.gapless = true
          persisted.crossfadeSec = 0
          persisted.replayGainMode = 'auto'
          persisted.replayGainPreampDb = 0
          persisted.replayGainAntiClip = true
        }
        return persisted
      }
    }
  )
)
