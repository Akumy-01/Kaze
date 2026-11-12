import path from 'path'
import { app } from 'electron'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const KuroshiroMod = require('kuroshiro')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AnalyzerMod = require('kuroshiro-analyzer-kuromoji')

const Kuroshiro = KuroshiroMod.default ?? KuroshiroMod
const KuromojiAnalyzer = AnalyzerMod.default ?? AnalyzerMod

let instance: any = null
let initPromise: Promise<any> | null = null

function dictPath() {
  let dir = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict')
  if (app.isPackaged) dir = dir.replace('app.asar', 'app.asar.unpacked')
  return dir
}

async function getKuroshiro() {
  if (instance) return instance
  if (!initPromise) {
    initPromise = (async () => {
      const k = new Kuroshiro()
      await k.init(new KuromojiAnalyzer({ dictPath: dictPath() }))
      instance = k
      return k
    })().catch((e) => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

const KANA = /[\u3040-\u309f\u30a0-\u30ff]/
const JA = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff\u3005\u30fc]/

export function hasKana(s: string) {
  return KANA.test(s)
}

function tidy(s: string) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?、。！？」』）)])/g, '$1')
    .replace(/([「『（(])\s+/g, '$1')
    .trim()
}

/** Convert an array of Japanese lines into Hepburn romaji (spaced). */
export async function romanize(lines: string[]): Promise<string[]> {
  const k = await getKuroshiro()
  const out: string[] = []
  for (const line of lines) {
    if (!line || !JA.test(line)) {
      out.push('')
      continue
    }
    try {
      const r: string = await k.convert(line, { to: 'romaji', mode: 'spaced', romajiSystem: 'hepburn' })
      out.push(tidy(r))
    } catch {
      out.push('')
    }
  }
  return out
}

export function warmup() {
  getKuroshiro().catch(() => {})
}
