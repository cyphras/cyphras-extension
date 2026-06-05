declare const __APP_VERSION__: string

declare module 'stellar-identicon-js' {
  interface IdenticonOptions {
    width?: number
    height?: number
  }
  function createStellarIdenticon(address: string, options?: IdenticonOptions): HTMLCanvasElement
  export default createStellarIdenticon
}
