/// <reference types="vite/client" />
import type { AkumyAPI } from '../../preload/index'

declare global {
  interface Window {
    akumy: AkumyAPI
  }
}

export {}
