import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ProjectSelectMenuOption {
  value: string
  label: string
}

interface ProjectSelectMenuProps {
  value: string
  options: ProjectSelectMenuOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  leadingIcon?: ReactNode
  className?: string
}

/** Compact app-styled select used by the Project Management toolbar. */
export function ProjectSelectMenu({
  value,
  options,
  onValueChange,
  ariaLabel,
  leadingIcon,
  className,
}: ProjectSelectMenuProps) {
  const selected = options.find((option) => option.value === value) ?? options[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/[0.02] px-2 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/5',
            className,
          )}
        >
          {leadingIcon}
          <span className="min-w-0 flex-1 truncate text-left">{selected?.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-foreground/40" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[260px]"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="text-xs"
            disabled={option.value === value}
            onSelect={() => onValueChange(option.value)}
          >
            <span className="truncate">{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
