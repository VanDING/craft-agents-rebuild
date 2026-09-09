/**
 * SettingsMenuSelect
 *
 * Menu-style dropdown select with support for option descriptions.
 * Uses Radix Popover for collision detection and accessibility.
 * Includes search/filter when options exceed threshold.
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { handleOptionNavigation } from '@/components/ui/option-navigation'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsMenuSelectOption {
  /** Value for this option */
  value: string
  /** Display label */
  label: string
  /** Optional description/subtitle */
  description?: string
}

export interface SettingsMenuSelectProps {
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder when nothing selected */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className for trigger */
  className?: string
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  id?: string
  ariaLabel?: string
  describedBy?: string
}

/**
 * SettingsMenuSelect - Menu-style dropdown with descriptions
 *
 * Uses Radix Popover for automatic collision detection and positioning.
 * Trigger styled like the model selector in FreeFormInput.
 * Includes search filter when options exceed 8 or searchable prop is true.
 */
export function SettingsMenuSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
  id,
  ariaLabel,
  describedBy,
}: SettingsMenuSelectProps) {
  const { t } = useTranslation()
  const effectiveSearchPlaceholder = searchPlaceholder ?? t("common.search")
  const [isOpen, setIsOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  // Show search when explicitly enabled or when there are many options
  const showSearch = searchable ?? options.length > 8

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!searchQuery.trim()) return options
    const query = searchQuery.toLowerCase()
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query) ||
        option.description?.toLowerCase().includes(query)
    )
  }, [options, searchQuery])

  const handleSelect = (optionValue: string) => {
    onValueChange(optionValue)
    setIsOpen(false)
    setSearchQuery('')
    // Clear preview on selection since the actual value is now set
    onHover?.(null)
  }

  // Clear preview when popover closes (via click outside, escape, etc.)
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      onHover?.(null)
      setSearchQuery('')
    } else if (showSearch) {
      // Focus search input when opening
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          className={cn(
            'craft-control inline-flex max-w-full items-center h-8 px-3 gap-1 text-sm rounded-lg',
            'bg-input shadow-minimal',
            'hover:bg-input/80 transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isOpen && 'bg-foreground/[0.02]',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label || placeholder}</span>
          <ChevronDown className="opacity-50 shrink-0 size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className="p-1.5"
        onKeyDown={handleOptionNavigation}
        style={{ width: menuWidth }}
        onMouseLeave={() => onHover?.(null)}
      >
        {showSearch && (
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label={effectiveSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={effectiveSearchPlaceholder}
              className={cn(
                'craft-control w-full h-8 pl-8 pr-3 text-sm rounded-md',
                'bg-foreground/5 border-0',
                'placeholder:text-muted-foreground',
                'focus-visible:ring-0'
              )}
            />
          </div>
        )}
        <div className="space-y-0.5 max-h-64 overflow-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-2.5 py-3 text-sm text-muted-foreground text-center">
              {t('chat.noResults')}
            </div>
          ) : (
            filteredOptions.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  data-option="true"
                  aria-pressed={isSelected}
                  onFocus={() => onHover?.(option.value)}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => onHover?.(option.value)}
                  className={cn(
                    'craft-control craft-menu-item w-full flex items-center justify-between px-2.5 py-[var(--theme-menu-item-padding-y)] rounded-md',
                    'hover:bg-foreground/5 transition-colors text-left',
                    isSelected && 'bg-foreground/3'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className={settingsUI.label}>{option.label}</div>
                    {option.description && (
                      <div className={cn(settingsUI.descriptionSmall, settingsUI.labelDescriptionGap)}>
                        {option.description}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="size-4 text-foreground shrink-0 ml-3" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * SettingsMenuSelectRow - Inline row with label and menu select
 */
export interface SettingsMenuSelectRowProps {
  /** Row label */
  label: string
  /** Optional description below label */
  description?: string
  /** Currently selected value */
  value: string
  /** Change handler */
  onValueChange: (value: string) => void
  /** Available options */
  options: SettingsMenuSelectOption[]
  /** Placeholder text */
  placeholder?: string
  /** Disabled state */
  disabled?: boolean
  /** Additional className */
  className?: string
  /** Whether inside a card */
  inCard?: boolean
  /** Width of the dropdown menu */
  menuWidth?: number
  /** Called when hovering over an option (for live preview). Pass null on leave. */
  onHover?: (value: string | null) => void
  /** Enable search filter (auto-enabled when options > 8) */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  id?: string
  ariaLabel?: string
  describedBy?: string
}

export function SettingsMenuSelectRow({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  inCard = true,
  menuWidth = 280,
  onHover,
  searchable,
  searchPlaceholder,
  id,
  ariaLabel,
  describedBy,
}: SettingsMenuSelectRowProps) {
  const generatedId = React.useId()
  const controlId = id ?? generatedId
  return (
    <div
      data-layout="settings-row"
      className={cn(
        'craft-settings-row flex items-center justify-between',
        inCard ? 'craft-settings-padding' : 'craft-settings-plain',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <label htmlFor={controlId} className={settingsUI.label}>{label}</label>
        {description && (
          <p id={controlId + '-description'} className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</p>
        )}
      </div>
      <div data-layout="settings-control" className="ml-4 shrink-0">
        <SettingsMenuSelect
          id={controlId}
          ariaLabel={ariaLabel}
          describedBy={[describedBy, description && controlId + '-description'].filter(Boolean).join(' ') || undefined}
          value={value}
          onValueChange={onValueChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled}
          menuWidth={menuWidth}
          onHover={onHover}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
        />
      </div>
    </div>
  )
}
