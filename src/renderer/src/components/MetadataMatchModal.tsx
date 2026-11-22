import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Search, AlertCircle, Loader2, Tag, Disc3, Check, Pencil, ImagePlus, ImageDown, Languages, RotateCcw } from 'lucide-react'
import type { FallbackTraceEntry, MetadataCandidate, TagWriteRequest, TitleLanguageVariant, Track } from '../../../shared/types'
import { useLibrary } from '../store/library'
import { usePlayer } from '../store/player'
import { useLyrics } from '../store/lyrics'
import { toast } from '../store/ui'
import { Cover } from './Cover'
import { Segmented } from './Controls'
import { fmtTime } from '../lib/format'

type FieldKey = 'title' | 'artist' | 'album' | 'albumArtist' | 'year' | 'trackNo' | 'genre' | 'isrc' | 'coverUrl'

const FIELD_LABELS: Record<FieldKey, string> = {
  title: '曲目标题',
  artist: '艺人',
  album: '专辑',
  albumArtist: '专辑艺人',
  year: '发行年份',
  trackNo: '音轨号',
  genre: '流派',
  isrc: 'ISRC 编码',
  coverUrl: '高清专辑封面'
}

function confidenceBadge(c: MetadataCandidate['confidence'], score: number) {
  const pct = `${Math.round(score * 100)}%`
  if (c === 'high') return { text: `高匹配 · ${pct}`, color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)' }
  if (c === 'medium') return { text: `中匹配 · ${pct}`, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' }
  return { text: `待确认 · ${pct}`, color: 'var(--text-2)', bg: 'var(--surface-hover)' }
}

function traceStatusMeta(status: FallbackTraceEntry['status']) {
  switch (status) {
    case 'hit':
      return { label: '命中', color: '#10b981' }
    case 'miss':
      return { label: '无结果', color: 'var(--text-2)' }
    case 'skipped-cooldown':
      return { label: '熔断冷却中', color: '#f59e0b' }
    case 'disabled':
      return { label: '已禁用', color: 'var(--text-2)' }
    case 'error':
      return { label: '请求失败', color: '#ef4444' }
  }
}

export function MetadataMatchModal({ trackId, initialTab = 'match', onClose }: { trackId: string; initialTab?: 'edit' | 'match'; onClose: () => void }) {
  const tracks = useLibrary((s) => s.tracks)
  const applyLibrary = useLibrary((s) => s.apply)
  const track: Track | undefined = useMemo(() => tracks.find((t) => t.id === trackId), [tracks, trackId])

  const [tab, setTab] = useState<'edit' | 'match'>(initialTab)

  // Manual edit fields
  const [editTitle, setEditTitle] = useState(track?.title ?? '')
  const [editArtist, setEditArtist] = useState(track?.artist ?? '')
  const [editAlbum, setEditAlbum] = useState(track?.album ?? '')
  const [editAlbumArtist, setEditAlbumArtist] = useState(track?.albumArtist ?? '')
  const [editYear, setEditYear] = useState(track?.year ? String(track.year) : '')
  const [editTrackNo, setEditTrackNo] = useState(track?.trackNo ? String(track.trackNo) : '')
  const [editDiscNo, setEditDiscNo] = useState(track?.discNo ? String(track.discNo) : '')
  const [editGenre, setEditGenre] = useState(track?.genre ?? '')
  const [editIsrc, setEditIsrc] = useState(track?.isrc ?? '')
  const [pickedCover, setPickedCover] = useState<{ filePath: string; dataUrl: string } | null>(null)
  const [savingCover, setSavingCover] = useState(false)
  const [variants, setVariants] = useState<TitleLanguageVariant[]>([])
  const [loadingVariants, setLoadingVariants] = useState(false)
  const [alsoApplyVariantMeta, setAlsoApplyVariantMeta] = useState(true)

  // Online match state
  const [titleQ, setTitleQ] = useState(track?.title ?? '')
  const [artistQ, setArtistQ] = useState(track?.artist ?? '')
  const [albumQ, setAlbumQ] = useState(track?.album ?? '')
  const [isrcQ, setIsrcQ] = useState(track?.isrc ?? '')

  const [searching, setSearching] = useState(false)
  const [writing, setWriting] = useState(false)
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([])
  const [trace, setTrace] = useState<FallbackTraceEntry[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [checkedFields, setCheckedFields] = useState<Record<FieldKey, boolean>>({
    title: true,
    artist: true,
    album: true,
    albumArtist: true,
    year: true,
    trackNo: true,
    genre: true,
    isrc: true,
    coverUrl: true
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loadVariants = async () => {
    if (!track) return
    setLoadingVariants(true)
    try {
      const list = await window.kaze.metadata.titleVariants({
        title: editTitle.trim() || track.title,
        artist: editArtist.trim() || track.artist,
        album: editAlbum.trim() || track.album,
        duration: track.duration || undefined
      })
      setVariants(list)
      if (!list.length) toast('未检索到其他语种的对应原曲名')
    } catch {
      toast('多语种原名检索失败', 'error')
    } finally {
      setLoadingVariants(false)
    }
  }

  const runSearch = async () => {
    if (!track) return
    setSearching(true)
    try {
      const res = await window.kaze.metadata.search({
        title: titleQ.trim() || track.title,
        artist: artistQ.trim(),
        album: albumQ.trim() || undefined,
        duration: track.duration || undefined,
        isrc: isrcQ.trim() || undefined
      })
      setCandidates(res.candidates)
      setTrace(res.trace)
      setSelectedIdx(0)
    } catch (e) {
      toast(e instanceof Error ? e.message : '元数据检索失败', 'error')
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    if (!track) return
    if (tab === 'match' && candidates.length === 0 && !searching) void runSearch()
    if (tab === 'edit' && variants.length === 0 && !loadingVariants) void loadVariants()
  }, [track?.id, tab])

  const selected = candidates[selectedIdx]

  useEffect(() => {
    if (!selected || !track) return
    setCheckedFields({
      title: Boolean(selected.title && selected.title !== track.title),
      artist: Boolean(selected.artist && selected.artist !== track.artist),
      album: Boolean(selected.album && selected.album !== track.album),
      albumArtist: Boolean(selected.albumArtist && selected.albumArtist !== track.albumArtist),
      year: Boolean(selected.year && selected.year !== track.year),
      trackNo: Boolean(selected.trackNo && selected.trackNo !== track.trackNo),
      genre: Boolean(selected.genre && selected.genre !== track.genre),
      isrc: Boolean(selected.isrc && selected.isrc !== track.isrc),
      coverUrl: Boolean(selected.coverUrl)
    })
  }, [selected?.id, selected?.source])

  if (!track) return null

  const toggleField = (k: FieldKey) => setCheckedFields((prev) => ({ ...prev, [k]: !prev[k] }))

  const handleWrite = async () => {
    if (!selected) return
    const req: TagWriteRequest = { trackId: track.id }
    if (checkedFields.title && selected.title) req.title = selected.title
    if (checkedFields.artist && selected.artist) req.artist = selected.artist
    if (checkedFields.album && selected.album) req.album = selected.album
    if (checkedFields.albumArtist && selected.albumArtist) req.albumArtist = selected.albumArtist
    if (checkedFields.year && selected.year) req.year = selected.year
    if (checkedFields.trackNo && selected.trackNo) req.trackNo = selected.trackNo
    if (checkedFields.genre && selected.genre) req.genre = selected.genre
    if (checkedFields.isrc && selected.isrc) req.isrc = selected.isrc
    if (checkedFields.coverUrl && selected.coverUrl) req.coverUrl = selected.coverUrl

    if (Object.keys(req).length <= 1) {
      toast('请至少勾选一项要写入的标签或封面', 'info')
      return
    }

    setWriting(true)
    try {
      const res = await window.kaze.metadata.writeTags(req)
      if (!res.ok) {
        toast(res.error ?? '标签写入失败', 'error')
        return
      }
      const lib = await window.kaze.library.get()
      applyLibrary(lib)
      toast(res.coverUpdated ? '标签与高清封面已封装写入音频文件' : '音频文件标签已更新', 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '标签封装失败', 'error')
    } finally {
      setWriting(false)
    }
  }

  const handleSaveManual = async () => {
    if (!track) return
    const req: TagWriteRequest = {
      trackId: track.id,
      title: editTitle.trim() || undefined,
      artist: editArtist.trim() || undefined,
      album: editAlbum.trim() || undefined,
      albumArtist: editAlbumArtist.trim() || undefined,
      year: editYear.trim() ? parseInt(editYear.trim(), 10) || undefined : undefined,
      trackNo: editTrackNo.trim() ? parseInt(editTrackNo.trim(), 10) || undefined : undefined,
      discNo: editDiscNo.trim() ? parseInt(editDiscNo.trim(), 10) || undefined : undefined,
      genre: editGenre.trim() || undefined,
      isrc: editIsrc.trim() || undefined,
      coverPath: pickedCover?.filePath
    }
    setWriting(true)
    try {
      const res = await window.kaze.metadata.writeTags(req)
      if (!res.ok) {
        toast(res.error ?? '保存标签失败', 'error')
        return
      }
      const lib = await window.kaze.library.get()
      applyLibrary(lib)
      if (usePlayer.getState().currentId === track.id && res.track) {
        void useLyrics.getState().load(res.track, true)
      }
      toast(res.coverUpdated ? '标签与新封面已写入音频文件' : '音频文件标签已保存', 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : '写入失败', 'error')
    } finally {
      setWriting(false)
    }
  }

  const diffRows: Array<{ key: FieldKey; current: string; incoming?: string }> = selected
    ? [
        { key: 'title', current: track.title || '—', incoming: selected.title },
        { key: 'artist', current: track.artist || '—', incoming: selected.artist },
        { key: 'album', current: track.album || '—', incoming: selected.album },
        { key: 'albumArtist', current: track.albumArtist || '—', incoming: selected.albumArtist },
        { key: 'year', current: track.year ? String(track.year) : '—', incoming: selected.year ? String(selected.year) : undefined },
        { key: 'trackNo', current: track.trackNo ? String(track.trackNo) : '—', incoming: selected.trackNo ? String(selected.trackNo) : undefined },
        { key: 'genre', current: track.genre || '—', incoming: selected.genre },
        { key: 'isrc', current: track.isrc || '—', incoming: selected.isrc }
      ]
    : []

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        className="modal"
        style={{ width: 840, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {tab === 'edit' ? <Pencil size={17} /> : <Tag size={18} />}
              {tab === 'edit' ? '编辑歌曲标签与封面' : '高准确度元数据匹配与标签封装'}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              {tab === 'edit'
                ? '手动修改歌曲标签、更换或另存专辑封面，并支持多语种原曲歌名一键替换写入文件'
                : '基于标题、多艺人、专辑、时长误差与 ISRC 多维置信度评分，并封装写入本地音频文件'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Segmented<'edit' | 'match'>
              layoutId="meta-modal-tab"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'edit', label: '手动编辑' },
                { value: 'match', label: '智能匹配' }
              ]}
            />
            <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        {tab === 'edit' ? (
          <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, paddingRight: 4 }}>
            {/* Left: Cover preview + Replace / Export Cover */}
            <div className="glass-surface" style={{ padding: 14, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 184,
                  height: 184,
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--sep)',
                  background: 'var(--surface)'
                }}
              >
                {pickedCover ? (
                  <img src={pickedCover.dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Cover cover={track.cover} iconSize={52} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
                )}
              </div>
              <button
                className="btn primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={async () => {
                  const res = await window.kaze.metadata.pickCover()
                  if (res) setPickedCover(res)
                }}
              >
                <ImagePlus size={14} />
                <span style={{ marginLeft: 5 }}>更换专辑封面…</span>
              </button>
              {pickedCover && (
                <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setPickedCover(null)}>
                  <RotateCcw size={13} />
                  <span style={{ marginLeft: 5 }}>撤销替换</span>
                </button>
              )}
              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={savingCover}
                onClick={async () => {
                  setSavingCover(true)
                  try {
                    const res = await window.kaze.metadata.saveCover(track.id)
                    if (res.canceled) return
                    if (res.ok) toast('专辑封面已保存', 'success')
                    else toast(res.error ?? '导出失败', 'error')
                  } finally {
                    setSavingCover(false)
                  }
                }}
              >
                <ImageDown size={14} />
                <span style={{ marginLeft: 5 }}>{savingCover ? '正在导出…' : '另存专辑封面…'}</span>
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.45 }}>
                支持 JPG / PNG / WebP / BMP，保存后会直接封套写入音频文件内嵌 Cover 标签
              </div>
            </div>

            {/* Right: Multilingual title switcher + editable tag fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <div className="glass-surface" style={{ padding: 12, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Languages size={14} />
                    <span>多语种原曲名一键替换（如英文换回日语/中文）</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ fontSize: 11.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={alsoApplyVariantMeta} onChange={(e) => setAlsoApplyVariantMeta(e.target.checked)} />
                      <span>同步替换艺人/专辑</span>
                    </label>
                    <button className="btn" onClick={() => void loadVariants()} disabled={loadingVariants} style={{ height: 26, fontSize: 11.5 }}>
                      {loadingVariants ? <Loader2 size={12} className="spin" /> : <Search size={12} />}
                      <span style={{ marginLeft: 4 }}>重新检索</span>
                    </button>
                  </div>
                </div>
                {loadingVariants && variants.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                    <Loader2 size={13} className="spin" />
                    <span>正在检索日区/中区/国际区对应曲名…</span>
                  </div>
                ) : variants.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {variants.map((v, i) => (
                      <button
                        key={`${v.lang}-${v.title}-${i}`}
                        type="button"
                        className="btn"
                        style={{
                          height: 'auto',
                          padding: '5px 10px',
                          fontSize: 12,
                          textAlign: 'left',
                          border: editTitle === v.title ? '1px solid var(--accent)' : '1px solid var(--sep)',
                          background: editTitle === v.title ? 'rgba(var(--accent-rgb), 0.14)' : undefined
                        }}
                        title={`${v.source}${v.artist ? ` · ${v.artist}` : ''}${v.album ? ` · ${v.album}` : ''}`}
                        onClick={() => {
                          setEditTitle(v.title)
                          if (alsoApplyVariantMeta) {
                            if (v.artist) setEditArtist(v.artist)
                            if (v.album) setEditAlbum(v.album)
                          }
                          toast(`已填入${v.langLabel}「${v.title}」`)
                        }}
                      >
                        <span style={{ opacity: 0.7, fontSize: 10.5, marginRight: 5 }}>[{v.langLabel}]</span>
                        <span style={{ fontWeight: 600 }}>{v.title}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无其他语种候选，可在下方直接手动输入或切换到「智能匹配」查找。</div>
                )}
              </div>

              <div className="glass-surface" style={{ padding: 14, borderRadius: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>歌曲标题</span>
                  <input className="text-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>艺人（多艺人可用 / 分隔）</span>
                  <input className="text-input" value={editArtist} onChange={(e) => setEditArtist(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>专辑</span>
                  <input className="text-input" value={editAlbum} onChange={(e) => setEditAlbum(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>专辑艺人</span>
                  <input className="text-input" value={editAlbumArtist} onChange={(e) => setEditAlbumArtist(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>流派</span>
                  <input className="text-input" value={editGenre} onChange={(e) => setEditGenre(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>发行年份</span>
                  <input className="text-input" value={editYear} onChange={(e) => setEditYear(e.target.value)} placeholder="如 2022" />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-2)' }}>音轨号</span>
                    <input className="text-input" value={editTrackNo} onChange={(e) => setEditTrackNo(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-2)' }}>碟片号</span>
                    <input className="text-input" value={editDiscNo} onChange={(e) => setEditDiscNo(e.target.value)} />
                  </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-2)' }}>ISRC 编码</span>
                  <input className="text-input" value={editIsrc} onChange={(e) => setEditIsrc(e.target.value)} />
                </label>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Search Toolbar */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 0.9fr auto', gap: 8 }}>
          <input className="text-input" placeholder="曲目标题" value={titleQ} onChange={(e) => setTitleQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()} />
          <input className="text-input" placeholder="艺人" value={artistQ} onChange={(e) => setArtistQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()} />
          <input className="text-input" placeholder="专辑（可选）" value={albumQ} onChange={(e) => setAlbumQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()} />
          <input className="text-input" placeholder="ISRC（精准锚点）" value={isrcQ} onChange={(e) => setIsrcQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runSearch()} />
          <button className="btn primary" onClick={runSearch} disabled={searching} style={{ height: 34, whiteSpace: 'nowrap' }}>
            {searching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
            <span style={{ marginLeft: 5 }}>匹配检索</span>
          </button>
        </div>

        {/* Fallback Chain Trace */}
        {trace.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5 }}>
            <span style={{ color: 'var(--text-2)' }}>Fallback 链追踪：</span>
            {trace.map((item, idx) => {
              const st = traceStatusMeta(item.status)
              return (
                <span
                  key={`${item.providerId}-${idx}`}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'var(--surface)',
                    border: '1px solid var(--sep)',
                    color: 'var(--text-1)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5
                  }}
                  title={item.message}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color }} />
                  <span>{item.providerName}</span>
                  <span style={{ color: st.color }}>
                    {st.label}
                    {typeof item.count === 'number' ? `(${item.count})` : ''} · {item.latencyMs}ms
                  </span>
                </span>
              )
            })}
          </div>
        )}

        {/* Main Split Content */}
        <div style={{ flex: 1, minHeight: 280, overflow: 'hidden', display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 }}>
          {/* Candidate List */}
          <div
            style={{
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingRight: 4
            }}
          >
            {searching && candidates.length === 0 && (
              <div style={{ padding: '48px 12px', textAlign: 'center', color: 'var(--text-2)', fontSize: 12.5 }}>
                <Loader2 size={20} className="spin" style={{ marginBottom: 8 }} />
                <div>正在按 Fallback 优先级检索权威元数据…</div>
              </div>
            )}

            {!searching && candidates.length === 0 && (
              <div style={{ padding: '44px 12px', textAlign: 'center', color: 'var(--text-2)', fontSize: 12.5 }}>
                未找到匹配候选。请尝试精简标题括号或仅保留主艺人后重新检索。
              </div>
            )}

            {candidates.map((c, idx) => {
              const active = idx === selectedIdx
              const badge = confidenceBadge(c.confidence, c.score)
              return (
                <button
                  key={`${c.source}-${c.id}`}
                  onClick={() => setSelectedIdx(idx)}
                  className={`modal-list-row ${active ? 'on' : ''}`}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    color: 'inherit'
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 7,
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'var(--surface-hover)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {c.coverUrl ? (
                      <img src={c.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Disc3 size={18} style={{ opacity: 0.45 }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 6,
                          color: badge.color,
                          background: badge.bg
                        }}
                      >
                        {badge.text}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{c.sourceName}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.artist} · {c.album || '未知专辑'}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-2)', marginTop: 3 }}>
                      {c.duration ? `${fmtTime(c.duration)} · ` : ''}
                      {c.year ? `${c.year} · ` : ''}
                      {c.isrc ? `ISRC ${c.isrc}` : `维度分 标${Math.round(c.breakdown.title * 100)}/艺${Math.round(c.breakdown.artist * 100)}/时${Math.round(c.breakdown.duration * 100)}`}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Diff & Tag Encapsulation Editor */}
          <div
            className="glass-surface"
            style={{
              overflowY: 'auto',
              padding: 12,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            {selected ? (
              <>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--sep)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10.5, color: 'var(--text-2)', marginBottom: 4 }}>当前本地封面</div>
                    <Cover cover={track.cover} style={{ width: 64, height: 64, borderRadius: 8 }} />
                  </div>
                  <div style={{ fontSize: 18, color: 'var(--text-2)' }}>→</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: selected.coverUrl ? 'pointer' : 'default', flex: 1 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--text-2)', marginBottom: 4 }}>候选高清封面</div>
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: 'var(--surface-hover)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid var(--sep)'
                        }}
                      >
                        {selected.coverUrl ? (
                          <img src={selected.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-2)' }}>无封面</span>
                        )}
                      </div>
                    </div>
                    {selected.coverUrl && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                        <input type="checkbox" checked={checkedFields.coverUrl} onChange={() => toggleField('coverUrl')} />
                        <span>写入 FrontCover 封套图片</span>
                      </div>
                    )}
                  </label>
                </div>

                {/* Multi-dimension Breakdown Pills */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
                  <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--surface-hover)' }}>
                    标题 {Math.round(selected.breakdown.title * 100)}%
                  </span>
                  <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--surface-hover)' }}>
                    艺人 {Math.round(selected.breakdown.artist * 100)}%
                  </span>
                  <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--surface-hover)' }}>
                    专辑 {Math.round(selected.breakdown.album * 100)}%
                  </span>
                  <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--surface-hover)' }}>
                    时长 {Math.round(selected.breakdown.duration * 100)}%
                  </span>
                  <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--surface-hover)' }}>
                    ISRC {selected.breakdown.isrc > 0 ? '精准命中' : '无/未比对'}
                  </span>
                </div>

                {/* Tag Diff Rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {diffRows.map((row) => {
                    const hasValue = Boolean(row.incoming)
                    return (
                      <label
                        key={row.key}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '22px 76px 1fr 18px 1fr',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: 12.5,
                          padding: '6px 8px',
                          borderRadius: 8,
                          background: hasValue && checkedFields[row.key] ? 'rgba(59,130,246,0.08)' : 'transparent',
                          opacity: hasValue ? 1 : 0.5,
                          cursor: hasValue ? 'pointer' : 'default'
                        }}
                      >
                        <input type="checkbox" disabled={!hasValue} checked={hasValue && checkedFields[row.key]} onChange={() => toggleField(row.key)} />
                        <span style={{ color: 'var(--text-2)' }}>{FIELD_LABELS[row.key]}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }} title={row.current}>
                          {row.current}
                        </span>
                        <span style={{ color: 'var(--text-2)', textAlign: 'center' }}>→</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: hasValue ? 600 : 400 }} title={row.incoming ?? '—'}>
                          {row.incoming ?? '—'}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </>
            ) : (
              <div style={{ padding: '56px 16px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
                <AlertCircle size={20} style={{ marginBottom: 8, opacity: 0.7 }} />
                <div>从左侧选择一个候选结果以预览待封装的标签差异。</div>
              </div>
            )}
          </div>
        </div>
          </>
        )}

        <div className="modal-actions" style={{ marginTop: 0, justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '58%' }} title={track.path}>
            文件：{track.path}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              取消
            </button>
            {tab === 'edit' ? (
              <button className="btn primary" disabled={writing} onClick={handleSaveManual}>
                {writing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                <span style={{ marginLeft: 5 }}>{writing ? '正在写入文件…' : '保存并写入文件'}</span>
              </button>
            ) : (
              <button className="btn primary" disabled={!selected || writing} onClick={handleWrite}>
                {writing ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                <span style={{ marginLeft: 5 }}>{writing ? '正在写入封装…' : '封装写入文件'}</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
