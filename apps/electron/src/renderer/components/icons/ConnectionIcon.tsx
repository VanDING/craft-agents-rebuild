/**
 * ConnectionIcon
 *
 * Displays the provider logo for an LLM connection.
 * Falls back to the first letter of the connection name if no icon is available.
 *
 * Used in:
 * - AI Settings (connections list)
 * - FreeFormInput (model display)
 * - Session List (connection badge)
 * - New Session (model selector group names)
 */

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getProviderIcon } from '@/lib/provider-icons'
import { logoUrlCache } from '@/lib/icon-cache'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { connectionFallbackInitial } from './connection-icon-utils'
import { getModelDisplayName } from '@config/models'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import type { LlmConnectionWithStatus } from '../../../shared/types'

interface ConnectionIconProps {
  /** The connection to display an icon for */
  connection: Pick<LlmConnectionWithStatus, 'name' | 'providerType' | 'baseUrl' | 'brandId' | 'piAuthProvider'> & { type?: string; defaultModel?: string }
  /** Size in pixels (default: 16) */
  size?: number
  /** Additional CSS classes */
  className?: string
  /** Show tooltip with connection name + model on hover (default: false) */
  showTooltip?: boolean
}

const FALLBACK_TONES = [
  'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  'bg-rose-500/12 text-rose-700 dark:text-rose-300',
] as const

function fallbackTone(name: string): string {
  let hash = 0
  for (const character of name) hash = ((hash * 31) + character.codePointAt(0)!) >>> 0
  return FALLBACK_TONES[hash % FALLBACK_TONES.length] ?? FALLBACK_TONES[0]
}

export function ConnectionIcon({ connection, size = 16, className = '', showTooltip = false }: ConnectionIconProps) {
  const providerIcon = getProviderIcon(
    connection.providerType || connection.type || '',
    connection.baseUrl,
    connection.piAuthProvider,
    connection.defaultModel,
    connection.brandId,
  )

  // Remote brand icons use the same durable cache as custom endpoint icons.
  const remoteProviderIcon = providerIcon?.startsWith('https://') ? providerIcon : null
  const serviceUrl = remoteProviderIcon
    ? new URL(remoteProviderIcon).searchParams.get('url') ?? connection.baseUrl
    : connection.baseUrl
  const cacheKey = `${serviceUrl ?? ''}:`
  const [endpointIcon, setEndpointIcon] = useState<{ key: string; value: string } | null>(null)

  useEffect(() => {
    let cancelled = false

    if (
      (providerIcon && !remoteProviderIcon)
      || !serviceUrl
      || typeof window === 'undefined'
      || !window.electronAPI?.getLogoUrl
    ) return

    const cached = logoUrlCache.get(cacheKey)
    if (cached) {
      setEndpointIcon({ key: cacheKey, value: cached })
      return
    }

    void window.electronAPI.getLogoUrl(serviceUrl).then((logoUrl) => {
      if (logoUrl) logoUrlCache.set(cacheKey, logoUrl)
      if (cancelled) return
      if (logoUrl) setEndpointIcon({ key: cacheKey, value: logoUrl })
    }).catch(() => {
      if (cancelled) return
      setEndpointIcon(null)
    })

    return () => { cancelled = true }
  }, [serviceUrl, providerIcon, remoteProviderIcon, cacheKey])

  const resolvedIcon = (remoteProviderIcon ? null : providerIcon)
    ?? logoUrlCache.get(cacheKey)
    ?? (endpointIcon?.key === cacheKey ? endpointIcon.value : null)
  const fallbackInitial = connectionFallbackInitial(connection.name)
  const fallbackToneClass = useMemo(() => fallbackTone(connection.name), [connection.name])
  const fallbackGlyph = fallbackInitial ? (
    <span aria-hidden="true" style={{ fontSize: Math.max(8, Math.round(size * 0.58)), lineHeight: 1 }}>{fallbackInitial}</span>
  ) : (
    <Sparkles aria-hidden="true" style={{ width: Math.round(size * 0.65), height: Math.round(size * 0.65) }} />
  )

  const iconElement = (
    <div
      className={`flex flex-shrink-0 overflow-hidden rounded-[3px] font-semibold ${className}`}
      style={{ width: size, height: size }}
    >
      <CrossfadeAvatar
        src={resolvedIcon}
        alt=""
        fallback={fallbackGlyph}
        className="h-full w-full rounded-[3px]"
        fallbackClassName={fallbackToneClass}
        imageClassName="object-contain"
      />
    </div>
  )

  if (!showTooltip) return iconElement

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {iconElement}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        <div className="text-center">
          <div>{connection.name}</div>
          {connection.defaultModel && <div className="text-[10px] opacity-60">{getModelDisplayName(connection.defaultModel)}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
