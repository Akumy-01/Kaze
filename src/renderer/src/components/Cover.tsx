import { memo, useState, useEffect, type CSSProperties } from 'react'
import { Music } from 'lucide-react'

interface Props {
  cover?: string
  className?: string
  style?: CSSProperties
  iconSize?: number
  onClick?: () => void
}

export const Cover = memo(function Cover({ cover, className = '', style, iconSize = 22, onClick }: Props) {
  const src = cover ? `akumy://cover/${cover}` : undefined
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState(false)
  useEffect(() => {
    setLoaded(false)
    setErr(false)
  }, [src])
  return (
    <div className={`cover ${className}`} style={style} onClick={onClick}>
      {(!src || err || !loaded) && (
        <div className="cover-ph">
          <Music size={iconSize} strokeWidth={1.6} />
        </div>
      )}
      {src && !err && (
        <img
          src={src}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={loaded ? 'loaded' : ''}
          onLoad={() => setLoaded(true)}
          onError={() => setErr(true)}
          alt=""
        />
      )}
    </div>
  )
})
