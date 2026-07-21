/**
 * WeChatConnectDialog — drives the WeChat QR-scan login flow from the UI.
 *
 * The WeChat adapter uses the fixed endpoint https://ilinkai.weixin.qq.com
 * for QR login. No gateway URL needs to be configured ahead of time — the
 * real gateway URL is returned in the 'confirmed' response and saved with
 * the account credentials.
 *
 * References @tencent-weixin/openclaw-weixin v2.4.6 auth/login-qr.ts.
 */

import * as React from 'react'
import { Check } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Spinner } from '@craft-agent/ui'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { WeixinUiEvent } from '../../../shared/types'

interface WeChatConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected?: () => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'show_qr'; qr: string }
  | { kind: 'connected'; account?: string }
  | { kind: 'error'; message: string }

export function WeChatConnectDialog({ open, onOpenChange, onConnected }: WeChatConnectDialogProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const activeWorkspaceId = activeWorkspace?.id
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })

  // Subscribe to WeChat UI events from the main process.
  React.useEffect(() => {
    if (!open || !activeWorkspaceId) return
    const off = window.electronAPI.onWeixinEvent(({ workspaceId, event }) => {
      if (workspaceId !== activeWorkspaceId) return
      handleEvent(event)
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeWorkspaceId])

  // Trigger connection on first open.
  React.useEffect(() => {
    if (!open || phase.kind !== 'idle') return
    setPhase({ kind: 'starting' })
    let cancelled = false
    const timeout = setTimeout(() => {
      if (cancelled) return
      setPhase({ kind: 'error', message: t('dialog.wechat.timeout') })
    }, 15_000)
    window.electronAPI
      .startWeixinConnect()
      .then(() => { clearTimeout(timeout) })
      .catch((err: unknown) => {
        clearTimeout(timeout)
        if (!cancelled) setPhase({ kind: 'error', message: errorMsg(err) })
      })
    return () => { cancelled = true; clearTimeout(timeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Reset state on close.
  React.useEffect(() => {
    if (!open) {
      setPhase({ kind: 'idle' })
    }
  }, [open])

  const handleEvent = (event: WeixinUiEvent) => {
    switch (event.type) {
      case 'qr':
        setPhase({ kind: 'show_qr', qr: event.qrPayload })
        return
      case 'connected':
        setPhase({ kind: 'connected', account: event.account })
        toast.success(t('dialog.wechat.connected'))
        setTimeout(() => {
          if (onConnected) {
            onConnected()
          } else {
            onOpenChange(false)
          }
        }, 1200)
        return
      case 'disconnected':
        return
      case 'unavailable':
        setPhase({ kind: 'error', message: event.reason })
        return
      case 'need_verifycode':
        setPhase({ kind: 'error', message: t('dialog.wechat.needVerifyCode') })
        return
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.wechat.title')}</DialogTitle>
          <DialogDescription>{t('dialog.wechat.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {phase.kind === 'starting' && (
            <StatusRow icon={<Spinner className="text-[16px]" />}>
              {t('dialog.wechat.starting')}
            </StatusRow>
          )}

          {phase.kind === 'show_qr' && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-4">
                <QRCodeSVG value={phase.qr} size={240} level="M" />
              </div>
              <p className="whitespace-pre-line text-center text-sm text-muted-foreground">
                {t('dialog.wechat.qrInstructions')}
              </p>
            </div>
          )}

          {phase.kind === 'connected' && (
            <StatusRow icon={<Check className="h-4 w-4 text-emerald-500" />}>
              {phase.account
                ? t('dialog.wechat.connectedAs', { account: phase.account })
                : t('dialog.wechat.connected')}
            </StatusRow>
          )}

          {phase.kind === 'error' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {phase.message}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
