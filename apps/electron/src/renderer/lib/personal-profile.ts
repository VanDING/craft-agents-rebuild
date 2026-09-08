export interface PreferencesFormState {
  name: string
  avatarDataUrl: string
  timezone: string
  city: string
  country: string
  notes: string
}

export const emptyFormState: PreferencesFormState = {
  name: '',
  avatarDataUrl: '',
  timezone: '',
  city: '',
  country: '',
  notes: '',
}

export function parsePreferences(json: string): {
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

export function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'CA'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return [...trimmed].slice(0, 2).join('').toUpperCase()
  return `${[...parts[0]][0] ?? ''}${[...parts.at(-1)!][0] ?? ''}`.toUpperCase()
}

