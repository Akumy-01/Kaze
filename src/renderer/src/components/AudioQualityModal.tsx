import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, FolderOpen, Activity, ShieldCheck, AlertTriangle, CheckCircle2, Sparkles, Loader2, RefreshCw, Layers } from 'lucide-react'
import type { Track } from '../../../shared/types'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { toast } from '../store/ui'
import { fmtTime, qualityLabel } from '../lib/format'
import { analyzeTrackQuality, type AudioAnalysisReport, type HiResAuthenticityStatus, type LosslessSpectralStatus } from '../lib/audioAnalysis'

function statusMetaLossless(status: LosslessSpectralStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'verified-lossless':
      return { label: '无损验证通过', color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)' }
    case 'suspect-low-transcode':
      return { label: '疑似低码率转码', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)' }
    case 'suspect-high-transcode':
      return { label: '疑似有损转码 / 滚降', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' }
    case 'lossy-format':
      return { label: '有损压缩格式', color: 'var(--text-2)', bg: 'var(--surface-hover)' }
  }
}

function statusMetaHiRes(status: HiResAuthenticityStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'authentic-hires':
      return { label: '原生高解析', color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)' }
    case 'cd-lossless':
      return { label: '标准 CD 无损', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.14)' }
    case 'zero-padded':
      return { label: '存在位深填充 (Zero-Padding)', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' }
    case 'upsampled':
      return { label: '存在上采样特征', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' }
    case 'upsampled-and-padded':
      return { label: '疑似伪高解析 (上采样 + 填充)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)' }
    case 'lossy':
      return { label: '有损封装 (非无损高解析)', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)' }
  }
}

function infernoColor(norm: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, norm))
  if (t < 0.2) {
    const k = t / 0.2
    return [Math.round(8 + k * 34), Math.round(8 + k * 6), Math.round(22 + k * 66)]
  }
  if (t < 0.45) {
    const k = (t - 0.2) / 0.25
    return [Math.round(42 + k * 96), Math.round(14 + k * 24), Math.round(88 + k * 42)]
  }
  if (t < 0.72) {
    const k = (t - 0.45) / 0.27
    return [Math.round(138 + k * 92), Math.round(38 + k * 78), Math.round(130 - k * 90)]
  }
  if (t < 0.9) {
    const k = (t - 0.72) / 0.18
    return [Math.round(230 + k * 22), Math.round(116 + k * 98), Math.round(40 + k * 36)]
  }
  const k = (t - 0.9) / 0.1
  return [Math.round(252 + k * 3), Math.round(214 + k * 38), Math.round(76 + k * 144)]
}

function SpectrogramCanvas({ report }: { report: AudioAnalysisReport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || report.spectrogram.length === 0) return
    const w = 640
    const h = 210
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cols = report.spectrogram.length
    const rows = report.spectrogram[0]?.length ?? 96
    const img = ctx.createImageData(cols, rows)

    for (let x = 0; x < cols; x++) {
      const col = report.spectrogram[x]
      for (let y = 0; y < rows; y++) {
        // y=0 at top corresponds to highest frequency
        const bin = rows - 1 - y
        const db = col[bin] ?? -120
        const norm = (db + 115) / 100
        const [r, g, b] = infernoColor(norm)
        const idx = (y * cols + x) * 4
        img.data[idx] = r
        img.data[idx + 1] = g
        img.data[idx + 2] = b
        img.data[idx + 3] = 255
      }
    }

    const off = document.createElement('canvas')
    off.width = cols
    off.height = rows
    const octx = off.getContext('2d')
    if (octx) {
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, w, h)
    }

    // Subtle horizontal reference grid (e.g. 16kHz, 20kHz, 24kHz)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = 1
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    const marks = [8, 16, 20, 24, 32, 44].filter((khz) => khz < report.nyquistKhz - 1)
    for (const khz of marks) {
      const y = h - (khz / report.nyquistKhz) * h
      ctx.beginPath()
      ctx.setLineDash([4, 4])
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillText(`${khz} kHz`, 8, Math.max(12, y - 4))
    }

    // Cutoff line
    if (report.cutoffKhz > 0 && report.cutoffKhz < report.nyquistKhz) {
      const cy = h - (report.cutoffKhz / report.nyquistKhz) * h
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, cy)
      ctx.lineTo(w, cy)
      ctx.stroke()
      ctx.fillStyle = 'rgba(186, 230, 253, 0.98)'
      ctx.fillText(`截止 ~${report.cutoffKhz.toFixed(1)} kHz`, w - 108, Math.max(14, cy - 5))
    }
  }, [report])

  return (
    <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--sep)', background: '#090910' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: 196, display: 'block' }} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '4px 10px',
          fontSize: 11,
          color: 'var(--text-2)',
          background: 'rgba(0,0,0,0.28)',
          borderTop: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <span>0 kHz · 音轨时间轴 ({fmtTime(report.duration)})</span>
        <span>Nyquist {report.nyquistKhz.toFixed(1)} kHz (-115 ~ -15 dBFS)</span>
      </div>
    </div>
  )
}

