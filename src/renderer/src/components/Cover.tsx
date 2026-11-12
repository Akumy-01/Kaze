import { memo, useState, useEffect, useRef, type CSSProperties } from 'react'
import logoUrl from '../assets/logo.png'

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

interface Props {
  cover?: string
  className?: string
  style?: CSSProperties
  iconSize?: number
  onClick?: () => void
}

export const Cover = memo(function Cover({ cover, className = '', style, onClick }: Props) {
  const baseSrc = cover ? `akumy://cover/${encodeURIComponent(cover)}` : undefined
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const src = baseSrc ? (retry > 0 ? `${baseSrc}?r=${retry}` : baseSrc) : undefined

  useEffect(() => {
    setRetry(0)
    setErr(false)
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth > 0) {
      setLoaded(true)
    } else {
      setLoaded(false)
    }
  }, [baseSrc])

  const showFallbackLogo = !src || err

  return (
    <div className={`cover ${className}`} style={style} onClick={onClick}>
      {(!loaded || showFallbackLogo) && (
        <div className="cover-ph">
          <img src={logoUrl} alt="Akumy Music" className="cover-logo-fallback" draggable={false} />
        </div>
      )}
      {src && !err && (
        <img
          ref={(el) => {
            imgRef.current = el
            if (el && el.complete && el.naturalWidth > 0 && !loaded) setLoaded(true)
          }}
          src={src}
          decoding="async"
          draggable={false}
          className={loaded ? 'loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (retry < 1) setRetry((r) => r + 1)
            else setErr(true)
          }}
          alt=""
        />
      )}
    </div>
  )
})
