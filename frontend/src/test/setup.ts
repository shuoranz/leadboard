import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom lacks these; Radix and ChartFrame use them.
class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    this.cb([{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    void el
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

// No canvas in jsdom; label measurement falls back to an estimate.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
