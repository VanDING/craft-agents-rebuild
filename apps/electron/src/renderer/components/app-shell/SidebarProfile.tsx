import { useEffect, type ComponentProps } from 'react'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Clock3, MapPin, Settings, UserRound } from 'lucide-react'
import { personalProfileAtom } from '@/atoms/personal-profile'
import { getInitials, parsePreferences } from '@/lib/personal-profile'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'

interface SidebarProfileProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenProfile: () => void
  onOpenSettings: () => void
  profileButtonProps: ComponentProps<'button'>
  settingsButtonProps: ComponentProps<'button'>
}

export function SidebarProfile({ open, onOpenChange, onOpenProfile, onOpenSettings, profileButtonProps, settingsButtonProps }: SidebarProfileProps) {
  const { t } = useTranslation()
  const [profile, setProfile] = useAtom(personalProfileAtom)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        if (!cancelled) setProfile(parsePreferences(result.content).form)
      } catch (error) {
        console.error('Failed to load sidebar profile:', error)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
    }
  }, [setProfile])

  const name = profile.name.trim()
  const displayName = name || t('sidebar.profile.setup')
  const location = [profile.city.trim(), profile.country.trim()].filter(Boolean).join(', ')
  const avatar = (className: string) => (
    <CrossfadeAvatar
      src={profile.avatarDataUrl || undefined}
      alt={displayName}
      fallback={name ? getInitials(name) : <UserRound className="h-1/2 w-1/2" strokeWidth={1.5} />}
      className={className}
      fallbackClassName="bg-accent/10 text-accent font-medium"
      imageClassName="object-cover"
    />
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className="flex min-w-0 items-center gap-1">
          <PopoverTrigger asChild>
            <button
              {...profileButtonProps}
              type="button"
              title={displayName}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {avatar('h-7 w-7 shrink-0 rounded-full text-[10px]')}
              <span className="truncate text-[13px] font-medium">{displayName}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={12}
            collisionPadding={8}
            aria-label={t('settings.preferences.title')}
            onKeyDown={(event) => event.stopPropagation()}
            className="isolate w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl p-0 ring-1 ring-foreground/5"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-36 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent" />
            <div className="p-5">
              <div className="mb-5 inline-flex rounded-full bg-background/80 p-1 shadow-minimal ring-1 ring-foreground/5">
                {avatar('h-16 w-16 rounded-full text-xl')}
              </div>
              <h2 className="break-words text-xl font-semibold leading-tight tracking-tight">{displayName}</h2>
              {(location || profile.timezone) && (
                <div className="mt-4 space-y-2 text-xs leading-relaxed text-muted-foreground">
                  {location && <p className="flex items-start gap-2"><MapPin aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" /><span className="break-words">{location}</span></p>}
                  {profile.timezone && <p className="flex items-start gap-2"><Clock3 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" /><span className="break-words">{profile.timezone}</span></p>}
                </div>
              )}
            </div>
            <div className="border-t border-foreground/5 p-2">
              <button
                type="button"
                onClick={() => { onOpenChange(false); onOpenProfile() }}
                className="flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                {t('sidebar.profile.view')}
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>
          </PopoverContent>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                {...settingsButtonProps}
                type="button"
                aria-label={t('sidebar.settings')}
                onClick={() => { onOpenChange(false); onOpenSettings() }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-sidebar-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Settings aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('sidebar.settings')}</TooltipContent>
          </Tooltip>
        </div>
      </PopoverAnchor>
    </Popover>
  )
}
