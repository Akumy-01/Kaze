import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, FolderOpen, Layers, RefreshCw, RotateCcw } from 'lucide-react'
import type { ProviderKind, ProviderSnapshot } from '../../../shared/types'
import { toast } from '../store/ui'
import { Switch } from './Controls'

function healthBadge(p: ProviderSnapshot) {
  if (!p.enabled || p.health.status === 'disabled') {
    return { label: '已禁用', color: 'var(--text-2)', bg: 'var(--surface-hover)' }
  }
  if (p.health.status === 'cooldown') {
    const sec = p.health.cooldownUntil ? Math.max(1, Math.ceil((p.health.cooldownUntil - Date.now()) / 1000)) : 60
    return { label: `冷却中 ${sec}s`, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' }
  }
  return { label: '就绪', color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)' }
}

function ProviderGroup({
  title,
  desc,
  items,
  onMove,
  onToggle,
  onReset
}: {
  title: string
  desc: string
  items: ProviderSnapshot[]
  onMove: (id: string, delta: -1 | 1) => void
  onToggle: (id: string, enabled: boolean) => void
  onReset: (id: string) => void
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '0 14px 8px' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3, var(--text-2))', marginTop: 2 }}>{desc}</div>
        </div>
      </div>

      <div className="settings-group-card">
        {items.length === 0 && (
          <div style={{ padding: '16px 18px', fontSize: 12.5, color: 'var(--text-2)' }}>暂无可用 Provider</div>
        )}
        {items.map((p, idx) => {
          const badge = healthBadge(p)
          return (
            <div
              key={p.id}
              className="settings-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '12px 16px',
                minHeight: 54
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    #{idx + 1}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: '1px 6px',
                      borderRadius: 6,
                      background: 'var(--surface-hover)',
                      color: 'var(--text-2)'
                    }}
                  >
                    {p.builtin ? '内置' : '扩展 Manifest'}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      padding: '1px 7px',
                      borderRadius: 999,
                      color: badge.color,
                      background: badge.bg
                    }}
                    title={p.health.lastError}
                  >
                    {badge.label}
                  </span>
                  {typeof p.health.avgLatencyMs === 'number' && p.health.avgLatencyMs > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {p.health.avgLatencyMs}ms
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45 }}>
                  {p.description}
                  {p.health.lastError && (
                    <span style={{ color: '#f59e0b', marginLeft: 8 }}>最近异常：{p.health.lastError}</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {p.health.status === 'cooldown' && (
                  <button className="btn" style={{ height: 28, padding: '0 8px', fontSize: 11.5 }} onClick={() => onReset(p.id)} title="立即恢复就绪">
                    <RotateCcw size={12} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  disabled={idx === 0}
                  onClick={() => onMove(p.id, -1)}
                  title="上移优先级"
                  aria-label="上移优先级"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="icon-btn"
                  disabled={idx === items.length - 1}
                  onClick={() => onMove(p.id, 1)}
                  title="下移优先级"
                  aria-label="下移优先级"
                >
                  <ArrowDown size={14} />
                </button>
                <Switch on={p.enabled} onChange={(v) => onToggle(p.id, v)} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function ProviderSettingsSection() {
  const [providers, setProviders] = useState<ProviderSnapshot[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const list = await window.kaze.providers.list()
      setProviders(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const onReload = () => void load()
    window.addEventListener('kaze:providers-reloaded', onReload)
    return () => window.removeEventListener('kaze:providers-reloaded', onReload)
  }, [])

  const byKind = (kind: ProviderKind) =>
    providers.filter((p) => p.kind === kind).sort((a, b) => a.priority - b.priority)

  const handleMove = async (id: string, delta: -1 | 1) => {
    const next = await window.kaze.providers.move(id, delta)
    setProviders(next)
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    const next = await window.kaze.providers.update(id, { enabled })
    setProviders(next)
  }

  const handleReset = async (id?: string) => {
    const next = await window.kaze.providers.resetHealth(id)
    setProviders(next)
    toast(id ? '已重置该 Provider 健康状态' : '已重置全部 Provider 熔断冷却状态', 'success')
  }

  const handleReload = async () => {
    setLoading(true)
    try {
      const next = await window.kaze.providers.reload()
      setProviders(next)
      toast('已重新加载自定义 JSON Provider', 'success')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={{ marginBottom: 26 }}>
      <div className="settings-sec-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Layers size={14} style={{ color: 'var(--accent)' }} />
        <span>Provider 可插拔与 Fallback 链</span>
      </div>

      <div className="settings-group-card" style={{ marginBottom: 18 }}>
        <div
          className="settings-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px 16px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>扩展目录与运行健康状态</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>
              可在扩展目录放入 JSON 声明式规则，或一键恢复因连续失败进入熔断冷却的接口源
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button className="btn" style={{ height: 30, fontSize: 12 }} onClick={() => window.kaze.providers.openDir()}>
              <FolderOpen size={13} style={{ marginRight: 5 }} />
              打开扩展目录
            </button>
            <button className="btn" style={{ height: 30, fontSize: 12 }} onClick={handleReload} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'spin' : undefined} style={{ marginRight: 5 }} />
              重载 JSON 插件
            </button>
            <button className="btn" style={{ height: 30, fontSize: 12 }} onClick={() => handleReset()}>
              <RotateCcw size={13} style={{ marginRight: 5 }} />
              重置健康状态
            </button>
          </div>
        </div>
      </div>

      <ProviderGroup
        title="元数据与封面 Fallback 链"
        desc="按优先级依次检索公开合规元数据与 Cover Art Archive 封面；连续失败 3 次将自动熔断冷却 60 秒。"
        items={byKind('metadata')}
        onMove={handleMove}
        onToggle={handleToggle}
        onReset={(id) => handleReset(id)}
      />

      <ProviderGroup
        title="在线歌词 Fallback 链"
        desc="本地未内嵌歌词时按顺序尝试在线歌词源，并在主源超时或无果时自动降级到下一源。"
        items={byKind('lyrics')}
        onMove={handleMove}
        onToggle={handleToggle}
        onReset={(id) => handleReset(id)}
      />
    </section>
  )
}
