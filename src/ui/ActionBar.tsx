import { useState, useRef, type ReactNode } from 'react'
import { getViewer } from '../engine/viewerRef'
import { CaptureController, downloadBlob } from '../capture/CaptureController'
import { captureMoment } from '../share/moments'
import { writeMomentExplicit, momentUrl } from '../share/deeplink'
import { parseSplatPly } from '../engine/loaders/splatPly'
import { parseSplatSpz } from '../engine/loaders/splatSpz'
import { SplatSequence } from '../engine/loaders/SplatSequence'
import type { GaussianCloudData } from '../engine/scenes/generators'

function IconBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`grid h-8 w-8 place-items-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-ink-100 active:scale-95 ${
        active ? 'bg-lav-300/25 text-lav-100 ring-1 ring-lav-300/40' : ''
      }`}
    >
      {children}
    </button>
  )
}

/** Share a Moment (deep link), export a PNG still, or record a loop clip. */
export function ActionBar() {
  const [flash, setFlash] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const ping = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 1500)
  }

  const parseFile = async (f: File): Promise<GaussianCloudData> => {
    const buf = await f.arrayBuffer()
    return f.name.toLowerCase().endsWith('.spz') ? parseSplatSpz(buf) : parseSplatPly(buf)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    const v = getViewer()
    if (files.length === 0 || !v) return
    try {
      if (files.length === 1) {
        ping('Loading…')
        const data = await parseFile(files[0])
        v.loadGaussianData(data)
        ping(`Loaded ${data.count.toLocaleString()} splats`)
      } else {
        // Multiple files → a 4D sequence (one frame per file, ordered by name).
        ping(`Loading ${files.length} frames…`)
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        const frames: GaussianCloudData[] = []
        for (const f of files) frames.push(await parseFile(f))
        v.loadSequence(SplatSequence.fromFrames(frames))
        ping(`Loaded ${files.length}-frame 4D sequence`)
      }
    } catch (err) {
      ping(err instanceof Error ? err.message : 'Load failed')
    } finally {
      e.target.value = '' // allow re-loading the same file(s)
    }
  }

  const onShare = async () => {
    const v = getViewer()
    if (!v) return
    const m = captureMoment(v)
    writeMomentExplicit(m)
    try {
      await navigator.clipboard.writeText(momentUrl(m))
      ping('Moment link copied')
    } catch {
      ping('Moment saved to URL')
    }
  }

  const onPng = async () => {
    const v = getViewer()
    if (!v) return
    try {
      const blob = await new CaptureController(v).exportPng()
      downloadBlob(blob, `chrono-${stamp()}.png`)
      ping('PNG saved')
    } catch {
      ping('PNG export failed')
    }
  }

  const onClip = async () => {
    const v = getViewer()
    if (!v || recording) return
    setRecording(true)
    try {
      const { blob, ext } = await new CaptureController(v).recordLoop()
      downloadBlob(blob, `chrono-${stamp()}.${ext}`)
      ping('Clip saved')
    } catch (err) {
      ping(err instanceof Error ? err.message : 'Recording failed')
    } finally {
      setRecording(false)
    }
  }

  return (
    <div className="relative">
      <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-full p-1">
        <IconBtn onClick={() => fileRef.current?.click()} title="Load a .ply/.spz splat (select multiple files for a 4D sequence)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4M7 9l5-5 5 5" />
            <path d="M5 20h14" />
          </svg>
        </IconBtn>
        <input ref={fileRef} type="file" accept=".ply,.spz" multiple className="hidden" onChange={onFile} />
        <IconBtn onClick={onShare} title="Copy shareable Moment link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" />
          </svg>
        </IconBtn>
        <IconBtn onClick={onPng} title="Export PNG still">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4z" />
            <circle cx="12" cy="13" r="3.2" />
          </svg>
        </IconBtn>
        <IconBtn onClick={onClip} title="Record a loop clip" active={recording}>
          {recording ? (
            <span className="h-2.5 w-2.5 rounded-[3px] bg-rose-400 shadow-[0_0_8px_rgba(255,120,160,0.9)]" />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
              <path d="m15.5 10 6-3.2v10.4l-6-3.2z" />
            </svg>
          )}
        </IconBtn>
      </div>
      {flash && (
        <div className="glass-deep pointer-events-none absolute right-0 top-11 whitespace-nowrap rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-100">
          {flash}
        </div>
      )}
    </div>
  )
}

function stamp(): string {
  return Math.floor(performance.now()).toString(36)
}
