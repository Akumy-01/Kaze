import type { Track } from '../../../shared/types'
import { mediaUrl } from './format'

export type HiResAuthenticityStatus =
  | 'authentic-hires'
  | 'zero-padded'
  | 'upsampled'
  | 'upsampled-and-padded'
  | 'cd-lossless'
  | 'lossy'

export type LosslessSpectralStatus = 'verified-lossless' | 'suspect-low-transcode' | 'suspect-high-transcode' | 'lossy-format'

export interface AudioAnalysisReport {
  trackId: string
  title: string
  artist: string
  format: string
  sampleRate: number
  declaredBits: number
  effectiveBits: number | null
  channels: number
  duration: number
  lossless: boolean

  // Level & Dynamic Metrics
  samplePeakDb: number
  truePeakDb: number
  rmsDb: number
  dynamicRangeDb: number
  clipCount: number

  // Quantization / Zero-padding stats
  grid16MatchPct: number
  grid20MatchPct: number

  // Spectral Metrics
  nyquistKhz: number
  cutoffKhz: number
  bandEnergy: {
    mid1to10k: number
    hi16to18k: number
    hi18to20k: number
    hi20to22k: number
    ultrasonic24kPlus: number | null
  }
  avgSpectrumDb: number[]
  spectrogram: number[][] // [timeSlice][freqBin] in dBFS

  // Verdicts
  losslessStatus: LosslessSpectralStatus
  losslessSummary: string
  hiResStatus: HiResAuthenticityStatus
  hiResSummary: string
  hiResDetails: string[]
}

/** In-place iterative Radix-2 Cooley-Tukey FFT */
function fftReal(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wlenRe = Math.cos(ang)
    const wlenIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      const half = len >> 1
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]
        const uIm = im[i + j]
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + half] = uRe - vRe
        im[i + j + half] = uIm - vIm
        const nextRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextRe
      }
    }
  }
}

const FFT_SIZE = 4096
const HANN = (() => {
  const w = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
  }
  return w
})()

function toDb(linear: number): number {
  return 20 * Math.log10(Math.max(1e-7, linear))
}

function avgBandDb(spectrumDb: Float64Array, sampleRate: number, lowHz: number, highHz: number): number {
  const nyq = sampleRate / 2
  const halfBins = spectrumDb.length
  const lo = Math.max(1, Math.floor((lowHz / nyq) * halfBins))
  const hi = Math.min(halfBins - 1, Math.ceil((highHz / nyq) * halfBins))
  if (hi <= lo) return -130
  let sum = 0
  let cnt = 0
  for (let i = lo; i <= hi; i++) {
    sum += spectrumDb[i]
    cnt++
  }
  return cnt > 0 ? sum / cnt : -130
}

