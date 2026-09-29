import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Leaderboard } from '../api/types'
import { BoardProvider } from '../shared/board/BoardContext'
import { buildBoardIndex } from '../shared/board/boardIndex'
import { TooltipProvider } from '../shared/ui/Tooltip'

/** Renders UI under the app's providers, starting at `url`. */
export function renderWithProviders(ui: ReactNode, { url = '/', board }: { url?: string; board?: Leaderboard } = {}) {
  window.history.replaceState(null, '', url)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const content = board ? <BoardProvider value={buildBoardIndex(board)}>{ui}</BoardProvider> : ui
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{content}</TooltipProvider>
    </QueryClientProvider>,
  )
}
