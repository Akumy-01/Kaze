import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Trash2, Loader2, Tag, Activity, Search, Plus, Check, Pencil, ImageDown } from 'lucide-react'
import { useUI, toast } from '../store/ui'
import { useUser } from '../store/user'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import { Cover } from './Cover'
import { fmtTime, fmtSize, qualityLabel } from '../lib/format'
import { AudioQualityModal } from './AudioQualityModal'
import { MetadataMatchModal } from './MetadataMatchModal'
import { BatchMetadataModal } from './BatchMetadataModal'

function Modal({ onClose, children, width }: { onClose: () => void; children: React.ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        className="modal"
        style={width ? { width } : undefined}
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function NameDialog({ title, initial, confirm, onSubmit, onClose }: { title: string; initial: string; confirm: string; onSubmit: (n: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTimeout(() => ref.current?.select(), 50)
  }, [])
  const submit = () => {
    if (!name.trim()) return
    onSubmit(name.trim())
    onClose()
  }
  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      <input ref={ref} className="text-input" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" onClick={submit} disabled={!name.trim()}>
          {confirm}
        </button>
      </div>
    </Modal>
  )
}

function TrackInfo({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useLibrary((s) => s.byId.get(id))
  const playCount = useUser((s) => s.playCounts[id] ?? 0)
  const playDur = useUser((s) => s.playDurations[id] ?? 0)
  if (!t) return null
  const rows: [string, React.ReactNode][] = [
    ['标题', t.title],
    ['艺人', t.artist],
    ['专辑', t.album],
    ['专辑艺人', t.albumArtist],
    ['年份', t.year ?? '—'],
    ['流派', t.genre ?? '—'],
    ['音轨', t.trackNo ? `${t.discNo ? t.discNo + '-' : ''}${t.trackNo}` : '—'],
    ['时长', fmtTime(t.duration)],
    ['聆听统计', `播放 ${playCount} 次 · 累计聆听 ${fmtTime(Math.round(playDur))}`],
    ['格式', `${t.format} · ${qualityLabel(t)}`],
    ['采样率', t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz${t.bitsPerSample ? ` / ${t.bitsPerSample} bit` : ''}` : '—'],
    ['比特率', t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : '—'],
    ['ISRC', t.isrc || '—'],
    ['大小', fmtSize(t.size)],
    ['歌词', t.hasLyrics ? '已有本地歌词' : '无'],
    ['位置', <span style={{ wordBreak: 'break-all', userSelect: 'text' }}>{t.path}</span>]
  ]
  return (
    <Modal onClose={onClose} width={520}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 18 }}>
        <Cover cover={t.cover} style={{ width: 84, borderRadius: 10, boxShadow: 'var(--shadow)' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{t.title}</div>
          <div style={{ color: 'var(--text-2)', marginTop: 2 }}>{t.artist}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '8px 12px', fontSize: 13 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <div style={{ color: 'var(--text-2)', textAlign: 'right' }}>{k}</div>
            <div>{v}</div>
          </div>
        ))}
      </div>
      <div className="modal-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => useUI.getState().openDialog({ kind: 'metadataMatch', trackId: t.id, tab: 'edit' })}>
            <Pencil size={13} style={{ marginRight: 5 }} />
            编辑标签与封面
          </button>
          <button className="btn" onClick={() => useUI.getState().openDialog({ kind: 'metadataMatch', trackId: t.id, tab: 'match' })}>
            <Tag size={13} style={{ marginRight: 5 }} />
            匹配在线标签
          </button>
          <button
            className="btn"
            onClick={async () => {
              const res = await window.kaze.metadata.saveCover(t.id)
              if (res.canceled) return
              if (res.ok) toast(`专辑封面已保存`, 'success')
              else toast(res.error ?? '该歌曲暂无可导出的封面', 'error')
            }}
          >
            <ImageDown size={13} style={{ marginRight: 5 }} />
            另存封面
          </button>
          <button className="btn" onClick={() => useUI.getState().openDialog({ kind: 'audioQuality', trackId: t.id, tab: 'quality' })}>
            <Activity size={13} style={{ marginRight: 5 }} />
            频谱质量分析
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => window.kaze.showItem(t.path)}>
            在资源管理器中显示
          </button>
          <button className="btn primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AddToPlaylistModal({ playlistId, onClose }: { playlistId: string; onClose: () => void }) {
  const pl = useUser((s) => s.playlists.find((p) => p.id === playlistId))
  const tracks = useLibrary((s) => s.tracks)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const existing = useMemo(() => new Set(pl?.trackIds ?? []), [pl?.trackIds])
  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return tracks.slice(0, 200)
    return tracks
      .filter((t) => {
        const hay = `${t.title} ${t.artist} ${t.album}`.toLowerCase()
        return terms.every((term) => hay.includes(term))
      })
      .slice(0, 200)
  }, [tracks, q])

  if (!pl) return null

  const toggle = (id: string) => {
    if (existing.has(id)) return
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const selectableFiltered = filtered.filter((t) => !existing.has(t.id))
  const selectAllFiltered = () => {
    const ids = selectableFiltered.map((t) => t.id)
    setSelected((prev) => Array.from(new Set([...prev, ...ids])))
  }

  const submit = () => {
    if (!selected.length) return
    const n = useUser.getState().addToPlaylist(pl.id, selected)
    toast(n ? `已向歌单「${pl.name}」添加 ${n} 首歌曲` : '所选歌曲已在歌单中', n ? 'success' : 'info')
    onClose()
  }

  return (
    <Modal onClose={onClose} width={600}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plus size={18} />
          添加歌曲到「{pl.name}」
        </h3>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-3)' }} />
          <input
            className="text-input"
            style={{ width: '100%', paddingLeft: 30 }}
            placeholder="搜索歌曲标题、艺人或专辑..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <button className="btn" onClick={selectAllFiltered} disabled={!selectableFiltered.length}>
          全选当前 ({selectableFiltered.length})
        </button>
      </div>

      <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
        {filtered.length === 0 && (
          <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>没有匹配的曲目</div>
        )}
        {filtered.map((t) => {
          const already = existing.has(t.id)
          const checked = already || selected.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              disabled={already}
              className={`modal-list-row ${checked && !already ? 'on' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 10px',
                borderRadius: 10,
                textAlign: 'left',
                opacity: already ? 0.55 : 1,
                cursor: already ? 'default' : 'pointer',
                width: '100%'
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  flexShrink: 0,
                  display: 'grid',
                  placeItems: 'center',
                  background: checked ? 'var(--accent)' : 'transparent',
                  border: checked ? '1px solid var(--accent)' : '1.5px solid var(--text-3)',
                  color: '#fff'
                }}
              >
                {checked && <Check size={12} strokeWidth={3} />}
              </div>
              <Cover cover={t.cover} style={{ width: 36, height: 36, borderRadius: 6 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.artist} · {t.album}
                </div>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-2)', flexShrink: 0 }}>
                {already ? '已在歌单中' : fmtTime(t.duration)}
              </span>
            </button>
          )
        })}
      </div>

      <div className="modal-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>已选 {selected.length} 首（默认展示前 200 首）</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!selected.length} onClick={submit}>
            添加到歌单 ({selected.length})
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function Dialogs() {
  const dialog = useUI((s) => s.dialog)
  const close = () => useUI.getState().openDialog(null)
  return (
    <AnimatePresence>
      {dialog?.kind === 'newPlaylist' && (
        <NameDialog
          key="new"
          title="新建歌单"
          initial="未命名歌单"
          confirm="创建"
          onClose={close}
          onSubmit={(name) => {
            const id = useUser.getState().createPlaylist(name, dialog.trackIds)
            toast(dialog.trackIds?.length ? `已创建歌单「${name}」并添加歌曲` : `已创建歌单「${name}」`, 'success')
            if (!dialog.trackIds?.length) useUI.getState().navigate({ name: 'playlist', param: id })
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog key="rename" title="重命名歌单" initial={dialog.name} confirm="完成" onClose={close} onSubmit={(name) => useUser.getState().renamePlaylist(dialog.id, name)} />
      )}
      {dialog?.kind === 'trackInfo' && <TrackInfo key="info" id={dialog.id} onClose={close} />}
      {dialog?.kind === 'addToPlaylist' && <AddToPlaylistModal key={`add-${dialog.playlistId}`} playlistId={dialog.playlistId} onClose={close} />}
      {dialog?.kind === 'metadataMatch' && (
        <MetadataMatchModal key={`meta-${dialog.trackId}-${dialog.tab ?? 'match'}`} trackId={dialog.trackId} initialTab={dialog.tab} onClose={close} />
      )}
      {dialog?.kind === 'batchMetadataMatch' && (
        <BatchMetadataModal key={`bmeta-${dialog.title}`} trackIds={dialog.trackIds} title={dialog.title} onClose={close} />
      )}
      {dialog?.kind === 'audioQuality' && (
        <AudioQualityModal key={`aq-${dialog.trackId ?? 'pick'}-${dialog.tab ?? 'quality'}`} initialTrackId={dialog.trackId} initialTab={dialog.tab} onClose={close} />
      )}
    </AnimatePresence>
  )
}

export function ScanPill() {
  const p = useLibrary((s) => s.progress)
  const show = p && p.phase !== 'done'
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="scan-pill" initial={{ opacity: 0, y: 20, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 20, x: '-50%' }}>
          <Loader2 size={14} className="spin" />
          <span>{p!.phase === 'collect' ? '正在查找音乐文件…' : `正在导入 ${p!.current} / ${p!.total}`}</span>
          {p!.phase === 'parse' && (
            <div className="bar">
              <i style={{ width: `${(p!.current / Math.max(1, p!.total)) * 100}%` }} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function QueuePanel({ onNp = false }: { onNp?: boolean }) {
  const open = useUI((s) => s.queueOpen)
  const toggle = useUI((s) => s.toggleQueue)
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const byId = useLibrary((s) => s.byId)
  const p = usePlayer.getState()
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'center' }), 60)
  }, [open])

  const upcoming = queue.slice(index + 1, index + 301)
  const cur = byId.get(queue[index])

  const item = (id: string, i: number, extra = '') => {
    const t = byId.get(id)
    if (!t) return null
    return (
      <div
        key={`${id}-${i}`}
        className={`qp-item ${extra} ${dragFrom === i ? 'dragging' : ''}`}
        style={dragOver === i && dragFrom !== null && dragFrom !== i ? { boxShadow: `inset 0 ${dragFrom < i ? -2 : 2}px 0 var(--accent)` } : undefined}
        draggable={i !== index}
        onDragStart={() => setDragFrom(i)}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(i)
        }}
        onDragEnd={() => {
          setDragFrom(null)
          setDragOver(null)
        }}
        onDrop={() => {
          if (dragFrom !== null && dragFrom !== i) p.moveInQueue(dragFrom, i)
          setDragFrom(null)
          setDragOver(null)
        }}
        onDoubleClick={() => p.jumpTo(i)}
      >
        <Cover cover={t.cover} iconSize={14} />
        <div className="qp-meta">
          <div className="qp-t">{t.title}</div>
          <div className="qp-a">{t.artist}</div>
        </div>
        {i !== index && (
          <button className="icon-btn qp-x" onClick={() => p.removeAt(i)} title="移除">
            <X size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`queue-panel ${onNp ? 'on-np' : ''}`}
          initial={{ opacity: 0, x: 40, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        >
          <div className="qp-head">
            <h3>播放队列</h3>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" title="清空队列" onClick={p.clearQueue}>
                <Trash2 size={15} />
              </button>
              <button className="icon-btn" onClick={() => toggle(false)}>
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="qp-list" ref={listRef}>
            {cur && (
              <>
                <div className="qp-label">正在播放</div>
                {item(queue[index], index, 'current')}
              </>
            )}
            <div className="qp-label">接下来播放 · {queue.length - index - 1} 首</div>
            {upcoming.map((id, k) => item(id, index + 1 + k))}
            {!upcoming.length && <div style={{ padding: '20px 8px', color: 'var(--text-3)', fontSize: 12.5 }}>队列里没有更多歌曲了</div>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
