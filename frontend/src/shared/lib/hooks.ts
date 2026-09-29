import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Tracks an element's content width. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** True once web fonts have loaded, so text measured earlier can be re-measured. */
export function useFontsReady() {
  const [ready, setReady] = useState(() => !document.fonts || document.fonts.status === 'loaded')
  useEffect(() => {
    if (ready) return
    let live = true
    document.fonts.ready.then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [ready])
  return ready
}

let measureCtx: CanvasRenderingContext2D | null | undefined
/** Rendered width of `text` in a CSS `font` shorthand, for SVG label layout. */
export function measureText(text: string, font: string) {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
    } catch {
      measureCtx = null // e.g. jsdom
    }
  }
  if (!measureCtx) return text.length * 7
  measureCtx.font = font
  return measureCtx.measureText(text).width
}
