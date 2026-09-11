/**
 * Static Lucide icon map for the shared menu schema.
 *
 * Menu items carry Lucide names as strings, so a namespace import would pull
 * the entire icon library into the initial renderer bundle. Keep this map in
 * sync with apps/electron/src/shared/menu-schema.ts; unknown names render nothing.
 */
import type { ComponentType } from 'react'
import { AppWindow, Bug, Building2, ClipboardPaste, Copy, Download, Eye, Focus, HelpCircle, Keyboard, LogOut, Maximize2, MessageSquare, Minimize2, Palette, PanelLeft, Pencil, Redo2, RotateCcw, Scissors, Server, Settings, ShieldCheck, Sparkles, SquarePen, Tag, TextSelect, ToggleRight, Undo2, UserCircle, ZoomIn, ZoomOut } from 'lucide-react'

type MenuIconComponent = ComponentType<{ className?: string }>

const MENU_ICONS: Record<string, MenuIconComponent> = {
  AppWindow,
  Bug,
  Building2,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  Focus,
  HelpCircle,
  Keyboard,
  LogOut,
  Maximize2,
  MessageSquare,
  Minimize2,
  Palette,
  PanelLeft,
  Pencil,
  Redo2,
  RotateCcw,
  Scissors,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Tag,
  TextSelect,
  ToggleRight,
  Undo2,
  UserCircle,
  ZoomIn,
  ZoomOut,
}

export function getMenuIcon(name: string): MenuIconComponent | null {
  return MENU_ICONS[name] ?? null
}
