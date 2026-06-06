/// <reference types="vite/client" />

// Allow importing GLSL shader sources as raw strings (used from M1 onward):
//   import frag from './splat.frag.glsl?raw'
declare module '*.glsl?raw' {
  const value: string
  export default value
}
declare module '*.vert?raw' {
  const value: string
  export default value
}
declare module '*.frag?raw' {
  const value: string
  export default value
}
