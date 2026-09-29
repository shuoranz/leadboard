import { createContext, useContext, type ReactNode } from 'react'
import type { BoardIndex } from './boardIndex'

const BoardContext = createContext<BoardIndex | null>(null)

export function BoardProvider({ value, children }: { value: BoardIndex; children: ReactNode }) {
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>
}

/** The current app's leaderboard index. Only valid under a BoardProvider. */
export function useBoard(): BoardIndex {
  const board = useContext(BoardContext)
  if (!board) throw new Error('useBoard() must be used inside <BoardProvider>')
  return board
}
