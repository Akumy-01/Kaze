import type { Track, TrackCategory } from '../../../shared/types'

export const CATEGORY_LABELS: Record<TrackCategory, string> = {
  zh: '中文',
  ja: '日语',
  en: '英语',
  ko: '韩语',
  instrumental: '纯音乐',
  other: '其他'
}

export const CATEGORY_ORDER: TrackCategory[] = ['zh', 'ja', 'en', 'ko', 'instrumental', 'other']

const HAS_KANA = /[\u3040-\u309f\u30a0-\u30ff]/
const HAS_HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/
const HAS_HAN = /[\u4e00-\u9fff]/
const HAS_LATIN = /[a-zA-Z]/

// Simplified-Chinese exclusive characters (distinguish zh from ja/hant Kanji)
const SIMPLIFIED_ONLY_HAN =
  /[这为个来时们到会说着爱让给对从现听欢乐梦飞风花鸟鱼龙门间问开关华东长书买卖见观杀死胸旅店万岁尘烟轻语声实国学发经绘铁灵兽宝药岁浅传佛假团围压增坏娘属厅废拜据扩举插搜摇摄击泽涩瀑汉潜烧牺独叠县碎续绿编练缘绳纵繁纤脏边迟]/g

// Japanese-exclusive Shinjitai forms (rare or absent in Standard Simplified & Traditional Chinese)
const JA_SHINJITAI_RE =
  /[桜駅気芸転読売経絵声鉄霊獣宝薬歳浅伝仏仮団囲圧増壊嬢実対属庁廃拝拠拡挙挿捜揺摂撃沢渋滝漢潜焼犠独畳県砕続緑編練縁縄縦繁繊聴職臓辺遅桜吹雪]/

// Unconditional instrumental title markers
const INST_STRONG_RE =
  /(\binst\.?\b|\binstrumental\b|\boff[\s_-]*vocal\b|\bminus[\s_-]*one\b|\bkaraoke\b|\bbgm\b|纯音乐|纯演奏|无人声|伴奏|钢琴独奏|小提琴独奏|吉他独奏|piano\s*solo|violin\s*solo|cello\s*solo|guitar\s*solo|acoustic\s*inst|music\s*box|インスト|カラオケ|オフボーカル|ピアノ・?ソロ)/i

// Genre or musical form cues that strongly indicate instrumental when no vocal/lyric signal exists
const INST_GENRE_RE =
  /(instrumental|classical|new[\s-]*age|ambient|piano|chamber|symphon|orchestr|soundtrack|score|ost|acoustic|lo[\s-]*fi)/i

const INST_FORM_RE =
  /(\bno\.?\s*\d+\b|\bop\.?\s*\d+\b|\bbwv\s*\d+\b|\bk\.?\s*\d+\b|\brv\.?\s*\d+\b|\bsonate?\b|\bconcerto\b|\bprelude\b|\bnocturne\b|\bwaltz\b|\bétude\b|\betude\b|\boverture\b|\bsymphony\b|\binterlude\b|\bprologue\b|\bepilogue\b|\bmain\s*theme\b|\borchestral\s*(ver|version|arr)?\b|\bpiano\s*(ver|version|arr)?\b|钢琴版|交响曲|协奏曲|奏鸣曲|圆舞曲|前奏曲|序曲|间奏)/i

// Pure instrumentalists / classical composers (rarely vocal main artists)
const PURE_INST_ARTIST_RE =
  /(richard\s*clayderman|yiruma|ryuichi\s*sakamoto|坂本龍一|坂本龙一|joe\s*hisaishi|久石譲|久石让|久石讓|磯村由紀子|yukiko\s*isomura|宗次郎|sojiro|喜多郎|kitaro|bandari|班得瑞|ludovico\s*einaudi|max\s*richter|kevin\s*kern|david\s*lanz|george\s*winston|secret\s*garden|神秘园|the\s*piano\s*guys|maksim\s*mrvica|马克西姆|paul\s*mauriat|dj\s*okawari|kenichiro\s*nishihara|thomas\s*bergersen|two\s*steps\s*from\s*hell|audiomachine|hans\s*zimmer|john\s*williams|ennio\s*morricone|ramin\s*djawadi|evan\s*call|kevin\s*penkin|yoshihisa\s*hirano|hideki\s*taniuchi|yasuharu\s*takanashi|yugo\s*kanno|taku\s*iwasaki|yuki\s*hayashi|yutaka\s*yamada|nobuo\s*uematsu|yasunori\s*mitsuda|koji\s*kondo|masashi\s*hamauzu|chopin|肖邦|mozart|莫扎特|beethoven|贝多芬|bach|巴赫|debussy|德彪西|tchaikovsky|柴可夫斯基|rachmaninoff|拉赫玛尼诺夫|vivaldi|维瓦尔第|schubert|舒伯特|liszt|李斯特|brahms|勃拉姆斯|ravel|拉威尔|satie|萨蒂|paganini|帕格尼尼|mendelssohn|门德尔松|dvorak|德沃夏克|mahler|马勒|shirou?\s*sagisu|鹭巢诗郎|鷺巣詩郎)/i

