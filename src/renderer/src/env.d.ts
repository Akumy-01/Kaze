/// <reference types="vite/client" />
import type { KazeAPI } from '../../preload/index'

declare global {
  interface Window {
    kaze: KazeAPI
    akumy: KazeAPI
  }
}

export {}
