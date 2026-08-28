/**
 * SessionFilesSection - Displays files in the session directory as a tree view
 *
 * Features:
 * - Recursive tree view with expandable folders (matches sidebar styling)
 * - File watcher for auto-refresh when files change
 * - Click to preview in-app, double-click to open
 * - Right-click context menu with "Open" / "Show in {file manager}" actions
 * - Persisted expanded folder state per session
 *
 * Styling matches LeftSidebar patterns:
 * - Chevron hidden by default, shown on hover
 * - Vertical connector lines for nested items
 * - 14x14px icons, 8px gaps, 6px radius
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { File, Folder, FolderOpen, FileText, Image, FileCode, ChevronRight, ExternalLink, Copy } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import type { SessionFile, SessionFileScope } from '../../../shared/types'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { restoreSessionFileWatch } from './session-files-watch'

/**
 * Stagger animation variants for child items - matches LeftSidebar pattern
 * Creates a pleasing "cascade" effect when expanding folders
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.01,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.015,
      staggerDirection: -1,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
}

export interface SessionFilesSectionProps {
  sessionId?: string
  className?: string
  /** Which authoritative root to browse. Info uses session; Files uses working. */
  fileScope?: SessionFileScope
  /** Root identity used to restart loading and watching when it changes. */
  rootPath?: string
  /** Absolute session folder path for header actions (e.g. View in Finder) */
  sessionFolderPath?: string
  /** Hide section header when embedded inside compact containers (e.g. popovers) */
  hideHeader?: boolean
  /** Case-insensitive filename filter (empty = no filtering). Directory
   *  ancestors of matches are kept so the tree path stays navigable. */
  filterQuery?: string
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Prune a file tree to entries matching a case-insensitive filename query.
 * Directories are kept when they (transitively) contain a match, so the path
 * to every match stays navigable. Pure — returns a shallow-pruned copy only
 * for nodes that survived.
 */
function filterFileTree(entries: SessionFile[], query: string): SessionFile[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries

  const matches = (file: SessionFile): boolean => file.name.toLowerCase().includes(needle)

  const visit = (items: SessionFile[]): SessionFile[] => {
    const kept: SessionFile[] = []
    for (const item of items) {
      if (item.type === 'directory' && item.children) {
        const keptChildren = visit(item.children)
        if (matches(item) || keptChildren.length > 0) {
          kept.push({ ...item, children: keptChildren })
        }
      } else if (matches(item)) {
        kept.push(item)
      }
    }
    return kept
  }

  return visit(entries)
}

/** Collect all directory paths recursively so the tree can start fully expanded. */
function collectDirectoryPaths(entries: SessionFile[]): string[] {
  const directories: string[] = []
  const visit = (items: SessionFile[]) => {
    for (const item of items) {
      if (item.type === 'directory') {
        directories.push(item.path)
        if (item.children && item.children.length > 0) {
          visit(item.children)
        }
      }
    }
  }
  visit(entries)
  return directories
}

/**
 * Get icon for file based on name/type (14x14px matching sidebar)
 */
function getFileIcon(file: SessionFile, isExpanded?: boolean) {
  const iconClass = "h-3.5 w-3.5 text-muted-foreground"

  if (file.type === 'directory') {
    return isExpanded
      ? <FolderOpen className={iconClass} />
      : <Folder className={iconClass} />
  }

  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'markdown') {
    return <FileText className={iconClass} />
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '')) {
    return <Image className={iconClass} />
  }

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].includes(ext || '')) {
    return <FileCode className={iconClass} />
  }

  return <File className={iconClass} />
}

interface FileTreeItemProps {
  file: SessionFile
  depth: number
  selectedPath?: string
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (file: SessionFile) => void
  onFileDoubleClick: (file: SessionFile) => void
  onRevealInFileManager: (path: string) => void
  /** Whether this item is inside an expanded folder (for stagger animation) */
  isNested?: boolean
}