function AverageSpectrumCanvas({ report }: { report: AudioAnalysisReport }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || report.avgSpectrumDb.length === 0) return
    const w = 640
    const h = 132
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)'
    ctx.fillRect(0, 0, w, h)

    // Grid lines (-20, -40, -60, -80, -100 dB)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)'
    ctx.lineWidth = 1
    ctx.font = '10px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(148, 163, 184, 0.72)'
    for (const db of [-20, -50, -80, -110]) {
      const y = ((0 - db) / 120) * (h - 18) + 8
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      ctx.fillText(`${db} dB`, 6, y - 3)
    }

    const n = report.avgSpectrumDb.length
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * w
      const db = Math.max(-120, Math.min(0, report.avgSpectrumDb[i]))
      const y = ((0 - db) / 120) * (h - 18) + 8
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.32)')
    grad.addColorStop(1, 'rgba(56, 189, 248, 0.02)')
    ctx.fillStyle = grad
    ctx.fill()
  }, [report])

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--sep)' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: 120, display: 'block' }} />
    </div>
  )
}

function MetricCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: string }) {
  return (
    <div
      className="glass-surface"
      style={{
        padding: '10px 12px',
        borderRadius: 11,
        display: 'flex',
        flexDirection: 'column',
        gap: 3
      }}
    >
      <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: highlight ?? 'var(--text-1)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{sub}</div>}
    </div>
  )
}

