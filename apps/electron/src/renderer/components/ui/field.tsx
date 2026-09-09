import * as React from 'react'
import { cn } from '@/lib/utils'

export interface FieldOptions {
  id?: string
  description?: React.ReactNode
  error?: React.ReactNode
  'aria-describedby'?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
}

/** IDs only: no provider, cloned children or input state ownership. */
export function useField({ id, description, error, 'aria-describedby': describedBy, 'aria-invalid': invalid }: FieldOptions) {
  const generatedId = React.useId()
  const controlId = id ?? generatedId
  const descriptionId = description ? `${controlId}-description` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const ids = [...new Set([describedBy, descriptionId, errorId].filter(Boolean).join(' ').split(/\s+/).filter(Boolean))]
  return {
    id: controlId, descriptionId, errorId,
    controlProps: { id: controlId, 'aria-describedby': ids.join(' ') || undefined, 'aria-invalid': error ? true as const : invalid },
  }
}

export function FieldHeader({ id, label, description, descriptionId }: {
  id: string; label?: React.ReactNode; description?: React.ReactNode; descriptionId?: string
}) {
  if (!label && !description) return null
  return <div className="craft-field-header">
    {label && <label htmlFor={id} className="craft-field-label">{label}</label>}
    {description && <p id={descriptionId} className="craft-field-description">{description}</p>}
  </div>
}

export function FieldError({ id, children, className }: { id?: string; children?: React.ReactNode; className?: string }) {
  return children ? <p id={id} className={cn('craft-field-error', className)}>{children}</p> : null
}
