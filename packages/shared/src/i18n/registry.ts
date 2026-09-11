/**
 * Canonical locale registry — single source of truth for all supported locales.
 *
 * To add a new locale:
 * 1. Create the locale JSON file in ./locales/
 * 2. Register a dynamic loader and date-fns locale below
 * 3. Add one entry to LOCALE_REGISTRY
 *
 * Messages load on demand so the renderer/main bundles only carry English at
 * startup; native names and date locales stay synchronous for settings lists
 * and date formatting.
 */

import type { Locale } from "date-fns";

// The English fallback ships inline so i18next can initialize synchronously.
import enMessages from "./locales/en.json";

import { enUS } from "date-fns/locale/en-US";
import { es as esDateLocale } from "date-fns/locale/es";
import { zhCN } from "date-fns/locale/zh-CN";
import { ja as jaDateLocale } from "date-fns/locale/ja";
import { hu as huDateLocale } from "date-fns/locale/hu";
import { de as deDateLocale } from "date-fns/locale/de";
import { pl as plDateLocale } from "date-fns/locale/pl";

type Messages = Record<string, string>;

function jsonLoader(importer: () => Promise<{ default: Messages }>): () => Promise<Messages> {
  return async () => (await importer()).default;
}

interface LocaleEntry {
  nativeName: string;
  loadMessages: () => Promise<Messages>;
  dateLocale: Locale;
}

export const LOCALE_REGISTRY = {
  en: { nativeName: "English", dateLocale: enUS, loadMessages: async () => enMessages },
  es: {
    nativeName: "Español",
    dateLocale: esDateLocale,
    loadMessages: jsonLoader(() => import("./locales/es.json")),
  },
  "zh-Hans": {
    nativeName: "简体中文",
    dateLocale: zhCN,
    loadMessages: jsonLoader(() => import("./locales/zh-Hans.json")),
  },
  ja: {
    nativeName: "日本語",
    dateLocale: jaDateLocale,
    loadMessages: jsonLoader(() => import("./locales/ja.json")),
  },
  hu: {
    nativeName: "Magyar",
    dateLocale: huDateLocale,
    loadMessages: jsonLoader(() => import("./locales/hu.json")),
  },
  de: {
    nativeName: "Deutsch",
    dateLocale: deDateLocale,
    loadMessages: jsonLoader(() => import("./locales/de.json")),
  },
  pl: {
    nativeName: "Polski",
    dateLocale: plDateLocale,
    loadMessages: jsonLoader(() => import("./locales/pl.json")),
  },
} satisfies Record<string, LocaleEntry>;

export type LanguageCode = keyof typeof LOCALE_REGISTRY;

/** Load one locale's translations on demand. */
export async function loadLocaleMessages(code: LanguageCode): Promise<Messages> {
  return LOCALE_REGISTRY[code].loadMessages();
}
