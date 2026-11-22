import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Tag, Check, Loader2, Play } from 'lucide-react'
import type { MetadataCandidate, Track } from '../../../shared/types'
import { useLibrary } from '../store/library'
import { toast } from '../store/ui'
import { Cover } from './Cover'

interface BatchRow {
  track: Track
  status: 'pending' | 'searching' | 'matched' | 'miss' | 'written' | 'error'
  candidate?: MetadataCandidate
  checked: boolean
  error?: string
}

export function BatchMetadataModal({ trackIds, title, onClose }: { trackIds: string[]; title: string; onClose: () => void }) {
  const byId = useLibrary((s) => s.byId)
  const applyLibrary = useLibrary((s) => s.apply)
  const tracks = useMemo(() => trackIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 60) as Track[], [trackIds, byId])

  const [rows, setRows] = useState<BatchRow[]>(() =>
    tracks.map((track) => ({ track, status: 'pending', checked: false }))
  )
  const [scanning, setScanning] = useState(false)
  const [writing, setWriting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: tracks.length })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !writing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, writing])

  const startScan = async () => {
    if (scanning || writing || !tracks.length) return
    setScanning(true)
    setProgress({ done: 0, total: tracks.length })
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: 'searching' } : r)))
      try {
        const res = await window.kaze.metadata.search({
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration || undefined,
          isrc: t.isrc || undefined
        })
        const best = res.candidates[0]
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: best ? 'matched' : 'miss',
                  candidate: best,
                  checked: !!best && best.confidence !== 'low'
                }
              : r
          )
        )
      } catch (e) {
        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'error', error: String(e) } : r))
        )
      }
      setProgress({ done: i + 1, total: tracks.length })
    }
    setScanning(false)
  }

  useEffect(() => {
    void startScan()
  }, [])

  const applyAllChecked = async () => {
    const targets = rows.filter((r) => r.checked && r.candidate)
    if (!targets.length) {
      toast('没有勾选可写入的匹配曲目', 'info')
      return
    }
    setWriting(true)
    setProgress({ done: 0, total: targets.length })
    let okCount = 0
    for (let i = 0; i < targets.length; i++) {
      const item = targets[i]
      const c = item.candidate!
      try {
        const res = await window.kaze.metadata.writeTags({
          trackId: item.track.id,
          title: c.title,
          artist: c.artist,
          album: c.album,
          albumArtist: c.albumArtist,
          year: c.year,
          trackNo: c.trackNo,
          genre: c.genre,
          isrc: c.isrc,
          coverUrl: c.coverUrl
        })
        if (res.ok) {
          okCount++
          setRows((prev) =>
            prev.map((r) => (r.track.id === item.track.id ? { ...r, status: 'written', checked: false } : r))
          )
        } else {
          setRows((prev) =>
            prev.map((r) => (r.track.id === item.track.id ? { ...r, status: 'error', error: res.error } : r))
          )
        }
      } catch (e) {
        setRows((prev) =>
          prev.map((r) => (r.track.id === item.track.id ? { ...r, status: 'error', error: String(e) } : r))
        )
      }
      setProgress({ done: i + 1, total: targets.length })
    }
    const lib = await window.kaze.library.get()
    applyLibrary(lib)
    setWriting(false)
    toast(`已完成批量封装写入 ${okCount} / ${targets.length} 首曲目`, okCount ? 'success' : 'error')
  }

  const checkedCount = rows.filter((r) => r.checked && r.candidate).length

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => !writing && onClose()}>
      <motion.div
        className="modal"
        style={{ width: 780, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag size={18} />
              批量匹配并封装标签 · {title}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              自动按 Fallback 链检索高精度元数据与封面，高/中置信度匹配将默认勾选（单批上限 60 首）
            </div>
          </div>
          <button className="icon-btn" disabled={writing} onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>

        {(scanning || writing) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--accent)' }}>
            <Loader2 size={14} className="spin" />
            <span>
              {writing ? '正在写入音频标签与封面' : '正在逐首检索权威元数据'}：{progress.done} / {progress.total}
            </span>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
          {rows.map((r, idx) => (
            <label
              key={r.track.id}
              className={`modal-list-row ${r.checked ? 'on' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 10px',
                borderRadius: 10,
                cursor: r.candidate && !writing ? 'pointer' : 'default'
              }}
            >
              <input
                type="checkbox"
                disabled={!r.candidate || writing || r.status === 'written'}
                checked={r.checked}
                onChange={() =>
                  setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, checked: !x.checked } : x)))
                }
              />
              <Cover cover={r.track.cover} style={{ width: 38, height: 38, borderRadius: 7 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.track.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.candidate
                    ? `→ ${r.candidate.title} · ${r.candidate.artist} · ${r.candidate.album}${r.candidate.isrc ? ` · ${r.candidate.isrc}` : ''}`
                    : r.status === 'searching'
                      ? '检索中...'
                      : r.status === 'miss'
                        ? '未匹配到候选'
                        : r.error || '等待检索'}
                </div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, flexShrink: 0, color: r.status === 'written' ? '#10b981' : 'var(--text-2)' }}>
                {r.status === 'written'
                  ? '已写入'
                  : r.candidate
                    ? `${Math.round(r.candidate.score * 100)}% (${r.candidate.sourceName})`
                    : r.status === 'searching'
                      ? '检索中'
                      : r.status === 'miss'
                        ? '无结果'
                        : '—'}
              </span>
            </label>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: 0, justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>已勾选 {checkedCount} 首待写入曲目</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={scanning || writing} onClick={() => void startScan()}>
              <Play size={13} />
              重新扫描
            </button>
            <button className="btn" disabled={writing} onClick={onClose}>
              关闭
            </button>
            <button className="btn primary" disabled={scanning || writing || !checkedCount} onClick={applyAllChecked}>
              {writing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              批量封装写入 ({checkedCount})
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
