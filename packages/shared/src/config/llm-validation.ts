/**
 * LLM Connection Validation
 *
 * Validates LLM connections by parsing error messages from LLM providers.
 */

export interface LlmValidationResult {
  success: boolean;
  error?: string;
}
/**
 * Parse error messages into user-friendly descriptions.
 * Centralizes error message translation for all connection validation.
 *
 * @param msg - The raw error message to parse
 * @returns A user-friendly error description
 */
export function parseValidationError(msg: string): string {
  const lowerMsg = msg.toLowerCase();

  // Connection errors — server unreachable
  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('enotfound') || lowerMsg.includes('fetch failed')) {
    return 'Cannot connect to API server. Check the URL and ensure the server is running.';
  }

  // Auth errors
  if (lowerMsg.includes('401') || lowerMsg.includes('unauthorized') || lowerMsg.includes('authentication')) {
    return 'Authentication failed. Check your API key or OAuth token.';
  }

  // Permission errors
  if (lowerMsg.includes('403') || lowerMsg.includes('forbidden') || lowerMsg.includes('permission')) {
    return 'Access denied. Check your API key permissions.';
  }

  // Rate limit / quota errors
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit') || lowerMsg.includes('quota')) {
    return 'Rate limited or quota exceeded. Try again later.';
  }

  // Credit/billing errors
  if (lowerMsg.includes('402') || lowerMsg.includes('credit') || lowerMsg.includes('billing') || lowerMsg.includes('insufficient')) {
    return 'Billing issue. Check your account credits or payment method.';
  }

  // Model not found
  if (lowerMsg.includes('model not found') || lowerMsg.includes('invalid model')) {
    return 'Model not found. Check the connection configuration.';
  }

  // 404 on endpoint
  if (lowerMsg.includes('404') && !lowerMsg.includes('model')) {
    return 'Endpoint not found. Ensure the server supports the Anthropic Messages API.';
  }

  // Service unavailable
  if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503') || lowerMsg.includes('service unavailable')) {
    return 'API temporarily unavailable. Try again in a few seconds.';
  }

  // Fallback
  return msg.slice(0, 200);
}
