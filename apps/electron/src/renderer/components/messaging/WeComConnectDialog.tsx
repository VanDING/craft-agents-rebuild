/** Configure the Enterprise WeChat (WeCom) intelligent-bot long connection. */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SettingsSecretInput } from '@/components/settings'
import { Spinner } from '@craft-agent/ui'

interface WeComConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reconfigure?: boolean
}

export function WeComConnectDialog({ open, onOpenChange, reconfigure = false }: WeComConnectDialogProps) {
  const { t } = useTranslation()
  const [botId, setBotId] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [wsUrl, setWsUrl] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setBotId('')
      setSecret('')
      setWsUrl('')
      setSaving(false)
    }
  }, [open])

  const ready = Boolean(botId.trim() && secret.trim())
  const handleSave = async () => {
    if (!ready) return
    setSaving(true)
    try {
      await window.electronAPI.saveWeComCredentials({
        botId: botId.trim(),
        secret: secret.trim(),
        ...(wsUrl.trim() ? { wsUrl: wsUrl.trim() } : {}),
      })
      toast.success(t('settings.messaging.wecom.saved'))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.messaging.wecom.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {t(reconfigure ? 'settings.messaging.wecom.reconfigureTitle' : 'settings.messaging.wecom.connectTitle')}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-line">
            {t('settings.messaging.wecom.instructions')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">{t('settings.messaging.wecom.botIdLabel')}</div>
            <SettingsSecretInput value={botId} onChange={setBotId} placeholder={t('settings.messaging.wecom.botIdPlaceholder')} disabled={saving} />
          </div>
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">{t('settings.messaging.wecom.secretLabel')}</div>
            <SettingsSecretInput value={secret} onChange={setSecret} placeholder={t('settings.messaging.wecom.secretPlaceholder')} disabled={saving} />
          </div>
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">{t('settings.messaging.wecom.wsUrlLabel')}</div>
            <SettingsSecretInput value={wsUrl} onChange={setWsUrl} placeholder="wss://openws.work.weixin.qq.com" disabled={saving} />
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.messaging.wecom.singleConnectionWarning')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.messaging.wecom.mcpNotice')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={!ready || saving}>
            {saving && <Spinner className="mr-1 text-[14px]" />}
            {t('settings.messaging.wecom.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
