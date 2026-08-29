import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface TrajectoryPromptViewProps {
  prompts: ReadonlyMap<number, string>
}

export function TrajectoryPromptView({ prompts }: TrajectoryPromptViewProps) {
  const { t } = useTranslation()
  const sequences = useMemo(() => [...prompts.keys()].sort((a, b) => a - b), [prompts])
  const [selectedSeq, setSelectedSeq] = useState<number | null>(() => sequences.at(-1) ?? null)
  const effectiveSeq = selectedSeq !== null && prompts.has(selectedSeq) ? selectedSeq : sequences.at(-1) ?? null
  const current = effectiveSeq === null ? undefined : prompts.get(effectiveSeq)
  const previousSeq = effectiveSeq === null ? undefined : [...sequences].reverse().find(seq => seq < effectiveSeq)
  const previous = previousSeq === undefined ? undefined : prompts.get(previousSeq)

  if (effectiveSeq === null || current === undefined) {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">{t('trajectory.prompt.empty')}</div>
  }

  const unchanged = previous !== undefined && previous === current

  return (
    <div className="flex h-full min-h-0 flex-col bg-foreground/[0.012]">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 bg-background/75 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sequences.map(seq => (
          <button
            key={seq}
            type="button"
            aria-pressed={seq === effectiveSeq}
            onClick={() => setSelectedSeq(seq)}
            className={`h-7 shrink-0 rounded-md px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring ${seq === effectiveSeq ? 'border border-border/60 bg-background text-foreground shadow-minimal' : 'text-muted-foreground hover:bg-foreground/[0.035]'}`}
          >
            {t('trajectory.prompt.request', { seq })}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 @min-[820px]/trajectory:grid-cols-2">
        <section className="min-h-0 overflow-auto border-b border-border/50 @min-[820px]/trajectory:border-b-0 @min-[820px]/trajectory:border-r">
          <div className="sticky top-0 border-b border-border/50 bg-background/90 px-3 py-2 text-[11px] font-semibold backdrop-blur-sm">
            {t('trajectory.prompt.current', { seq: effectiveSeq, chars: current.length })}
          </div>
          <pre className="whitespace-pre-wrap break-words px-3 py-3 text-[11px] leading-5">{current}</pre>
        </section>
        <section className="min-h-0 overflow-auto">
          <div className="sticky top-0 border-b border-border/50 bg-background/90 px-3 py-2 text-[11px] font-semibold backdrop-blur-sm">
            {previous === undefined
              ? t('trajectory.prompt.noPrevious')
              : unchanged
                ? t('trajectory.prompt.unchanged')
                : t('trajectory.prompt.previous', { seq: previousSeq, chars: previous.length })}
          </div>
          {previous === undefined ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('trajectory.prompt.initialRequest')}</div>
          ) : unchanged ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('trajectory.prompt.unchangedHint')}</div>
          ) : (
            <pre className="whitespace-pre-wrap break-words px-3 py-3 text-[11px] leading-5 text-muted-foreground">{previous}</pre>
          )}
        </section>
      </div>
    </div>
  )
}
