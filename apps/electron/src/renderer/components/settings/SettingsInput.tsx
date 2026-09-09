import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { FieldHeader, FieldError, useField } from '@/components/ui/field'
import { cn } from '@/lib/utils'

export interface SettingsInputProps extends React.AriaAttributes {
  id?: string
  name?: string
  label?: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'email' | 'url'
  disabled?: boolean
  readOnly?: boolean
  required?: boolean
  autoComplete?: string
  error?: string
  action?: React.ReactNode
  className?: string
  inCard?: boolean
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  inputRef?: React.Ref<HTMLInputElement>
}

function SecretToggle({ visible, onToggle, disabled }: { visible: boolean; onToggle: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return <button type="button" className="craft-icon-button craft-focus absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
    onClick={onToggle} disabled={disabled} aria-label={t(visible ? 'common.hideSecret' : 'common.showSecret')}>
    {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
  </button>
}

export function SettingsInput({ label, description, value, onChange, placeholder, type = 'text', disabled, error, action, className, inCard = false, onBlur, onKeyDown, inputRef, ...native }: SettingsInputProps) {
  const field = useField({ ...native, description, error })
  const [visible, setVisible] = React.useState(false)
  return <div className={cn('craft-field', inCard && 'craft-settings-padding', className)}>
    <FieldHeader {...field} label={label} description={description} />
    <div className="flex items-start gap-2 min-w-0">
      <div className="craft-field-surface flex-1">
        <Input {...native} {...field.controlProps} ref={inputRef} type={type === 'password' && visible ? 'text' : type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} onBlur={onBlur} onKeyDown={onKeyDown} className={cn(type === 'password' && 'pr-12')} />
        {type === 'password' && <SecretToggle visible={visible} onToggle={() => setVisible(v => !v)} disabled={disabled} />}
      </div>
      {action}
    </div>
    <FieldError id={field.errorId}>{error}</FieldError>
  </div>
}

export interface SettingsInputRowProps extends Omit<SettingsInputProps, 'label' | 'action'> { label: string }
export function SettingsInputRow({ label, description, value, onChange, placeholder, type = 'text', disabled, error, className, inCard = true, onBlur, onKeyDown, inputRef, ...native }: SettingsInputRowProps) {
  const field = useField({ ...native, description, error })
  const [visible, setVisible] = React.useState(false)
  return <div data-layout="settings-row" className={cn('craft-settings-row flex items-center justify-between', inCard ? 'craft-settings-padding' : 'craft-settings-plain', className)}>
    <div className="craft-field-header flex-1 min-w-0">
      <FieldHeader {...field} label={label} description={description} />
      <FieldError id={field.errorId}>{error}</FieldError>
    </div>
    <div data-layout="settings-control" className="craft-field-surface w-[200px] shrink-0 max-w-full">
      <Input {...native} {...field.controlProps} ref={inputRef} type={type === 'password' && visible ? 'text' : type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} onBlur={onBlur} onKeyDown={onKeyDown} className={cn(type === 'password' && 'pr-12')} />
      {type === 'password' && <SecretToggle visible={visible} onToggle={() => setVisible(v => !v)} disabled={disabled} />}
    </div>
  </div>
}

export interface SettingsSecretInputProps extends Omit<SettingsInputProps, 'type'> {}
export function SettingsSecretInput(props: SettingsSecretInputProps) {
  return <SettingsInput {...props} type="password" />
}
