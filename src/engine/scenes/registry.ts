import {
  galaxyCloud,
  sphereCloud,
  supernovaCloud,
  waveCloud,
  auroraCloud,
  morphCloud,
  type GaussianCloudData,
} from './generators'

/**
 * A scene = a base-cloud generator + the deform mode that animates it. The
 * shader's `uMode` and the CPU `deformPosition()`/`deformMorph()` both key off
 * `mode`, so the two stay in sync.
 */
export interface SceneDef {
  id: string
  name: string
  /** deform mode index, shared by the shader (uMode) and the CPU mirror */
  mode: number
  build: (count: number) => GaussianCloudData
}

export const SCENES: SceneDef[] = [
  { id: 'galaxy', name: 'Galaxy', mode: 0, build: galaxyCloud },
  { id: 'pulse', name: 'Pulse', mode: 1, build: (n) => sphereCloud(n) },
  { id: 'supernova', name: 'Supernova', mode: 2, build: supernovaCloud },
  { id: 'wave', name: 'Wave', mode: 3, build: waveCloud },
  { id: 'aurora', name: 'Aurora', mode: 4, build: auroraCloud },
  { id: 'morph', name: 'Morph', mode: 5, build: morphCloud },
]
