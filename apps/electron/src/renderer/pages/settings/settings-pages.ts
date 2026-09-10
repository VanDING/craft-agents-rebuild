/**
 * Settings Page Components Registry
 *
 * Maps settings subpage IDs to their React components.
 * TypeScript enforces that all pages defined in settings-registry have a component here.
 *
 * To add a new settings page:
 * 1. Add to SETTINGS_PAGES in shared/settings-registry.ts
 * 2. Create the page component (e.g., NewSettingsPage.tsx)
 * 3. Add to SETTINGS_PAGE_COMPONENTS below
 * 4. Add icon to SETTINGS_ICONS in components/icons/SettingsIcons.tsx
 */

import { lazy, type ComponentType } from 'react'
import type { SettingsSubpage } from '../../../shared/settings-registry'

const AppSettingsPage = lazy(() => import('./AppSettingsPage'))
const AiSettingsPage = lazy(() => import('./AiSettingsPage'))
const AppearanceSettingsPage = lazy(() => import('./AppearanceSettingsPage'))
const InputSettingsPage = lazy(() => import('./InputSettingsPage'))
const WorkspaceSettingsPage = lazy(() => import('./WorkspaceSettingsPage'))
const PermissionsSettingsPage = lazy(() => import('./PermissionsSettingsPage'))
const LabelsSettingsPage = lazy(() => import('./LabelsSettingsPage'))
const MessagingSettingsPage = lazy(() => import('./MessagingSettingsPage'))
const ServerSettingsPage = lazy(() => import('./ServerSettingsPage'))
const ShortcutsPage = lazy(() => import('./ShortcutsPage'))
const PreferencesPage = lazy(() => import('./PreferencesPage'))

/**
 * Map of settings subpage IDs to their page components.
 * TypeScript will error if a page from SETTINGS_PAGES is missing here.
 */
export const SETTINGS_PAGE_COMPONENTS: Record<SettingsSubpage, ComponentType> = {
  app: AppSettingsPage,
  ai: AiSettingsPage,
  appearance: AppearanceSettingsPage,
  input: InputSettingsPage,
  workspace: WorkspaceSettingsPage,
  permissions: PermissionsSettingsPage,
  labels: LabelsSettingsPage,
  messaging: MessagingSettingsPage,
  server: ServerSettingsPage,
  shortcuts: ShortcutsPage,
  preferences: PreferencesPage,
}

/**
 * Get the component for a settings subpage
 */
export function getSettingsPageComponent(subpage: SettingsSubpage): ComponentType {
  return SETTINGS_PAGE_COMPONENTS[subpage]
}
