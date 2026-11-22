import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  ChevronRight,
  Disc3,
  Headphones,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Volume2,
  Waves
} from 'lucide-react'
import { engine, type AudioOutputDevice } from '../lib/audio'
import { computePeqResponse, isScanningReplayGain, scanTracksReplayGain } from '../lib/replaygain'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import {
  createDefaultBands,
  PEQ_PRESETS,
  useSettings,
  type AudioPreset,
  type PeqBand,
  type PeqFilterType,
  type ReplayGainMode
} from '../store/settings'
import { toast, useUI } from '../store/ui'
import { Segmented, Slider, Switch } from './Controls'

const LOG_FREQS = Array.from({ length: 160 }, (_, i) => {
  const minLog = Math.log10(20)
  const maxLog = Math.log10(20000)
  return Math.pow(10, minLog + (i / 159) * (maxLog - minLog))
})

function PeqCurveCanvas({
  bands,
  preampDb,
  autoHeadroom,
  enabled
}: {
  bands: PeqBand[]
  preampDb: number
  autoHeadroom: boolean
  enabled: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const resp = useMemo(
    () =>
      computePeqResponse(
        { enabled, preampDb, autoHeadroom, presetName: '', bands },
        LOG_FREQS,
        engine.sampleRate || 48000
      ),
    [bands, preampDb, autoHeadroom, enabled]
  )

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const dpr = window.devicePixelRatio || 1
    const w = cvs.clientWidth || 680
    const h = cvs.clientHeight || 150
    cvs.width = Math.round(w * dpr)
    cvs.height = Math.round(h * dpr)
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const padL = 36
    const padR = 14
    const padT = 14
    const padB = 22
    const plotW = w - padL - padR
    const plotH = h - padT - padB

    const dbToY = (db: number) => {
      const clamped = Math.max(-15, Math.min(15, db))
      return padT + ((15 - clamped) / 30) * plotH
    }
    const freqToX = (f: number) => {
      const minL = Math.log10(20)
      const maxL = Math.log10(20000)
      return padL + ((Math.log10(Math.max(20, Math.min(20000, f))) - minL) / (maxL - minL)) * plotW
    }

    const isDark = document.documentElement.dataset.theme === 'dark'
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    const zeroColor = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)'
    const textColor = isDark ? 'rgba(245,245,247,0.48)' : 'rgba(29,29,31,0.48)'
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#fa2d48'

    // Horizontal dB lines (-12, -6, 0, +6, +12)
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (const db of [-12, -6, 0, 6, 12]) {
      const y = dbToY(db)
      ctx.strokeStyle = db === 0 ? zeroColor : gridColor
      ctx.lineWidth = db === 0 ? 1.2 : 1
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(w - padR, y)
      ctx.stroke()
      ctx.fillStyle = textColor
      ctx.fillText(`${db > 0 ? `+${db}` : db}dB`, padL - 6, y)
    }

    // Vertical frequency grid lines
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const [f, lbl] of [
      [31, '31'],
      [62, '62'],
      [125, '125'],
      [250, '250'],
      [500, '500'],
      [1000, '1k'],
      [2000, '2k'],
      [4000, '4k'],
      [8000, '8k'],
      [16000, '16k']
    ] as const) {
      const x = freqToX(f)
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, h - padB)
      ctx.stroke()
      ctx.fillStyle = textColor
      ctx.fillText(lbl, x, h - padB + 5)
    }

    // Draw raw EQ curve (dashed if preamp offsets it)
    if (Math.abs(resp.effectivePreampDb) > 0.1) {
      ctx.save()
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.24)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1.2
      ctx.beginPath()
      for (let i = 0; i < LOG_FREQS.length; i++) {
        const x = freqToX(LOG_FREQS[i])
        const y = dbToY(enabled ? resp.rawCurveDb[i] : 0)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()
    }

    // Draw effective composite response curve (with preamp & auto-headroom)
    const zeroY = dbToY(0)
    ctx.save()
    ctx.beginPath()
    for (let i = 0; i < LOG_FREQS.length; i++) {
      const x = freqToX(LOG_FREQS[i])
      const y = dbToY(enabled ? resp.totalCurveDb[i] : 0)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = enabled ? accent : zeroColor
    ctx.lineWidth = 2.2
    ctx.stroke()

    ctx.lineTo(freqToX(20000), zeroY)
    ctx.lineTo(freqToX(20), zeroY)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, padT, 0, h - padB)
    grad.addColorStop(0, enabled ? `${accent}44` : 'transparent')
    grad.addColorStop(0.5, enabled ? `${accent}14` : 'transparent')
    grad.addColorStop(1, enabled ? `${accent}33` : 'transparent')
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()

    // Draw 10 band control nodes
    for (const b of bands) {
      const x = freqToX(b.freq)
      const y = dbToY(enabled && b.enabled ? b.gain + resp.effectivePreampDb : 0)
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = enabled && b.enabled ? accent : zeroColor
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = isDark ? '#1c1c1e' : '#ffffff'
      ctx.stroke()
    }
  }, [bands, resp, enabled])

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 156,
          display: 'block',
          borderRadius: 10,
          background: 'var(--fill)',
          border: '1px solid var(--sep)'
        }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11.5,
          color: 'var(--text-2)',
          marginTop: 6,
          padding: '0 4px'
        }}
      >
        <span>
          峰值增益：<strong>{resp.maxRawBoostDb > 0 ? `+${resp.maxRawBoostDb}` : resp.maxRawBoostDb} dB</strong>
        </span>
        <span>
          实际生效前级：
          <strong style={{ color: resp.effectivePreampDb < preampDb ? 'var(--accent)' : 'var(--text)' }}>
            {resp.effectivePreampDb > 0 ? `+${resp.effectivePreampDb}` : resp.effectivePreampDb} dB
          </strong>
          {resp.effectivePreampDb < preampDb && ' (已自动衰减防削波)'}
        </span>
      </div>
    </div>
  )
}

