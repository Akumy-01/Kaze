import './lib/migrateStorage'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/m-plus-rounded-1c/500.css'
import '@fontsource/m-plus-rounded-1c/700.css'
import '@fontsource/m-plus-rounded-1c/800.css'
import App from './App'
import { DesktopLyricsWindow, MiniPlayerWindow } from './components/FloatingWindows'
import './styles/global.css'

const hash = window.location.hash
if (hash === '#mini' || hash === '#desktop-lyrics') {
  document.documentElement.classList.add('floating-win')
  document.body.classList.add('floating-win')
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  hash === '#mini' ? <MiniPlayerWindow /> : hash === '#desktop-lyrics' ? <DesktopLyricsWindow /> : <App />
)
