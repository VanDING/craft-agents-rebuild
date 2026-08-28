import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { motionSpring, motionTween } from '@craft-agent/ui/motion'
import { cn } from '@/lib/utils'

interface PanelSectionProps {
  title: ReactNode
  icon?: ReactNode
  meta?: ReactNode
  children: ReactNode
  collapsible?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
  contentClassName?: string
}

/** Shared surface and disclosure behavior for narrow workbench panels. */
export function PanelSection({
  title,
  icon,
  meta,
  children,
  collapsible = false,
  expanded = true,
  onExpandedChange,
  className,
  contentClassName,
}: PanelSectionProps) {
  const reduceMotion = useReducedMotion()
  const open = !collapsible || expanded
  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5">
      {icon && (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground/[0.045] text-muted-foreground">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground/85">{title}</span>
      {meta && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/65">{meta}</span>}
      {collapsible && (
        <motion.span
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/70"
          animate={{ rotate: open ? 0 : -90 }}
          transition={motionSpring(reduceMotion, 'responsive')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      )}
    </div>
  )

  return (
    <section className={cn('overflow-hidden rounded-xl border border-border/60 bg-background/55 shadow-minimal', className)}>
      {collapsible ? (
        <button
          type="button"
          className="flex w-full text-left outline-none transition-colors hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={open}
          onClick={() => onExpandedChange?.(!open)}
        >
          {header}
        </button>
      ) : header}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={motionTween(reduceMotion, 'standard', open ? 'enter' : 'exit')}
            className="overflow-hidden"
          >
            <div className={cn('border-t border-border/50 p-2.5', contentClassName)}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

interface PanelRowProps {
  icon?: ReactNode
  title: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  titleAttribute?: string
}

export function PanelRow({ icon, title, trailing, onClick, titleAttribute }: PanelRowProps) {
  const content = (
    <>
      {icon && <span className="shrink-0 text-muted-foreground/75">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {trailing}
    </>
  )

  if (!onClick) {
    return <div className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-foreground/85" title={titleAttribute}>{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={titleAttribute}
      className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-foreground/85 outline-none transition-[background-color,transform] hover:bg-foreground/[0.045] active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </button>
  )
}
