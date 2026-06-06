import { useEffect, useRef } from 'react'
import { SplatViewer } from './engine/SplatViewer'
import { setViewerRef } from './engine/viewerRef'
import { readMomentHash, decodeMoment } from './share/deeplink'
import { applyMoment } from './share/moments'
import { parseSplatPly } from './engine/loaders/splatPly'
import { parseSplatSpz } from './engine/loaders/splatSpz'
import { SplatSequence } from './engine/loaders/SplatSequence'
import { Hud } from './ui/Hud'

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const viewer = new SplatViewer(canvas)
    setViewerRef(viewer)

    // Dev-only: load real captures from URLs (for automated verification).
    if (import.meta.env.DEV) {
      const g = globalThis as Record<string, unknown>
      g.chronoLoadPly = async (url: string) => {
        const data = parseSplatPly(await (await fetch(url)).arrayBuffer())
        viewer.loadGaussianData(data)
        return data.count
      }
      g.chronoLoadSpz = async (url: string) => {
        const data = await parseSplatSpz(await (await fetch(url)).arrayBuffer())
        viewer.loadGaussianData(data)
        return data.count
      }
      g.chronoLoadSeq = async (urls: string[]) => {
        const seq = await SplatSequence.load(urls)
        viewer.loadSequence(seq)
        return seq.frameCount
      }
    }

    // Restore a shared "Moment" from the URL hash (also on browser back/forward).
    const restore = () => {
      const enc = readMomentHash()
      if (!enc) return
      const m = decodeMoment(enc)
      if (m) applyMoment(viewer, m)
    }
    restore()
    window.addEventListener('popstate', restore)

    return () => {
      window.removeEventListener('popstate', restore)
      setViewerRef(null)
      viewer.dispose()
    }
  }, [])

  return (
    <div className="relative h-dvh w-screen overflow-hidden">
      {/* Cinematic backdrop behind the transparent canvas */}
      <div className="stage-gradient pointer-events-none absolute inset-0" />

      {/* The 3D stage */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Cinematic vignette to focus the eye on the splat */}
      <div className="vignette pointer-events-none absolute inset-0" />

      {/* Soft top/bottom scrims so glass UI always has contrast */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-950/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-ink-950/80 to-transparent" />

      {/* Heads-up display */}
      <Hud />
    </div>
  )
}
