/**
 * Personal profile and preferences.
 *
 * Combines a local, read-only usage profile with the existing editable
 * preferences document. The page deliberately follows the settings system's
 * single-page layout: no nested tabs or secondary navigation.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, LockKeyhole, X } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { useAtomValue } from 'jotai'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { routes } from '@/lib/navigate'
import {
  SettingsSection,
  SettingsCard,
  SettingsCardContent,
  SettingsInput,
  SettingsTextarea,
  SettingsRow,
} from '@/components/settings'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { computeProfileActivity } from './profile-activity'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'preferences',
}

interface PreferencesFormState {
  name: string
  avatarDataUrl: string
  timezone: string
  city: string
  country: string
  notes: string
}

const emptyFormState: PreferencesFormState = {
  name: '',
  avatarDataUrl: '',
  timezone: '',
  city: '',
  country: '',
  notes: '',
}

const ACTIVITY_LEVEL_CLASSES = [
  'bg-foreground/4',
  'bg-accent/20',
  'bg-accent/40',
  'bg-accent/65',
  'bg-accent',
] as const

function parsePreferences(json: string): {
  form: PreferencesFormState
  document: Record<string, unknown>
} {
  try {
    const parsed = JSON.parse(json)
    const prefs = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
    const location = prefs.location && typeof prefs.location === 'object' && !Array.isArray(prefs.location)
      ? prefs.location as Record<string, unknown>
      : {}

    return {
      form: {
        name: typeof prefs.name === 'string' ? prefs.name : '',
        avatarDataUrl: prefs.avatar && typeof prefs.avatar === 'object' && !Array.isArray(prefs.avatar)
          && (prefs.avatar as Record<string, unknown>).kind === 'image'
          && typeof (prefs.avatar as Record<string, unknown>).dataUrl === 'string'
          ? (prefs.avatar as Record<string, unknown>).dataUrl as string
          : '',
        timezone: typeof prefs.timezone === 'string' ? prefs.timezone : '',
        city: typeof location.city === 'string' ? location.city : '',
        country: typeof location.country === 'string' ? location.country : '',
        notes: typeof prefs.notes === 'string' ? prefs.notes : '',
      },
      document: prefs,
    }
  } catch {
    return { form: emptyFormState, document: {} }
  }
}

function buildPreferencesDocument(
  state: PreferencesFormState,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const prefs = { ...existing }
  const existingLocation = prefs.location && typeof prefs.location === 'object' && !Array.isArray(prefs.location)
    ? prefs.location as Record<string, unknown>
    : {}

  if (state.name) prefs.name = state.name
  else delete prefs.name
  if (state.avatarDataUrl) prefs.avatar = { kind: 'image', dataUrl: state.avatarDataUrl }
  else delete prefs.avatar
  if (state.timezone) prefs.timezone = state.timezone
  else delete prefs.timezone
  if (state.notes) prefs.notes = state.notes
  else delete prefs.notes

  const location = { ...existingLocation }
  if (state.city) location.city = state.city
  else delete location.city
  if (state.country) location.country = state.country
  else delete location.country
  if (Object.keys(location).length > 0) prefs.location = location
  else delete prefs.location

  delete prefs.updatedAt
  return prefs
}

function stablePreferencesJson(state: PreferencesFormState, existing: Record<string, unknown>): string {
  return JSON.stringify(buildPreferencesDocument(state, existing), null, 2)
}

function formatCompactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value)
}

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'CA'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return [...trimmed].slice(0, 2).join('').toUpperCase()
  return `${[...parts[0]][0] ?? ''}${[...parts.at(-1)!][0] ?? ''}`.toUpperCase()
}

export default function PreferencesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [formState, setFormState] = useState<PreferencesFormState>(emptyFormState)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const [isLoading, setIsLoading] = useState(true)
  const [preferencesPath, setPreferencesPath] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  const formStateRef = useRef(formState)
  const preferencesDocumentRef = useRef<Record<string, unknown>>({})
  const lastSavedRef = useRef<string>('')

  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  useEffect(() => {
    const load = async () => {
      const preferencesResult = await Promise.resolve(window.electronAPI.readPreferences())
        .then(value => ({ status: 'fulfilled' as const, value }))
        .catch(reason => ({ status: 'rejected' as const, reason }))

      if (preferencesResult.status === 'fulfilled') {
        const parsed = parsePreferences(preferencesResult.value.content)
        setFormState(parsed.form)
        setPreferencesPath(preferencesResult.value.path)
        preferencesDocumentRef.current = parsed.document
        lastSavedRef.current = stablePreferencesJson(parsed.form, parsed.document)
      } else {
        console.error('Failed to load stored user preferences:', preferencesResult.reason)
      }

      setIsLoading(false)
      setTimeout(() => {
        isInitialLoadRef.current = false
      }, 100)
    }
    void load()
  }, [])

  useEffect(() => {
    if (isInitialLoadRef.current || isLoading) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const stableJson = stablePreferencesJson(formState, preferencesDocumentRef.current)
        const document = {
          ...JSON.parse(stableJson) as Record<string, unknown>,
          updatedAt: Date.now(),
        }
        const result = await window.electronAPI.writePreferences(JSON.stringify(document, null, 2))
        if (result.success) {
          lastSavedRef.current = stableJson
          preferencesDocumentRef.current = document
        } else {
          console.error('Failed to save preferences:', result.error)
        }
      } catch (error) {
        console.error('Failed to save preferences:', error)
      }
    }, 500)

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [formState, isLoading])

  useEffect(() => () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    const stableJson = stablePreferencesJson(formStateRef.current, preferencesDocumentRef.current)
    if (lastSavedRef.current !== stableJson && !isInitialLoadRef.current) {
      const document = {
        ...JSON.parse(stableJson) as Record<string, unknown>,
        updatedAt: Date.now(),
      }
      window.electronAPI.writePreferences(JSON.stringify(document, null, 2)).catch(error => {
        console.error('Failed to save preferences on unmount:', error)
      })
    }
  }, [])

  const updateField = useCallback(<K extends keyof PreferencesFormState>(
    field: K,
    value: PreferencesFormState[K],
  ) => {
    setFormState(previous => ({ ...previous, [field]: value }))
  }, [])

  const chooseAvatar = useCallback(async () => {
    try {
      const [path] = await window.electronAPI.openFileDialog()
      if (!path) return
      const dataUrl = await window.electronAPI.readFilePreviewDataUrl(path, 512)
      if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('Unsupported image')
      updateField('avatarDataUrl', dataUrl)
    } catch (error) {
      console.error('Failed to select profile image:', error)
    }
  }, [updateField])

  const sessions = useMemo(() => [...sessionMetaMap.values()], [sessionMetaMap])
  const profile = useMemo(() => computeProfileActivity(sessions), [sessions])
  const calendarWeeks = useMemo(
    () => Array.from({ length: 53 }, (_, index) => profile.calendar.slice(index * 7, index * 7 + 7)),
    [profile.calendar],
  )
  const weekdayLabels = useMemo(() => [1, 3, 5].map(day => ({
    day,
    label: new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2026, 7, 23 + day)),
  })), [locale])
  const displayName = formState.name.trim() || t('settings.preferences.defaultName')
  const locationParts = [formState.city, formState.country].filter(Boolean)
  const profileMeta = [locationParts.join(', '), formState.timezone].filter(Boolean).join(' · ')
  const weekday = profile.busiestWeekday === null
    ? t('settings.preferences.noActivity')
    : new Intl.DateTimeFormat(locale, { weekday: 'long' })
      .format(new Date(2026, 7, 23 + profile.busiestWeekday))

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="text-lg text-muted-foreground" />
      </div>
    )
  }

  const metrics = [
    [formatCompactNumber(profile.totalSessions, locale), t('settings.preferences.totalSessions')],
    [formatCompactNumber(profile.totalTokens, locale), t('settings.preferences.lifetimeTokens')],
    [formatCompactNumber(profile.activeDays, locale), t('settings.preferences.activeDays')],
    [formatCompactNumber(profile.longestStreak, locale), t('settings.preferences.longestStreak')],
  ]

  return (
    <div className="h-full flex flex-col">
      <PanelHeader
        title={t('settings.preferences.title')}
        actions={<HeaderMenu route={routes.view.settings('preferences')} helpFeature="preferences" />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-8 max-w-3xl mx-auto">
            <div className="space-y-8">
              <section className="flex flex-col items-center text-center pt-2 pb-1">
                <div className="group relative h-20 w-20">
                  <CrossfadeAvatar
                    src={formState.avatarDataUrl || undefined}
                    alt={displayName}
                    fallback={getInitials(displayName)}
                    className="h-20 w-20 rounded-full bg-accent text-2xl font-medium text-background shadow-minimal select-none"
                    fallbackClassName="bg-accent text-background"
                    imageClassName="object-cover"
                  />
                  <button
                    type="button"
                    onClick={chooseAvatar}
                    title={t('common.change')}
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Camera className="h-5 w-5" />
                  </button>
                  {formState.avatarDataUrl && (
                    <button
                      type="button"
                      onClick={() => updateField('avatarDataUrl', '')}
                      title={t('common.remove')}
                      className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-minimal hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight">{displayName}</h2>
                {profileMeta && <p className="mt-1 text-sm text-muted-foreground">{profileMeta}</p>}
                <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LockKeyhole className="w-3 h-3" />
                  <span>{t('settings.preferences.localOnly')}</span>
                </div>
              </section>

              <SettingsCard divided={false}>
                <div className="grid grid-cols-2 sm:grid-cols-4">
                  {metrics.map(([value, label], index) => (
                    <div
                      key={label}
                      className={`relative px-3 py-4 text-center ${index >= 2 ? 'border-t sm:border-t-0 border-border/50' : ''}`}
                    >
                      {index > 0 && (
                        <div className={`${index === 2 ? 'hidden sm:block' : ''} absolute left-0 top-3 bottom-3 w-px bg-border/50`} />
                      )}
                      <div className="text-base font-semibold tabular-nums">{value}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
              </SettingsCard>

              <SettingsSection
                title={t('settings.preferences.activity')}
                description={t('settings.preferences.activityDesc')}
              >
                <SettingsCard divided={false}>
                  <SettingsCardContent className="py-4">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <span className="text-xs text-muted-foreground">{t('settings.preferences.lastYear')}</span>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground" aria-hidden="true">
                        <span>{t('settings.preferences.less')}</span>
                        {ACTIVITY_LEVEL_CLASSES.map((className, level) => (
                          <span key={className} className={`w-2.5 h-2.5 rounded-[3px] ${className}`} data-level={level} />
                        ))}
                        <span>{t('settings.preferences.more')}</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto pb-1" role="group" aria-label={t('settings.preferences.activityAriaLabel')}>
                      <div className="w-max">
                        <div className="mb-1 ml-7 flex gap-1 text-[9px] text-muted-foreground/70" aria-hidden="true">
                          {calendarWeeks.map((week, index) => {
                            const month = week.find(day => day.date.getDate() <= 7)?.date
                            return (
                              <span key={week[0]?.key ?? index} className="w-2.5 shrink-0 overflow-visible whitespace-nowrap">
                                {month ? new Intl.DateTimeFormat(locale, { month: 'short' }).format(month) : ''}
                              </span>
                            )
                          })}
                        </div>
                        <div className="flex gap-2">
                          <div className="relative w-5 shrink-0 text-[9px] text-muted-foreground/70" aria-hidden="true">
                            {weekdayLabels.map(({ day, label }) => (
                              <span key={day} className="absolute right-0" style={{ top: day * 14 - 1 }}>{label}</span>
                            ))}
                          </div>
                          <div className="grid grid-flow-col grid-rows-7 auto-cols-[10px] gap-1">
                            {profile.calendar.map(day => (
                              <span
                                key={day.key}
                                role={day.isFuture ? undefined : 'img'}
                                aria-label={day.isFuture ? undefined : t('settings.preferences.activityDay', {
                                  date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(day.date),
                                  count: day.count,
                                })}
                                className={`h-2.5 w-2.5 rounded-[3px] ${day.isFuture ? 'bg-transparent' : ACTIVITY_LEVEL_CLASSES[day.level]} ${day.key === new Date().toLocaleDateString('en-CA') ? 'ring-1 ring-accent ring-offset-1 ring-offset-background' : ''}`}
                                title={day.isFuture ? undefined : t('settings.preferences.activityDay', {
                                  date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(day.date),
                                  count: day.count,
                                })}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </SettingsCardContent>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title={t('settings.preferences.insights')}
                description={t('settings.preferences.insightsDesc')}
              >
                <SettingsCard>
                  <SettingsRow label={t('settings.preferences.busiestDay')}>
                    <span className="text-sm tabular-nums">{weekday}</span>
                  </SettingsRow>
                  <SettingsRow label={t('settings.preferences.averageTokens')}>
                    <span className="text-sm tabular-nums">{formatCompactNumber(profile.averageTokens, locale)}</span>
                  </SettingsRow>
                  <SettingsRow label={t('settings.preferences.peakSessionTokens')}>
                    <span className="text-sm tabular-nums">{formatCompactNumber(profile.peakSessionTokens, locale)}</span>
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title={t('settings.preferences.basicInfo')}
                description={t('settings.preferences.basicInfoDesc')}
              >
                <SettingsCard>
                  <SettingsInput
                    label={t('settings.preferences.name')}
                    description={t('settings.preferences.nameDesc')}
                    value={formState.name}
                    onChange={value => updateField('name', value)}
                    placeholder={t('settings.preferences.namePlaceholder')}
                    inCard
                  />
                  <SettingsInput
                    label={t('settings.preferences.timezone')}
                    description={t('settings.preferences.timezoneDesc')}
                    value={formState.timezone}
                    onChange={value => updateField('timezone', value)}
                    placeholder={t('settings.preferences.timezonePlaceholder')}
                    inCard
                  />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title={t('settings.preferences.location')}
                description={t('settings.preferences.locationDesc')}
              >
                <SettingsCard>
                  <SettingsInput
                    label={t('settings.preferences.city')}
                    description={t('settings.preferences.cityDesc')}
                    value={formState.city}
                    onChange={value => updateField('city', value)}
                    placeholder={t('settings.preferences.cityPlaceholder')}
                    inCard
                  />
                  <SettingsInput
                    label={t('settings.preferences.country')}
                    description={t('settings.preferences.countryDesc')}
                    value={formState.country}
                    onChange={value => updateField('country', value)}
                    placeholder={t('settings.preferences.countryPlaceholder')}
                    inCard
                  />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title={t('settings.preferences.notes')}
                description={t('settings.preferences.notesDesc')}
                action={preferencesPath ? (
                  <EditPopover
                    trigger={<EditButton />}
                    {...getEditConfig('preferences-notes', preferencesPath)}
                    secondaryAction={{
                      label: t('common.editFile'),
                      filePath: preferencesPath,
                    }}
                  />
                ) : null}
              >
                <SettingsCard divided={false}>
                  <SettingsTextarea
                    value={formState.notes}
                    onChange={value => updateField('notes', value)}
                    placeholder={t('settings.preferences.notesPlaceholder')}
                    rows={5}
                    inCard
                  />
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
