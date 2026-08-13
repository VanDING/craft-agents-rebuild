/**
 * ToolDefinition — 通用工具定义类型
 *
 * Craft 的 defineTool shim:与 Pi SDK 的 ToolDefinition<any, any> 兼容。
 */
import type { ZodRawShape } from 'zod/v4';

// ToolResult — 与 Pi SDK 的 CallToolResult 兼容
export interface ToolResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any[];
  isError?: boolean;
}

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>;
  annotations?: { readOnlyHint?: boolean };
}

/**
 * 创建工具定义的工厂函数 (Craft 的 defineTool shim)。
 */
export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>,
  extras?: { annotations?: { readOnlyHint?: boolean } },
): ToolDefinition<Shape> {
  return { name, description, inputSchema, handler, ...extras };
}
