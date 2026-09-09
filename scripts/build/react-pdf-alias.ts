import { createRequire } from 'node:module'
import { dirname } from 'node:path'

/** Keep browser PDF.js imports (including ?url workers) on react-pdf's version.
 * The server also installs pdfjs-dist and may hoist a different major version.
 * Resolve through react-pdf instead of relying on the node_modules layout.
 */
export function reactPdfAlias(configUrl: string) {
  const appRequire = createRequire(configUrl)
  const reactPdfRequire = createRequire(appRequire.resolve('react-pdf'))
  return {
    'pdfjs-dist': dirname(reactPdfRequire.resolve('pdfjs-dist/package.json')),
  }
}
