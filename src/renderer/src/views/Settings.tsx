import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Sun, Moon, Monitor, Check, ImagePlus, FolderPlus, RefreshCw, X, Disc3, Sparkles, ExternalLink, Palette, Image as ImageIcon, Square, Download, Upload } from 'lucide-react'
import { useSettings, ACCENTS, type BgType, type NpMode, type SaveMode } from '../store/settings'
import { useLibrary } from '../store/library'
import { useUser } from '../store/user'
import { useUI, toast } from '../store/ui'
import { Segmented, Slider, Switch } from '../components/Controls'
import { AudioSettingsSection } from '../components/AudioSettingsSection'
import { ProviderSettingsSection } from '../components/ProviderSettingsSection'
import { DESKTOP_LYRICS_ANIMS, DESKTOP_LYRICS_COLORS } from '../components/FloatingWindows'
import { LogoMark, DEFAULT_LOGO_URL } from '../components/Cover'
import { importFolder } from './Library'
import type { DesktopLyricsAnimation } from '../../../shared/types'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 8px 14px' }}>{title}</div>
      <div className="settings-group-card">{children}</div>
    </section>
  )
}

function Row({ label, desc, children, column }: { label: ReactNode; desc?: ReactNode; children?: ReactNode; column?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: column ? 'column' : 'row',
        alignItems: column ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: column ? 12 : 20,
        padding: '12px 16px',
        minHeight: 48
      }}
      className="settings-row"
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
      {children}
    </div>
  )
}

function ModeCard({ mode, icon, title, desc }: { mode: NpMode; icon: ReactNode; title: string; desc: string }) {
  const { npMode, set } = useSettings()
  const curMode: NpMode = (npMode as string) === 'apple' ? 'lyric' : npMode
  const on = curMode === mode
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => set({ npMode: mode })}
      className={`settings-subcard ${on ? 'on' : ''}`}
    >
      <div style={{ color: 'var(--accent)' }}>{icon}</div>
      <div style={{ fontWeight: 600, marginTop: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
    </motion.button>
  )
}

type SettingsTab = 'appearance' | 'audio' | 'lyrics' | 'library'

