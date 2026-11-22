import { useEffect, useState } from 'react'
import { X, Minus, Plus, Square, Copy } from 'lucide-react'
import { useSettings } from '../store/settings'

export function TrafficLights() {
  const [max, setMax] = useState(false)
  useEffect(() => {
    window.kaze.win.isMaximized().then(setMax)
    return window.kaze.win.onMaximized(setMax)
  }, [])
  return (
    <div className="traffic no-drag">
      <button className="t-close" onClick={() => window.kaze.win.close()} title="关闭">
        <X size={8} strokeWidth={3} />
      </button>
      <button className="t-min" onClick={() => window.kaze.win.minimize()} title="最小化">
        <Minus size={8} strokeWidth={3} />
      </button>
      <button className="t-max" onClick={() => window.kaze.win.toggleMaximize()} title={max ? '还原' : '最大化'}>
        <Plus size={8} strokeWidth={3} />
      </button>
    </div>
  )
}

export function WinControls() {
  const [max, setMax] = useState(false)
  useEffect(() => {
    window.kaze.win.isMaximized().then(setMax)
    return window.kaze.win.onMaximized(setMax)
  }, [])
  return (
    <div className="win-ctrls no-drag">
      <button onClick={() => window.kaze.win.minimize()} title="最小化">
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button onClick={() => window.kaze.win.toggleMaximize()} title={max ? '还原' : '最大化'}>
        {max ? <Copy size={12} strokeWidth={1.5} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} strokeWidth={1.5} />}
      </button>
      <button className="close" onClick={() => window.kaze.win.close()} title="关闭">
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}

export function useWinStyle() {
  return useSettings((s) => s.windowControls)
}
