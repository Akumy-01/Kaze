import { createContext, useContext } from 'react'

export const ScrollContext = createContext<HTMLElement | null>(null)
export const useScrollParent = () => useContext(ScrollContext)
