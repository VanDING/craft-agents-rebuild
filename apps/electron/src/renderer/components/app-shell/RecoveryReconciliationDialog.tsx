import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  DurableRecoveryEvidenceSnapshot,
  ToolReconciliationDecision,
} from '@craft-agent/shared/durable-runtime'
import type { ActivityItem } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface RecoveryReconciliationDialogProps {
  open: boolean
  sessionId: string
  activity: ActivityItem | null
  onClose: () => void
}

const DECISIONS: ToolReconciliationDecision[] = [
  'completed',
  'definitely_not_executed',
  'failed',
  'manual_abandon',
]

function decisionKey(decision: ToolReconciliationDecision): string {
  return `recovery.decision.${decision}`
}

export function RecoveryReconciliationDialog({
  open,
  sessionId,
  activity,
  onClose,
}: RecoveryReconciliationDialogProps) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<DurableRecoveryEvidenceSnapshot | null>(null)
  const [decision, setDecision] = useState<ToolReconciliationDecision>('completed')
  const [evidence, setEvidence] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState('')
  const [externalReference, setExternalReference] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isQuerying, setIsQuerying] = useState(false)

  const operationId = activity?.durableOperationId
  const dispatch = snapshot?.evidence.dispatch

  useEffect(() => {
    if (!open || !operationId) return

    let cancelled = false
    setSnapshot(null)
    setDecision('completed')
    setEvidence('')
    setReason('')
    setResult('')
    setExternalReference('')
    setIsLoading(true)

    window.electronAPI.getRecoveryEvidence(sessionId, operationId)
      .then(value => {
        if (!cancelled) setSnapshot(value)
      })
      .catch(error => {
        if (!cancelled) {
          toast.error(t('recovery.toast.loadFailed'), {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [open, operationId, sessionId, t])

  const canSubmit = useMemo(() => {
    if (!operationId || isLoading || isSubmitting || !reason.trim()) return false
    return decision === 'manual_abandon' || Boolean(evidence.trim())
  }, [decision, evidence, isLoading, isSubmitting, operationId, reason])

  const handleSubmit = async () => {
    if (!operationId || !canSubmit) return
    setIsSubmitting(true)
    try {
      await window.electronAPI.reconcileTool(sessionId, {
        toolOperationId: operationId,
        decision,
        reason: reason.trim(),
        evidence: evidence.trim()
          ? [{
              source: 'operator_observation',
              summary: evidence.trim(),
              observedAt: Date.now(),
              ...(externalReference.trim() && { externalReference: externalReference.trim() }),
            }]
          : [],
        ...(result.trim() && { result: result.trim() }),
        ...(externalReference.trim() && { externalReference: externalReference.trim() }),
      })
      toast.success(t('recovery.toast.committed'))
      onClose()
    } catch (error) {
      toast.error(t('recovery.toast.commitFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleExternalQuery = async () => {
    if (!operationId || isQuerying || isSubmitting) return
    setIsQuerying(true)
    try {
      await window.electronAPI.queryReconcileTool(sessionId, operationId)
      toast.success(t('recovery.toast.queried'))
      onClose()
    } catch (error) {
      toast.error(t('recovery.toast.queryFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsQuerying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen && !isSubmitting) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            {t('recovery.dialog.title')}
          </DialogTitle>
          <DialogDescription>{t('recovery.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">{t('recovery.dialog.tool')}</dt>
            <dd className="font-medium">{activity?.displayName || activity?.toolName || t('common.unknown')}</dd>
            <dt className="text-muted-foreground">{t('recovery.dialog.operation')}</dt>
            <dd className="break-all font-mono">{operationId}</dd>
            <dt className="text-muted-foreground">{t('recovery.dialog.mode')}</dt>
            <dd className="font-mono">{dispatch?.recoveryMode ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('recovery.dialog.argumentsHash')}</dt>
            <dd className="break-all font-mono">{dispatch?.canonicalArgsHash ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('recovery.dialog.currentVerdict')}</dt>
            <dd className="font-mono">{isLoading ? t('common.loading') : snapshot?.verdict.kind ?? '—'}</dd>
          </dl>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="recovery-decision">{t('recovery.dialog.decision')}</Label>
            <Select value={decision} onValueChange={value => setDecision(value as ToolReconciliationDecision)} disabled={isSubmitting}>
              <SelectTrigger id="recovery-decision">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DECISIONS.map(value => (
                  <SelectItem key={value} value={value}>{t(decisionKey(value))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="recovery-evidence">{t('recovery.dialog.evidence')}</Label>
            <Textarea
              id="recovery-evidence"
              value={evidence}
              onChange={event => setEvidence(event.target.value)}
              placeholder={t('recovery.dialog.evidencePlaceholder')}
              disabled={isSubmitting}
            />
            {decision === 'manual_abandon' && (
              <p className="text-xs text-muted-foreground">{t('recovery.dialog.evidenceOptional')}</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="recovery-reason">{t('recovery.dialog.reason')}</Label>
            <Textarea
              id="recovery-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={t('recovery.dialog.reasonPlaceholder')}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="recovery-result">{t('recovery.dialog.result')}</Label>
              <Textarea
                id="recovery-result"
                className="min-h-12"
                value={result}
                onChange={event => setResult(event.target.value)}
                placeholder={t('recovery.dialog.optional')}
                disabled={isSubmitting}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="recovery-reference">{t('recovery.dialog.externalReference')}</Label>
              <Textarea
                id="recovery-reference"
                className="min-h-12"
                value={externalReference}
                onChange={event => setExternalReference(event.target.value)}
                placeholder={t('recovery.dialog.optional')}
                disabled={isSubmitting}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting || isQuerying}>{t('common.cancel')}</Button>
          <Button variant="secondary" onClick={handleExternalQuery} disabled={!operationId || isLoading || isSubmitting || isQuerying}>
            {isQuerying ? t('recovery.dialog.querying') : t('recovery.dialog.queryExternal')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting ? t('recovery.dialog.committing') : t('recovery.dialog.commit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