export function AudioSettingsSection() {
  const s = useSettings()
  const tracks = useLibrary((st) => st.tracks)
  const currentId = usePlayer((p) => p.currentId)
  const currentTrack = useMemo(() => tracks.find((t) => t.id === currentId) ?? null, [tracks, currentId])
  const engineSr = engine.sampleRate
  const [devices, setDevices] = useState<AudioOutputDevice[]>([])
  const [scanningRg, setScanningRg] = useState(isScanningReplayGain())
  const [rgProgress, setRgProgress] = useState<{ done: number; total: number; title: string } | null>(null)

  const peq = s.getPeqProfile()
  const isDirect = s.audioPreset === 'direct'

  const refreshDevices = async () => {
    const list = await engine.listOutputDevices()
    setDevices(list)
  }

  useEffect(() => {
    void refreshDevices()
    const onDevChange = () => void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDevChange)
  }, [])

  const rgCoveredCount = useMemo(
    () => tracks.filter((t) => typeof t.replayGainTrackDb === 'number' && isFinite(t.replayGainTrackDb)).length,
    [tracks]
  )

  const handleScanReplayGain = async (onlyMissing: boolean) => {
    if (scanningRg) return
    setScanningRg(true)
    try {
      const updates = await scanTracksReplayGain(
        tracks,
        (done, total, title) => setRgProgress({ done, total, title }),
        onlyMissing
      )
      const freshLib = await window.kaze.library.get()
      useLibrary.getState().apply(freshLib)
      toast(
        updates.length > 0 ? `已完成 ${updates.length} 首歌曲的响度与峰值分析（保存在本地数据库）` : '所有歌曲均已具备响度数据',
        'success'
      )
    } finally {
      setScanningRg(false)
      setRgProgress(null)
    }
  }

  const updateBand = (idx: number, patch: Partial<PeqBand>) => {
    const nextBands = peq.bands.map((b, i) => (i === idx ? { ...b, ...patch } : b))
    s.setPeqProfile({ bands: nextBands, presetName: 'custom' })
  }

  const presetSummary = useMemo(() => {
    if (s.audioPreset === 'direct') {
      return '当前实际设置：原样浮点直通 · 已旁路均衡器 (PEQ) · 已关闭响度增益 · 已关闭交叉淡化与暂停包络 · 保持无损无缝预读'
    }
    const parts: string[] = []
    parts.push(s.gapless ? '无缝播放 (Gapless) 开启' : '无缝播放关闭')
    if (s.crossfadeSec > 0) parts.push(`交叉淡化 ${s.crossfadeSec} 秒`)
    const rgMap: Record<ReplayGainMode, string> = {
      off: '响度统一关闭',
      auto: `响度统一：智能 (${s.replayGainAntiClip ? '含峰值防削波' : '无防削波'})`,
      track: `响度统一：曲目增益 (${s.replayGainAntiClip ? '含峰值防削波' : '无防削波'})`,
      album: `响度统一：专辑增益 (${s.replayGainAntiClip ? '含峰值防削波' : '无防削波'})`
    }
    parts.push(rgMap[s.replayGainMode])
    parts.push(peq.enabled ? `10 段参数均衡器开启 (${PEQ_PRESETS.find((p) => p.id === peq.presetName)?.name ?? '自定义曲线'})` : '10 段参数均衡器旁路')
    return `当前实际设置：${parts.join(' · ')}`
  }, [s.audioPreset, s.gapless, s.crossfadeSec, s.replayGainMode, s.replayGainAntiClip, peq.enabled, peq.presetName])

  return (
    <>
      {/* 1. 三大听感与链路预设 + 输出设备选择 */}
      <section style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 8px 14px' }}>
          音频链路与输出 (WASAPI)
        </div>
        <div className="settings-group-card">
          {/* Preset Cards */}
          <div style={{ padding: 14, borderBottom: '1px solid var(--sep)' }}>
            <div style={{ display: 'flex', gap: 12 }}>
              {(
                [
                  {
                    id: 'daily',
                    icon: <Headphones size={19} />,
                    title: '日常聆听',
                    desc: '启用无缝播放、ReplayGain 响度统一与防削波，支持设备 EQ 调音'
                  },
                  {
                    id: 'direct',
                    icon: <ShieldCheck size={19} />,
                    title: '原样输出',
                    desc: '物理旁路均衡器、响度调整与淡入淡出包络，减少非必要转换'
                  },
                  {
                    id: 'custom',
                    icon: <Sliders size={19} />,
                    title: '自定义模式',
                    desc: '自由组合无缝衔接、交叉淡化、响度策略与 10 段参数均衡器'
                  }
                ] as { id: AudioPreset; icon: React.ReactNode; title: string; desc: string }[]
              ).map((card) => {
                const on = s.audioPreset === card.id
                return (
                  <motion.button
                    key={card.id}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => s.applyAudioPreset(card.id)}
                    className={`settings-subcard ${on ? 'on' : ''}`}
                  >
                    <div style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      {card.icon}
                      {on && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: 10,
                            background: 'var(--accent)',
                            color: '#fff'
                          }}
                        >
                          当前使用
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, marginTop: 8, fontSize: 13.5 }}>{card.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45 }}>{card.desc}</div>
                  </motion.button>
                )
              })}
            </div>
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'var(--fill)',
                fontSize: 12,
                color: 'var(--text-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <Activity size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>{presetSummary}</span>
            </div>
          </div>

          {/* Output Device Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              borderBottom: '1px solid var(--sep)'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>音频输出设备 (WASAPI 共享终端)</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                可选“跟随系统默认设备”或固定输出到指定 USB DAC；设备拔出时自动回退系统默认并在重连后恢复
              </div>
              <div style={{ fontSize: 11.5, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 99,
                    fontWeight: 600,
                    background:
                      currentTrack?.sampleRate && currentTrack.sampleRate === engineSr
                        ? 'rgba(16, 185, 129, 0.14)'
                        : 'rgba(59, 130, 246, 0.12)',
                    color:
                      currentTrack?.sampleRate && currentTrack.sampleRate === engineSr ? '#10b981' : '#3b82f6'
                  }}
                >
                  输出混音器 {(engineSr / 1000).toFixed(1)} kHz
                  {currentTrack?.sampleRate
                    ? currentTrack.sampleRate === engineSr
                      ? ` · 与当前曲目 (${(currentTrack.sampleRate / 1000).toFixed(1)} kHz) 采样率一致`
                      : ` · 当前曲目 ${(currentTrack.sampleRate / 1000).toFixed(1)} kHz → WASAPI 重采样`
                    : ''}
                </span>
                <span style={{ color: 'var(--text-3)' }}>
                  (如需系统层面零重采样，可在 Windows 声音设置将默认格式调至与音源一致)
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <select
                className="text-input"
                value={s.outputDeviceId}
                onChange={(e) => {
                  const id = e.target.value
                  const found = devices.find((d) => d.deviceId === id)
                  s.set({
                    outputDeviceId: id,
                    outputDeviceLabel: found?.label ?? '跟随系统默认设备'
                  })
                }}
                style={{ maxWidth: 280, minWidth: 210, fontSize: 12.5 }}
              >
                {devices.length === 0 && <option value="default">跟随系统默认设备</option>}
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
                {s.outputDeviceId !== 'default' && !devices.some((d) => d.deviceId === s.outputDeviceId) && (
                  <option value={s.outputDeviceId}>{s.outputDeviceLabel} (未连接，已回退默认)</option>
                )}
              </select>
              <button className="icon-btn" title="刷新音频设备列表" onClick={refreshDevices}>
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Gapless Playback */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              borderBottom: '1px solid var(--sep)'
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>无缝播放 (Gapless Playback)</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                A/B 双通道后台预解码下一首曲目，在现场、古典、连续混音专辑换曲时保持零间隔衔接
              </div>
            </div>
            <Switch
              on={s.gapless}
              onChange={(v) =>
                s.set({
                  gapless: v,
                  audioPreset: s.audioPreset === 'direct' ? 'direct' : 'custom'
                })
              }
            />
          </div>

          {/* Crossfade (Separate from Gapless) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              opacity: isDirect ? 0.5 : 1
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                交叉淡化过渡 (Crossfade){isDirect ? ' · 原样输出下已旁路' : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                {s.crossfadeSec === 0
                  ? '已关闭（保持曲目原有无缝衔接）'
                  : `${s.crossfadeSec} 秒 — 换曲时双通道指数包络平滑叠化`}
              </div>
            </div>
            <div style={{ width: 220, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Slider
                value={isDirect ? 0 : s.crossfadeSec}
                max={12}
                onChange={(v) => s.set({ crossfadeSec: Math.round(v), audioPreset: 'custom' })}
                className="accent"
                thumb
              />
              <span style={{ width: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {isDirect ? '关闭' : s.crossfadeSec === 0 ? '关闭' : `${s.crossfadeSec}s`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 响度统一 (ReplayGain) */}
      <section style={{ marginBottom: 26 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 8px 14px' }}>
          响度统一 (ReplayGain 2.0)
        </div>
        <div className="settings-group-card" style={{ opacity: isDirect ? 0.55 : 1 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 12,
              padding: '14px 16px',
              borderBottom: '1px solid var(--sep)'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                响度统一模式{isDirect ? ' · 原样输出下已旁路' : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>
                “智能”模式下：随机播放自动使用曲目增益 (Track Gain)，按专辑/顺序播放使用专辑增益 (Album Gain)
              </div>
            </div>
            <Segmented<ReplayGainMode>
              layoutId="seg-rg-mode"
              value={s.replayGainMode}
              onChange={(v) => s.set({ replayGainMode: v, audioPreset: 'custom' })}
              options={[
                { value: 'off', label: '关闭' },
                { value: 'auto', label: '智能' },
                { value: 'track', label: '曲目增益' },
                { value: 'album', label: '专辑增益' }
              ]}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              borderBottom: '1px solid var(--sep)'
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>峰值防削波保护 (Peak Anti-Clipping)</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                当提升增益可能导致样本峰值超过 -0.1 dBFS 时，优先按峰值上限降低增益，绝不动态压缩音乐范围
              </div>
            </div>
            <Switch
              on={s.replayGainAntiClip}
              onChange={(v) => s.set({ replayGainAntiClip: v, audioPreset: 'custom' })}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              borderBottom: '1px solid var(--sep)'
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>ReplayGain 基准微调</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                在 -18 LUFS 标准响度基础上微调前级偏置（{s.replayGainPreampDb > 0 ? `+${s.replayGainPreampDb}` : s.replayGainPreampDb} dB）
              </div>
            </div>
            <div style={{ width: 220, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Slider
                value={s.replayGainPreampDb + 6}
                max={12}
                onChange={(v) => s.set({ replayGainPreampDb: Math.round((v - 6) * 2) / 2, audioPreset: 'custom' })}
                className="accent"
                thumb
              />
              <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {s.replayGainPreampDb > 0 ? `+${s.replayGainPreampDb}` : s.replayGainPreampDb}dB
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px'
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>本地曲库响度数据库扫描</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
                {rgProgress
                  ? `正在分析 (${rgProgress.done}/${rgProgress.total})：${rgProgress.title}`
                  : `已具备响度与峰值数据：${rgCoveredCount} / ${tracks.length} 首（扫描结果仅保存在本地数据库，不修改原音频文件）`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                className="btn"
                disabled={scanningRg || tracks.length === 0}
                onClick={() => handleScanReplayGain(true)}
              >
                <Waves size={14} className={scanningRg ? 'spin' : ''} />
                {scanningRg ? '扫描中…' : '扫描未分析歌曲'}
              </button>
              {rgCoveredCount > 0 && !scanningRg && (
                <button className="btn ghost" onClick={() => handleScanReplayGain(false)} title="重新分析全部歌曲">
                  全量重扫
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 3. 10 段参数均衡器 (10-Band PEQ) */}
      <section style={{ marginBottom: 26 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            margin: '0 14px 8px'
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
            10 段参数均衡器 (32-Bit Float PEQ)
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
            按输出设备独立记忆 · 当前设备：{s.outputDeviceId === 'default' ? '系统默认输出' : s.outputDeviceLabel}
          </span>
        </div>

        <div className="settings-group-card" style={{ opacity: isDirect ? 0.55 : 1 }}>
          {/* Top bar: enable switch + preset selector + reset */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              borderBottom: '1px solid var(--sep)',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Switch
                on={peq.enabled && !isDirect}
                onChange={(v) => s.setPeqProfile({ enabled: v })}
              />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {isDirect
                    ? '原样输出模式下已物理旁路 PEQ'
                    : peq.enabled
                      ? '参数均衡器已启用'
                      : '参数均衡器已旁路 (Bypass)'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
                  {PEQ_PRESETS.find((p) => p.id === peq.presetName)?.desc ?? '自定义频率、增益与 Q 值曲线'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                className="text-input"
                value={peq.presetName}
                onChange={(e) => {
                  const id = e.target.value
                  const found = PEQ_PRESETS.find((p) => p.id === id)
                  if (found) {
                    s.setPeqProfile({
                      enabled: true,
                      presetName: found.id,
                      preampDb: found.preampDb,
                      bands: found.bands.map((b) => ({ ...b }))
                    })
                  }
                }}
                style={{ fontSize: 12.5, minWidth: 190 }}
              >
                {PEQ_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    预设：{p.name}
                  </option>
                ))}
                {peq.presetName === 'custom' && <option value="custom">预设：自定义曲线</option>}
              </select>

              <button
                className="btn"
                title="重置为 0 dB 平坦曲线"
                onClick={() =>
                  s.setPeqProfile({
                    presetName: 'flat',
                    preampDb: 0,
                    bands: createDefaultBands()
                  })
                }
              >
                <RotateCcw size={13} />
                归零
              </button>
            </div>
          </div>

          {/* Preamp & Auto Headroom row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '10px 16px',
              borderBottom: '1px solid var(--sep)',
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>前级增益 (Preamp)</span>
              <div style={{ width: 170, display: 'flex' }}>
                <Slider
                  value={peq.preampDb + 12}
                  max={18}
                  onChange={(v) => s.setPeqProfile({ preampDb: Math.round((v - 12) * 2) / 2 })}
                  className="accent"
                  thumb
                />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-2)', width: 46, fontVariantNumeric: 'tabular-nums' }}>
                {peq.preampDb > 0 ? `+${peq.preampDb}` : peq.preampDb} dB
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>自动防削波余量 (Auto-Headroom)</span>
              <Switch
                on={peq.autoHeadroom}
                onChange={(v) => s.setPeqProfile({ autoHeadroom: v })}
              />
            </div>
          </div>

          {/* Interactive Frequency Response Curve */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--sep)' }}>
            <PeqCurveCanvas
              bands={peq.bands}
              preampDb={peq.preampDb}
              autoHeadroom={peq.autoHeadroom}
              enabled={peq.enabled && !isDirect}
            />
          </div>

          {/* 10-Band Parametric Table (Type, Frequency, Gain Slider, Q Factor) */}
          <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '48px 92px 86px 1fr 62px 82px',
                gap: 10,
                padding: '0 4px 4px',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--text-3)'
              }}
            >
              <span>频段</span>
              <span>滤波类型</span>
              <span>频率 (Hz)</span>
              <span>增益 (-12 ~ +12 dB · 双击归零)</span>
              <span style={{ textAlign: 'right' }}>增益值</span>
              <span style={{ textAlign: 'right' }}>Q 值 (带宽)</span>
            </div>

            {peq.bands.map((band, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '48px 92px 86px 1fr 62px 82px',
                  gap: 10,
                  alignItems: 'center',
                  padding: '4px',
                  borderRadius: 8,
                  background: idx % 2 === 0 ? 'rgba(120,120,128,0.05)' : 'transparent'
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', paddingLeft: 4 }}>
                  #{idx + 1}
                </span>

                <select
                  className="text-input"
                  value={band.type}
                  onChange={(e) => updateBand(idx, { type: e.target.value as PeqFilterType })}
                  style={{ height: 26, fontSize: 11.5, padding: '0 6px' }}
                >
                  <option value="lowshelf">低架 LowShelf</option>
                  <option value="peaking">峰值 Peaking</option>
                  <option value="highshelf">高架 HighShelf</option>
                </select>

                <input
                  type="number"
                  className="text-input"
                  min={20}
                  max={20000}
                  step={band.freq < 100 ? 1 : band.freq < 1000 ? 10 : 100}
                  value={band.freq}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (isFinite(v) && v >= 20 && v <= 20000) updateBand(idx, { freq: v })
                  }}
                  style={{ height: 26, fontSize: 12, padding: '0 6px', fontVariantNumeric: 'tabular-nums' }}
                />

                <div
                  onDoubleClick={() => updateBand(idx, { gain: 0 })}
                  title="双击恢复 0 dB"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <Slider
                    value={band.gain + 12}
                    max={24}
                    onChange={(v) => updateBand(idx, { gain: Math.round((v - 12) * 10) / 10 })}
                    className="accent"
                    thumb
                  />
                </div>

                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    color: Math.abs(band.gain) > 0.05 ? 'var(--accent)' : 'var(--text-2)'
                  }}
                >
                  {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)} dB
                </span>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Q</span>
                  <input
                    type="number"
                    className="text-input"
                    min={0.1}
                    max={18}
                    step={0.1}
                    value={band.q}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (isFinite(v) && v >= 0.1 && v <= 18) updateBand(idx, { q: Math.round(v * 100) / 100 })
                    }}
                    style={{ width: 58, height: 26, fontSize: 12, padding: '0 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 26 }}>
        <div className="settings-sec-title">频谱和电平分析</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="settings-group-card" style={{ borderRadius: 18 }}>
            <button
              type="button"
              onClick={() =>
                useUI.getState().openDialog({
                  kind: 'audioQuality',
                  trackId: usePlayer.getState().currentId ?? tracks[0]?.id,
                  tab: 'quality'
                })
              }
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '18px 20px',
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer'
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>音频质量分析</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>通过频谱分析验证无损质量</div>
              </div>
              <ChevronRight size={18} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
            </button>
          </div>

          <div
            className="settings-group-card"
            style={{ padding: '18px 20px', borderRadius: 18, display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>高解析真实性</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>检查频谱和有效位深，寻找上采样或填充的迹象。</div>
            </div>

            <button
              type="button"
              onClick={() =>
                useUI.getState().openDialog({
                  kind: 'audioQuality',
                  trackId: usePlayer.getState().currentId ?? tracks[0]?.id,
                  tab: 'hires'
                })
              }
              style={{
                width: '100%',
                height: 44,
                borderRadius: 999,
                border: '1px solid color-mix(in srgb, var(--accent) 18%, transparent)',
                background: 'color-mix(in srgb, var(--accent) 13%, transparent)',
                color: 'var(--text-1)',
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: 'pointer'
              }}
            >
              <Search size={16} />
              <span>检查</span>
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
