export interface Palette {
  colors: [number, number, number][]
  /** css rgb strings */
  css: string[]
  dark: boolean
}

const cache = new Map<string, Promise<Palette>>()

export const DEFAULT_PALETTE: Palette = {
  colors: [
    [250, 45, 72],
    [120, 60, 200],
    [40, 90, 200],
    [30, 30, 40]
  ],
  css: ['rgb(250,45,72)', 'rgb(120,60,200)', 'rgb(40,90,200)', 'rgb(30,30,40)'],
  dark: true
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let s = 0
  if (max !== min) s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
  return { s, l }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export function extractPalette(url?: string): Promise<Palette> {
  if (!url) return Promise.resolve(DEFAULT_PALETTE)
  let p = cache.get(url)
  if (p) return p
  p = (async () => {
    try {
      const img = await loadImage(url)
      const size = 40
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0, size, size)
      const data = ctx.getImageData(0, 0, size, size).data
      const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
      let lum = 0
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        const e = buckets.get(key)
        if (e) {
          e.r += r
          e.g += g
          e.b += b
          e.n++
        } else buckets.set(key, { r, g, b, n: 1 })
      }
      const avgLum = lum / (data.length / 4)
      const list = [...buckets.values()].map((e) => {
        const r = e.r / e.n
        const g = e.g / e.n
        const b = e.b / e.n
        const { s, l } = rgbToHsl(r, g, b)
        const vivid = s * (1 - Math.abs(l - 0.5) * 1.6)
        return { rgb: [r, g, b] as [number, number, number], score: e.n * (0.35 + vivid * 1.6) }
      })
      list.sort((a, b) => b.score - a.score)
      const picked: [number, number, number][] = []
      for (const item of list) {
        if (picked.every((p) => Math.hypot(p[0] - item.rgb[0], p[1] - item.rgb[1], p[2] - item.rgb[2]) > 48))
          picked.push(item.rgb)
        if (picked.length >= 5) break
      }
      while (picked.length < 4) picked.push(picked[0] ?? [60, 60, 70])
      const colors = picked.map((c) => c.map((v) => Math.round(v)) as [number, number, number])
      return { colors, css: colors.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`), dark: avgLum < 140 }
    } catch {
      return DEFAULT_PALETTE
    }
  })()
  cache.set(url, p)
  return p
}

/** Render cover to a small data URL (for SMTC artwork). */
export async function coverDataUrl(url?: string, size = 256): Promise<string | undefined> {
  if (!url) return undefined
  try {
    const img = await loadImage(url)
    const c = document.createElement('canvas')
    c.width = c.height = size
    c.getContext('2d')!.drawImage(img, 0, 0, size, size)
    return c.toDataURL('image/jpeg', 0.85)
  } catch {
    return undefined
  }
}

/** Boost saturation/brightness of an rgb for glowing visuals */
export function vivid([r, g, b]: [number, number, number], minL = 0.55): [number, number, number] {
  const max = Math.max(r, g, b)
  const target = 255 * minL + 60
  if (max < target) {
    const k = target / Math.max(1, max)
    return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)]
  }
  return [r, g, b]
}
