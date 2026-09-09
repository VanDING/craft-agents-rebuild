import * as React from 'react'

/** Roving focus for existing button-based radio groups. No observers or input state. */
export function useRadioGroupNavigation(selection: string, children: unknown) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter(el => el.closest('[role="radiogroup"]') === group)
    const entry = radios.find(el => el.getAttribute('aria-checked') === 'true' && !el.disabled) ?? radios.find(el => !el.disabled)
    for (const radio of radios) radio.tabIndex = radio === entry ? 0 : -1
  }, [selection, children])
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const group = event.currentTarget
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'radio' || target.closest('[role="radiogroup"]') !== group) return
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).filter(el => !el.disabled && el.closest('[role="radiogroup"]') === group)
    if (!radios.length) return
    const index = radios.indexOf(target as HTMLButtonElement)
    const rtl = getComputedStyle(group).direction === 'rtl'
    const forward = event.key === 'ArrowDown' || event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (index + (forward ? 1 : -1) + radios.length) % radios.length
    event.preventDefault()
    radios[next]!.focus()
    radios[next]!.click()
  }
  return { ref, onKeyDown }
}
