import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Sun, Moon, Monitor, Check, ImagePlus, FolderPlus, RefreshCw, X, Disc3, Sparkles, Apple, ExternalLink, Palette, Image as ImageIcon, Square } from 'lucide-react'
import { useSettings, ACCENTS, type BgType, type NpMode, type SaveMode } from '../store/settings'
import { useLibrary } from '../store/library'
import { toast } from '../store/ui'
import { Segmented, Slider, Switch } from '../components/Controls'
import { importFolder } from './Library'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 8px 14px' }}>{title}</div>
      <div
        style={{
          borderRadius: 12,
          background: 'var(--surface)',
          backdropFilter: 'blur(30px) saturate(160%)',
          border: '1px solid var(--sep)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden'
        }}
      >
        {children}
      </div>
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
        borderBottom: '1px solid var(--sep)',
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
  const on = npMode === mode
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={() => set({ npMode: mode })}
      style={{
        flex: 1,
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        background: on ? 'rgba(var(--accent-rgb),0.12)' : 'var(--fill)',
        boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'none',
        transition: 'background .2s, box-shadow .2s'
      }}
    >
      <div style={{ color: 'var(--accent)' }}>{icon}</div>
      <div style={{ fontWeight: 600, marginTop: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>
    </motion.button>
  )
}

export function SettingsView() {
  const s = useSettings()
  const folders = useLibrary((st) => st.folders)
  const count = useLibrary((st) => st.tracks.length)
  const [version, setVersion] = useState('')
  const [custom, setCustom] = useState(s.accent)
  useEffect(() => {
    window.akumy.version().then(setVersion)
  }, [])

  const pickWallpaper = async () => {
    const url = await window.akumy.pickWallpaper()
    if (url) s.set({ wallpaper: url, bgType: 'image' })
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1 className="page-title" style={{ marginBottom: 20 }}>
        设置
      </h1>

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
              { value: 'mac', label: 'macOS 风格' },
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
          <ModeCard mode="apple" icon={<Apple size={20} />} title="Apple Music" desc="流动封面背景 + 弹性滚动歌词" />
          <ModeCard mode="vinyl" icon={<Disc3 size={20} />} title="黑胶唱片" desc="旋转唱片 + 环绕式音频可视化" />
          <ModeCard mode="aurora" icon={<Sparkles size={20} />} title="流光" desc="极光背景 + 沉浸式卡拉OK歌词" />
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

      <Group title="歌词">
        <Row label="自动获取在线歌词" desc="本地无歌词时，自动从网易云音乐 / LRCLIB / 酷狗搜索最匹配的歌词">
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

      <Group title="资料库">
        <Row label="音乐文件夹" desc={`共 ${count} 首歌曲`}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={async () => {
                const d = await window.akumy.library.rescan()
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
                const d = await window.akumy.library.removeFolder(f)
                useLibrary.getState().apply(d)
              }}
            >
              <X size={15} />
            </button>
          </Row>
        ))}
      </Group>

      <Group title="关于">
        <Row label="Akumy Music" desc={`版本 ${version} · 一款拥有 Apple 质感的本地音乐播放器`}>
          <button className="btn" onClick={() => window.akumy.openExternal('https://github.com/Akumy-01/akumy-music')}>
            <ExternalLink size={14} />
            GitHub
          </button>
        </Row>
        <Row label="快捷键" desc="空格 播放/暂停 · ←/→ 快退/快进 5 秒 · Ctrl+←/→ 上一首/下一首 · ↑/↓ 音量 · Ctrl+F 搜索 · Esc 关闭播放界面" />
      </Group>
    </div>
  )
}
