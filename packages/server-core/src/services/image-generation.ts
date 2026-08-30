import OpenAI from 'openai';
import type {
  ImageGenerateParamsNonStreaming,
  ImagesResponse,
} from 'openai/resources/images';
import type { LlmConnection } from '@craft-agent/shared/config';

export const DEFAULT_IMAGE_GENERATION_MODEL = 'gpt-image-2';
export const MAX_GENERATED_IMAGE_BYTES = 50 * 1024 * 1024;

export type GeneratedImageFormat = 'png' | 'jpeg' | 'webp';

export interface GenerateImageRequest {
  prompt: string;
  model?: string;
  size?: string;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  background?: 'auto' | 'opaque' | 'transparent';
  outputFormat?: GeneratedImageFormat;
}

export interface GeneratedImage {
  bytes: Buffer;
  model: string;
  format: GeneratedImageFormat;
  revisedPrompt?: string;
  providerCreatedAt?: number;
}

export interface OpenAIImageProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ImageApiClient {
  images: {
    generate(params: ImageGenerateParamsNonStreaming): Promise<ImagesResponse>;
  };
}

export interface ResolvedImageGenerationConnection {
  connection: LlmConnection;
  apiKey: string;
}

function createClient(config: OpenAIImageProviderConfig): ImageApiClient {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl?.trim() || undefined,
    timeout: config.timeoutMs ?? 300_000,
    maxRetries: config.maxRetries ?? 2,
  });
}

export function supportsNativeImageGeneration(connection: LlmConnection): boolean {
  return connection.providerType === 'pi'
    && connection.piAuthProvider === 'openai'
    && connection.authType === 'api_key';
}

export async function resolveImageGenerationConnection(input: {
  explicitSlug?: string;
  preferredConnection?: LlmConnection | null;
  connections: readonly LlmConnection[];
  getApiKey: (connectionSlug: string) => Promise<string | null>;
}): Promise<ResolvedImageGenerationConnection> {
  const explicitSlug = input.explicitSlug?.trim();
  const candidates = explicitSlug
    ? input.connections.filter((connection) => connection.slug === explicitSlug)
    : [
        ...(input.preferredConnection ? [input.preferredConnection] : []),
        ...input.connections.filter((connection) => connection.slug !== input.preferredConnection?.slug),
      ];
  if (explicitSlug && candidates.length === 0) {
    throw new Error(`LLM connection "${explicitSlug}" was not found.`);
  }

  for (const connection of candidates) {
    if (!supportsNativeImageGeneration(connection)) continue;
    const apiKey = await input.getApiKey(connection.slug);
    if (apiKey) return { connection, apiKey };
    if (explicitSlug) throw new Error(`OpenAI API key is missing for connection "${connection.slug}".`);
  }
  throw new Error('No image-capable OpenAI API-key connection is configured. Add an OpenAI API connection in AI Settings.');
}

function decodeBase64Image(value: string): Buffer {
  const normalized = value.replaceAll(/\s/g, '');
  if (!normalized || normalized.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 4) {
    throw new Error('The image provider returned an empty or oversized base64 payload.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('The image provider returned invalid base64 data.');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error('The generated image is empty or exceeds the 50 MB safety limit.');
  }
  return bytes;
}

function assertImageSignature(bytes: Buffer, format: GeneratedImageFormat): void {
  const valid = format === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : format === 'jpeg'
      ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF'
        && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!valid) throw new Error(`The image provider payload does not match the declared ${format.toUpperCase()} format.`);
}

/**
 * Official OpenAI Images API adapter. It deliberately requests exactly one
 * image so one paid operation maps to one managed Artifact review decision.
 */
export async function generateImageWithOpenAI(
  config: OpenAIImageProviderConfig,
  request: GenerateImageRequest,
  client: ImageApiClient = createClient(config),
): Promise<GeneratedImage> {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error('Image prompt must not be empty.');
  if (prompt.length > 32_000) throw new Error('Image prompt exceeds the 32,000 character limit.');

  const model = request.model?.trim() || DEFAULT_IMAGE_GENERATION_MODEL;
  if (model.startsWith('dall-e-')) {
    throw new Error('Legacy DALL-E models are not supported by the native Artifact workflow; use a GPT Image model.');
  }
  const outputFormat = request.outputFormat ?? 'png';
  const background = request.background ?? 'auto';
  if (background === 'transparent' && outputFormat === 'jpeg') {
    throw new Error('Transparent backgrounds require PNG or WebP output.');
  }
  if (background === 'transparent' && (model === 'gpt-image-2' || model === 'gpt-image-2-2026-04-21')) {
    throw new Error(`${model} does not support transparent backgrounds.`);
  }

  const params: ImageGenerateParamsNonStreaming = {
    prompt,
    model,
    n: 1,
    output_format: outputFormat,
    background,
    quality: request.quality ?? 'auto',
    size: request.size ?? 'auto',
    stream: false,
  };

  const response = await client.images.generate(params);
  const image = response.data?.[0];
  if (!image?.b64_json) {
    throw new Error('The image provider returned no inline image data.');
  }
  const bytes = decodeBase64Image(image.b64_json);
  const actualFormat = response.output_format ?? outputFormat;
  assertImageSignature(bytes, actualFormat);
  return {
    bytes,
    model,
    format: actualFormat,
    revisedPrompt: image.revised_prompt,
    providerCreatedAt: response.created,
  };
}