export async function analyzeTrackQuality(track: Track): Promise<AudioAnalysisReport> {
  const targetSr = Math.min(192000, Math.max(8000, track.sampleRate || 48000))
  const resp = await fetch(mediaUrl(track.path))
  if (!resp.ok) throw new Error('无法读取音频文件')
  const arrayBuf = await resp.arrayBuffer()

  const Ctx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
  let decodeCtx: OfflineAudioContext
  try {
    decodeCtx = new Ctx(Math.max(1, track.channels || 2), 1, targetSr)
  } catch {
    decodeCtx = new Ctx(Math.max(1, track.channels || 2), 1, 48000)
  }

  const audioBuf = await decodeCtx.decodeAudioData(arrayBuf)
  const sr = audioBuf.sampleRate
  const chCount = audioBuf.numberOfChannels
  const totalLen = audioBuf.length
  const ch0 = audioBuf.getChannelData(0)
  const ch1 = chCount > 1 ? audioBuf.getChannelData(1) : ch0

  // 1. Level, True Peak (4x cubic oversample), RMS & Bit-Depth Quantization Residue
  let samplePeak = 0
  let truePeak = 0
  let sumSq = 0
  let clipCount = 0

  let checkedSamples = 0
  let match16 = 0
  let match20 = 0
  const quantStride = Math.max(1, Math.floor(totalLen / 180000))

  // Stride slightly on huge files only for true-peak oversampling; check all samples for peak & RMS
  const peakStep = totalLen > 12_000_000 ? 2 : 1
  for (let i = 0; i < totalLen; i += peakStep) {
    const a = ch0[i]
    const b = ch1[i]
    const absA = Math.abs(a)
    const absB = Math.abs(b)
    if (absA > samplePeak) samplePeak = absA
    if (absB > samplePeak) samplePeak = absB
    if (absA >= 0.9999 || absB >= 0.9999) clipCount++
    sumSq += (a * a + b * b) * 0.5

    // Fast 4x Catmull-Rom inter-sample peak check around loud peaks (> 0.65)
    if ((absA > 0.65 || absB > 0.65) && i >= 1 && i + 2 < totalLen) {
      for (const ch of chCount > 1 ? [ch0, ch1] : [ch0]) {
        const y0 = ch[i - 1]
        const y1 = ch[i]
        const y2 = ch[i + 1]
        const y3 = ch[i + 2]
        for (const t of [0.25, 0.5, 0.75]) {
          const t2 = t * t
          const t3 = t2 * t
          const interp =
            0.5 *
            (2 * y1 +
              (-y0 + y2) * t +
              (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
              (-y0 + 3 * y1 - 3 * y2 + y3) * t3)
          const av = Math.abs(interp)
          if (av > truePeak) truePeak = av
        }
      }
    }

    if (i % quantStride === 0 && absA > 0.002) {
      checkedSamples++
      const s16 = a * 32768
      if (Math.abs(s16 - Math.round(s16)) < 1.2e-4) match16++
      const s20 = a * 524288
      if (Math.abs(s20 - Math.round(s20)) < 1.2e-4) match20++
    }
  }
  if (samplePeak > truePeak) truePeak = samplePeak

  const rms = Math.sqrt(sumSq / Math.max(1, Math.floor(totalLen / peakStep)))
  const samplePeakDb = Math.round(toDb(samplePeak) * 100) / 100
  const truePeakDb = Math.round(toDb(truePeak) * 100) / 100
  const rmsDb = Math.round(toDb(rms) * 100) / 100
  const dynamicRangeDb = Math.max(0, Math.round((samplePeakDb - rmsDb) * 10) / 10)

  const grid16Pct = checkedSamples > 0 ? Math.round((match16 / checkedSamples) * 1000) / 10 : 0
  const grid20Pct = checkedSamples > 0 ? Math.round((match20 / checkedSamples) * 1000) / 10 : 0

  const declaredBits = track.bitsPerSample ?? (track.lossless ? 16 : 0)
  let effectiveBits: number | null = null
  if (track.lossless) {
    if (grid16Pct >= 97) effectiveBits = 16
    else if (grid20Pct >= 97) effectiveBits = 20
    else effectiveBits = declaredBits >= 24 ? 24 : Math.max(16, declaredBits)
  }

  // 2. Multi-Window Hann FFT Spectrogram + Average Spectrum
  const halfBins = FFT_SIZE / 2
  const accumDb = new Float64Array(halfBins)
  let validFrames = 0
  const specSlices = 48
  const specBins = 96
  const spectrogram: number[][] = []
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)

  const usableLen = Math.max(1, totalLen - FFT_SIZE)
  for (let s = 0; s < specSlices; s++) {
    const start = Math.floor(((s + 0.5) / specSlices) * usableLen)
    let winRms = 0
    for (let i = 0; i < FFT_SIZE; i++) {
      const sample = (ch0[start + i] + ch1[start + i]) * 0.5
      winRms += sample * sample
      re[i] = sample * HANN[i]
      im[i] = 0
    }
    fftReal(re, im)

    const sliceRow: number[] = new Array(specBins)
    const active = Math.sqrt(winRms / FFT_SIZE) > 0.0025
    if (active) validFrames++

    // Normalization for Hann window sum = FFT_SIZE / 2
    const norm = FFT_SIZE * 0.5
    for (let b = 0; b < halfBins; b++) {
      const mag = Math.hypot(re[b], im[b]) / norm
      const db = Math.max(-135, toDb(mag))
      if (active) accumDb[b] += db
    }

    for (let sb = 0; sb < specBins; sb++) {
      const b0 = Math.floor((sb / specBins) * (halfBins - 1))
      const b1 = Math.max(b0 + 1, Math.floor(((sb + 1) / specBins) * (halfBins - 1)))
      let peakBinDb = -135
      for (let b = b0; b < b1; b++) {
        const db = Math.max(-135, toDb(Math.hypot(re[b], im[b]) / norm))
        if (db > peakBinDb) peakBinDb = db
      }
      sliceRow[sb] = Math.round(peakBinDb * 10) / 10
    }
    spectrogram.push(sliceRow)
  }

  const denom = Math.max(1, validFrames)
  for (let b = 0; b < halfBins; b++) {
    accumDb[b] = accumDb[b] / denom
  }

  // Downsample 2048 FFT bins to 128 curve bins for smooth plotting
  const curveBins = 128
  const avgSpectrumDb: number[] = []
  for (let c = 0; c < curveBins; c++) {
    const b0 = Math.floor((c / curveBins) * (halfBins - 1))
    const b1 = Math.max(b0 + 1, Math.floor(((c + 1) / curveBins) * (halfBins - 1)))
    let sum = 0
    for (let b = b0; b < b1; b++) sum += accumDb[b]
    avgSpectrumDb.push(Math.round((sum / (b1 - b0)) * 10) / 10)
  }

  // 3. Spectral Roll-off / Cutoff Detection
  const nyquistKhz = Math.round((sr / 2000) * 10) / 10
  const mid1to10k = Math.round(avgBandDb(accumDb, sr, 1000, 10000) * 10) / 10
  const hi16to18k = Math.round(avgBandDb(accumDb, sr, 16000, 18000) * 10) / 10
  const hi18to20k = Math.round(avgBandDb(accumDb, sr, 18000, 20000) * 10) / 10
  const hi20to22k = Math.round(avgBandDb(accumDb, sr, 20000, Math.min(22050, sr * 0.49)) * 10) / 10
  const ultrasonic24kPlus =
    sr >= 80000 ? Math.round(avgBandDb(accumDb, sr, 24000, sr * 0.48) * 10) / 10 : null

  // Find highest frequency still meaningfully above spectral noise floor (-98 dBFS or within 46 dB of 1-10k avg)
  const thresholdDb = Math.max(-102, mid1to10k - 46)
  let cutoffHz = sr / 2
  const stepHz = 500
  let consecutiveSilent = 0
  for (let f = 12000; f <= sr * 0.49; f += stepHz) {
    const bandDb = avgBandDb(accumDb, sr, f, Math.min(sr * 0.495, f + stepHz))
    if (bandDb < thresholdDb) {
      consecutiveSilent++
      if (consecutiveSilent >= 2) {
        cutoffHz = Math.max(12000, f - stepHz)
        break
      }
    } else {
      consecutiveSilent = 0
    }
  }
  const cutoffKhz = Math.round((cutoffHz / 1000) * 10) / 10

  // 4. Lossless Spectral Verdict
  let losslessStatus: LosslessSpectralStatus = 'verified-lossless'
  let losslessSummary = '高频能量自然延伸至奈奎斯特边界，符合真实无损频谱特征'
  if (!track.lossless) {
    losslessStatus = 'lossy-format'
    losslessSummary = `有损格式 (${track.format})，存在编码器高频滤波截止（约 ${cutoffKhz} kHz）`
  } else if (cutoffKhz < 17.5 && hi16to18k < mid1to10k - 38) {
    losslessStatus = 'suspect-low-transcode'
    losslessSummary = `检测到约 ${cutoffKhz} kHz 处出现陡降截止，高度疑似由低码率 MP3/AAC 转码封装`
  } else if (cutoffKhz < 19.8 && hi18to20k < mid1to10k - 42 && sr >= 44100) {
    losslessStatus = 'suspect-high-transcode'
    losslessSummary = `检测到约 ${cutoffKhz} kHz 处高频截止特征，疑似由高码率有损音源（如 320k MP3）转码`
  }

  // 5. Hi-Res Authenticity Verdict (Upsampling + Bit-Depth Zero-Padding)
  const isPadded = declaredBits >= 20 && effectiveBits === 16 && grid16Pct >= 97
  const isUpsampled = sr > 48000 && cutoffKhz <= 23.0 && (ultrasonic24kPlus === null || ultrasonic24kPlus < -104)

  let hiResStatus: HiResAuthenticityStatus = 'authentic-hires'
  let hiResSummary = ''
  const hiResDetails: string[] = []

  if (!track.lossless) {
    hiResStatus = 'lossy'
    hiResSummary = '当前曲目为有损编码，不适用无损高解析验证'
  } else if (isPadded && isUpsampled) {
    hiResStatus = 'upsampled-and-padded'
    hiResSummary = '检测到上采样与低位零填充特征，疑似由标准 CD 音轨升频升位封装'
  } else if (isUpsampled) {
    hiResStatus = 'upsampled'
    hiResSummary = `采样率为 ${(sr / 1000).toFixed(1)} kHz，但 ${cutoffKhz} kHz 以上缺乏有效超声波频谱内容，存在上采样迹象`
  } else if (isPadded) {
    hiResStatus = 'zero-padded'
    hiResSummary = `文件声明 ${declaredBits}-bit，但有 ${grid16Pct}% 有效样本精确落在 16-bit 量化网格上，低位存在零填充`
  } else if (sr > 48000 || (declaredBits >= 20 && (effectiveBits ?? 16) >= 20)) {
    hiResStatus = 'authentic-hires'
    hiResSummary = `频谱与有效位深验证通过（约 ${effectiveBits ?? declaredBits}-bit 有效动态${
      sr > 48000 ? `，且 24 kHz 以上存在真实谐波延展` : ''
    }）`
  } else {
    hiResStatus = 'cd-lossless'
    hiResSummary =
      losslessStatus === 'verified-lossless'
        ? `标准 CD 规格真无损 (${declaredBits}-bit / ${(sr / 1000).toFixed(1)} kHz)，未发现填充或伪造迹象`
        : '标准规格无损容器，但高频截止异常，请结合频谱图人工核验'
  }

  hiResDetails.push(
    track.lossless
      ? `位深核验：容器声明 ${declaredBits}-bit → 实测有效位深 ${effectiveBits ?? declaredBits}-bit（16-bit 网格重合率 ${grid16Pct}%）`
      : `编码格式：${track.format}（有损压制）`
  )
  hiResDetails.push(
    `频宽核验：奈奎斯特极限 ${nyquistKhz} kHz，频谱截止约 ${cutoffKhz} kHz${
      ultrasonic24kPlus !== null ? `，>24 kHz 均值 ${ultrasonic24kPlus} dBFS` : ''
    }`
  )
  hiResDetails.push(
    `电平核验：真峰值 ${truePeakDb} dBTP · 采样峰值 ${samplePeakDb} dBFS · RMS ${rmsDb} dBFS · 动态范围 DR ${dynamicRangeDb} dB`
  )

  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    format: track.format,
    sampleRate: sr,
    declaredBits,
    effectiveBits,
    channels: chCount,
    duration: audioBuf.duration,
    lossless: !!track.lossless,
    samplePeakDb,
    truePeakDb,
    rmsDb,
    dynamicRangeDb,
    clipCount,
    grid16MatchPct: grid16Pct,
    grid20MatchPct: grid20Pct,
    nyquistKhz,
    cutoffKhz,
    bandEnergy: {
      mid1to10k,
      hi16to18k,
      hi18to20k,
      hi20to22k,
      ultrasonic24kPlus
    },
    avgSpectrumDb,
    spectrogram,
    losslessStatus,
    losslessSummary,
    hiResStatus,
    hiResSummary,
    hiResDetails
  }
}
