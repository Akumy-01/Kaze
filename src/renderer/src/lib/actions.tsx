import {
  Play,
  ListStart,
  ListEnd,
  Heart,
  HeartOff,
  ListPlus,
  FolderOpen,
  Trash2,
  Info,
  Disc3,
  User,
  Plus,
  ListMinus,
  Tag,
  Activity,
  Languages,
  Pencil,
  ImageDown
} from 'lucide-react'
import type { Track } from '../../../shared/types'
import { usePlayer } from '../store/player'
import { useUser } from '../store/user'
import { useUI, toast, type MenuItem } from '../store/ui'
import { useLibrary, albumKey } from '../store/library'
import { splitArtists } from './format'
import { CATEGORY_LABELS, CATEGORY_ORDER } from './classify'

export function playlistSubmenu(trackIds: string[]): MenuItem[] {
  const { playlists, addToPlaylist } = useUser.getState()
  return [
    {
      label: '新建歌单…',
      icon: <Plus size={14} />,
      onClick: () => useUI.getState().openDialog({ kind: 'newPlaylist', trackIds })
    },
    ...(playlists.length ? [{ divider: true } as MenuItem] : []),
    ...playlists.map((p) => ({
      label: p.name,
      onClick: () => {
        const n = addToPlaylist(p.id, trackIds)
        toast(n ? `已添加到「${p.name}」` : `歌曲已在「${p.name}」中`, n ? 'success' : 'info')
      }
    }))
  ]
}

export function trackMenu(t: Track, ctx: { list?: string[]; index?: number; playlistId?: string } = {}): MenuItem[] {
  const player = usePlayer.getState()
  const user = useUser.getState()
  const ui = useUI.getState()
  const liked = user.liked.includes(t.id)
  const artists = splitArtists(t.artist)
  const items: MenuItem[] = [
    {
      label: '播放',
      icon: <Play size={14} />,
      onClick: () => (ctx.list ? player.playTracks(ctx.list, ctx.index ?? ctx.list.indexOf(t.id)) : player.playTracks([t.id]))
    },
    { label: '下一首播放', icon: <ListStart size={14} />, onClick: () => player.playNext([t.id]) },
    { label: '添加到播放队列', icon: <ListEnd size={14} />, onClick: () => player.addToQueue([t.id]) },
    { divider: true },
    {
      label: liked ? '取消喜欢' : '喜欢',
      icon: liked ? <HeartOff size={14} /> : <Heart size={14} />,
      onClick: () => user.toggleLike(t.id)
    },
    { label: '添加到歌单', icon: <ListPlus size={14} />, children: playlistSubmenu([t.id]) },
    { divider: true },
    {
      label: '前往专辑',
      icon: <Disc3 size={14} />,
      onClick: () => ui.navigate({ name: 'album', param: albumKey(t) })
    },
    {
      label: artists.length > 1 ? '前往艺人' : `前往艺人`,
      icon: <User size={14} />,
      ...(artists.length > 1
        ? { children: artists.map((a) => ({ label: a, onClick: () => ui.navigate({ name: 'artist', param: a.toLowerCase() }) })) }
        : { onClick: () => ui.navigate({ name: 'artist', param: (artists[0] ?? t.artist).toLowerCase() }) })
    },
    { label: '歌曲信息', icon: <Info size={14} />, onClick: () => ui.openDialog({ kind: 'trackInfo', id: t.id }) },
    {
      label: '设置曲目分类',
      icon: <Languages size={14} />,
      children: [
        {
          label: '恢复自动识别',
          onClick: () => {
            useUser.getState().setTrackCategory(t.id, 'auto')
            toast('已恢复自动分类识别', 'info')
          }
        },
        { divider: true },
        ...CATEGORY_ORDER.map((cat) => ({
          label: CATEGORY_LABELS[cat],
          onClick: () => {
            useUser.getState().setTrackCategory(t.id, cat)
            toast(`已归类为「${CATEGORY_LABELS[cat]}」`, 'success')
          }
        }))
      ]
    },
    {
      label: '编辑标签与封面',
      icon: <Pencil size={14} />,
      onClick: () => ui.openDialog({ kind: 'metadataMatch', trackId: t.id, tab: 'edit' })
    },
    { label: '智能匹配与完善标签', icon: <Tag size={14} />, onClick: () => ui.openDialog({ kind: 'metadataMatch', trackId: t.id, tab: 'match' }) },
    {
      label: '另存专辑封面',
      icon: <ImageDown size={14} />,
      onClick: async () => {
        const res = await window.kaze.metadata.saveCover(t.id)
        if (res.canceled) return
        if (res.ok) toast(`专辑封面已保存到 ${res.filePath}`, 'success')
        else toast(res.error ?? '导出专辑封面失败', 'error')
      }
    },
    { label: '频谱与无损质量分析', icon: <Activity size={14} />, onClick: () => ui.openDialog({ kind: 'audioQuality', trackId: t.id, tab: 'quality' }) },
    { label: '在资源管理器中显示', icon: <FolderOpen size={14} />, onClick: () => window.kaze.showItem(t.path) }
  ]
  if (ctx.playlistId) {
    items.push({ divider: true })
    items.push({
      label: '从歌单中移除',
      icon: <ListMinus size={14} />,
      danger: true,
      onClick: () => user.removeFromPlaylist(ctx.playlistId!, t.id)
    })
  } else {
    items.push({ divider: true })
    items.push({
      label: '从资料库中移除',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: async () => {
        const d = await window.kaze.library.removeTracks([t.id])
        useLibrary.getState().apply(d)
        toast('已从资料库中移除（文件未删除）')
      }
    })
  }
  return items
}

export function collectionMenu(ids: string[], name: string): MenuItem[] {
  const player = usePlayer.getState()
  return [
    { label: '播放', icon: <Play size={14} />, onClick: () => player.playTracks(ids, 0, { shuffle: false }) },
    { label: '下一首播放', icon: <ListStart size={14} />, onClick: () => player.playNext(ids) },
    { label: '添加到播放队列', icon: <ListEnd size={14} />, onClick: () => player.addToQueue(ids) },
    { divider: true },
    { label: `添加「${name}」到歌单`, icon: <ListPlus size={14} />, children: playlistSubmenu(ids) },
    {
      label: '批量匹配并封装标签',
      icon: <Tag size={14} />,
      onClick: () => useUI.getState().openDialog({ kind: 'batchMetadataMatch', trackIds: ids, title: name })
    }
  ]
}
