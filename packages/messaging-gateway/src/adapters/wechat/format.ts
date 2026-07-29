/**
 * Markdown-to-plain-text conversion for WeChat message output.
 *
 * Strips common Markdown syntax while preserving meaningful content:
 * fenced code blocks (kept verbatim), inline code, images, links,
 * bold/italic/strikethrough markers, heading `#` prefixes, and
 * blockquote `>` markers.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Inline processing
// ---------------------------------------------------------------------------

/**
 * Remove inline Markdown formatting on a single line.
 *
 * Order matters: images before links (share the `[...](...)` form),
 * bold/italic before plain `*`/`_` markers to avoid partial matches.
 */
function stripInline(text: string): string {
  // Images: ![alt](url) → "alt (url)" or bare url
  text = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt: string, url: string) => (alt ? `${alt} (${url})` : url),
  )

  // Links: [text](url) → "text (url)" or bare url
  text = text.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, t: string, url: string) => (t ? `${t} (${url})` : url),
  )

  // Inline code: remove backticks
  text = text.replace(/`([^`]*)`/g, '$1')

  // Bold **text** / __text__ (handle before italic to avoid capturing partial)
  text = text.replace(/\*\*([^*]*)\*\*/g, '$1')
  text = text.replace(/__([^_]*)__/g, '$1')

  // Italic *text* / _text_ (must not match bold markers)
  text = text.replace(/(?<!\*)\*([^*]*)\*(?!\*)/g, '$1')
  text = text.replace(/(?<!_)_([^_]*)_(?!_)/g, '$1')

  // Strikethrough ~~text~~
  text = text.replace(/~~([^~]*)~~/g, '$1')

  return text
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Strip Markdown formatting from `input`, returning plain text suitable for
 * WeChat display.
 *
 * Fenced code blocks (```` ``` ````) are preserved verbatim.  All other
 * Markdown constructs are removed or simplified to their text content.
 *
 * @param input - Raw Markdown text.
 * @returns Plain-text content with leading/trailing whitespace trimmed.
 *          Returns an empty string when `input` is empty or blank-falsy.
 */
export function stripMarkdownForWeChat(input: string): string {
  if (!input) return ''

  // ---- Protect fenced code blocks ---------------------------------------
  const blocks = new Map<string, string>()
  let index = 0

  const text = input.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    (_match, _lang: string, code: string) => {
      const key = `\x00CODE_${index++}\x00`
      blocks.set(key, code.trimEnd())
      return key
    },
  )

  // ---- Process each line for block-level and inline markdown -------------
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    // Leave protected placeholders untouched
    if (/^\x00CODE_\d+\x00$/.test(line)) continue

    let l: string = line
    // Heading markers
    l = l.replace(/^#{1,6}\s+/, '')
    // Blockquote markers
    l = l.replace(/^>\s?/, '')
    // Inline formatting
    l = stripInline(l)
    lines[i] = l
  }

  // ---- Restore code blocks -----------------------------------------------
  let result = lines.join('\n')
  for (const [key, code] of blocks) {
    // Simple split-replace to avoid re-regexing inserted content
    result = result.replace(key, code)
  }

  return result.trim()
}
