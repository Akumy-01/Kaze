import { memo, useState, useEffect, type CSSProperties } from 'react'
import logoUrl from '../assets/logo.png'
import { coverFileUrl } from '../lib/format'

export { logoUrl as DEFAULT_LOGO_URL }

/** Vector monochrome silhouette of the user's spiral logo */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" style={{ display: 'block', flexShrink: 0 }}>
      <path
        d="M186 41 C155 17 102 20 63 52 C23 85 17 139 36 181 C56 223 101 240 141 227 C181 214 203 178 202 140 C201 107 180 85 153 86 C130 87 111 107 105 128 C99 150 107 166 121 173 C133 179 147 174 155 163 C159 157 159 149 155 145 C150 142 146 144 142 150 C139 154 134 156 130 153 C125 148 129 135 136 129 C145 119 158 118 167 125 C181 136 179 158 168 175 C155 196 132 207 108 202 C78 197 58 172 56 143 C53 111 68 85 93 69 C118 54 148 54 171 67 C183 74 193 71 197 61 C200 53 195 47 186 41 Z"
        transform="translate(13.15221 -1.35355) scale(1.0090964)"
      />
    </svg>
  )
}

interface CoverGeometry {
  scale: number
  offsetX: number
  offsetY: number
}

const DEFAULT_GEO: CoverGeometry = {
  scale: 1,
  offsetX: 0,
  offsetY: 0
}

const geoCache = new Map<string, CoverGeometry>()
const loadedUrlCache = new Set<string>()
const dataUrlFallbackCache = new Map<string, string>()

/**
 * Inspect a loaded cover image on a 100x100 offscreen canvas (matching `object-fit: cover` center square)
 * to detect white / near-white letterbox or pillarbox bars baked into the image edges, and compute
 * the exact zoom scale + center offset so the album cover fills the card completely without white borders.
 */
function analyzeCoverGeometry(img: HTMLImageElement, cacheKey: string): CoverGeometry {
  const cached = geoCache.get(cacheKey)
  if (cached) return cached

  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return DEFAULT_GEO

  try {
    const S = 100
    const cvs = document.createElement('canvas')
    cvs.width = S
    cvs.height = S
    const ctx = cvs.getContext('2d', { willReadFrequently: true })
    if (!ctx) return DEFAULT_GEO

    // Draw the center-cropped square (matching CSS `object-fit: cover` on a 1:1 card)
    const side = Math.min(nw, nh)
    const sx = (nw - side) / 2
    const sy = (nh - side) / 2
    ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S)
    const data = ctx.getImageData(0, 0, S, S).data

    const isRowWhiteBorder = (y: number) => {
      let whiteCount = 0
      let minLuma = 255
      let maxLuma = 0
      const xStart = 5
      const xEnd = 95
      const total = xEnd - xStart
      for (let x = xStart; x < xEnd; x++) {
        const i = (y * S + x) * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        if (a < 20) {
          whiteCount++
          continue
        }
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        if (luma < minLuma) minLuma = luma
        if (luma > maxLuma) maxLuma = luma
        if (r >= 236 && g >= 236 && b >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 18) {
          whiteCount++
        }
      }
      return whiteCount / total >= 0.88 && maxLuma - minLuma <= 24
    }

    const isColWhiteBorder = (x: number) => {
      let whiteCount = 0
      let minLuma = 255
      let maxLuma = 0
      const yStart = 5
      const yEnd = 95
      const total = yEnd - yStart
      for (let y = yStart; y < yEnd; y++) {
        const i = (y * S + x) * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        if (a < 20) {
          whiteCount++
          continue
        }
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        if (luma < minLuma) minLuma = luma
        if (luma > maxLuma) maxLuma = luma
        if (r >= 236 && g >= 236 && b >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 18) {
          whiteCount++
        }
      }
      return whiteCount / total >= 0.88 && maxLuma - minLuma <= 24
    }

    const maxScan = 26 // up to 26% per edge
    let topPad = 0
    while (topPad < maxScan && isRowWhiteBorder(topPad)) topPad++
    let botPad = 0
    while (botPad < maxScan && isRowWhiteBorder(S - 1 - botPad)) botPad++

    let leftPad = 0
    while (leftPad < maxScan && isColWhiteBorder(leftPad)) leftPad++
    let rightPad = 0
    while (rightPad < maxScan && isColWhiteBorder(S - 1 - rightPad)) rightPad++

    // Distinguish letterbox/pillarbox bars (or thin white frames) from covers whose entire 4-sided background is white
    const isFourSidedWhiteBg = topPad >= 8 && botPad >= 6 && leftPad >= 10 && rightPad >= 10
    if (!isFourSidedWhiteBg) {
      const hasVBar = (topPad >= 1 && botPad >= 1 && topPad + botPad >= 3) || topPad >= 3 || botPad >= 3
      const hasHBar = (leftPad >= 1 && rightPad >= 1 && leftPad + rightPad >= 3) || leftPad >= 3 || rightPad >= 3

      if (hasVBar || hasHBar) {
        // Add 2% bleed margin on each padded edge to push anti-aliased transition rows completely outside the card
        const t = hasVBar && topPad > 0 ? (topPad + 2.2) / S : 0
        const b = hasVBar && botPad > 0 ? (botPad + 2.2) / S : 0
        const l = hasHBar && leftPad > 0 ? (leftPad + 2.2) / S : 0
        const r = hasHBar && rightPad > 0 ? (rightPad + 2.2) / S : 0

        const scaleV = 1 / Math.max(0.55, 1 - t - b)
        const scaleH = 1 / Math.max(0.55, 1 - l - r)
        const neededScale = Math.min(1.65, Math.max(scaleV, scaleH))

        // With `transform: translate3d(offsetX%, offsetY%, 0) scale(neededScale)` and `transform-origin: 50% 50%`,
        // `offsetY = ((b - t) / 2) * neededScale * 100` centers the cropped content region inside the card.
        const offsetY = ((b - t) / 2) * neededScale * 100
        const offsetX = ((r - l) / 2) * neededScale * 100

        const res: CoverGeometry = {
          scale: Math.round(neededScale * 1000) / 1000,
          offsetX: Math.round(offsetX * 100) / 100,
          offsetY: Math.round(offsetY * 100) / 100
        }
        geoCache.set(cacheKey, res)
        return res
      }
    }
  } catch {
    /* ignore canvas errors */
  }

  geoCache.set(cacheKey, DEFAULT_GEO)
  return DEFAULT_GEO
}

