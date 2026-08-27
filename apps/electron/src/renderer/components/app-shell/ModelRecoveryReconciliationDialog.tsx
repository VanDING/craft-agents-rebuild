import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ModelReconciliationDecision } from '@craft-agent/shared/durable-runtime'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function ModelRecoveryReconciliationDialog({
  open, sessionId, modelOperationId, onClose, onResolved,
}: {
  open: boolean
  sessionId: string
  modelOperationId?: string
  onClose: () => void
  onResolved?: (modelOperationId: string) => void
}) {
  const { t } = useTranslation()
  const [decision, setDecision] = useState<ModelReconciliationDecision>('manual_abandon')
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setDecision('manual_abandon')
    setReason('')
    setEvidence('')
  }, [open, modelOperationId])

  const submit = async () => {
    if (!modelOperationId || !reason.trim()) return
    setSubmitting(true)
    try {
      await window.electronAPI.reconcileModel(sessionId, {
        modelOperationId,
        decision,
        reason: reason.trim(),
        evidence: evidence.trim() ? [{
          source: 'operator_observation', summary: evidence.trim(), observedAt: Date.now(),
        }] : [],
      })
      toast.success(t('recovery.model.committed'))
      onResolved?.(modelOperationId)
      onClose()
    } catch (error) {
      toast.error(t('recovery.model.commitFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !submitting) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('recovery.model.title')}</DialogTitle>
          <DialogDescription>{t('recovery.model.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="break-all rounded-md border p-2 font-mono text-xs">{modelOperationId}</div>
          <div className="grid gap-1.5">
            <Label>{t('recovery.dialog.decision')}</Label>
            <Select value={decision} onValueChange={value => setDecision(value as ModelReconciliationDecision)} disabled={submitting}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="provider_not_billed">{t('recovery.model.providerNotBilled')}</SelectItem>
                <SelectItem value="billed_response_unavailable">{t('recovery.model.billedUnavailable')}</SelectItem>
                <SelectItem value="manual_abandon">{t('recovery.decision.manual_abandon')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{t('recovery.dialog.reason')}</Label>
            <Textarea value={reason} onChange={event => setReason(event.target.value)} disabled={submitting} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t('recovery.dialog.evidence')}</Label>
            <Textarea value={evidence} onChange={event => setEvidence(event.target.value)} disabled={submitting} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={submitting || !reason.trim()}>{t('recovery.dialog.commit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
