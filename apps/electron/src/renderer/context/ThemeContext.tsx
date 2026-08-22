import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as storage from '@/lib/local-storage'
import {
  DEFAULT_SHIKI_THEME,
  DEFAULT_THEME_FILE,
  getShikiTheme,
  isValidUserThemeId,
  resolveTheme,
  resolveThemeMode,
  themeToCSS,
  type ShikiThemeConfig,
  type ThemeFile,
  type ThemeFontPreference,
  type ThemeOverrides,
  type ThemePreferenceMode,
  type ThemePreferences,
} from '@config/theme'

export type ThemeMode = ThemePreferenceMode
export type FontFamily = ThemeFontPreference

type ThemeResolvedFrom = 'builtin' | 'ipc' | 'fallback'
type ThemeLoadStatus = 'loading' | 'ready' | 'error'

interface ThemeContextType {
  mode: ThemeMode
  colorTheme: string
  font: FontFamily
  setMode: (mode: ThemeMode) => void
  setColorTheme: (theme: string) => void
  setFont: (font: FontFamily) => void

  activeWorkspaceId: string | null
  workspaceColorTheme: string | null
  setWorkspaceColorTheme: (theme: string | null) => void

  resolvedMode: 'light' | 'dark'
  systemPreference: 'light' | 'dark'
  effectiveColorTheme: string
  appliedColorTheme: string
  previewColorTheme: string | null
  setPreviewColorTheme: (theme: string | null) => void
  effectiveColorThemeSource: 'preview' | 'workspace' | 'app'
  themeResolvedFrom: ThemeResolvedFrom
  themeLoadStatus: ThemeLoadStatus
  themeLoadError: string | null
  themePreferenceError: string | null

  presetTheme: ThemeFile | null
  resolvedTheme: ThemeOverrides
  isDark: boolean
  isScenic: boolean
  shikiTheme: string
  shikiConfig: ShikiThemeConfig
}

interface StoredThemeCache extends ThemePreferences {
  version: 3
}

interface LegacyStoredThemeCache {
  mode: ThemeMode
  colorTheme: string
  font?: Exclude<FontFamily, 'theme'>
  isUserOverride?: boolean
}

interface StoredThemeCacheInput {
  version?: unknown
  mode?: unknown
  colorTheme?: unknown
  font?: unknown
  isUserOverride?: unknown
}

interface StartupThemeCache {
  preferences: ThemePreferences
  legacyMigration: {
    colorThemeWasExplicit: boolean
  } | null
}

interface LoadedThemeState {
  requestedId: string
  appliedId: string
  theme: ThemeFile
  status: ThemeLoadStatus
  source: ThemeResolvedFrom
  error: string | null
}

interface ThemeProviderProps {
  children: ReactNode
  defaultMode?: ThemeMode
  defaultColorTheme?: string
  defaultFont?: FontFamily
  activeWorkspaceId?: string | null
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function isFontFamily(value: unknown): value is FontFamily {
  return value === 'theme' || value === 'inter' || value === 'system'
}

function loadStoredTheme(): StartupThemeCache | null {
  if (typeof window === 'undefined') return null
  const cached = storage.get<StoredThemeCacheInput | null>(storage.KEYS.theme, null)
  if (!cached || !isThemeMode(cached.mode)) return null

  const colorTheme = cached.colorTheme === 'default'
    || (typeof cached.colorTheme === 'string' && isValidUserThemeId(cached.colorTheme))
    ? cached.colorTheme
    : 'default'

  if (cached.version === 3 && isFontFamily(cached.font)) {
    return {
      preferences: { mode: cached.mode, colorTheme, font: cached.font },
      legacyMigration: null,
    }
  }

  // Before config.json became authoritative, mode/font lived only in this
  // unversioned renderer cache. Preserve those choices once, while allowing
  // config.json to win for color unless the user explicitly selected a theme.
  const legacy = cached as Partial<LegacyStoredThemeCache>
  return {
    preferences: {
      mode: cached.mode,
      colorTheme,
      font: isFontFamily(legacy.font) ? legacy.font : 'system',
    },
    legacyMigration: {
      colorThemeWasExplicit: legacy.isUserOverride === true,
    },
  }
}

function saveThemeCache(preferences: ThemePreferences): void {
  storage.set(storage.KEYS.theme, { version: 3, ...preferences } satisfies StoredThemeCache)
}

/** Resolve any browser-supported CSS color to Electron's native RGBA syntax. */
function toNativeOverlayColor(value: string, fallback: string, opacity: number): string {
  const color = typeof CSS !== 'undefined' && CSS.supports('color', value) ? value : fallback
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) return fallback

