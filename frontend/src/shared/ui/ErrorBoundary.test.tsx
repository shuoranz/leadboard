import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

describe('ErrorBoundary', () => {
  it('shows the fallback on a render error and recovers on reset', async () => {
    // React rethrows render errors to window in dev; the boundary is what's under test.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const swallow = (e: ErrorEvent) => e.preventDefault()
    window.addEventListener('error', swallow)
    let fail = true
    const Flaky = () => {
      if (fail) throw new Error('boom')
      return <p>recovered</p>
    }
    render(
      <ErrorBoundary fallback={(e, reset) => <button onClick={reset}>{e.message}</button>}>
        <Flaky />
      </ErrorBoundary>,
    )
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'boom' }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
    window.removeEventListener('error', swallow)
  })
})
