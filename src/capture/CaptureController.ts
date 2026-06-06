import type { SplatViewer } from '../engine/SplatViewer'
import { useViewerStore } from '../state/store'
import { LOOP_SECONDS } from '../engine/constants'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function pickVideoMime(): string {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  }
  return 'video/webm'
}

export function extForMime(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/**
 * Still + clip capture.
 *  • PNG — deterministic single frame at the current time (engine renders it
 *    synchronously; the renderer keeps `preserveDrawingBuffer` so toBlob is safe).
 *  • Clip — one seamless loop recorded in realtime via MediaRecorder off the live
 *    canvas. (A deterministic, faster-than-realtime WebCodecs path is a future upgrade.)
 */
export class CaptureController {
  constructor(private readonly viewer: SplatViewer) {}

  async exportPng(): Promise<Blob> {
    const canvas = this.viewer.domElement
    const t = useViewerStore.getState().time
    const restore = this.viewer.beginCapture()
    try {
      this.viewer.renderAt(t)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'))
      if (!blob) throw new Error('PNG capture failed')
      return blob
    } finally {
      restore()
    }
  }

  /** Record exactly one seamless loop. Resolves to a video Blob (mp4 or webm). */
  async recordLoop(onRecording?: (active: boolean) => void): Promise<{ blob: Blob; ext: string }> {
    const canvas = this.viewer.domElement
    const store = useViewerStore.getState()
    // The director-preview branch ignores store.playing, so leave preview first.
    if (store.isPreviewingShot) store.setPreviewingShot(false)

    const mime = pickVideoMime()
    let rec: MediaRecorder
    let stream: MediaStream
    try {
      stream = canvas.captureStream(60)
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
    } catch {
      onRecording?.(false)
      throw new Error('Clip recording is not supported in this browser')
    }
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    const done = new Promise<Blob>((res) => {
      rec.onstop = () => res(new Blob(chunks, { type: mime }))
    })

    const prevPlaying = store.playing
    const prevTime = store.time
    const restoreCamera = this.viewer.freezeCameraForCapture() // steady camera → seamless loop
    store.setTime(0)
    store.setPlaying(true)
    onRecording?.(true)
    try {
      rec.start()
      await new Promise((r) => setTimeout(r, LOOP_SECONDS * 1000 + 90))
    } finally {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* already stopped */
      }
      onRecording?.(false)
      store.setPlaying(prevPlaying)
      store.setTime(prevTime)
      restoreCamera()
    }
    return { blob: await done, ext: extForMime(mime) }
  }
}