/**
 * Recursive file tree item component
 * Matches LeftSidebar styling patterns exactly:
 * - Vertical line on container level (not per-item)
 * - Framer-motion staggered animation for expand/collapse
 * - Chevron shown on hover, icon hidden
 */
function FileTreeItem({
  file,
  depth,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  onFileDoubleClick,
  onRevealInFileManager,
  isNested,
}: FileTreeItemProps) {
  const { t } = useTranslation()
  const isDirectory = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  const hasChildren = isDirectory && file.children && file.children.length > 0
  const isSelected = !isDirectory && selectedPath === file.path

  const handleClick = () => {
    if (isDirectory && hasChildren) {
      onToggleExpand(file.path)
    } else {
      onFileClick(file)
    }
  }

  const handleDoubleClick = () => {
    onFileDoubleClick(file)
  }

  // Handle chevron click separately to toggle expand
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasChildren) {
      onToggleExpand(file.path)
    }
  }

  // The button element for the file/folder item
  const buttonElement = (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        // Base styles matching LeftSidebar exactly
        // min-w-0 and overflow-hidden required for truncation to work in grid context
        "group relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg py-1.5 text-left text-[13px] select-none outline-none",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "transition-[background-color,color,transform] hover:bg-sidebar-hover active:scale-[0.995]",
        isSelected && "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/15",
        // Same padding for all items - nested indentation handled by container
        "px-2"
      )}
      aria-expanded={hasChildren ? isExpanded : undefined}
      title={`${file.path}\n${file.type === 'file' ? formatFileSize(file.size) : 'Directory'}\n\nClick to ${hasChildren ? 'expand' : 'preview'}, double-click to open externally`}
    >
      {isSelected && (
        <motion.span
          className="absolute inset-y-1 left-0 w-0.5 origin-center rounded-r bg-accent"
          initial={{ opacity: 0, scaleY: 0.4 }}
          animate={{ opacity: 1, scaleY: 1 }}
        />
      )}
      {/* Icon row — persistent chevron for expandable items, alignment slot
          for plain files so every row lines up. */}
      <span className="flex h-3.5 shrink-0 items-center gap-0.5">
        {hasChildren ? (
          <span
            className="flex h-3 w-3 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={handleChevronClick}
          >
            <ChevronRight
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                isExpanded && "rotate-90"
              )}
            />
          </span>
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          {getFileIcon(file, isExpanded)}
        </span>
      </span>

      {/* File/folder name - min-w-0 required for truncate to work in flex container */}
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
      {file.type === 'file' && file.size !== undefined && (
        <span className={cn('shrink-0 text-[10px] tabular-nums text-muted-foreground/45 transition-opacity', !isSelected && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')}>
          {formatFileSize(file.size)}
        </span>
      )}
    </button>
  )

  const fileManagerName = getFileManagerName()

  // Inner content: button and expandable children (wrapped in group/section like LeftSidebar)
  const innerContent = (
    <div className="group/section min-w-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {buttonElement}
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          {/* Open — files only (folders just show "Show in file manager") */}
          {file.type !== 'directory' && (
            <StyledContextMenuItem onSelect={() => onFileClick(file)}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t("chat.openFile")}
            </StyledContextMenuItem>
          )}
          {/* Copy path */}
          <StyledContextMenuItem
            onSelect={() => {
              navigator.clipboard.writeText(file.path).then(
                () => toast.success(t('toast.pathCopied')),
                () => toast.error(t('toast.copyFailed')),
              )
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('common.copyPath')}
          </StyledContextMenuItem>
          {/* Show in file manager */}
          <StyledContextMenuItem
            onSelect={() => onRevealInFileManager(file.path)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("chat.showInFileManager", { fileManager: fileManagerName })}
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>
      {/* Expandable children with framer-motion animation - matches LeftSidebar exactly */}
      {hasChildren && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {/* Wrapper div matches LeftSidebar recursive structure - min-w-0 allows shrinking */}
              <div className="flex flex-col select-none min-w-0">
                <motion.nav
                  className="grid gap-0.5 pl-5 pr-0 relative"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {/* Vertical line at container level - matches LeftSidebar pattern */}
                  <div
                    className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
                    aria-hidden="true"
                  />
                  {file.children!.map((child) => (
                    <motion.div key={child.path} variants={itemVariants} className="min-w-0">
                      <FileTreeItem
                        file={child}
                        depth={depth + 1}
                        selectedPath={selectedPath}
                        expandedPaths={expandedPaths}
                        onToggleExpand={onToggleExpand}
                        onFileClick={onFileClick}
                        onFileDoubleClick={onFileDoubleClick}
                        onRevealInFileManager={onRevealInFileManager}
                        isNested={true}
                      />
                    </motion.div>
                  ))}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )

  // For nested items, the parent already wraps in motion.div for stagger
  // Root items use Fragment to avoid extra wrapper (matches LeftSidebar exactly)
  return <>{innerContent}</>
}

/**
 * Section displaying session files as a tree
 */
export function SessionFilesSection({
  sessionId,
  className,
  fileScope = 'session',
  rootPath,
  sessionFolderPath,
  hideHeader = false,
  filterQuery = '',
}: SessionFilesSectionProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<SessionFile[]>([])
  const expansionStorageKey = `${sessionId ?? 'none'}:${fileScope}:${rootPath ?? 'default'}`

  // Apply the optional filename filter (keeps matching directories' paths open).
  const visibleFiles = useMemo(
    () => filterFileTree(files, filterQuery),
    [files, filterQuery],
  )
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string>()
  const [hasSavedExpandedState, setHasSavedExpandedState] = useState(false)
  const mountedRef = useRef(true)

  // Never leave the previous root visible while a changed work folder loads.
  useEffect(() => {
    setFiles([])
    setLoadError(false)
    setSelectedPath(undefined)
  }, [sessionId, fileScope, rootPath])

  // Load expanded paths from storage when session changes.
  // If no value exists yet, we default to "expand all" after files load.
  useEffect(() => {
    if (sessionId) {
      const raw = storage.getRaw(storage.KEYS.sessionFilesExpandedFolders, expansionStorageKey)
      if (raw !== null) {
        const saved = storage.get<string[]>(storage.KEYS.sessionFilesExpandedFolders, [], expansionStorageKey)
        setExpandedPaths(new Set(saved))
        setHasSavedExpandedState(true)
      } else {
        setExpandedPaths(new Set())
        setHasSavedExpandedState(false)
      }
    } else {
      setExpandedPaths(new Set())
      setHasSavedExpandedState(false)
    }
  }, [sessionId, expansionStorageKey])

  // Save expanded paths to storage when they change
  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    if (sessionId) {
      storage.set(storage.KEYS.sessionFilesExpandedFolders, Array.from(paths), expansionStorageKey)
    }
  }, [sessionId, expansionStorageKey])

  // Load files
  const loadFiles = useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      return
    }

    setIsLoading(true)
    try {
      const sessionFiles = await window.electronAPI.getSessionFiles(sessionId, fileScope)
      if (mountedRef.current) {
        setLoadError(false)
        setFiles(sessionFiles)

        // Session assets are small and start expanded. Work folders can be large,
        // so they start collapsed and expand only on explicit user action.
        if (!hasSavedExpandedState) {
          const initialPaths = fileScope === 'session'
            ? new Set(collectDirectoryPaths(sessionFiles))
            : new Set<string>()
          setExpandedPaths(initialPaths)
          saveExpandedPaths(initialPaths)
          setHasSavedExpandedState(true)
        }
      }
    } catch (error) {
      console.error('Failed to load session files:', error)
      if (mountedRef.current) {
        setLoadError(true)
        setFiles([])
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [sessionId, fileScope, hasSavedExpandedState, saveExpandedPaths])

  // Initial load and file watcher setup
  useEffect(() => {
    mountedRef.current = true
    loadFiles()

    if (sessionId) {
      // Start watching for file changes
      void window.electronAPI.watchSessionFiles(sessionId, fileScope)

      // Listen for file change events
      const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId, changedScope = 'session') => {
        if (changedSessionId === sessionId && changedScope === fileScope && mountedRef.current) {
          void loadFiles()
        }
      })

      const unsubscribeReconnect = window.electronAPI.onReconnected(() => {
        if (!mountedRef.current) return
        void restoreSessionFileWatch(sessionId, loadFiles, fileScope)
      })

      return () => {
        mountedRef.current = false
        unsubscribe()
        unsubscribeReconnect()
        void window.electronAPI.unwatchSessionFiles(fileScope)
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [sessionId, fileScope, rootPath, loadFiles])

  // Use the link interceptor (via context) so file clicks show in-app previews
  // instead of always opening in the file manager / default app.
  const { onOpenFile } = useAppShellContext()
  const fileManagerName = getFileManagerName()

  // Reveal a file/folder in the system file manager
  const handleRevealInFileManager = useCallback((path: string) => {
    window.electronAPI.showInFolder(path)
  }, [])

  // Handle file click — preview in-app if possible, open directory in file manager
  const handleFileClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      // eslint-disable-next-line craft-links/no-direct-file-open -- directories can't be previewed in-app
      window.electronAPI.openFile(file.path)
    } else {
      setSelectedPath(file.path)
      onOpenFile(file.path)
    }
  }, [onOpenFile])

  // Handle double-click — open in the system default app (distinct from the
  // in-app preview on single click; directories go to the file manager).
  const handleFileDoubleClick = useCallback((file: SessionFile) => {
    // eslint-disable-next-line craft-links/no-direct-file-open -- external open is the intended double-click semantic
    window.electronAPI.openFile(file.path)
  }, [])

  // Toggle folder expanded state
  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      saveExpandedPaths(next)
      return next
    })
  }, [saveExpandedPaths])

  if (!sessionId) {
    return null
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Header - matches sidebar styling with select-none, extra top padding for visual balance */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 select-none">
          <span className="text-xs font-medium text-muted-foreground">{t("chat.sessionFiles")}</span>
          {sessionFolderPath && (
            <button
              type="button"
              onClick={() => window.electronAPI.showInFolder(sessionFolderPath)}
              className="text-xs text-foreground/50 hover:text-foreground/80 hover:underline underline-offset-2 transition-colors"
            >
              {t("chat.viewInFileManager", { fileManager: fileManagerName })}
            </button>
          )}
        </div>
      )}

      {/* File tree - px-2 is on nav to match LeftSidebar exactly (constrains grid width) */}
      {/* overflow-x-hidden prevents horizontal scroll, forcing truncation */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2">
        {loadError ? (
          <div className="px-4 text-destructive select-none">
            <p className="text-xs">{t('chat.sessionFilesError')}</p>
          </div>
        ) : files.length === 0 ? (
          isLoading ? (
            <div className="grid gap-1 px-2 pt-1" aria-label={t('chat.sessionFilesLoading')}>
              {[72, 56, 84, 64, 76].map((width, index) => (
                <div key={width} className="flex h-8 animate-pulse items-center gap-2 rounded-lg px-2" style={{ paddingLeft: 8 + (index % 3) * 12 }}>
                  <span className="h-3.5 w-3.5 rounded bg-foreground/[0.07]" />
                  <span className="h-2.5 rounded-full bg-foreground/[0.07]" style={{ width: `${width}%` }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-center text-muted-foreground select-none">
              <p className="text-xs">{t('chat.sessionFilesEmpty')}</p>
            </div>
          )
        ) : visibleFiles.length === 0 ? (
          <div className="px-4 text-muted-foreground select-none">
            <p className="text-xs">{t('contentPanel.files.noFilterMatches')}</p>
          </div>
        ) : (
          /* Root nav has px-2 to match LeftSidebar exactly - this constrains grid width */
          <nav className="grid gap-0.5 px-2">
            {visibleFiles.map((file) => (
              <FileTreeItem
                key={file.path}
                file={file}
                depth={0}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onRevealInFileManager={handleRevealInFileManager}
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
