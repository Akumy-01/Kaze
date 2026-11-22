import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Search, Loader2, Download, FileText, RotateCcw, Minus, Plus, Check, Globe2, Languages } from 'lucide-react'
import type { LyricCandidate, OnlineLyricSource, Track } from '../../../shared/types'
import { useLyrics } from '../store/lyrics'
import { useUI, toast } from '../store/ui'
import { useUser } from '../store/user'
import { useSettings } from '../store/settings'
import { Segmented, Switch } from '../components/Controls'
import { fmtTime } from '../lib/format'

const SOURCE_LABEL: Record<string, string> = {
  embedded: '内嵌歌词',
  sidecar: '本地 .lrc',
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  lrclib: 'LRCLIB',
  lyricsplus: 'Apple / Musixmatch',
  lyricsovh: 'Lyrics.ovh'
}

export function LyricsPanel({ t }: { t: Track }) {
  const open = useUI((s) => s.lyricsPanel)
  const setOpen = useUI((s) => s.setLyricsPanel)
  const { payload, online, lyrics, status, saving, romanizing, searchCacheEntry, recordSearchResults } = useLyrics()
  const offset = useUser((s) => s.lyricOffsets[t.id] ?? 0)
  const setOffset = useUser((s) => s.setOffset)
  const settings = useSettings()
  const [title, setTitle] = useState(t.title)
  const [artist, setArtist] = useState(/未知/.test(t.artist) ? '' : t.artist)
  const [source, setSource] = useState<OnlineLyricSource>('all')
  const [searching, setSearching] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)

  useEffect(() => {
    setTitle(t.title)
    setArtist(/未知/.test(t.artist) ? '' : t.artist)
    setSource('all')
  }, [t.id])

  const search = async (overrideSource?: OnlineLyricSource) => {
    if (!title.trim()) return
    const activeSource = overrideSource ?? source
    setSearching(true)
    try {
      const r = await window.kaze.lyrics.search({
        title,
        artist,
        album: t.album,
        duration: t.duration,
        source: activeSource
      })
      recordSearchResults(t.id, title.trim(), artist.trim(), activeSource, r, true)
      if (!r.length) toast('没有找到匹配的歌词')
    } catch {
      toast('搜索失败，请检查网络连接', 'error')
    } finally {
      setSearching(false)
    }
  }

  const onSourceChange = (nextSource: OnlineLyricSource) => {
    setSource(nextSource)
    // Filter cached "全部" / prior search results locally with zero duplicate network requests!
    // Only trigger a fresh search if this query hasn't been fetched yet at all or for this unsearched single source.
    const sameQuery =
      searchCacheEntry &&
      searchCacheEntry.title === title.trim() &&
      searchCacheEntry.artist === artist.trim()
    const alreadyCovered =
      sameQuery &&
      (searchCacheEntry.searchedAll || searchCacheEntry.searchedSources.includes(nextSource))
    if (!alreadyCovered && nextSource !== 'all' && sameQuery && title.trim() && !searching) {
      void search(nextSource)
    }
  }

  const allCached = searchCacheEntry?.candidates ?? []
  const filteredResults =
    searchCacheEntry
      ? source === 'all'
        ? allCached
        : allCached.filter((c) => c.source === source)
      : null

  const apply = async (c: LyricCandidate) => {
    const key = c.source + c.id
    setApplying(key)
    try {
      const p = await window.kaze.lyrics.fetch(c)
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
              {lyrics && !lyrics.hasTrans && (
                <button
                  className="np-pill"
                  style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
                  onClick={() => void useLyrics.getState().translateCurrent()}
                >
                  <Languages size={13} />
                  当前歌词无译文 · 一键生成中文翻译
                </button>
              )}
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
              <div className="lp-source-seg">
                <Segmented<OnlineLyricSource>
                  layoutId="lp-online-source"
                  value={source}
                  onChange={onSourceChange}
                  options={[
                    { value: 'all', label: '全部' },
                    { value: 'netease', label: '网易云' },
                    { value: 'qq', label: 'QQ音乐' },
                    { value: 'lrclib', label: 'LRCLIB' },
                    { value: 'lyricsplus', label: 'Apple/MXM' }
                  ]}
                />
              </div>
              {searchCacheEntry && allCached.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.58)' }}>
                  <span>已缓存 {allCached.length} 条：</span>
                  {(['netease', 'qq', 'lrclib', 'lyricsplus'] as const).map((srcKey) => {
                    const cnt = allCached.filter((c) => c.source === srcKey).length
                    const label = srcKey === 'netease' ? '网易云' : srcKey === 'qq' ? 'QQ' : srcKey === 'lrclib' ? 'LRCLIB' : 'Apple/MXM'
                    return (
                      <button
                        key={srcKey}
                        type="button"
                        onClick={() => onSourceChange(srcKey)}
                        style={{
                          padding: 0,
                          color: source === srcKey ? '#fff' : cnt > 0 ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.35)',
                          fontWeight: source === srcKey ? 600 : 400,
                          cursor: 'pointer'
                        }}
                      >
                        {label} {cnt}
                      </button>
                    )
                  })}
                </div>
              )}
              <input className="lp-input" placeholder="歌曲名" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <input className="lp-input" placeholder="艺人（可选）" value={artist} onChange={(e) => setArtist(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="np-pill solid" onClick={() => search()} disabled={searching || !title.trim()} style={{ flex: 1 }}>
                  {searching ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                  搜索
                </button>
                <button className="np-pill" onClick={() => useLyrics.getState().load(t, true)} title="忽略本地歌词，自动匹配在线歌词">
                  <RotateCcw size={13} />
                  自动匹配
                </button>
              </div>
              {filteredResults && (
                <div className="lp-results">
                  {filteredResults.length === 0 ? (
                    <div style={{ padding: '14px 10px', textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                      该来源在本次检索中暂无匹配结果
                    </div>
                  ) : (
                    filteredResults.map((c) => {
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
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
