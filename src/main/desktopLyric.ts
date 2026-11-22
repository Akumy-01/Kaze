import { BrowserWindow, screen } from 'electron'
import path from 'path'

export interface LyricBounds {
  x?: number
  y?: number
  width: number
  height: number
}

interface DesktopLyricDeps {
  loadRoute: (win: BrowserWindow, hash: string) => void
  onSaveState: () => void
  getInitialFloatingState: () => Record<string, unknown> | null
}

let deps: DesktopLyricDeps | null = null
let lyricsWin: BrowserWindow | null = null
let lockedPref = false
let alwaysOnTopPref = true
let ignoreMouseState = false
let unlockPillHovered = false
let mouseCheckTimer: NodeJS.Timeout | null = null
let alwaysOnTopTimer: NodeJS.Timeout | null = null
let isProgrammaticMove = false
let customSized = false

const MIN_W = 380
const MIN_H = 92
const MAX_W = 1440
const MAX_H = 560

let boundsState: { x: number | null; y: number | null; width: number; height: number } = {
  x: null,
  y: null,
  width: 780,
  height: 156
}

export function clampDesktopLyricPos(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const disp = screen.getDisplayMatching({ x: Math.round(x), y: Math.round(y), width, height })
  const wa = disp.workArea
  return {
    x: Math.max(wa.x - width + 80, Math.min(wa.x + wa.width - 80, Math.round(x))),
    y: Math.max(wa.y, Math.min(wa.y + wa.height - 40, Math.round(y)))
  }
}

export function initDesktopLyric(d: DesktopLyricDeps) {
  deps = d
}

export function getDesktopLyricWindow(): BrowserWindow | null {
  return lyricsWin && !lyricsWin.isDestroyed() ? lyricsWin : null
}

export function getDesktopLyricPersistedBounds(): {
  pos?: { x: number; y: number }
  size?: { width: number; height: number }
} {
  return {
    pos: boundsState.x !== null && boundsState.y !== null ? { x: boundsState.x, y: boundsState.y } : undefined,
    size: customSized ? { width: boundsState.width, height: boundsState.height } : undefined
  }
}

export function restoreDesktopLyricPersistedBounds(pos?: { x: number; y: number }, size?: { width: number; height: number }) {
  if (pos) {
    boundsState.x = pos.x
    boundsState.y = pos.y
  }
  if (size && size.width >= MIN_W && size.height >= MIN_H) {
    boundsState.width = Math.min(MAX_W, Math.round(size.width))
    boundsState.height = Math.min(MAX_H, Math.round(size.height))
    customSized = true
  }
}

export function sendToDesktopLyric(channel: string, payload: unknown) {
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    lyricsWin.webContents.send(channel, payload)
  }
}

function stopAlwaysOnTopTools() {
  if (alwaysOnTopTimer) {
    clearInterval(alwaysOnTopTimer)
    alwaysOnTopTimer = null
  }
}

/** Periodically re-assert screen-saver z-order so fullscreen/taskbar focus never buries lyrics. */
function startAlwaysOnTopTools() {
  stopAlwaysOnTopTools()
  if (!alwaysOnTopPref || !lyricsWin || lyricsWin.isDestroyed()) return
  lyricsWin.setAlwaysOnTop(true, 'screen-saver')
  alwaysOnTopTimer = setInterval(() => {
    if (!alwaysOnTopPref || !lyricsWin || lyricsWin.isDestroyed()) {
      stopAlwaysOnTopTools()
      return
    }
    if (!lyricsWin.isAlwaysOnTop()) {
      lyricsWin.setAlwaysOnTop(true, 'screen-saver')
    } else if (process.platform === 'win32') {
      lyricsWin.moveTop()
    }
  }, 1500)
}

export function setDesktopLyricAlwaysOnTop(enabled: boolean) {
  alwaysOnTopPref = !!enabled
  if (!lyricsWin || lyricsWin.isDestroyed()) return
  if (alwaysOnTopPref) {
    lyricsWin.setAlwaysOnTop(true, 'screen-saver')
    startAlwaysOnTopTools()
  } else {
    stopAlwaysOnTopTools()
    lyricsWin.setAlwaysOnTop(false)
  }
}

function applyIgnoreMouse(ignore: boolean) {
  if (!lyricsWin || lyricsWin.isDestroyed()) return
  if (ignoreMouseState === ignore) return
  ignoreMouseState = ignore
  lyricsWin.setIgnoreMouseEvents(ignore, { forward: true })
}

export function stopDesktopLyricMouseCheck() {
  if (mouseCheckTimer) {
    clearInterval(mouseCheckTimer)
    mouseCheckTimer = null
  }
  ignoreMouseState = false
  unlockPillHovered = false
}