  context.clearRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  const resolvedAlpha = Math.round((alpha / 255) * opacity * 1000) / 1000
  return `rgba(${red}, ${green}, ${blue}, ${resolvedAlpha})`
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
  defaultColorTheme = 'default',
  defaultFont = 'theme',
  activeWorkspaceId = null,
}: ThemeProviderProps) {
  const [startupThemeCache] = useState(loadStoredTheme)
  const [preferences, setPreferencesState] = useState<ThemePreferences>(() => (
    startupThemeCache?.preferences ?? {
      mode: defaultMode,
      colorTheme: defaultColorTheme,
      font: defaultFont,
    }
  ))
  const preferencesRef = useRef(preferences)
  const preferenceGeneration = useRef(0)
  const [themePreferenceError, setThemePreferenceError] = useState<string | null>(null)

  const [systemPreference, setSystemPreference] = useState<'light' | 'dark'>(getSystemPreference)
  const [previewColorTheme, setPreviewColorTheme] = useState<string | null>(null)
  const [workspaceColorTheme, setWorkspaceColorThemeState] = useState<string | null>(null)
  const workspaceRequestGeneration = useRef(0)

  const [loadedTheme, setLoadedTheme] = useState<LoadedThemeState>({
    requestedId: 'default',
    appliedId: 'default',
    theme: DEFAULT_THEME_FILE,
    status: 'ready',
    source: 'builtin',
    error: null,
  })
  const themeRequestGeneration = useRef(0)
  const [userThemeRevision, setUserThemeRevision] = useState(0)

  const { mode, colorTheme, font } = preferences
  const resolvedMode = mode === 'system' ? systemPreference : mode
  const effectiveColorTheme = previewColorTheme ?? workspaceColorTheme ?? colorTheme
  const effectiveColorThemeSource: 'preview' | 'workspace' | 'app' =
    previewColorTheme !== null ? 'preview' : workspaceColorTheme !== null ? 'workspace' : 'app'

  const applyAuthoritativePreferences = useCallback((next: ThemePreferences) => {
    preferencesRef.current = next
    setPreferencesState(next)
    saveThemeCache(next)
    setThemePreferenceError(null)
  }, [])

  // config.json is authoritative; localStorage is only an immediate startup
  // cache. Older renderer-only preferences are migrated into config.json once.
  useEffect(() => {
    const getThemePreferences = window.electronAPI?.getThemePreferences
    if (!getThemePreferences) return
    const generation = preferenceGeneration.current
    let cancelled = false

    void (async () => {
      try {
        const persisted = await getThemePreferences()
        if (cancelled || generation !== preferenceGeneration.current) return

        const legacyMigration = startupThemeCache?.legacyMigration
        const setThemePreferences = window.electronAPI?.setThemePreferences
        if (!legacyMigration || !setThemePreferences) {
          applyAuthoritativePreferences(persisted)
          return
        }

        const legacy = startupThemeCache.preferences
        const migrated = await setThemePreferences({
          mode: legacy.mode,
          colorTheme: legacyMigration.colorThemeWasExplicit ? legacy.colorTheme : persisted.colorTheme,
          font: legacy.font,
        })
        if (!cancelled && generation === preferenceGeneration.current) {
          applyAuthoritativePreferences(migrated)
        }
      } catch (error) {
        if (cancelled || generation !== preferenceGeneration.current) return
        setThemePreferenceError(`Failed to load theme preferences: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyAuthoritativePreferences, startupThemeCache])

  useEffect(() => {
    const subscribe = window.electronAPI?.onThemePreferencesChange
    if (!subscribe) return
    return subscribe((persisted) => {
      preferenceGeneration.current += 1
      applyAuthoritativePreferences(persisted)
    })
  }, [applyAuthoritativePreferences])

  const persistPreferences = useCallback((patch: Partial<ThemePreferences>) => {
    const previous = preferencesRef.current
    const next: ThemePreferences = { ...previous, ...patch }
    const generation = ++preferenceGeneration.current
    preferencesRef.current = next
    setPreferencesState(next)
    saveThemeCache(next)
    setThemePreferenceError(null)

    const persist = window.electronAPI?.setThemePreferences
    if (!persist) return
    void persist(next).then((persisted) => {
      if (generation === preferenceGeneration.current) {
        applyAuthoritativePreferences(persisted)
      }
    }).catch((error) => {
      if (generation !== preferenceGeneration.current) return
      preferencesRef.current = previous
      setPreferencesState(previous)
      saveThemeCache(previous)
      setThemePreferenceError(`Failed to save theme preferences: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, [applyAuthoritativePreferences])

  const setMode = useCallback((nextMode: ThemeMode) => {
    persistPreferences({ mode: nextMode })
  }, [persistPreferences])

  const setColorTheme = useCallback((nextTheme: string) => {
    persistPreferences({ colorTheme: nextTheme || 'default' })
  }, [persistPreferences])

  const setFont = useCallback((nextFont: FontFamily) => {
    persistPreferences({ font: nextFont })
  }, [persistPreferences])

  // Workspace theme selection is loaded with a request generation so a slow
  // response from the previous workspace can never overwrite the active one.
  useEffect(() => {
    const generation = ++workspaceRequestGeneration.current
    setWorkspaceColorThemeState(null)
    if (!activeWorkspaceId) return

    let cancelled = false
    void window.electronAPI?.getWorkspaceColorTheme?.(activeWorkspaceId).then((theme) => {
      if (!cancelled && generation === workspaceRequestGeneration.current) {
        setWorkspaceColorThemeState(theme)
      }
    }).catch(() => {
      if (!cancelled && generation === workspaceRequestGeneration.current) {
        setWorkspaceColorThemeState(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  const setWorkspaceColorTheme = useCallback((nextTheme: string | null) => {
    if (!activeWorkspaceId) return
    const previous = workspaceColorTheme
    const generation = ++workspaceRequestGeneration.current
    setWorkspaceColorThemeState(nextTheme)
    const persist = window.electronAPI?.setWorkspaceColorTheme
    if (!persist) return
    void persist(activeWorkspaceId, nextTheme).catch(() => {
      if (generation === workspaceRequestGeneration.current) {
        setWorkspaceColorThemeState(previous)
      }
    })
  }, [activeWorkspaceId, workspaceColorTheme])

  useEffect(() => {
    const subscribe = window.electronAPI?.onWorkspaceThemeChange
    if (!subscribe) return
    return subscribe(({ workspaceId, themeId }) => {
      if (workspaceId === activeWorkspaceId) {
        workspaceRequestGeneration.current += 1
        setWorkspaceColorThemeState(themeId)
      }
    })
  }, [activeWorkspaceId])

  useEffect(() => {
    const subscribe = window.electronAPI?.onUserThemesChanged
    if (!subscribe) return
    return subscribe(() => setUserThemeRevision((revision) => revision + 1))
  }, [])

  // Keep the last-good snapshot only during loading. A terminal failure applies
  // Default atomically, preventing stale CSS from masquerading as another theme.
  useEffect(() => {
    const requestedId = effectiveColorTheme || 'default'
    const generation = ++themeRequestGeneration.current
    let cancelled = false

    if (requestedId === 'default') {
      setLoadedTheme({
        requestedId,
        appliedId: 'default',
        theme: DEFAULT_THEME_FILE,
        status: 'ready',
        source: 'builtin',
        error: null,
      })
      return
    }

    setLoadedTheme((previous) => ({
      ...previous,
      requestedId,
      status: 'loading',
      error: null,
    }))

    const failToDefault = (reason: string) => {
      if (cancelled || generation !== themeRequestGeneration.current) return
      setLoadedTheme({
        requestedId,
        appliedId: 'default',
        theme: DEFAULT_THEME_FILE,
        status: 'error',
        source: 'fallback',
        error: reason,
      })
    }

    const loadPresetTheme = window.electronAPI?.loadPresetTheme
    if (!loadPresetTheme) {
      failToDefault(`Theme loader is unavailable for "${requestedId}".`)
      return () => {
        cancelled = true
      }
    }

    void loadPresetTheme(requestedId).then((preset) => {
      if (cancelled || generation !== themeRequestGeneration.current) return
      if (!preset?.theme) {
        failToDefault(`Theme "${requestedId}" was not found or is invalid.`)
        return
      }
      setLoadedTheme({
        requestedId,
        appliedId: requestedId,
        theme: preset.theme,
        status: 'ready',
        source: 'ipc',
        error: null,
      })
    }).catch((error) => {
      failToDefault(`Failed to load theme "${requestedId}": ${error instanceof Error ? error.message : String(error)}`)
    })

    return () => {
      cancelled = true
    }
  }, [effectiveColorTheme, userThemeRevision])

  const presetTheme = loadedTheme.appliedId === 'default' ? null : loadedTheme.theme
  const resolvedTheme = useMemo(() => resolveTheme(loadedTheme.theme), [loadedTheme.theme])
  const isScenic = resolvedTheme.mode === 'scenic' && Boolean(resolvedTheme.backgroundImage)
  const actualMode = resolveThemeMode({
    mode: isScenic ? 'scenic' : 'solid',
    supportedModes: loadedTheme.theme.supportedModes,
  }, resolvedMode)
  const isDark = actualMode === 'dark'
  const shikiConfig = loadedTheme.theme.shikiTheme || DEFAULT_SHIKI_THEME
  const shikiTheme = getShikiTheme(shikiConfig, isDark)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setSystemPreference(event.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handleMediaChange)

    const cleanup = window.electronAPI?.onSystemThemeChange?.((dark) => {
      setSystemPreference(dark ? 'dark' : 'light')
    })
    void window.electronAPI?.getSystemTheme?.().then((dark) => {
      setSystemPreference(dark ? 'dark' : 'light')
    }).catch(() => {})

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange)
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const effectiveThemeFont = isDark
      ? (resolvedTheme.dark?.fontSans ?? resolvedTheme.fontSans)
      : resolvedTheme.fontSans
    const themeOwnsTypography = loadedTheme.appliedId !== 'default' && Boolean(effectiveThemeFont)

    if (font === 'theme' && themeOwnsTypography) delete root.dataset.font
    else root.dataset.font = font === 'inter' ? 'inter' : 'system'

    if (loadedTheme.appliedId !== 'default') root.dataset.theme = loadedTheme.appliedId
    else delete root.dataset.theme
    root.dataset.themeStatus = loadedTheme.status
    root.dataset.themeOverride = 'true'
  }, [font, isDark, loadedTheme.appliedId, loadedTheme.status, resolvedTheme.dark?.fontSans, resolvedTheme.fontSans])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(actualMode)

    const supportedModes = loadedTheme.theme.supportedModes
    const themeModeUnsupported = Boolean(supportedModes?.length && !supportedModes.includes(resolvedMode))
    const vibrancyMismatch = actualMode !== systemPreference
    if (themeModeUnsupported || vibrancyMismatch) root.dataset.themeMismatch = 'true'
    else delete root.dataset.themeMismatch

    if (isScenic && resolvedTheme.backgroundImage) {
      root.dataset.scenic = 'true'
      root.style.setProperty('--background-image', `url(${JSON.stringify(resolvedTheme.backgroundImage)})`)
    } else {
      delete root.dataset.scenic
      root.style.removeProperty('--background-image')
    }

    const effectiveVisualTheme = isDark && resolvedTheme.dark
      ? { ...resolvedTheme, ...resolvedTheme.dark }
      : resolvedTheme
    root.dataset.themeDepth = effectiveVisualTheme.depth ?? 'elevated'
    root.dataset.themeDensity = effectiveVisualTheme.density ?? 'comfortable'
  }, [actualMode, isDark, isScenic, loadedTheme.theme, resolvedMode, resolvedTheme, systemPreference])

  useEffect(() => {
    const styleId = 'craft-theme-overrides'
    let styleElement = document.getElementById(styleId) as HTMLStyleElement | null
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = styleId
      document.head.appendChild(styleElement)
    }

    styleElement.textContent = loadedTheme.appliedId === 'default'
      ? ''
      : `:root {\n  ${themeToCSS(loadedTheme.theme, isDark)}\n}`

    window.dispatchEvent(new CustomEvent('craft-theme-change', {
      detail: { id: loadedTheme.appliedId, mode: actualMode },
    }))
  }, [actualMode, isDark, loadedTheme.appliedId, loadedTheme.theme])

  useEffect(() => {
    const setTitleBarOverlay = window.electronAPI?.setTitleBarOverlay
    if (!setTitleBarOverlay) return
    const effectiveVisualTheme = isDark && resolvedTheme.dark
      ? { ...resolvedTheme, ...resolvedTheme.dark }
      : resolvedTheme
    const fallbackForeground = isDark ? '#f5f5f7' : '#1a1625'
    const symbolColor = toNativeOverlayColor(
      effectiveVisualTheme.foreground ?? fallbackForeground,
      fallbackForeground,
      1
    )
    void setTitleBarOverlay({
      color: 'rgba(0, 0, 0, 0)',
      symbolColor,
      height: 48,
    }).catch(() => {})
  }, [isDark, resolvedTheme])

  const value = useMemo<ThemeContextType>(() => ({
    mode,
    colorTheme,
    font,
    setMode,
    setColorTheme,
    setFont,
    activeWorkspaceId,
    workspaceColorTheme,
    setWorkspaceColorTheme,
    resolvedMode,
    systemPreference,
    effectiveColorTheme,
    appliedColorTheme: loadedTheme.appliedId,
    previewColorTheme,
    setPreviewColorTheme,
    effectiveColorThemeSource,
    themeResolvedFrom: loadedTheme.source,
    themeLoadStatus: loadedTheme.status,
    themeLoadError: loadedTheme.error,
    themePreferenceError,
    presetTheme,
    resolvedTheme,
    isDark,
    isScenic,
    shikiTheme,
    shikiConfig,
  }), [
    activeWorkspaceId,
    colorTheme,
    effectiveColorTheme,
    effectiveColorThemeSource,
    font,
    isDark,
    isScenic,
    loadedTheme.appliedId,
    loadedTheme.error,
    loadedTheme.source,
    loadedTheme.status,
    mode,
    presetTheme,
    previewColorTheme,
    resolvedMode,
    resolvedTheme,
    setColorTheme,
    setFont,
    setMode,
    setWorkspaceColorTheme,
    shikiConfig,
    shikiTheme,
    systemPreference,
    themePreferenceError,
    workspaceColorTheme,
  ])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
