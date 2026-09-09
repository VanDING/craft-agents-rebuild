import type * as React from 'react'
/** Options remain real buttons; search stays an ordinary labelled input. */
export function handleOptionNavigation(event: React.KeyboardEvent<HTMLElement>) {
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement
  const input = target instanceof HTMLInputElement
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || (input && (event.key === 'Home' || event.key === 'End'))) return
  const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-option]')).filter(el => !el.disabled)
  if (!options.length) return
  const index = options.indexOf(target as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index < 0 ? (event.key === 'ArrowUp' ? options.length - 1 : 0) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  event.preventDefault()
  options[next]!.focus()
}