export function AudioQualityModal({
  initialTrackId,
  initialTab = 'quality',
  onClose
}: {
  initialTrackId?: string
  initialTab?: 'quality' | 'hires' | 'batch'
  onClose: () => void
}) {
  const tracks = useLibrary((s) => s.tracks)
  const currentId = usePlayer((s) => s.currentId)
  const spectralCache = useUser((s) => s.spectralCache)
  const [tab, setTab] = useState<'quality' | 'hires' | 'batch'>(initialTab)
  const [externalTrack, setExternalTrack] = useState<Track | null>(null)
  const [selectedId, setSelectedId] = useState<string>(() => initialTrackId ?? currentId ?? tracks[0]?.id ?? '')
  const [report, setReport] = useState<AudioAnalysisReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [batchRunning, setBatchRunning] = useState(false)
  const [batchIdx, setBatchIdx] = useState(0)
  const [batchTotal, setBatchTotal] = useState(0)
  const [batchCurrentTitle, setBatchCurrentTitle] = useState('')
  const batchStopRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        batchStopRef.current = true
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      batchStopRef.current = true
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const activeTrack = useMemo(() => {
    if (externalTrack && externalTrack.id === selectedId) return externalTrack
    return tracks.find((t) => t.id === selectedId) ?? externalTrack ?? tracks[0] ?? null
  }, [externalTrack, tracks, selectedId])

  const runAnalysis = async (track: Track) => {
    setLoading(true)
    setError(null)
    try {
      const res = await analyzeTrackQuality(track)
      setReport(res)
      if (!externalTrack || externalTrack.id !== track.id) {
        useUser.getState().setSpectralResult(track.id, {
          losslessStatus: res.losslessStatus,
          hiResStatus: res.hiResStatus,
          cutoffKhz: res.cutoffKhz,
          effectiveBits: res.effectiveBits,
          checkedAt: Date.now()
        })
      }
    } catch (e) {
      setReport(null)
      setError(e instanceof Error ? e.message : '音频解码或频谱分析失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'batch' && activeTrack) {
      void runAnalysis(activeTrack)
    }
  }, [activeTrack?.id, tab])

  const startBatchScan = async (onlyUnscanned: boolean) => {
    const targets = onlyUnscanned ? tracks.filter((t) => !useUser.getState().spectralCache[t.id]) : tracks
    if (!targets.length) {
      toast('所有曲目均已完成频谱体检', 'success')
      return
    }
    batchStopRef.current = false
    setBatchRunning(true)
    setBatchIdx(0)
    setBatchTotal(targets.length)
    let doneCount = 0
    for (let i = 0; i < targets.length; i++) {
      if (batchStopRef.current) break
      const t = targets[i]
      setBatchIdx(i + 1)
      setBatchCurrentTitle(`${t.title} - ${t.artist}`)
      try {
        const res = await analyzeTrackQuality(t)
        useUser.getState().setSpectralResult(t.id, {
          losslessStatus: res.losslessStatus,
          hiResStatus: res.hiResStatus,
          cutoffKhz: res.cutoffKhz,
          effectiveBits: res.effectiveBits,
          checkedAt: Date.now()
        })
        doneCount++
      } catch {
        // skip unreadable track during batch sweep
      }
    }
    setBatchRunning(false)
    setBatchCurrentTitle('')
    if (!batchStopRef.current) {
      toast(`全库频谱体检完成，已检测 ${doneCount} 首曲目`, 'success')
    } else {
      toast(`已中止体检，已保存 ${doneCount} 首结果`)
    }
  }

  const handlePickFile = async () => {
    const picked = await window.kaze.pickAudioFile()
    if (!picked) return
    setExternalTrack(picked)
    setSelectedId(picked.id)
    toast(`已载入外部音频：${picked.title}`, 'info')
  }

  const losslessBadge = report ? statusMetaLossless(report.losslessStatus) : null
  const hiresBadge = report ? statusMetaHiRes(report.hiResStatus) : null

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        className="modal"
        style={{ width: 760, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={18} />
              频谱和电平分析
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>通过 FFT 频谱分析、真峰值电平与有效位深检测验证无损与高解析真实性</div>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* Source & Tab Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', padding: 3, borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--sep)', gap: 2 }}>
            <button
              className="btn"
              onClick={() => setTab('quality')}
              style={{
                height: 28,
                padding: '0 12px',
                fontSize: 12.5,
                background: tab === 'quality' ? 'var(--accent)' : 'transparent',
                color: tab === 'quality' ? '#fff' : 'var(--text-1)',
                border: 'none'
              }}
            >
              <Activity size={13} style={{ marginRight: 5 }} />
              音频质量分析
            </button>
            <button
              className="btn"
              onClick={() => setTab('hires')}
              style={{
                height: 28,
                padding: '0 12px',
                fontSize: 12.5,
                background: tab === 'hires' ? 'var(--accent)' : 'transparent',
                color: tab === 'hires' ? '#fff' : 'var(--text-1)',
                border: 'none'
              }}
            >
              <ShieldCheck size={13} style={{ marginRight: 5 }} />
              高解析真实性
            </button>
            <button
              className="btn"
              onClick={() => setTab('batch')}
              style={{
                height: 28,
                padding: '0 12px',
                fontSize: 12.5,
                background: tab === 'batch' ? 'var(--accent)' : 'transparent',
                color: tab === 'batch' ? '#fff' : 'var(--text-1)',
                border: 'none'
              }}
            >
              <Layers size={13} style={{ marginRight: 5 }} />
              全库频谱体检
            </button>
          </div>

          {tab !== 'batch' && (
            <>
              <select
                className="text-input"
                style={{ flex: 1, minWidth: 210, height: 34, fontSize: 12.5 }}
                value={activeTrack?.id ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  if (externalTrack && externalTrack.id !== id) setExternalTrack(null)
                  setSelectedId(id)
                }}
              >
                {externalTrack && <option value={externalTrack.id}>[外部文件] {externalTrack.title} - {externalTrack.artist}</option>}
                {tracks.slice(0, 300).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} — {t.artist} ({qualityLabel(t)})
                  </option>
                ))}
                {tracks.length === 0 && !externalTrack && <option value="">曲库暂无曲目</option>}
              </select>

              <button className="btn" onClick={handlePickFile} style={{ height: 34, fontSize: 12.5 }}>
                <FolderOpen size={14} style={{ marginRight: 5 }} />
                选择本地文件
              </button>

              {activeTrack && (
                <button className="btn" onClick={() => runAnalysis(activeTrack)} disabled={loading} style={{ height: 34, fontSize: 12.5 }} title="重新扫描">
                  <RefreshCw size={13} className={loading ? 'spin' : undefined} />
                </button>
              )}
            </>
          )}
        </div>

        {/* Scrollable Body */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 4 }}>
          {tab === 'batch' && (
            <>
              {(() => {
                const scanned = tracks.filter((t) => spectralCache[t.id])
                const verified = scanned.filter((t) => spectralCache[t.id]?.losslessStatus === 'verified-lossless')
                const suspect = scanned.filter((t) => spectralCache[t.id]?.losslessStatus?.startsWith('suspect'))
                const hiresAuthentic = scanned.filter((t) => spectralCache[t.id]?.hiResStatus === 'authentic-hires')
                const fakeHires = scanned.filter((t) => ['zero-padded', 'upsampled'].includes(spectralCache[t.id]?.hiResStatus ?? ''))
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                        已体检 {scanned.length} / {tracks.length} 首（结果自动保存，可在「歌曲」页按真无损/假无损筛选）
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {batchRunning ? (
                          <button
                            className="btn"
                            onClick={() => {
                              batchStopRef.current = true
                            }}
                          >
                            停止扫描 ({batchIdx}/{batchTotal})
                          </button>
                        ) : (
                          <>
                            <button className="btn" onClick={() => void startBatchScan(false)} disabled={!tracks.length}>
                              <RefreshCw size={13} />
                              全库重扫
                            </button>
                            <button className="btn primary" onClick={() => void startBatchScan(true)} disabled={!tracks.length}>
                              <Activity size={13} />
                              扫描未检测曲目 ({tracks.length - scanned.length})
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {batchRunning && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--sep)', fontSize: 12.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <Loader2 size={14} className="spin" />
                          <span style={{ fontWeight: 600 }}>正在体检 ({batchIdx}/{batchTotal})：</span>
                          <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{batchCurrentTitle}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: 'var(--sep)', overflow: 'hidden' }}>
                          <div style={{ width: `${batchTotal ? (batchIdx / batchTotal) * 100 : 0}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.2s' }} />
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                      <MetricCard label="真无损通过" value={`${verified.length}`} highlight="#10b981" sub="频谱延伸健康" />
                      <MetricCard label="疑似假无损/转码" value={`${suspect.length}`} highlight={suspect.length ? '#f59e0b' : undefined} sub="存在高频一刀切" />
                      <MetricCard label="原生 Hi-Res" value={`${hiresAuthentic.length}`} highlight="#3b82f6" sub="含 >20kHz 高频能量" />
                      <MetricCard label="伪高解析/升频" value={`${fakeHires.length}`} highlight={fakeHires.length ? '#ef4444' : undefined} sub="零填充或无超声信息" />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {scanned.length === 0 ? (
                        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
                          点击右上角“扫描未检测曲目”即可对整库执行 4096-pt FFT 频谱与有效位深自动排查。
                        </div>
                      ) : (
                        scanned.map((t) => {
                          const v = spectralCache[t.id]!
                          const isSuspect = v.losslessStatus.startsWith('suspect')
                          const isAuthenticHr = v.hiResStatus === 'authentic-hires'
                          const isFakeHr = v.hiResStatus === 'zero-padded' || v.hiResStatus === 'upsampled'
                          return (
                            <div
                              key={t.id}
                              className="modal-list-row"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '8px 12px',
                                borderRadius: 10,
                                cursor: 'pointer'
                              }}
                              onClick={() => {
                                setSelectedId(t.id)
                                setTab('quality')
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {t.title}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {t.artist} · {qualityLabel(t)}
                                </div>
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                                截止 {v.cutoffKhz.toFixed(1)} kHz{v.effectiveBits != null ? ` · ~${v.effectiveBits.toFixed(1)}bit` : ''}
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: '2px 8px',
                                  borderRadius: 99,
                                  flexShrink: 0,
                                  background: isSuspect
                                    ? 'rgba(245,158,11,0.16)'
                                    : v.losslessStatus === 'verified-lossless'
                                      ? 'rgba(16,185,129,0.16)'
                                      : 'var(--surface-hover)',
                                  color: isSuspect
                                    ? '#f59e0b'
                                    : v.losslessStatus === 'verified-lossless'
                                      ? '#10b981'
                                      : 'var(--text-2)'
                                }}
                              >
                                {isSuspect ? '疑似假无损' : v.losslessStatus === 'verified-lossless' ? '真无损' : '有损'}
                              </span>
                              {(isAuthenticHr || isFakeHr) && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: 99,
                                    flexShrink: 0,
                                    background: isAuthenticHr ? 'rgba(59,130,246,0.16)' : 'rgba(239,68,68,0.14)',
                                    color: isAuthenticHr ? '#3b82f6' : '#ef4444'
                                  }}
                                >
                                  {isAuthenticHr ? '原生 Hi-Res' : '伪高解析'}
                                </span>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </>
                )
              })()}
            </>
          )}

          {tab !== 'batch' && !activeTrack && (
            <div style={{ padding: '44px 16px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
              请从曲库选择曲目或点击右上角“选择本地文件”开始频谱与位深分析。
            </div>
          )}

          {tab !== 'batch' && loading && (
            <div style={{ padding: '52px 16px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Loader2 size={24} className="spin" />
              <span>正在以原生采样率解码并计算 4096-pt FFT 频谱与量化分布…</span>
            </div>
          )}

          {tab !== 'batch' && error && !loading && (
            <div style={{ padding: 16, borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', fontSize: 13 }}>
              分析失败：{error}
            </div>
          )}

          {tab !== 'batch' && report && !loading && tab === 'quality' && (
            <>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 11,
                  background: losslessBadge?.bg,
                  border: `1px solid ${losslessBadge?.color ?? 'var(--sep)'}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {report.losslessStatus === 'verified-lossless' ? (
                    <CheckCircle2 size={20} color={losslessBadge?.color} />
                  ) : (
                    <AlertTriangle size={20} color={losslessBadge?.color} />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: losslessBadge?.color }}>{losslessBadge?.label}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-1)', marginTop: 2 }}>{report.losslessSummary}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-2)', flexShrink: 0 }}>
                  <div>{report.format} · {(report.sampleRate / 1000).toFixed(1)} kHz</div>
                  <div>{report.declaredBits ? `${report.declaredBits}-bit` : '有损编码'} · {report.channels}ch</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                <MetricCard
                  label="真峰值 (4x True Peak)"
                  value={`${report.truePeakDb.toFixed(2)} dBTP`}
                  highlight={report.truePeakDb > 0 ? '#ef4444' : undefined}
                  sub={report.truePeakDb > 0 ? '存在样本间过载风险' : '安全余量充足'}
                />
                <MetricCard label="采样峰值 / RMS" value={`${report.samplePeakDb.toFixed(1)} / ${report.rmsDb.toFixed(1)}`} sub="单位 dBFS" />
                <MetricCard
                  label="动态范围 (DR)"
                  value={`DR${Math.round(report.dynamicRangeDb)}`}
                  sub={`${report.dynamicRangeDb.toFixed(1)} dB · 削波 ${report.clipCount} 次`}
                />
                <MetricCard label="有效高频截止" value={`${report.cutoffKhz.toFixed(1)} kHz`} sub={`Nyquist ${report.nyquistKhz.toFixed(1)} kHz`} />
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>时频谱图 (Spectrogram)</div>
                <SpectrogramCanvas report={report} />
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>平均频响曲线与各频段能量</div>
                <AverageSpectrumCanvas report={report} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: 'var(--text-2)' }}>
                  <span>1-10 kHz: {report.bandEnergy.mid1to10k.toFixed(1)} dB</span>
                  <span>· 16-18 kHz: {report.bandEnergy.hi16to18k.toFixed(1)} dB</span>
                  <span>· 18-20 kHz: {report.bandEnergy.hi18to20k.toFixed(1)} dB</span>
                  <span>· 20-22 kHz: {report.bandEnergy.hi20to22k.toFixed(1)} dB</span>
                  {report.bandEnergy.ultrasonic24kPlus !== null && (
                    <span>· &gt;24 kHz 超声: {report.bandEnergy.ultrasonic24kPlus.toFixed(1)} dB</span>
                  )}
                </div>
              </div>
            </>
          )}

          {report && !loading && tab === 'hires' && (
            <>
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 11,
                  background: hiresBadge?.bg,
                  border: `1px solid ${hiresBadge?.color ?? 'var(--sep)'}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {report.hiResStatus === 'authentic-hires' || report.hiResStatus === 'cd-lossless' ? (
                    <Sparkles size={20} color={hiresBadge?.color} />
                  ) : (
                    <AlertTriangle size={20} color={hiresBadge?.color} />
                  )}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: hiresBadge?.color }}>{hiresBadge?.label}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-1)', marginTop: 2 }}>{report.hiResSummary}</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                <MetricCard label="容器声明位深" value={report.declaredBits ? `${report.declaredBits}-bit` : '有损格式'} sub={report.format} />
                <MetricCard
                  label="实测有效位深"
                  value={report.effectiveBits ? `${report.effectiveBits}-bit` : '不适用'}
                  highlight={report.declaredBits >= 24 && (report.effectiveBits ?? 24) <= 16 ? '#f59e0b' : undefined}
                  sub="基于量化网格探测"
                />
                <MetricCard
                  label="16-bit 网格重合率"
                  value={`${report.grid16MatchPct.toFixed(1)}%`}
                  highlight={report.grid16MatchPct > 97 && report.declaredBits >= 24 ? '#ef4444' : undefined}
                  sub=">97% 说明存在 16→24 补零"
                />
                <MetricCard
                  label=">24 kHz 超声频段"
                  value={report.bandEnergy.ultrasonic24kPlus !== null ? `${report.bandEnergy.ultrasonic24kPlus.toFixed(1)} dB` : '采样率 ≤48kHz'}
                  sub={`采样率 ${(report.sampleRate / 1000).toFixed(1)} kHz`}
                />
              </div>

              <div
                className="glass-surface"
                style={{
                  padding: '12px 14px',
                  borderRadius: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>高解析真实性诊断明细</div>
                {report.hiResDetails.map((line, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.55 }}>
                    • {line}
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>高频与超声区间频谱证据</div>
                <SpectrogramCanvas report={report} />
              </div>
            </>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: 0 }}>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
