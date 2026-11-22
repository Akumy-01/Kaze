import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSettings } from '../store/settings'
import { usePlayer } from '../store/player'
import { useLibrary } from '../store/library'
import { DEFAULT_LOGO_URL } from './Cover'
import { coverFileUrl } from '../lib/format'

export function Background() {
  const { bgType, wallpaper, blur, dim, accent } = useSettings()
  const currentId = usePlayer((s) => s.currentId)
  const cover = useLibrary((s) => (currentId ? s.byId.get(currentId)?.cover : undefined))

  let img: string | undefined
  if (bgType === 'image' && wallpaper) img = wallpaper
  if (bgType === 'cover') img = coverFileUrl(cover) ?? DEFAULT_LOGO_URL
  const effBlur = bgType === 'cover' ? Math.max(blur, 40) : blur

  return (
    <div className="app-bg">
      {bgType === 'accent' && (
        <div
          className="bg-accent"
          style={{
            background: `radial-gradient(60% 50% at 15% 10%, ${accent}55, transparent 70%),
             radial-gradient(50% 50% at 90% 20%, ${accent}33, transparent 70%),
             radial-gradient(70% 60% at 60% 100%, ${accent}40, transparent 70%)`
          }}
        />
      )}
      <AnimatePresence>
        {img && (
          <motion.img
            key={img}
            src={img}
            crossOrigin={bgType === 'cover' ? 'anonymous' : undefined}
            alt=""
            draggable={false}
            className="bg-img"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            style={{
              width: 'calc(100% + 120px)',
              height: 'calc(100% + 120px)',
              objectFit: 'cover',
              filter: `blur(${effBlur}px) saturate(${bgType === 'cover' ? 1.5 : 1.1})`
            }}
          />
        )}
      </AnimatePresence>
      {img && <div className="bg-dim" style={{ background: `rgba(var(--dim-color), ${dim / 100})` }} />}
    </div>
  )
}

/** apply theme attributes to <html> */
export function useThemeEffect() {
  const { themeMode, accent, reduceMotion, bgType, wallpaper } = useSettings()
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = () => setSystemDark(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  const theme = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.setProperty('--accent', accent)
    const h = accent.replace('#', '')
    const n = parseInt(h, 16)
    root.style.setProperty('--accent-rgb', `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`)
    root.classList.toggle('reduce-motion', reduceMotion)
  }, [theme, accent, reduceMotion])
  return { theme, hasWallpaper: (bgType === 'image' && !!wallpaper) || bgType === 'cover' }
}
