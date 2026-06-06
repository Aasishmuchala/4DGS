import type { SplatViewer } from './SplatViewer'

/**
 * A module-level handle to the live engine so React UI (capture buttons, Moment
 * sharing) can call imperative viewer methods without threading the instance
 * through context or coupling it into the zustand store (which would create an
 * import cycle). App sets it on mount; clears on unmount.
 */
let current: SplatViewer | null = null

export function setViewerRef(v: SplatViewer | null): void {
  current = v
}

export function getViewer(): SplatViewer | null {
  return current
}