const VOCAL_CUE_RE = /(\bfeat\.?\b|\bft\.?\b|\bvocal\b|\bwith\b|\bsung\b|合唱|独唱|主唱)/i

const JA_ARTIST_RE =
  /(yoasobi|yorushika|ヨルシカ|zutomayo|ずっと真夜中でいいのに|ado\b|kenshi\s*yonezu|米津玄師|aimyon|あいみょん|official髭男|king\s*gnu|fujii\s*kaze|藤井風|vaundy|lisa\b|aimer|egoist|radwimps|bump\s*of\s*chicken|mrs\.\s*green\s*apple|back\s*number|utada|hikaru|atarayo|あたらよ|kessoku|結束バンド|togenashi|akino\s*arai|新居昭乃|rocky\s*chack|sawano|kajiura|yoko\s*kanno|eir\s*aoi|藍井エイル|milet|reona|claris|garnidelia|kalafina|minami|美波|yuuri|優里|tatsuya\s*kitani|creepy\s*nuts|imase|hatsune\s*miku|初音ミク|vocaloid|mafumafu|まふまふ|soraru|そらる|sheena\s*ringo|椎名林檎|one\s*ok\s*rock|yui\b|ayumi\s*hamasaki|浜崎あゆみ|mika\s*nakashima|中島美嘉|zard|spyair|uverworld|asian\s*kung-fu|sakanaction|サカナクション|takayan|yama\b|mariya\s*takeuchi|tatsuro\s*yamashita|miki\s*matsubara|anri|cidergirl|saucy\s*dog|indigo\s*la\s*end|tsukuyomi|月詠み|myth\s*&\s*roid|fripside|fhana|choucho|kana-boon|mygo|ave\s*mujica|riya\b|lia\b|chata\b|kanako\s*ito|kotoringo|butaotome|豚乙女|alstroemeria)/i

const ZH_ARTIST_RE =
  /(周杰伦|林俊杰|陈奕迅|王菲|邓紫棋|毛不易|李荣浩|薛之谦|许嵩|五月天|苏打绿|万能青年旅店|草东没有派对|告五人|刺猬|新裤子|落日飞车|张学友|刘德华|张国荣|beyond|孙燕姿|梁静茹|蔡依林|田馥甄|林宥嘉|陶喆|方大同|张惠妹|赵雷|朴树|许巍|汪峰|伍佰|崔健|罗大佑|李宗盛|周深|张杰|单依纯|华晨宇|陈粒|房东的猫|逃跑计划|痛仰|重塑|五条人|棱镜|康士坦|deca\s*joins|jay\s*chou|eason\s*chan|jj\s*lin)/i

const KO_ARTIST_RE =
  /(blackpink|bts|newjeans|aespa|twice|stray\s*kids|seventeen|g-idle|\(g\)i-dle|le\s*sserafim|ive\b|taeyeon|iu\b|akmu|bol4|red\s*velvet|itzy|nmixx|txt\b|enhypen|exo\b|bigbang|g-dragon|taeyang|day6|psy\b|heize|zico|sunmi|chungha|boA\b|jennie|rosé|jung\s*kook)/i

export interface ClassificationContext {
  albumLang?: Exclude<TrackCategory, 'instrumental' | 'other'>
  artistLang?: Exclude<TrackCategory, 'instrumental' | 'other'>
}

