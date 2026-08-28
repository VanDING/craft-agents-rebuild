import type { SessionFileScope } from '../../../shared/types'

export async function restoreSessionFileWatch(
  sessionId: string,
  reloadFiles: () => Promise<void>,
  scope: SessionFileScope = 'session',
): Promise<void> {
  try {
    await window.electronAPI.watchSessionFiles(sessionId, scope)
  } catch (error) {
    console.error(`[SessionFiles] Failed to restore file watch for ${sessionId}:`, error)
  }

  try {
    await reloadFiles()
  } catch (error) {
    console.error(`[SessionFiles] Failed to reload files for ${sessionId} after reconnect:`, error)
  }
}
