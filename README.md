# CHRONO — 4D Splat Studio

A real-time, browser-based **4D Gaussian Splatting** studio. Generate animated
gaussian scenes, **scrub or freeze time, and orbit the frozen moment from any
angle** — then author cinematic shots and share an exact, orbitable moment.

Built with Vite + React + TypeScript + Three.js. WebGL2 baseline (runs on Apple
Silicon); a WebGPU compute-sort path is planned for high-end GPUs.

## Why it's different

The market splits into **polished but static** (SuperSplat, Luma, Marble) and
**dynamic but unpolished/VR-locked** (Gracia, 4DV, research viewers). CHRONO owns
the empty quadrant: a polished, flat-web, real-time **4D** studio whose signature
interaction is freeze-and-orbit, whose content is **procedural** (shapeable, not
baked), and whose unit of sharing is an orbitable **Moment**.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build      # production bundle
npm run preview    # serve the production bundle
npm run typecheck  # tsc --noEmit
```

## Roadmap

| #  | Milestone | Status |
| -- | --------- | ------ |
| M0 | Scaffold + cinematic design system + orbit canvas | ✅ done |
| M1 | Gaussian splat core: EWA projection, conic falloff, premult blend, depth sort | ✅ done |
| M2 | 4D + freeze-and-orbit hero: `deform()`, grab-to-freeze, timeline transport | ✅ done |
| —  | Hero polish: bloom, starfield, vignette, seamless+organic motion | ✅ done |
| M3 | 6 procedural scenes (Galaxy/Pulse/Supernova/Wave/Aurora/Morph) + live field params | ✅ done |
| M5 | Moments — shareable deep-links + PNG still + loop clip (MediaRecorder) | ✅ done |
| M4 | Director Mode — dual-track camera × time keyframes | ✅ done |
| M6 | Performance — adaptive quality (FPS-hold + tiers), 300k ceiling | ✅ done |
| R1 | Real-data ingest — load real 3DGS `.ply` captures (static, orbit) | ✅ done |
| M6+ | Web Worker deform+sort (push ceiling past 300k); WebGPU compute sort | ⬜ spec ready |
| R2 | SPZ loader + 4D sequence playback (per-frame splat streaming) | ⬜ planned |

## Architecture

```
React HUD (state/store.ts ⇄ engine)   ← thin glass UI shell
        ▼
engine/SplatViewer.ts                  ← owns renderer, scene, camera, loop
  ├─ GaussianSplatMaterial (M1)        ← custom EWA splat shaders
  ├─ sort/ (M1)                        ← off-thread depth sort
  └─ scenes/ (M3)                      ← procedural base-cloud generators
```