function detectExplicitScript(t: Track, lyricSample?: string): Exclude<TrackCategory, 'instrumental' | 'other'> | null {
  const lyric = lyricSample?.trim() ?? ''
  const titleAndArtist = `${t.title} ${t.artist} ${t.album}`
  const combined = `${lyric} ${titleAndArtist}`
  if (HAS_KANA.test(combined)) return 'ja'
  if (HAS_HANGUL.test(combined)) return 'ko'
  if (JA_ARTIST_RE.test(`${t.artist} ${t.albumArtist}`)) return 'ja'
  if (KO_ARTIST_RE.test(`${t.artist} ${t.albumArtist}`)) return 'ko'
  if (ZH_ARTIST_RE.test(`${t.artist} ${t.albumArtist}`)) return 'zh'
  const simpHits = (combined.match(SIMPLIFIED_ONLY_HAN) ?? []).length
  if (simpHits > 0 && !JA_SHINJITAI_RE.test(combined)) return 'zh'
  if (JA_SHINJITAI_RE.test(combined)) return 'ja'
  return null
}

/** Build album & artist language consensus across the library for resolving ambiguous Hanzi / English titles. */
export function buildLibraryCategoryContext(tracks: Track[]): {
  albumHints: Map<string, Exclude<TrackCategory, 'instrumental' | 'other'>>
  artistHints: Map<string, Exclude<TrackCategory, 'instrumental' | 'other'>>
} {
  const albumVotes = new Map<string, Record<string, number>>()
  const artistVotes = new Map<string, Record<string, number>>()

  for (const t of tracks) {
    const lang = detectExplicitScript(t)
    if (!lang) continue
    if (t.album) {
      const aKey = `${(t.albumArtist || t.artist || '').toLowerCase()}||${t.album.toLowerCase()}`
      const bucket = albumVotes.get(aKey) ?? {}
      bucket[lang] = (bucket[lang] ?? 0) + 1
      albumVotes.set(aKey, bucket)
    }
    const primaryArtist = (t.artist || '').split(/\s*[\/,&]\s*/)[0].trim().toLowerCase()
    if (primaryArtist) {
      const bucket = artistVotes.get(primaryArtist) ?? {}
      bucket[lang] = (bucket[lang] ?? 0) + 1
      artistVotes.set(primaryArtist, bucket)
    }
  }

  const pickWinner = (votes: Record<string, number>): Exclude<TrackCategory, 'instrumental' | 'other'> | undefined => {
    let best: string | undefined
    let max = 0
    for (const [k, v] of Object.entries(votes)) {
      if (v > max) {
        max = v
        best = k
      }
    }
    return best as Exclude<TrackCategory, 'instrumental' | 'other'> | undefined
  }

  const albumHints = new Map<string, Exclude<TrackCategory, 'instrumental' | 'other'>>()
  for (const [k, v] of albumVotes) {
    const w = pickWinner(v)
    if (w) albumHints.set(k, w)
  }

  const artistHints = new Map<string, Exclude<TrackCategory, 'instrumental' | 'other'>>()
  for (const [k, v] of artistVotes) {
    const w = pickWinner(v)
    if (w) artistHints.set(k, w)
  }

  return { albumHints, artistHints }
}

