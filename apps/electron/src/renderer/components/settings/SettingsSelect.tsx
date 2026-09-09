import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { FieldHeader, FieldError, useField } from '@/components/ui/field'
import { cn } from '@/lib/utils'
export interface SettingsSelectOption { value: string; label: string; disabled?: boolean; group?: string }
export interface SettingsSelectProps extends React.AriaAttributes {
  id?: string
  label?: string
  description?: string
  value: string
  onValueChange: (value: string) => void
  options: SettingsSelectOption[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  error?: string
  className?: string
  inCard?: boolean
}
function Options({ options }: { options: SettingsSelectOption[] }) {
  const groups = new Map<string, SettingsSelectOption[]>()
  for (const option of options) {
    const key = option.group ?? ''
    const items = groups.get(key)
    if (items) items.push(option)
    else groups.set(key, [option])
  }
  return <>{Array.from(groups, ([name, items]) => <SelectGroup key={name}>
    {name && <SelectLabel>{name}</SelectLabel>}
    {items.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
  </SelectGroup>)}</>
}
function SettingsSelectField({ label, description, value, onValueChange, options, placeholder = 'Select...', disabled, loading, error, className, inCard = false, inline, ...aria }: SettingsSelectProps & { inline?: boolean }) {
  const field = useField({ ...aria, description, error })
  const { t } = useTranslation()
  return <div data-layout={inline ? 'settings-row' : undefined} className={cn(inline ? 'craft-settings-row flex items-center justify-between' : 'craft-field', inCard ? 'craft-settings-padding' : inline && 'craft-settings-plain', className)}>
    <div className="craft-field-header min-w-0 flex-1"><FieldHeader {...field} label={label} description={description} /><FieldError id={field.errorId}>{error}</FieldError></div>
    <div data-layout={inline ? 'settings-control' : undefined} className={cn('min-w-0', inline && 'w-[180px] max-w-full shrink-0')}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled || loading}>
        <SelectTrigger {...aria} {...field.controlProps} aria-busy={loading || undefined} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent><Options options={options} />{options.length === 0 && <p role="status" className="px-3 py-2 text-sm text-muted-foreground">{t('chat.noResults')}</p>}</SelectContent>
      </Select>
      {loading && <p role="status" className="craft-field-description mt-1">{t('common.loading')}</p>}
    </div>
  </div>
}
export function SettingsSelect(props: SettingsSelectProps) { return <SettingsSelectField {...props} /> }
export interface SettingsSelectRowProps extends SettingsSelectProps { label: string }
export function SettingsSelectRow({ inCard = true, ...props }: SettingsSelectRowProps) { return <SettingsSelectField {...props} inCard={inCard} inline /> }
