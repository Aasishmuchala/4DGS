/** Maximum gaussians per scene (the "Ultra" ceiling). The AdaptiveQuality
 *  controller scales the *active* fraction down to hold the target FPS on weaker
 *  GPUs, so this can be set high for the 5090 without hurting the M1. */
export const GAUSSIAN_COUNT = 300_000

/** Wall-clock length of one full timeline loop, in seconds. */
export const LOOP_SECONDS = 10