/** Click-through when locked, temporarily un-ignoring ONLY over the top Unlock icon pill. */
function startDesktopLyricMouseCheck() {
  stopDesktopLyricMouseCheck()
  if (!lockedPref || !lyricsWin || lyricsWin.isDestroyed()) return
  applyIgnoreMouse(true)
  mouseCheckTimer = setInterval(() => {
    if (!lockedPref || !lyricsWin || lyricsWin.isDestroyed()) {
      stopDesktopLyricMouseCheck()
      return
    }
    const b = lyricsWin.getBounds()
    const pt = screen.getCursorScreenPoint()
    const pillW = 84
    const pillLeft = b.x + Math.round((b.width - pillW) / 2)
    const inUnlockPill =
      pt.x >= pillLeft - 6 && pt.x <= pillLeft + pillW + 6 && pt.y >= b.y && pt.y <= b.y + 34
    if (inUnlockPill !== unlockPillHovered) {
      unlockPillHovered = inUnlockPill
      applyIgnoreMouse(!inUnlockPill)
      lyricsWin.webContents.send('desktopLyrics:unlockHover', inUnlockPill)
    }
  }, 100)
}

export function setDesktopLyricLocked(locked: boolean) {
  lockedPref = !!locked
  if (lockedPref) {
    startDesktopLyricMouseCheck()
  } else {
    stopDesktopLyricMouseCheck()
    if (lyricsWin && !lyricsWin.isDestroyed()) {
      lyricsWin.setIgnoreMouseEvents(false)
      lyricsWin.webContents.send('desktopLyrics:unlockHover', false)
    }
  }
}

export function toggleDesktopLyricWindow(forceOpen?: boolean): boolean {
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    if (forceOpen === true) {
      lyricsWin.showInactive()
      return true
    }
    stopDesktopLyricMouseCheck()
    stopAlwaysOnTopTools()
    lyricsWin.close()
    lyricsWin = null
    return false
  }
  if (forceOpen === false) return false

  const wa = screen.getPrimaryDisplay().workArea
  const width = boundsState.width
  const height = boundsState.height
  const startPos =
    boundsState.x !== null && boundsState.y !== null
      ? clampDesktopLyricPos(boundsState.x, boundsState.y, width, height)
      : { x: Math.round(wa.x + (wa.width - width) / 2), y: wa.y + wa.height - (height + 24) }

  boundsState.x = startPos.x
  boundsState.y = startPos.y

  lyricsWin = new BrowserWindow({
    width,
    height,
    minWidth: MIN_W,
    minHeight: MIN_H,
    maxWidth: MAX_W,
    maxHeight: MAX_H,
    useContentSize: true,
    roundedCorners: false,
    x: startPos.x,
    y: startPos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: alwaysOnTopPref,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webgl: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })

  if (alwaysOnTopPref) lyricsWin.setAlwaysOnTop(true, 'screen-saver')
  lyricsWin.on('will-resize', (e) => {
    if (!isProgrammaticMove) e.preventDefault()
  })
  // Windows DPI guard (#2244): keep exact dimensions intact on move
  lyricsWin.on('move', () => {
    if (!lyricsWin || lyricsWin.isDestroyed() || isProgrammaticMove) return
    if (boundsState.x === null || boundsState.y === null) return
    if (process.platform === 'win32') {
      isProgrammaticMove = true
      lyricsWin.setBounds({
        x: boundsState.x,
        y: boundsState.y,
        width: boundsState.width,
        height: boundsState.height
      })
      isProgrammaticMove = false
    }
  })
  lyricsWin.once('ready-to-show', () => {
    if (lockedPref) startDesktopLyricMouseCheck()
    if (alwaysOnTopPref) startAlwaysOnTopTools()
  })
  lyricsWin.on('closed', () => {
    stopDesktopLyricMouseCheck()
    stopAlwaysOnTopTools()
    deps?.onSaveState()
    lyricsWin = null
  })
  lyricsWin.webContents.on('did-finish-load', () => {
    const st = deps?.getInitialFloatingState()
    if (st) lyricsWin?.webContents.send('floating:state', st)
    if (lockedPref) startDesktopLyricMouseCheck()
    if (alwaysOnTopPref) startAlwaysOnTopTools()
  })
  deps?.loadRoute(lyricsWin, 'desktop-lyrics')
  return true
}

