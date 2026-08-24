import type { AnnotationV1 } from '@craft-agent/core'
import { annotationColorToCss } from './annotation-style-tokens'

export function clearBlockAnnotationMarkers(root: HTMLElement): void {
  const blocks = root.querySelectorAll<HTMLElement>('[data-ca-block-annotated="true"]')
  blocks.forEach((block) => {
    block.removeAttribute('data-ca-block-annotated')
    // Imperative annotation cleanup cannot be expressed as a utility class.
    // eslint-disable-next-line craft-styles/no-nonstandard-shadows
    block.style.boxShadow = ''
    block.style.backgroundColor = ''
  })
}

export function applyBlockAnnotationMarker(root: HTMLElement, annotation: AnnotationV1): void {
  const blockSelector = annotation.target.selectors.find((selector) => selector.type === 'block') as Extract<
    AnnotationV1['target']['selectors'][number],
    { type: 'block' }
  > | undefined

  if (!blockSelector) return

  const selector = blockSelector.blockId
    ? `[data-ca-block-id="${CSS.escape(blockSelector.blockId)}"]`
    : `[data-ca-block-path="${CSS.escape(blockSelector.path)}"]`

  const target = root.querySelector<HTMLElement>(selector)
  if (!target) return

  target.setAttribute('data-ca-block-annotated', 'true')
  target.style.backgroundColor = annotationColorToCss(annotation.style?.color)
  // The marker is attached to rendered markdown nodes outside React's class tree.
  // eslint-disable-next-line craft-styles/no-nonstandard-shadows
  target.style.boxShadow = 'inset 0 0 0 1px color-mix(in srgb, var(--info) 22%, transparent)'
}
