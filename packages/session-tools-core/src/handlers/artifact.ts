import type {
  ArtifactApplyInput,
  ArtifactCreateInput,
  ArtifactToolResult,
  SessionToolContext,
} from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse } from '../response.ts';

export interface ArtifactStatusArgs {
  artifactId?: string;
}

export type ArtifactCreateArgs = ArtifactCreateInput;

export interface ArtifactApplyArgs extends ArtifactApplyInput {
  artifactId: string;
}

export interface ArtifactInspectArgs {
  artifactId: string;
}

export type ArtifactRenderArgs = ArtifactInspectArgs;

export interface ArtifactSubmitArgs {
  artifactId: string;
  expectedRevision?: string;
}

function success(result: ArtifactToolResult): ToolResult {
  return {
    content: [{ type: 'text', text: result.text }],
    structuredContent: result.structuredContent,
    isError: false,
  };
}

async function invoke(
  toolName: string,
  operation: (() => Promise<ArtifactToolResult>) | undefined,
): Promise<ToolResult> {
  if (!operation) return errorResponse(`${toolName} is not available in this context.`);
  try {
    return success(await operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResponse(`${toolName} failed: ${message}`);
  }
}

export function handleArtifactStatus(ctx: SessionToolContext, args: ArtifactStatusArgs): Promise<ToolResult> {
  return invoke('artifact_status', ctx.artifactStatus
    ? () => ctx.artifactStatus!(args.artifactId)
    : undefined);
}

export function handleArtifactCreate(ctx: SessionToolContext, args: ArtifactCreateArgs): Promise<ToolResult> {
  return invoke('artifact_create', ctx.artifactCreate
    ? () => ctx.artifactCreate!(args)
    : undefined);
}

export function handleArtifactApply(ctx: SessionToolContext, args: ArtifactApplyArgs): Promise<ToolResult> {
  const { artifactId, expectedRevision, operation } = args;
  return invoke('artifact_apply', ctx.artifactApply
    ? () => ctx.artifactApply!(artifactId, { expectedRevision, operation })
    : undefined);
}

export function handleArtifactInspect(ctx: SessionToolContext, args: ArtifactInspectArgs): Promise<ToolResult> {
  return invoke('artifact_inspect', ctx.artifactInspect
    ? () => ctx.artifactInspect!(args.artifactId)
    : undefined);
}

export function handleArtifactRender(ctx: SessionToolContext, args: ArtifactRenderArgs): Promise<ToolResult> {
  return invoke('artifact_render', ctx.artifactRender
    ? () => ctx.artifactRender!(args.artifactId)
    : undefined);
}

export function handleArtifactSubmit(ctx: SessionToolContext, args: ArtifactSubmitArgs): Promise<ToolResult> {
  return invoke('artifact_submit', ctx.artifactSubmit
    ? () => ctx.artifactSubmit!(args.artifactId, args.expectedRevision)
    : undefined);
}
