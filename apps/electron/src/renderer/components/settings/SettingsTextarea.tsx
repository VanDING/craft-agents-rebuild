import * as React from 'react'
import { Textarea } from '@/components/ui/textarea'
import { FieldHeader, FieldError, useField } from '@/components/ui/field'
import { cn } from '@/lib/utils'
export interface SettingsTextareaProps extends React.AriaAttributes {
  id?: string
  label?: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  rows?: number
  disabled?: boolean
  readOnly?: boolean
  error?: string
  className?: string
  inCard?: boolean
}
export function SettingsTextarea({ label, description, value, onChange, placeholder, maxLength, rows = 4, disabled, error, className, inCard = false, ...native }: SettingsTextareaProps) {
  const field = useField({ ...native, description, error })
  const overLimit = maxLength !== undefined && value.length > maxLength
  const countId = field.id + '-count'
  return <div className={cn('craft-field', inCard && 'craft-settings-padding', className)}>
    <FieldHeader {...field} label={label} description={description} />
    <div className="craft-field-surface">
      <Textarea {...native} {...field.controlProps} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} disabled={disabled}
        aria-invalid={!!error || overLimit || undefined}
        aria-describedby={[field.controlProps['aria-describedby'], maxLength !== undefined && countId].filter(Boolean).join(' ') || undefined}
        className="resize-y min-h-[120px]" />
    </div>
    <div className="flex justify-between gap-2">
      <FieldError id={field.errorId}>{error}</FieldError>
      {maxLength !== undefined && <span id={countId} className={cn('ml-auto text-xs tabular-nums', overLimit ? 'text-destructive' : 'text-muted-foreground')}>{value.length}/{maxLength}</span>}
    </div>
  </div>
}
