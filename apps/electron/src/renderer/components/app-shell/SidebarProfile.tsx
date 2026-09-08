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
        <div
          data-state={open ? 'open' : 'closed'}
          className="flex min-w-0 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-sidebar-hover focus-within:bg-sidebar-hover data-[state=open]:bg-sidebar-hover"
        >
          <PopoverTrigger asChild>
            <button
              {...profileButtonProps}
              type="button"
              title={displayName}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] font-normal outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {avatar('h-3.5 w-3.5 shrink-0 rounded-full text-[7px]')}
              <span className="truncate">{displayName}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={12}
            collisionPadding={8}
            aria-label={t('settings.preferences.title')}
            onKeyDown={(event) => event.stopPropagation()}
            className="isolate w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] overflow-x-hidden overflow-y-auto rounded-2xl bg-popover p-0 ring-1 ring-foreground/5"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none aspect-[4/5] w-full overflow-hidden"
              style={{ maskImage: 'linear-gradient(to bottom, black 45%, rgba(0,0,0,0.95) 55%, rgba(0,0,0,0.65) 70%, rgba(0,0,0,0.2) 87%, transparent 100%)' }}
            >
              <CrossfadeAvatar
                src={profile.avatarDataUrl || undefined}
                alt=""
                fallback={name ? getInitials(name) : <UserRound className="h-16 w-16" strokeWidth={1} />}
                className="h-full w-full rounded-none text-5xl"
                fallbackClassName="rounded-none bg-accent/10 text-accent/50 font-medium"
                imageClassName="object-cover object-center"
              />
            </div>
            <div className="px-5 pb-4 pt-0">
              <h2 className="break-words text-xl font-semibold leading-tight tracking-tight">{displayName}</h2>
              {(location || profile.timezone) && (
                <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                  {location && <p className="flex items-start gap-2"><MapPin aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" /><span className="break-words">{location}</span></p>}
                  {profile.timezone && <p className="flex items-start gap-2"><Clock3 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" /><span className="break-words">{profile.timezone}</span></p>}
                </div>
              )}
            </div>
            <div className="px-2 pb-2">
              <button
                type="button"
                onClick={() => { onOpenChange(false); onOpenProfile() }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
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
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Settings aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('sidebar.settings')}</TooltipContent>
          </Tooltip>
        </div>
      </PopoverAnchor>
    </Popover>
  )
}
