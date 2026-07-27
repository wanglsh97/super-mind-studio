import type { ChatEvent, TextModelId, Usage } from '@supermind/sdk'

export type CompareStatus = 'loading' | 'streaming' | 'success' | 'error' | 'cancelled'

export interface CompareColumn {
  model: TextModelId
  status: CompareStatus
  content: string
  requestId?: string
  usage?: Usage
  error?: string
}

export interface CompareState {
  columns: readonly CompareColumn[]
  active: boolean
}

export type CompareAction =
  | { type: 'start'; models: readonly TextModelId[] }
  | { type: 'event'; model: TextModelId; event: ChatEvent }
  | { type: 'fail'; model: TextModelId; message: string }
  | { type: 'cancel'; model: TextModelId }
  | { type: 'cancelAll' }

export const initialCompareState: CompareState = { columns: [], active: false }

export function compareReducer(state: CompareState, action: CompareAction): CompareState {
  if (action.type === 'start') {
    return {
      active: true,
      columns: action.models.map((model) => ({ model, status: 'loading', content: '' })),
    }
  }
  if (action.type === 'cancelAll') {
    return finishIfSettled({
      ...state,
      columns: state.columns.map((column) =>
        isActive(column.status) ? { ...column, status: 'cancelled' } : column,
      ),
    })
  }
  if (action.type === 'cancel') {
    return updateColumn(state, action.model, (column) =>
      isActive(column.status) ? { ...column, status: 'cancelled' } : column,
    )
  }
  if (action.type === 'fail') {
    return updateColumn(state, action.model, (column) => ({
      ...column,
      status: 'error',
      error: action.message,
    }))
  }
  return updateColumn(state, action.model, (column) => applyEvent(column, action.event))
}

function applyEvent(column: CompareColumn, event: ChatEvent): CompareColumn {
  if (!isActive(column.status)) return column
  switch (event.type) {
    case 'start':
      return { ...column, requestId: event.requestId }
    case 'delta':
      return { ...column, status: 'streaming', content: column.content + event.content }
    case 'usage':
      return { ...column, usage: event.usage }
    case 'error':
      return { ...column, status: 'error', error: event.error.message }
    case 'done':
      return { ...column, status: 'success' }
  }
}

function updateColumn(
  state: CompareState,
  model: TextModelId,
  update: (column: CompareColumn) => CompareColumn,
): CompareState {
  return finishIfSettled({
    ...state,
    columns: state.columns.map((column) => (column.model === model ? update(column) : column)),
  })
}

function finishIfSettled(state: CompareState): CompareState {
  return { ...state, active: state.columns.some(({ status }) => isActive(status)) }
}

function isActive(status: CompareStatus): boolean {
  return status === 'loading' || status === 'streaming'
}
