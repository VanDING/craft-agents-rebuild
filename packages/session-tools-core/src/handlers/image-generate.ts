import type {
  ArtifactToolResult,
  ImageGenerateInput,
  SessionToolContext,
} from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export type ImageGenerateArgs = ImageGenerateInput;

export async function handleImageGenerate(
  ctx: SessionToolContext,
  args: ImageGenerateArgs,
): Promise<ToolResult> {
  if (!ctx.imageGenerate) return errorResponse('image_generate is not available in this context.');
  try {
    const result: ArtifactToolResult = await ctx.imageGenerate(args);
    return {
      content: [{ type: 'text', text: result.text }],
      structuredContent: result.structuredContent,
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`image_generate failed: ${message}`);
  }
}
