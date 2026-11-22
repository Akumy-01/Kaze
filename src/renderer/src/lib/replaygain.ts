import type { ReplayGainUpdate, Track } from '../../../shared/types'
import type { PeqBand, PeqProfile, SettingsState } from '../store/settings'
import { mediaUrl } from './format'

export interface ReplayGainInfo {
  active: boolean
  modeUsed: 'off' | 'track' | 'album'
  gainDb: number
  peak: number
  antiClipped: boolean
  linear: number
}

/**
 * Compute ReplayGain linear multiplier for a given track and current settings.
 * - Shuffle mode in 'auto' -> uses Track Gain
 * - Album/Sequential mode in 'auto' -> uses Album Gain (falls back to Track Gain)
 * - Anti-clipping: if gain * peak > 0.988 (-0.1 dBFS), reduces gain to prevent clipping without compressing dynamics.
 */
export function computeReplayGain(
  track: Track | undefined,
  settings: Pick<SettingsState, 'audioPreset' | 'replayGainMode' | 'replayGainPreampDb' | 'replayGainAntiClip'>,
  isShuffle: boolean
): ReplayGainInfo {
  if (!track || settings.audioPreset === 'direct' || settings.replayGainMode === 'off') {
    return { active: false, modeUsed: 'off', gainDb: 0, peak: 1, antiClipped: false, linear: 1 }
  }

  const preferAlbum = settings.replayGainMode === 'album' || (settings.replayGainMode === 'auto' && !isShuffle)
  let rawDb: number | undefined
  let peak: number | undefined
  let modeUsed: 'track' | 'album' = 'track'

  if (preferAlbum) {
    if (typeof track.replayGainAlbumDb === 'number' && isFinite(track.replayGainAlbumDb)) {
      rawDb = track.replayGainAlbumDb
      peak = track.replayGainAlbumPeak ?? track.replayGainTrackPeak
      modeUsed = 'album'
    } else if (typeof track.replayGainTrackDb === 'number' && isFinite(track.replayGainTrackDb)) {
      rawDb = track.replayGainTrackDb
      peak = track.replayGainTrackPeak
      modeUsed = 'track'
    }
  } else {
    if (typeof track.replayGainTrackDb === 'number' && isFinite(track.replayGainTrackDb)) {
      rawDb = track.replayGainTrackDb
      peak = track.replayGainTrackPeak
      modeUsed = 'track'
    } else if (typeof track.replayGainAlbumDb === 'number' && isFinite(track.replayGainAlbumDb)) {
      rawDb = track.replayGainAlbumDb
      peak = track.replayGainAlbumPeak
      modeUsed = 'album'
    }
  }

  if (rawDb === undefined) {
    return { active: false, modeUsed: 'off', gainDb: 0, peak: track.replayGainTrackPeak ?? 1, antiClipped: false, linear: 1 }
  }

  const totalDb = Math.max(-24, Math.min(18, rawDb + (settings.replayGainPreampDb || 0)))
  let linear = Math.pow(10, totalDb / 20)
  const safePeak = typeof peak === 'number' && peak > 0 && isFinite(peak) ? peak : 1
  let antiClipped = false

  // Prevent clipping by reducing gain when linear * peak exceeds -0.1 dBFS (0.9885)
  const ceiling = 0.9885
  if (settings.replayGainAntiClip && linear * safePeak > ceiling) {
    linear = ceiling / safePeak
    antiClipped = true
  }

  const effectiveDb = Math.round(20 * Math.log10(Math.max(1e-6, linear)) * 100) / 100
  return {
    active: true,
    modeUsed,
    gainDb: effectiveDb,
    peak: safePeak,
    antiClipped,
    linear
  }
}

/**
 * Analytical RBJ Audio-EQ-Cookbook Biquad magnitude response |H(e^jw)| in dB
 * Used for both UI frequency response curve plotting and Auto-Headroom anti-clipping calculation.
 */
export function evaluateBiquadDb(band: PeqBand, freq: number, sampleRate = 48000): number {
  if (!band.enabled || Math.abs(band.gain) < 0.01) return 0
  const A = Math.pow(10, band.gain / 40)
  const w0 = (2 * Math.PI * Math.max(10, Math.min(sampleRate * 0.49, band.freq))) / sampleRate
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const Q = Math.max(0.1, Math.min(18, band.q))
  const alpha = sinW0 / (2 * Q)

  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0

  if (band.type === 'peaking') {
    b0 = 1 + alpha * A
    b1 = -2 * cosW0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cosW0
    a2 = 1 - alpha / A
  } else if (band.type === 'lowshelf') {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha)
    b1 = 2 * A * (A - 1 - (A + 1) * cosW0)
    b2 = A * (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha)
    a0 = A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha
    a1 = -2 * (A - 1 + (A + 1) * cosW0)
    a2 = A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha
  } else if (band.type === 'highshelf') {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha
    b0 = A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha)
    b1 = -2 * A * (A - 1 + (A + 1) * cosW0)
    b2 = A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha)
    a0 = A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha
    a1 = 2 * (A - 1 - (A + 1) * cosW0)
    a2 = A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha
  }

  const w = (2 * Math.PI * freq) / sampleRate
  const cosW = Math.cos(w)
  const cos2W = Math.cos(2 * w)
  const sinW = Math.sin(w)
  const sin2W = Math.sin(2 * w)

  const numRe = b0 + b1 * cosW + b2 * cos2W
  const numIm = -(b1 * sinW + b2 * sin2W)
  const denRe = a0 + a1 * cosW + a2 * cos2W
  const denIm = -(a1 * sinW + a2 * sin2W)

  const numMagSq = numRe * numRe + numIm * numIm
  const denMagSq = Math.max(1e-18, denRe * denRe + denIm * denIm)
  return 10 * Math.log10(numMagSq / denMagSq)
}

