import type { ThinkingLevel } from '../../../thinking-levels.ts';
import { THINKING_LEVEL_IDS } from '../../../thinking-levels.ts';
import type { ModelDefinition } from '../../../../config/models.ts';

type CustomEndpointApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

interface DiscoveryOptions {
  baseUrl: string;
  api: CustomEndpointApi;
  apiKey?: string;
  timeoutMs: number;
  knownModels?: ModelDefinition[];
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function positiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function modelListUrls(baseUrl: string, api: CustomEndpointApi): string[] {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const urls = base.endsWith('/v1')
    ? [`${base}/models`]
    : api === 'anthropic-messages'
      ? [`${base}/v1/models`, `${base}/models`]
      : [`${base}/models`, `${base}/v1/models`];

  // Ollama exposes its native model list here even when its OpenAI-compatible
  // inference endpoint is selected in Craft.
  if (!base.endsWith('/v1')) urls.push(`${base}/api/tags`);
  return [...new Set(urls)];
}

function isLoopbackOrLinkLocalUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname === '::1') return true;
    if (hostname.startsWith('127.') || hostname.startsWith('169.254.')) return true;
    if (/^fe[89ab][0-9a-f]/.test(hostname)) return true;
    if (hostname.startsWith('::ffff:')) {
      const mapped = hostname.slice('::ffff:'.length);
      if (mapped.startsWith('127.')) return true;
      const groups = mapped.split(':');
      if (groups.length >= 2) {
        const secondLast = Number.parseInt(groups.at(-2) ?? '', 16);
        return Number.isFinite(secondLast) && (secondLast >>> 8) === 127;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function discoveryHeaders(baseUrl: string, api: CustomEndpointApi, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  // Keep the same audit policy as the Pi inference runtime: a local model
  // server must never receive a real provider credential.
  if (!apiKey || isLoopbackOrLinkLocalUrl(baseUrl)) return headers;
  if (api === 'anthropic-messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function extractRows(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) return payload.map(asObject).filter((row): row is JsonObject => !!row);
  const root = asObject(payload);
  if (!root) return [];
  const rows = root.data ?? root.models;
  return Array.isArray(rows)
    ? rows.map(asObject).filter((row): row is JsonObject => !!row)
    : [];
}

function extractThinkingLevels(row: JsonObject): ThinkingLevel[] | undefined {
  const raw = row.supportedReasoningEfforts
    ?? row.supported_reasoning_efforts
    ?? row.supportedThinkingLevels
    ?? row.supported_thinking_levels;
  if (!Array.isArray(raw)) return undefined;
  const levels = raw.filter((level): level is ThinkingLevel =>
    typeof level === 'string' && (THINKING_LEVEL_IDS as readonly string[]).includes(level),
  );
  if (levels.length === 0) return undefined;
  return levels.includes('off') ? levels : ['off', ...levels];
}

function rowSupportsReasoning(row: JsonObject): boolean | undefined {
  if (typeof row.reasoning === 'boolean') return row.reasoning;
  if (typeof row.supports_reasoning === 'boolean') return row.supports_reasoning;
  if (typeof row.supportsThinking === 'boolean') return row.supportsThinking;
  if (extractThinkingLevels(row)) return true;
  const supported = row.supported_parameters;
  if (Array.isArray(supported)) {
    return supported.some(value => typeof value === 'string' && /reasoning|thinking/.test(value));
  }
  return undefined;
}

function rowSupportsImages(row: JsonObject): boolean | undefined {
  const architecture = asObject(row.architecture);
  const modalities = architecture?.input_modalities ?? row.input_modalities ?? row.modalities;
  if (!Array.isArray(modalities)) return undefined;
  return modalities.some(value => value === 'image' || value === 'vision');
}

function findKnownModel(id: string, knownModels: ModelDefinition[]): ModelDefinition | undefined {
  const bareId = id.startsWith('pi/') ? id.slice(3) : id;
  return knownModels.find(model => {
    const knownBareId = model.id.startsWith('pi/') ? model.id.slice(3) : model.id;
    return knownBareId === bareId;
  });
}

/** Convert common OpenAI/Anthropic/Ollama model-list payloads into Craft models. */
export function parseDiscoveredModels(
  payload: unknown,
  knownModels: ModelDefinition[] = [],
): ModelDefinition[] {
  const seen = new Set<string>();
  const models: ModelDefinition[] = [];

  for (const row of extractRows(payload)) {
    const idValue = row.id ?? row.model ?? row.name;
    if (typeof idValue !== 'string' || !idValue.trim()) continue;
    const id = idValue.trim();
    if (seen.has(id)) continue;
    seen.add(id);

    const known = findKnownModel(id, knownModels);
    const topProvider = asObject(row.top_provider);
    const nameValue = row.display_name ?? row.displayName ?? row.name;
    const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : known?.name ?? id;
    const reportedLevels = extractThinkingLevels(row);
    const reportedReasoning = rowSupportsReasoning(row);
    const supportsThinking = reportedReasoning ?? known?.supportsThinking ?? false;
    const supportedThinkingLevels = reportedLevels
      ?? known?.supportedThinkingLevels
      ?? (supportsThinking ? ['off', 'minimal', 'low', 'medium', 'high'] : ['off']);

    models.push({
      id,
      name,
      shortName: known?.shortName ?? name,
      description: known?.description ?? 'Discovered from custom endpoint',
      provider: 'pi',
      contextWindow: positiveNumber(
        row.context_window,
        row.contextWindow,
        row.context_length,
        topProvider?.context_length,
        known?.contextWindow,
      ) ?? 131_072,
      supportsThinking,
      supportedThinkingLevels,
      ...(known?.thinkingLevelMap ? { thinkingLevelMap: known.thinkingLevelMap } : {}),
      supportsImages: rowSupportsImages(row) ?? known?.supportsImages ?? false,
    });
  }
  return models;
}

/**
 * Discover models from a custom endpoint. Generic inference protocols do not
 * define one universal list URL, so the standard variants are tried in order.
 */
export async function discoverCustomEndpointModels(options: DiscoveryOptions): Promise<ModelDefinition[]> {
  const errors: string[] = [];
  const deadline = Date.now() + options.timeoutMs;
  for (const url of modelListUrls(options.baseUrl, options.api)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: discoveryHeaders(options.baseUrl, options.api, options.apiKey),
        signal: controller.signal,
      });
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const models = parseDiscoveredModels(await response.json(), options.knownModels);
      if (models.length > 0) return models;
      errors.push(`${url}: empty model list`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${url}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Custom endpoint model discovery failed (${errors.join('; ')})`);
}
