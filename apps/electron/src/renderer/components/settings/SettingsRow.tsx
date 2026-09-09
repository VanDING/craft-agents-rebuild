/**
 * SettingsRow
 *
 * Generic row component for settings with label on left and content on right.
 * Use for custom layouts that don't fit Toggle/Select patterns.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { settingsUI } from './SettingsUIConstants'

export interface SettingsRowProps {
  /** Row label (can be string or JSX for custom rendering) */
  label: React.ReactNode
  /** Optional description below label */
  description?: string
  /** Content on the right side */
  children?: React.ReactNode
  /** Click handler for the entire row */
  onClick?: () => void
  /** Optional action button (e.g., "Change" button) */
  action?: React.ReactNode
  /** Additional className */
  className?: string
  /** Whether the row is inside a card (affects padding) */
  inCard?: boolean
}

/**
 * SettingsRow - Generic row for custom settings layouts
 *
 * @example
 * <SettingsRow
 *   label="Working Directory"
 *   description="~/Documents"
 *   action={<Button variant="ghost" size="sm">Change</Button>}
 * />
 */
export function SettingsRow({
  label,
  description,
  children,
  onClick,
  action,
  className,
  inCard = true,
}: SettingsRowProps) {
  const isRowButton = !!onClick && !children && !action
  const Component = isRowButton ? 'button' : 'div'
  const LabelComponent = onClick && !isRowButton ? 'button' : 'div'

  return (
    <Component
      type={isRowButton ? 'button' : undefined}
      onClick={isRowButton ? onClick : undefined}
      data-layout="settings-row"
      className={cn(
        'craft-settings-row craft-focus craft-row-focus w-full flex flex-wrap items-center justify-between text-left',
        inCard
          ? 'px-4 py-[var(--theme-settings-row-padding-y)]'
          : 'py-[var(--theme-row-padding-y)]',
        isRowButton && 'hover:bg-muted/70 motion-interactive transition-colors cursor-pointer',
        className
      )}
    >
      <LabelComponent type={onClick && !isRowButton ? 'button' : undefined} onClick={onClick && !isRowButton ? onClick : undefined} className="craft-focus flex-1 basis-40 min-w-0 text-left">
        <div className={settingsUI.label}>{label}</div>
        {description && (
          <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap, 'break-words')}>
            {description}
          </div>
        )}
      </LabelComponent>
      {(children || action) && (
        <div data-layout="settings-control" className="flex items-center gap-3 max-w-full shrink-0">
          {children}
          {action}
        </div>
      )}
    </Component>
  )
}

/**
 * SettingsRowLabel - Standalone label for use outside SettingsRow
 *
 * @example
 * <SettingsRowLabel label="Theme" />
 * <SettingsSegmentedControl ... />
 */
export function SettingsRowLabel({
  label,
  description,
  className,
}: {
  label: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn(settingsUI.labelGroup, className)}>
      <div className={settingsUI.label}>{label}</div>
      {description && (
        <div className={cn(settingsUI.description, settingsUI.labelDescriptionGap)}>{description}</div>
      )}
    </div>
  )
}
