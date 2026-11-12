import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'
export type BgType = 'default' | 'accent' | 'image' | 'cover'
export type NpMode = 'vinyl' | 'apple' | 'aurora'
export type SaveMode = 'off' | 'sidecar' | 'embed' | 'both'

export const ACCENTS = [
  { name: '音乐红', value: '#fa2d48' },
  { name: '粉红', value: '#ff375f' },
  { name: '橙色', value: '#ff9f0a' },
  { name: '黄色', value: '#ffcc00' },
  { name: '绿色', value: '#30d158' },
  { name: '薄荷', value: '#00c7be' },
  { name: '天蓝', value: '#64d2ff' },
  { name: '蓝色', value: '#0a84ff' },
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
  npMode: NpMode
  npShowLyrics: boolean
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
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      accent: '#fa2d48',
      bgType: 'default',
      wallpaper: null,
      blur: 24,
      dim: 35,
      windowControls: 'mac',
      npMode: 'apple',
      npShowLyrics: true,
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
      set: (patch) => set(patch)
    }),
    { name: 'akumy-settings', version: 1 }
  )
)