export function setDesktopLyricSizePreset(opts: { rows?: number; wide?: boolean; fontSize?: number; direction?: 'horizontal' | 'vertical' }) {
  if (customSized) return
  const rows = opts?.rows === 1 || opts?.rows === 3 ? opts.rows : 2
  const wide = !!opts?.wide
  const vertical = opts?.direction === 'vertical'
  const fontSize = Math.max(14, Math.min(64, Number(opts?.fontSize) || 24))

  let newW = boundsState.width
  let newH = boundsState.height
  if (vertical) {
    newW = Math.max(220, Math.min(440, Math.round(fontSize * 3.8 + 80)))
    newH = wide ? 520 : 420
  } else {
    newW = wide ? 1040 : 780
    const minHForRows =
      rows === 1 ? Math.round(fontSize * 1.65 + 62) : rows === 2 ? Math.round(fontSize * 2.8 + 84) : Math.round(fontSize * 3.8 + 104)
    newH = Math.max(120, Math.min(420, minHForRows))
  }
  if (boundsState.width === newW && boundsState.height === newH) return

  const oldW = boundsState.width
  const oldH = boundsState.height
  boundsState.width = newW
  boundsState.height = newH
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    const curX = boundsState.x ?? lyricsWin.getPosition()[0]
    const curY = boundsState.y ?? lyricsWin.getPosition()[1]
    const nextPos = clampDesktopLyricPos(curX - (newW - oldW) / 2, curY - (newH - oldH) / 2, newW, newH)
    boundsState.x = nextPos.x
    boundsState.y = nextPos.y
    isProgrammaticMove = true
    lyricsWin.setMinimumSize(newW, newH)
    lyricsWin.setMaximumSize(newW, newH)
    lyricsWin.setBounds({ x: nextPos.x, y: nextPos.y, width: newW, height: newH })
    isProgrammaticMove = false
  }
}

let dragAnchor: { winX: number; winY: number; cursorX: number; cursorY: number; width: number; height: number } | null = null

export function startDesktopLyricDrag() {
  if (!lyricsWin || lyricsWin.isDestroyed()) return
  const [curX, curY] = lyricsWin.getPosition()
  const winX = boundsState.x ?? curX
  const winY = boundsState.y ?? curY
  const cursor = screen.getCursorScreenPoint()
  dragAnchor = {
    winX,
    winY,
    cursorX: cursor.x,
    cursorY: cursor.y,
    width: boundsState.width,
    height: boundsState.height
  }
}

export function moveDesktopLyricDrag() {
  if (!lyricsWin || lyricsWin.isDestroyed() || !dragAnchor) return
  const cur = screen.getCursorScreenPoint()
  const nextPos = clampDesktopLyricPos(
    dragAnchor.winX + (cur.x - dragAnchor.cursorX),
    dragAnchor.winY + (cur.y - dragAnchor.cursorY),
    dragAnchor.width,
    dragAnchor.height
  )
  boundsState.x = nextPos.x
  boundsState.y = nextPos.y
  isProgrammaticMove = true
  lyricsWin.setBounds({
    x: nextPos.x,
    y: nextPos.y,
    width: dragAnchor.width,
    height: dragAnchor.height
  })
  isProgrammaticMove = false
}

let resizeAnchor: { x: number; y: number; w: number; h: number; cx: number; cy: number; edge: string } | null = null

export function startDesktopLyricResize(edge: string) {
  if (!lyricsWin || lyricsWin.isDestroyed()) return
  const [curX, curY] = lyricsWin.getPosition()
  const cur = screen.getCursorScreenPoint()
  resizeAnchor = {
    x: boundsState.x ?? curX,
    y: boundsState.y ?? curY,
    w: boundsState.width,
    h: boundsState.height,
    cx: cur.x,
    cy: cur.y,
    edge
  }
}

export function moveDesktopLyricResize() {
  if (!lyricsWin || lyricsWin.isDestroyed() || !resizeAnchor) return
  const cur = screen.getCursorScreenPoint()
  const dx = cur.x - resizeAnchor.cx
  const dy = cur.y - resizeAnchor.cy
  let { x, y, w, h } = resizeAnchor
  if (resizeAnchor.edge.includes('right')) w = Math.max(MIN_W, Math.min(MAX_W, resizeAnchor.w + dx))
  if (resizeAnchor.edge.includes('left')) {
    const nextW = Math.max(MIN_W, Math.min(MAX_W, resizeAnchor.w - dx))
    x = resizeAnchor.x + (resizeAnchor.w - nextW)
    w = nextW
  }
  if (resizeAnchor.edge.includes('bottom')) h = Math.max(MIN_H, Math.min(MAX_H, resizeAnchor.h + dy))
  if (resizeAnchor.edge.includes('top')) {
    const nextH = Math.max(MIN_H, Math.min(MAX_H, resizeAnchor.h - dy))
    y = resizeAnchor.y + (resizeAnchor.h - nextH)
    h = nextH
  }
  customSized = true
  boundsState = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h)
  }
  isProgrammaticMove = true
  lyricsWin.setMinimumSize(boundsState.width, boundsState.height)
  lyricsWin.setMaximumSize(boundsState.width, boundsState.height)
  lyricsWin.setBounds({
    x: boundsState.x!,
    y: boundsState.y!,
    width: boundsState.width,
    height: boundsState.height
  })
  isProgrammaticMove = false
}
