import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Search, Loader2, Download, FileText, RotateCcw, Minus, Plus, Check, Globe2, Languages } from 'lucide-react'
import type { LyricCandidate, Track } from '../../../shared/types'
import { useLyrics } from '../store/lyrics'
import { useUI, toast } from '../store/ui'
import { useUser } from '../store/user'
import { useSettings } from '../store/settings'
import { Switch } from '../components/Controls'
import { fmtTime } from '../lib/format'

const SOURCE_LABEL: Record<string, string> = {
  embedded: '内嵌歌词',
  sidecar: '本地 .lrc',
  netease: '网易云音乐',
  lrclib: 'LRCLIB',
  kugou: '酷狗音乐'
}

export function LyricsPanel({ t }: { t: Track }) {
  const open = useUI((s) => s.lyricsPanel)
  const setOpen = useUI((s) => s.setLyricsPanel)
  const { payload, online, lyrics, status, saving, romanizing } = useLyrics()
  const offset = useUser((s) => s.lyricOffsets[t.id] ?? 0)
  const setOffset = useUser((s) => s.setOffset)
  const settings = useSettings()
  const [title, setTitle] = useState(t.title)
  const [artist, setArtist] = useState(t.artist)
  const [results, setResults] = useState<LyricCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)

  useEffect(() => {
    setTitle(t.title)
    setArtist(/未知/.test(t.artist) ? '' : t.artist)
    setResults(null)
  }, [t.id])

  const search = async () => {
    setSearching(true)
    try {
      const r = await window.akumy.lyrics.search({ title, artist, album: t.album, duration: t.duration })
      setResults(r)
      if (!r.length) toast('没有找到匹配的歌词')
    } catch {
      toast('搜索失败，请检查网络连接', 'error')
    } finally {
      setSearching(false)
    }
  }

  const apply = async (c: LyricCandidate) => {
    const key = c.source + c.id
    setApplying(key)
    try {
      const p = await window.akumy.lyrics.fetch(c)
      if (!p) {
        toast('该来源没有可用歌词', 'error')
        return
      }
      await useLyrics.getState().applyPayload(t, p, true)
      setOffset(t.id, 0)
      toast(`已应用来自${SOURCE_LABEL[c.source]}的歌词`, 'success')
    } catch {
      toast('获取歌词失败', 'error')
    } finally {
      setApplying(null)
    }
  }

  const curKey = payload?.candidate ? payload.candidate.source + payload.candidate.id : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lyrics-panel"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        >
          <div className="qp-head">
            <h3>歌词</h3>
            <button className="icon-btn" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="lp-body">
            <div className="lp-card">
              <div className="lp-row">
                <span className="lp-label">当前来源</span>
                <span>
                  {status === 'loading' ? '加载中…' : payload ? SOURCE_LABEL[payload.source] : '无'}
                  {online && <span className="lp-tag">未保存</span>}
                </span>
              </div>
              {lyrics && (
                <div className="lp-row">
                  <span className="lp-label">内容</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {lyrics.synced ? '逐行同步' : '纯文本'}
                    {lyrics.hasTrans && <span className="lp-tag ok">翻译</span>}
                    {lyrics.hasRoma && <span className="lp-tag ok">罗马音</span>}
                    {romanizing && <Loader2 size={12} className="spin" />}
                  </span>
                </div>
              )}
              <div className="lp-row">
                <span className="lp-label">时间偏移</span>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button className="icon-btn" onClick={() => setOffset(t.id, offset - 500)} title="歌词提前 0.5 秒">
                    <Minus size={14} />
                  </button>
                  <span style={{ width: 52, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    {offset > 0 ? '+' : ''}
                    {(offset / 1000).toFixed(1)}s
                  </span>
                  <button className="icon-btn" onClick={() => setOffset(t.id, offset + 500)} title="歌词延后 0.5 秒">
                    <Plus size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => setOffset(t.id, 0)} title="重置">
                    <RotateCcw size={13} />
                  </button>
                </span>
              </div>
              <div className="lp-row">
                <span className="lp-label">
                  <Languages size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  显示罗马音
                </span>
                <Switch on={settings.showRoma} onChange={(v) => settings.set({ showRoma: v })} />
              </div>
              <div className="lp-row">
                <span className="lp-label">显示翻译</span>
                <Switch on={settings.showTrans} onChange={(v) => settings.set({ showTrans: v })} />
              </div>
            </div>

            {lyrics && (
              <div className="lp-card">
                <div className="lp-section">保存到本地</div>
                <div className="lp-row">
                  <span className="lp-label">包含罗马音</span>
                  <Switch on={settings.saveRoma} onChange={(v) => settings.set({ saveRoma: v })} />
                </div>
                <div className="lp-row">
                  <span className="lp-label">包含翻译</span>
                  <Switch on={settings.saveTrans} onChange={(v) => settings.set({ saveTrans: v })} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="np-pill solid" disabled={saving} onClick={() => useLyrics.getState().save('embed')} style={{ flex: 1 }}>
                    {saving ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                    嵌入音乐文件
                  </button>
                  <button className="np-pill" disabled={saving} onClick={() => useLyrics.getState().save('sidecar')} style={{ flex: 1 }}>
                    <FileText size={13} />
                    保存 .lrc
                  </button>
                </div>
                <div className="lp-hint">嵌入会把 LRC 歌词写入文件标签（MP3 USLT / FLAC LYRICS / M4A ©lyr），日语歌会同时写入罗马音行。</div>
              </div>
            )}

            <div className="lp-card">
              <div className="lp-section">
                <Globe2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                搜索在线歌词
              </div>
              <input className="lp-input" placeholder="歌曲名" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <input className="lp-input" placeholder="艺人（可选）" value={artist} onChange={(e) => setArtist(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="np-pill solid" onClick={search} disabled={searching || !title.trim()} style={{ flex: 1 }}>
                  {searching ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                  搜索
                </button>
                <button className="np-pill" onClick={() => useLyrics.getState().load(t, true)} title="忽略本地歌词，自动匹配在线歌词">
                  <RotateCcw size={13} />
                  自动匹配
                </button>
              </div>
              {results && (
                <div className="lp-results">
                  {results.map((c) => {
                    const key = c.source + c.id
                    return (
                      <button key={key} className={`lp-result ${curKey === key ? 'on' : ''}`} onClick={() => apply(c)} disabled={!!applying}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="lp-r-title">{c.title}</div>
                          <div className="lp-r-sub">
                            {c.artist}
                            {c.album ? ` · ${c.album}` : ''}
                          </div>
                          <div className="lp-r-meta">
                            <span className={`lp-src ${c.source}`}>{SOURCE_LABEL[c.source]}</span>
                            {c.duration ? <span>{fmtTime(c.duration)}</span> : null}
                            {c.synced === false && <span>纯文本</span>}
                            <span>匹配 {Math.round((c.score ?? 0) * 100)}%</span>
                          </div>
                        </div>
                        {applying === key ? <Loader2 size={14} className="spin" /> : curKey === key ? <Check size={14} /> : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