export function classifyTrackCategory(
  t: Track,
  customCategories?: Record<string, TrackCategory>,
  cachedLyricSample?: string,
  ctx?: ClassificationContext
): TrackCategory {
  const override = customCategories?.[t.id]
  if (override) return override

  const lyric = cachedLyricSample?.trim() ?? ''
  const titleAlbum = `${t.title} ${t.album}`
  const artistAll = `${t.artist} ${t.albumArtist}`
  const pathLower = (t.path ?? '').toLowerCase()

  // 1. Explicit Instrumental Signals
  if (INST_STRONG_RE.test(titleAlbum)) return 'instrumental'
  if (lyric && lyric.length < 60 && /(纯音乐|纯演奏|instrumental|no lyrics|pure music)/i.test(lyric)) {
    return 'instrumental'
  }
  if (!lyric && !t.hasLyrics) {
    if (PURE_INST_ARTIST_RE.test(artistAll) && !VOCAL_CUE_RE.test(t.title)) {
      return 'instrumental'
    }
    if (INST_FORM_RE.test(t.title) && !VOCAL_CUE_RE.test(t.title)) {
      return 'instrumental'
    }
    if (t.genre && INST_GENRE_RE.test(t.genre) && !VOCAL_CUE_RE.test(t.title)) {
      return 'instrumental'
    }
    if (/[\\/](pure music|instrumental|bgm|classical|piano|纯音乐|轻音乐|古典|配乐)[\\/]/i.test(pathLower)) {
      return 'instrumental'
    }
  } else if (PURE_INST_ARTIST_RE.test(artistAll) && !lyric && !VOCAL_CUE_RE.test(t.title) && INST_FORM_RE.test(titleAlbum)) {
    return 'instrumental'
  }

  // 2. Multi-signal Language Scoring
  const scores: Record<'zh' | 'ja' | 'en' | 'ko', number> = { zh: 0, ja: 0, en: 0, ko: 0 }

  if (lyric) {
    if (HAS_KANA.test(lyric)) scores.ja += 12
    if (HAS_HANGUL.test(lyric)) scores.ko += 12
    const simpInLyric = (lyric.match(SIMPLIFIED_ONLY_HAN) ?? []).length
    if (simpInLyric >= 2) scores.zh += 10
    if (HAS_HAN.test(lyric) && !HAS_KANA.test(lyric) && !HAS_HANGUL.test(lyric)) scores.zh += 4
    if (!HAS_HAN.test(lyric) && !HAS_KANA.test(lyric) && !HAS_HANGUL.test(lyric) && HAS_LATIN.test(lyric)) scores.en += 10
  }

  if (HAS_KANA.test(t.title)) scores.ja += 10
  if (HAS_KANA.test(`${t.album} ${artistAll}`)) scores.ja += 6
  if (HAS_HANGUL.test(t.title)) scores.ko += 10
  if (HAS_HANGUL.test(`${t.album} ${artistAll}`)) scores.ko += 6

  if (JA_ARTIST_RE.test(artistAll)) scores.ja += 6
  if (ZH_ARTIST_RE.test(artistAll)) scores.zh += 6
  if (KO_ARTIST_RE.test(artistAll)) scores.ko += 6

  // Disambiguate Hanzi-only title / artist strings
  const textToInspect = `${t.title} ${t.artist} ${t.album}`
  const simpHits = (textToInspect.match(SIMPLIFIED_ONLY_HAN) ?? []).length
  if (simpHits > 0) scores.zh += Math.min(8, simpHits * 3)
  if (JA_SHINJITAI_RE.test(textToInspect)) scores.ja += 6

  // Path & genre hints
  if (/(j-?pop|anime|acg|vocaloid|日语|日音|日本|東方)/i.test(`${t.genre ?? ''} ${pathLower}`)) scores.ja += 5
  if (/(c-?pop|mandopop|cantopop|chinese|华语|国语|粤语|台语|中文|民谣|古风)/i.test(`${t.genre ?? ''} ${pathLower}`)) scores.zh += 5
  if (/(k-?pop|korean|韩语|韩音)/i.test(`${t.genre ?? ''} ${pathLower}`)) scores.ko += 5
  if (/(english|western|欧美|英文|英语|uk pop|us pop|indie rock)/i.test(`${t.genre ?? ''} ${pathLower}`)) scores.en += 4

  // Sibling album & artist language consensus (resolves e.g. Japanese Kanji or English titles inside CJK albums)
  if (ctx?.albumLang) scores[ctx.albumLang] += 4
  if (ctx?.artistLang) scores[ctx.artistLang] += 3

  // Generic Hanzi fallback & Latin fallback
  if (HAS_HAN.test(`${t.title} ${t.artist}`) && scores.ja === 0 && scores.ko === 0) {
    scores.zh += 3
  } else if (HAS_HAN.test(t.title)) {
    scores.zh += 1
  }

  if (HAS_LATIN.test(t.title) && !HAS_HAN.test(t.title) && !HAS_KANA.test(t.title) && !HAS_HANGUL.test(t.title)) {
    scores.en += 5
  }

  let bestCat: TrackCategory = 'other'
  let bestScore = 0
  for (const k of ['ja', 'zh', 'ko', 'en'] as const) {
    if (scores[k] > bestScore) {
      bestScore = scores[k]
      bestCat = k
    }
  }
  return bestScore > 0 ? bestCat : 'other'
}