export function SettingsView() {
  const s = useSettings()
  const folders = useLibrary((st) => st.folders)
  const count = useLibrary((st) => st.tracks.length)
  const [version, setVersion] = useState('')
  const [custom, setCustom] = useState(s.accent)
  const [tab, setTab] = useState<SettingsTab>('appearance')
  useEffect(() => {
    window.kaze.version().then(setVersion)
  }, [])

  const pickWallpaper = async () => {
    const url = await window.kaze.pickWallpaper()
    if (url) s.set({ wallpaper: url, bgType: 'image' })
  }

  return (
    <div className="page" style={{ maxWidth: 840 }}>
      <div className="page-header" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          设置
        </h1>
        <Segmented<SettingsTab>
          layoutId="seg-settings-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'appearance', label: '外观与界面' },
            { value: 'audio', label: '音频与频谱' },
            { value: 'lyrics', label: '歌词与音源' },
            { value: 'library', label: '曲库与备份' }
          ]}
        />
      </div>

      {tab === 'appearance' && (
        <>
          <Group title="外观">
        <Row label="主题">
          <Segmented
            layoutId="seg-theme"
            value={s.themeMode}
            onChange={(v) => s.set({ themeMode: v })}
            options={[
              { value: 'light', label: <><Sun size={13} />浅色</> },
              { value: 'dark', label: <><Moon size={13} />深色</> },
              { value: 'system', label: <><Monitor size={13} />跟随系统</> }
            ]}
          />
        </Row>
        <Row label="主题色" desc="用于按钮、高亮、图标等强调元素" column>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {ACCENTS.map((a) => (
              <motion.button
                key={a.value}
                title={a.name}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => s.set({ accent: a.value })}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: a.value,
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: s.accent === a.value ? `0 0 0 2px var(--bg-solid), 0 0 0 4px ${a.value}` : 'inset 0 0 0 0.5px rgba(0,0,0,.15)'
                }}
              >
                {s.accent === a.value && <Check size={14} color="#fff" strokeWidth={3} />}
              </motion.button>
            ))}
            <label
              title="自定义颜色"
              style={{
                position: 'relative',
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                boxShadow: !ACCENTS.some((a) => a.value === s.accent) ? `0 0 0 2px var(--bg-solid), 0 0 0 4px ${s.accent}` : undefined
              }}
            >
              <input
                type="color"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value)
                  s.set({ accent: e.target.value })
                }}
                style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              />
            </label>
          </div>
        </Row>
        <Row label="背景" desc="可选纯色、主题色渐变、自定义图片壁纸，或跟随当前播放的专辑封面" column>
          <Segmented<BgType>
            layoutId="seg-bg"
            value={s.bgType}
            onChange={(v) => {
              if (v === 'image' && !s.wallpaper) pickWallpaper()
              else s.set({ bgType: v })
            }}
            options={[
              { value: 'default', label: <><Square size={13} />默认</> },
              { value: 'accent', label: <><Palette size={13} />主题色</> },
              { value: 'image', label: <><ImageIcon size={13} />图片壁纸</> },
              { value: 'cover', label: <><Disc3 size={13} />专辑封面</> }
            ]}
          />
          {s.bgType === 'image' && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div
                style={{
                  width: 160,
                  height: 96,
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: 'var(--fill)',
                  position: 'relative',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                {s.wallpaper && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: -10,
                      backgroundImage: `url("${s.wallpaper}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      filter: `blur(${s.blur / 4}px)`
                    }}
                  />
                )}
                <div style={{ position: 'absolute', inset: 0, background: `rgba(var(--dim-color), ${s.dim / 100})` }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn" onClick={pickWallpaper}>
                  <ImagePlus size={14} />
                  更换图片
                </button>
                {s.wallpaper && (
                  <button className="btn ghost" onClick={() => s.set({ wallpaper: null, bgType: 'default' })}>
                    <X size={14} />
                    移除壁纸
                  </button>
                )}
              </div>
            </div>
          )}
        </Row>
        {(s.bgType === 'image' || s.bgType === 'cover') && (
          <>
            <Row label="高斯模糊" desc={`${s.blur}px`}>
              <div style={{ width: 240, display: 'flex' }}>
                <Slider value={s.blur} max={80} onChange={(v) => s.set({ blur: Math.round(v) })} className="accent" thumb />
              </div>
            </Row>
            <Row label="遮罩浓度" desc={`${s.dim}% — 保证文字清晰可读`}>
              <div style={{ width: 240, display: 'flex' }}>
                <Slider value={s.dim} max={90} onChange={(v) => s.set({ dim: Math.round(v) })} className="accent" thumb />
              </div>
            </Row>
          </>
        )}
        <Row label="窗口按钮样式">
          <Segmented
            layoutId="seg-winctrl"
            value={s.windowControls}
            onChange={(v) => s.set({ windowControls: v })}
            options={[
              { value: 'mac', label: '经典圆点' },
              { value: 'windows', label: 'Windows 风格' }
            ]}
          />
        </Row>
        <Row label="减弱动态效果" desc="关闭大部分过渡动画，适合低配置设备">
          <Switch on={s.reduceMotion} onChange={(v) => s.set({ reduceMotion: v })} />
        </Row>
      </Group>

      <Group title="播放界面">
        <div style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid var(--sep)' }}>
          <ModeCard mode="lyric" icon={<LogoMark size={20} />} title="灵动歌词" desc="流动封面背景 + 弹性滚动歌词" />
          <ModeCard mode="vinyl" icon={<Disc3 size={20} />} title="黑胶唱片" desc="旋转唱片 + 环绕式音频可视化" />
          <ModeCard mode="aurora" icon={<Sparkles size={20} />} title="流光舞台" desc="极光背景 + 沉浸式卡拉OK歌词" />
        </div>
        <Row label="唱片可视化样式">
          <Segmented
            layoutId="seg-viz"
            value={s.vinylViz}
            onChange={(v) => s.set({ vinylViz: v })}
            options={[
              { value: 'bars', label: '频谱柱' },
              { value: 'wave', label: '波形环' },
              { value: 'particles', label: '粒子' }
            ]}
          />
        </Row>
        <Row label="暂停时淡入淡出">
          <Switch on={s.fadeOnPause} onChange={(v) => s.set({ fadeOnPause: v })} />
        </Row>
      </Group>
      </>
      )}

      {tab === 'audio' && <AudioSettingsSection />}

      {tab === 'lyrics' && (
        <>
          <Group title="歌词">
        <Row label="自动获取在线歌词" desc="本地无歌词或缺少外语译文时，自动从网易云音乐 / QQ 音乐 / LRCLIB / Apple Music 等多源检索最佳同步歌词">
          <Switch on={s.autoOnlineLyrics} onChange={(v) => s.set({ autoOnlineLyrics: v })} />
        </Row>
        <Row label="显示罗马音" desc="日语歌曲自动生成平文式罗马音">
          <Switch on={s.showRoma} onChange={(v) => s.set({ showRoma: v })} />
        </Row>
        <Row label="显示翻译">
          <Switch on={s.showTrans} onChange={(v) => s.set({ showTrans: v })} />
        </Row>
        <Row label="歌词对齐">
          <Segmented
            layoutId="seg-align"
            value={s.lyricAlign}
            onChange={(v) => s.set({ lyricAlign: v })}
            options={[
              { value: 'left', label: '左对齐' },
              { value: 'center', label: '居中' }
            ]}
          />
        </Row>
        <Row label="歌词字号" desc={`${Math.round(s.lyricScale * 100)}%`}>
          <div style={{ width: 240, display: 'flex' }}>
            <Slider value={s.lyricScale - 0.7} max={0.8} onChange={(v) => s.set({ lyricScale: Math.round((v + 0.7) * 20) / 20 })} className="accent" thumb />
          </div>
        </Row>
        <Row label="自动保存在线歌词" desc="获取到在线歌词后自动写入本地（嵌入文件 / 同名 .lrc）">
          <Segmented<SaveMode>
            layoutId="seg-save"
            value={s.autoSaveLyrics}
            onChange={(v) => s.set({ autoSaveLyrics: v })}
            options={[
              { value: 'off', label: '关闭' },
              { value: 'embed', label: '嵌入' },
              { value: 'sidecar', label: '.lrc' },
              { value: 'both', label: '两者' }
            ]}
          />
        </Row>
        <Row label="保存时包含罗马音">
          <Switch on={s.saveRoma} onChange={(v) => s.set({ saveRoma: v })} />
        </Row>
        <Row label="保存时包含翻译">
          <Switch on={s.saveTrans} onChange={(v) => s.set({ saveTrans: v })} />
        </Row>
      </Group>

      <Group title="桌面悬浮歌词">
        <Row label="开启 / 切换桌面歌词" desc="独立置顶透明歌词窗口，也可在左下/右下播放栏快速开关">
          <button className="btn" onClick={() => window.kaze.floating.toggleDesktopLyrics()}>
            开关桌面歌词
          </button>
        </Row>
        <Row label="字体大小" desc={`${s.desktopLyricsFontSize}px（调节后自动适配窗高）`}>
          <div style={{ width: 240, display: 'flex' }}>
            <Slider
              value={s.desktopLyricsFontSize - 18}
              max={26}
              onChange={(v) => s.set({ desktopLyricsFontSize: Math.round(v + 18) })}
              className="accent"
              thumb
            />
          </div>
        </Row>
        <Row label="显示排数" desc="自由切换单行沉浸、双行（词+译/预显）或三行全景展示">
          <Segmented
            layoutId="seg-dl-rows"
            value={String(s.desktopLyricsRows)}
            onChange={(v) => s.set({ desktopLyricsRows: Number(v) as 1 | 2 | 3 })}
            options={[
              { value: '1', label: '1 行' },
              { value: '2', label: '2 行' },
              { value: '3', label: '3 行' }
            ]}
          />
        </Row>
        <Row label="宽屏显示区域" desc="将桌面歌词最大宽度由 820px 扩展至 1040px，容纳更大字号的长歌词">
          <Switch on={s.desktopLyricsWide} onChange={(v) => s.set({ desktopLyricsWide: v })} />
        </Row>
        <Row label="文字不透明度" desc={`${s.desktopLyricsOpacity}%`}>
          <div style={{ width: 240, display: 'flex' }}>
            <Slider
              value={s.desktopLyricsOpacity - 30}
              max={70}
              onChange={(v) => s.set({ desktopLyricsOpacity: Math.round(v + 30) })}
              className="accent"
              thumb
            />
          </div>
        </Row>
        <Row label="当前行突出放大" desc="当前正在演唱行自动放大突出显示">
          <Switch on={s.desktopLyricsActiveZoom} onChange={(v) => s.set({ desktopLyricsActiveZoom: v })} />
        </Row>
        <Row label="歌词文字颜色" desc="选择桌面歌词高亮主色，或自定义颜色">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {DESKTOP_LYRICS_COLORS.map((c) => (
              <button
                key={c.value}
                title={c.name}
                onClick={() => s.set({ desktopLyricsColor: c.value })}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: c.value,
                  cursor: 'pointer',
                  border: s.desktopLyricsColor.toLowerCase() === c.value.toLowerCase() ? '2px solid var(--accent)' : '1px solid var(--sep)',
                  boxShadow: s.desktopLyricsColor.toLowerCase() === c.value.toLowerCase() ? '0 0 0 2px var(--bg)' : undefined
                }}
              />
            ))}
            <input
              type="color"
              value={s.desktopLyricsColor}
              onChange={(e) => s.set({ desktopLyricsColor: e.target.value })}
              title="自定义颜色"
              style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
            />
          </div>
        </Row>
        <Row label="歌词出现方式" desc="切换逐字渐进扫光或逐行高亮显示模式" column>
          <Segmented<DesktopLyricsAnimation>
            layoutId="seg-dl-anim"
            value={s.desktopLyricsAnimation === 'none' ? 'none' : 'karaoke'}
            onChange={(v) => s.set({ desktopLyricsAnimation: v })}
            options={DESKTOP_LYRICS_ANIMS}
          />
        </Row>
        <Row label="排列方向" desc="支持横向经典字幕与竖向（vertical-rl）两种排列模式">
          <Segmented<'horizontal' | 'vertical'>
            layoutId="seg-dl-dir"
            value={s.desktopLyricsDirection}
            onChange={(v) => s.set({ desktopLyricsDirection: v })}
            options={[
              { value: 'horizontal', label: '横向' },
              { value: 'vertical', label: '竖向' }
            ]}
          />
        </Row>
        <Row label="窗口总在最前" desc="定期维护 screen-saver 置顶层级，不被全屏或任务栏遮挡">
          <Switch on={s.desktopLyricsAlwaysOnTop} onChange={(v) => s.set({ desktopLyricsAlwaysOnTop: v })} />
        </Row>
        <Row label="字体加粗" desc="加粗桌面歌词正文与翻译/罗马音扩展行">
          <Switch on={s.desktopLyricsBold} onChange={(v) => s.set({ desktopLyricsBold: v })} />
        </Row>
        <Row label="鼠标悬停淡隐" desc="悬停桌面歌词区域时淡隐至 5% 透明度，仅在解锁状态下移入可恢复">
          <Switch on={s.desktopLyricsHoverHide} onChange={(v) => s.set({ desktopLyricsHoverHide: v })} />
        </Row>
        <Row label="暂停时自动隐藏" desc="音乐暂停 200ms 后自动淡隐桌面歌词，恢复播放时重新显现">
          <Switch on={s.desktopLyricsPauseHide} onChange={(v) => s.set({ desktopLyricsPauseHide: v })} />
        </Row>
        <Row label="鼠标穿透锁定" desc="锁定后点击歌词区域直接穿透到底层应用，悬停顶部“解锁”按钮可恢复交互">
          <Switch on={s.desktopLyricsLocked} onChange={(v) => s.set({ desktopLyricsLocked: v })} />
        </Row>
      </Group>

      <ProviderSettingsSection />
        </>
      )}

      {tab === 'library' && (
        <>
          <Group title="资料库">
        <Row label="音乐文件夹" desc={`共 ${count} 首歌曲`}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={async () => {
                const d = await window.kaze.library.rescan()
                useLibrary.getState().apply(d)
                toast('资料库已重新扫描', 'success')
              }}
            >
              <RefreshCw size={14} />
              重新扫描
            </button>
            <button className="btn primary" onClick={importFolder}>
              <FolderPlus size={14} />
              添加文件夹
            </button>
          </div>
        </Row>
        {folders.map((f) => (
          <Row key={f} label={<span style={{ fontWeight: 400, fontSize: 12.5, wordBreak: 'break-all' }}>{f}</span>}>
            <button
              className="icon-btn"
              title="移除文件夹"
              onClick={async () => {
                const d = await window.kaze.library.removeFolder(f)
                useLibrary.getState().apply(d)
              }}
            >
              <X size={15} />
            </button>
          </Row>
        ))}
      </Group>

      <Group title="系统集成与通用歌单">
        <Row
          label="关闭主窗口时最小化到系统托盘"
          desc="点击关闭按钮后隐入右下角系统托盘并在后台继续播放，支持系统全局媒体按键控制"
        >
          <Switch
            on={s.minimizeToTray}
            onChange={(v) => {
              s.set({ minimizeToTray: v })
              window.kaze.win.setMinimizeToTray(v)
            }}
          />
        </Row>
        <Row
          label="导入 .m3u / .m3u8 外部歌单"
          desc="从其他播放器导出的 .m3u / .m3u8 播放列表文件导入歌曲并自动创建一个新歌单"
        >
          <button
            className="btn"
            onClick={async () => {
              const res = await window.kaze.playlist.importM3u()
              if (res.canceled) return
              if (!res.ok) {
                toast(res.error ?? '导入 .m3u8 失败', 'error')
                return
              }
              if (res.lib) useLibrary.getState().apply(res.lib)
              const ids = res.trackIds ?? []
              if (ids.length && res.name) {
                const plId = useUser.getState().createPlaylist(res.name, res.trackIds ?? ids)
                toast(`已导入歌单「${res.name}」（共 ${ids.length} 首）`, 'success')
                useUI.getState().navigate({ name: 'playlist', param: plId })
              } else {
                toast('未在歌单中匹配到有效音频文件', 'error')
              }
            }}
          >
            <Upload size={14} />
            选择 .m3u8 导入
          </button>
        </Row>
      </Group>

      <Group title="配置备份与恢复 (.js)">
        <Row
          label="JavaScript 配置文件导入与导出"
          desc="将外观主题、音效预设与 PEQ、歌单/喜欢、分类调整、Provider 优先级与聆听统计导出为可读的 .js 文件，或从 .js 文件一键还原"
        >
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              className="btn"
              onClick={async () => {
                const st = useSettings.getState()
                const u = useUser.getState()
                const settingsPayload: Record<string, unknown> = {}
                for (const [k, v] of Object.entries(st)) {
                  if (typeof v !== 'function') settingsPayload[k] = v
                }
                const res = await window.kaze.config.exportJs({
                  settings: settingsPayload,
                  user: {
                    liked: u.liked,
                    playlists: u.playlists,
                    lyricOffsets: u.lyricOffsets,
                    playCounts: u.playCounts,
                    playDurations: u.playDurations,
                    customCategories: u.customCategories,
                    spectralCache: u.spectralCache
                  }
                })
                if (res.ok) toast('配置已导出为 .js 文件', 'success')
              }}
            >
              <Download size={14} />
              导出 .js 配置
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                const res = await window.kaze.config.importJs()
                if (res.canceled) return
                if (!res.ok || !res.data) {
                  toast(res.error ?? '导入配置失败', 'error')
                  return
                }
                const d = res.data
                if (d.settings && typeof d.settings === 'object' && !Array.isArray(d.settings)) {
                  useSettings.getState().set(d.settings)
                }
                if (d.user && typeof d.user === 'object' && !Array.isArray(d.user)) {
                  useUser.setState((prev) => ({
                    liked: Array.isArray(d.user.liked) ? d.user.liked : prev.liked,
                    playlists: Array.isArray(d.user.playlists) ? d.user.playlists : prev.playlists,
                    lyricOffsets: d.user.lyricOffsets && typeof d.user.lyricOffsets === 'object' ? d.user.lyricOffsets : prev.lyricOffsets,
                    playCounts: d.user.playCounts && typeof d.user.playCounts === 'object' ? d.user.playCounts : prev.playCounts,
                    playDurations: d.user.playDurations && typeof d.user.playDurations === 'object' ? d.user.playDurations : prev.playDurations,
                    customCategories: d.user.customCategories && typeof d.user.customCategories === 'object' ? d.user.customCategories : prev.customCategories,
                    spectralCache: d.user.spectralCache && typeof d.user.spectralCache === 'object' ? d.user.spectralCache : prev.spectralCache
                  }))
                }
                window.dispatchEvent(new CustomEvent('kaze:providers-reloaded'))
                toast('已成功从 .js 文件恢复配置', 'success')
              }}
            >
              <Upload size={14} />
              导入 .js 配置
            </button>
          </div>
        </Row>
      </Group>

      <Group title="关于">
        <Row
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <img src={DEFAULT_LOGO_URL} width={22} height={22} alt="" style={{ display: 'block' }} />
              Kaze
            </span>
          }
          desc={`版本 ${version} · 高准确度匹配与无损标签封装的本地 Hi-Res 音乐播放器`}
        >
          <button className="btn" onClick={() => window.kaze.openExternal('https://github.com/Akumy-01/Kaze')}>
            <ExternalLink size={14} />
            GitHub
          </button>
        </Row>
        <Row label="快捷键" desc="空格 播放/暂停 · ←/→ 快退/快进 5 秒 · Ctrl+←/→ 上一首/下一首 · ↑/↓ 音量 · Ctrl+F 搜索 · Esc 关闭播放界面" />
      </Group>
        </>
      )}
    </div>
  )
}