export function computePeqResponse(profile: PeqProfile, freqs: number[], sampleRate = 48000) {
  const curveDb: number[] = new Array(freqs.length).fill(0)
  let maxRawBoostDb = 0

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i]
    let sumDb = 0
    for (const b of profile.bands) {
      sumDb += evaluateBiquadDb(b, f, sampleRate)
    }
    curveDb[i] = sumDb
    if (sumDb > maxRawBoostDb) maxRawBoostDb = sumDb
  }

  // Calculate effective preamp with Auto-Headroom anti-clipping
  let effectivePreampDb = profile.preampDb
  if (profile.autoHeadroom && maxRawBoostDb + effectivePreampDb > -0.2) {
    effectivePreampDb = -(maxRawBoostDb + 0.2)
  }

  const totalDb = curveDb.map((v) => v + effectivePreampDb)
  return {
    rawCurveDb: curveDb,
    totalCurveDb: totalDb,
    maxRawBoostDb: Math.round(maxRawBoostDb * 10) / 10,
    effectivePreampDb: Math.round(effectivePreampDb * 10) / 10
  }
}

/**
 * Analyze an AudioBuffer to estimate ReplayGain (target -18 LUFS / ReplayGain 2.0 reference) and sample peak.
 * Runs in chunks with gating so silence doesn't skew the loudness measurement.
 */
function analyzeAudioBuffer(buf: AudioBuffer): { gainDb: number; peak: number } {
  const nCh = buf.numberOfChannels
  const len = buf.length
  const sr = buf.sampleRate
  if (len === 0 || nCh === 0) return { gainDb: 0, peak: 1 }

  const channels: Float32Array[] = []
  for (let c = 0; c < nCh; c++) channels.push(buf.getChannelData(c))

  let peak = 0
  // 400ms block size with 200ms hop (stride by 4 samples for fast background scan)
  const blockSamples = Math.max(1024, Math.floor(sr * 0.4))
  const hopSamples = Math.max(512, Math.floor(sr * 0.2))
  const blockEnergies: number[] = []

  for (let start = 0; start < len; start += hopSamples) {
    const end = Math.min(len, start + blockSamples)
    const count = end - start
    if (count < 256) break
    let sumSq = 0
    let samplesChecked = 0
    for (let i = start; i < end; i += 4) {
      samplesChecked++
      for (let c = 0; c < nCh; c++) {
        const s = channels[c][i]
        const abs = s < 0 ? -s : s
        if (abs > peak) peak = abs
        sumSq += s * s
      }
    }
    const meanSq = sumSq / Math.max(1, samplesChecked * nCh)
    // Absolute gate at -70 LUFS (~1e-7 mean square)
    if (meanSq > 1e-7) {
      blockEnergies.push(meanSq)
    }
  }

  if (blockEnergies.length === 0) {
    return { gainDb: 0, peak: Math.max(0.01, peak) }
  }

  // Relative gate at -10 dB below ungated average (ITU-R BS.1770 / EBU R128 style)
  const ungatedMean = blockEnergies.reduce((a, b) => a + b, 0) / blockEnergies.length
  const relGate = ungatedMean * 0.1
  const gated = blockEnergies.filter((e) => e >= relGate)
  const finalMean = (gated.length ? gated : blockEnergies).reduce((a, b) => a + b, 0) / Math.max(1, gated.length || blockEnergies.length)

  // Estimate integrated loudness in LUFS (approx -0.691 + 10 * log10(meanSq))
  const lufs = -0.691 + 10 * Math.log10(Math.max(1e-10, finalMean))
  // ReplayGain 2.0 target is -18 LUFS
  const gainDb = Math.max(-18, Math.min(15, Math.round((-18 - lufs) * 100) / 100))
  const roundedPeak = Math.round(Math.max(0.001, peak) * 10000) / 10000

  return { gainDb, peak: roundedPeak }
}

let scanningRg = false
export function isScanningReplayGain() {
  return scanningRg
}

/**
 * Scan tracks missing ReplayGain metadata in the background and save results to local database.
 */
export async function scanTracksReplayGain(
  tracks: Track[],
  onProgress?: (done: number, total: number, currentTitle: string) => void,
  onlyMissing = true
): Promise<ReplayGainUpdate[]> {
  if (scanningRg) return []
  const targets = onlyMissing
    ? tracks.filter((t) => typeof t.replayGainTrackDb !== 'number' || !isFinite(t.replayGainTrackDb))
    : tracks
  if (!targets.length) return []

  scanningRg = true
  const updates: ReplayGainUpdate[] = []
  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
  const decodeCtx = new OfflineCtx(2, 44100, 44100)

  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      onProgress?.(i + 1, targets.length, t.title)
      try {
        const res = await fetch(mediaUrl(t.path))
        if (!res.ok) continue
        const ab = await res.arrayBuffer()
        const audioBuf = await decodeCtx.decodeAudioData(ab)
        const { gainDb, peak } = analyzeAudioBuffer(audioBuf)
        updates.push({
          id: t.id,
          replayGainTrackDb: gainDb,
          replayGainTrackPeak: peak
        })
        // Flush in batches of 5 so library.json stays updated incrementally
        if (updates.length % 5 === 0) {
          await window.kaze.library.updateReplayGain(updates.slice(-5))
        }
      } catch (e) {
        console.warn('[ReplayGain] skip track', t.title, e)
      }
      // Yield to UI thread between tracks
      await new Promise((r) => setTimeout(r, 25))
    }
    const remainder = updates.length % 5
    if (remainder > 0) {
      await window.kaze.library.updateReplayGain(updates.slice(-remainder))
    }
  } finally {
    scanningRg = false
  }
  return updates
}