interface Props {
  cover?: string
  className?: string
  style?: CSSProperties
  iconSize?: number
  onClick?: () => void
  dataCoverRole?: string
  eager?: boolean
}

export const Cover = memo(function Cover({ cover, className = '', style, onClick, dataCoverRole, eager = false }: Props) {
  const baseSrc = coverFileUrl(cover)
  const [phase, setPhase] = useState<'cors' | 'nocors' | 'ipc'>('cors')
  const [ipcDataUrl, setIpcDataUrl] = useState<string | null>(() => (cover ? dataUrlFallbackCache.get(cover) ?? null : null))
  const [retry, setRetry] = useState(0)
  const [err, setErr] = useState(false)
  const [geo, setGeo] = useState<CoverGeometry>(() => (baseSrc && geoCache.get(baseSrc)) || DEFAULT_GEO)

  useEffect(() => {
    setPhase('cors')
    setIpcDataUrl(cover ? dataUrlFallbackCache.get(cover) ?? null : null)
    setRetry(0)
    setErr(false)
    setGeo((baseSrc && geoCache.get(baseSrc)) || DEFAULT_GEO)
  }, [cover, baseSrc])

  useEffect(() => {
    if (phase !== 'ipc' || !cover || ipcDataUrl) return
    let alive = true
    void window.kaze.metadata.readCoverDataUrl(cover).then((data) => {
      if (!alive) return
      if (data) {
        dataUrlFallbackCache.set(cover, data)
        setIpcDataUrl(data)
      } else {
        setErr(true)
      }
    })
    return () => {
      alive = false
    }
  }, [phase, cover, ipcDataUrl])

  const httpSrc = baseSrc
    ? retry > 0
      ? `${baseSrc}${baseSrc.includes('?') ? '&' : '?'}r=${retry}`
      : baseSrc
    : undefined
  const targetSrc = ipcDataUrl || (phase === 'ipc' ? undefined : httpSrc)
  const showFallbackLogo = (!targetSrc && phase !== 'ipc') || err

  const fgTransform =
    geo.scale !== 1 || geo.offsetX !== 0 || geo.offsetY !== 0
      ? `translate3d(${geo.offsetX}%, ${geo.offsetY}%, 0) scale(${geo.scale})`
      : undefined

  return (
    <div
      className={`cover ${className}`}
      style={style}
      onClick={onClick}
      data-cover-role={dataCoverRole}
    >
      <div className="cover-ph">
        <img src={logoUrl} alt="Kaze" className="cover-logo-fallback" draggable={false} />
      </div>

      {!showFallbackLogo && targetSrc && (
        <img
          key={`${targetSrc}-${phase}`}
          src={targetSrc}
          crossOrigin={phase === 'cors' && !ipcDataUrl ? 'anonymous' : undefined}
          decoding={eager ? 'sync' : 'async'}
          loading="eager"
          draggable={false}
          className="cover-fg loaded"
          style={{
            objectFit: 'cover',
            transform: fgTransform
          }}
          onLoad={(e) => {
            loadedUrlCache.add(targetSrc)
            if (phase === 'cors' || ipcDataUrl) {
              setGeo(analyzeCoverGeometry(e.currentTarget, baseSrc ?? targetSrc))
            }
          }}
          onError={() => {
            if (phase === 'cors') {
              // Retry immediately without CORS in case Chromium cached a non-CORS response
              setPhase('nocors')
              setRetry((r) => r + 1)
            } else if (phase === 'nocors') {
              // Last-resort deterministic local IPC read directly from disk
              setPhase('ipc')
            } else {
              setErr(true)
            }
          }}
          alt=""
        />
      )}
    </div>
  )
})
