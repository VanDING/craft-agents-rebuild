# Native file preview

Branch: `codex/native-file-preview`

This updates the file-preview portion of the Artifact baseline. Artifact storage, immutable revisions, leases and accept/discard remain the delivery model. Supported formats render their original revision bytes rather than extracted Markdown.

## File opening

Conversation links and session-file entries carry their session ID to a shared opener. The workspace-routed `file:resolve` RPC validates session ownership, resolves relative paths against the session working directory, canonicalizes paths, enforces existing read permissions and returns file metadata. Missing paths produce errors; nearby same-name files are never substituted. Relative links inside documents resolve against the original source document, not its stored revision.

Explicit filesystem links accept Unicode, encoded spaces, Windows/UNC paths and unknown suffixes. Keyboard and middle-click activation follow the same handler. Web and custom URI schemes retain URL routing. Directories open externally. Supported files enter Artifact Workbench; registration failure falls back to the same preview panel. Stale asynchronous requests cannot replace a newer file selection.

Registering an existing Artifact no longer depends on MarkItDown conversion. Inspect/submit retain semantic preview generation. Unknown or oversized files show a fallback with an explicit external-open action and useful errors.

## Renderers

- DOCX/XLSX/PPTX and other Office formats: lazy `@open-file-viewer/core@0.1.44` adapter, with only `officePlugin()` registered.
- CSV/TSV: table and source views.
- Markdown, HTML, SVG, JSON and Mermaid: preview/source switching. JSON has a collapsible tree; source uses Shiki.
- PDF: responsive single-page rendering with pagination, avoiding eager rendering of every page.
- Images and browser-supported audio/video: local Blob URLs, released when the preview changes or closes.
- HTML/SVG: opaque, script-disabled frames. Local image references are resolved through checked RPCs and inlined, limited to 32 images of at most 5 MiB each.
- Office DOM: same-origin frame without script permission; nested frames inherit the sandbox. CSP blocks network resources. Generated DOCX styles are mirrored into the frame and removed by the viewer on disposal.

Whole-file reads retain the 50 MiB RPC limit. Text rendering is capped at one million characters. Binary Office files have no source tab. External-open errors and decoding failures are visible; failed reads can be retried.

## Validation

Focused tests cover Unicode/encoded paths, URI preservation, exact resolution, relative document links, symlink permission checks, session workspace ownership, Artifact registration of corrupt Office bytes, protocol routing and the format registry.

```sh
bun test ./packages/server-core/src/services/file-target.test.ts ./packages/server-core/src/handlers/rpc/artifacts.test.ts ./packages/ui/src/components/markdown/__tests__/linkify.test.ts ./packages/ui/src/components/markdown/__tests__/markdown-link-routing.test.ts ./packages/shared/src/protocol/__tests__/routing.test.ts ./packages/shared/src/artifacts/__tests__/file-formats.test.ts
bun test ./packages/server-core/src/handlers/rpc/files-resolve.test.ts
bun run --cwd apps/electron typecheck
bun run --cwd packages/server-core typecheck
bun scripts/check-i18n-parity.ts
bun run --cwd apps/electron build:renderer
bun scripts/electron-build-main.ts
```

Headless Chromium smoke checks used generated Chinese DOCX/XLSX/PPTX, Markdown, CSV, HTML/SVG, JSON, Mermaid, a two-page PDF, PNG, WAV and a damaged DOCX. Checks passed for nested Markdown file activation, source switching, Office content, PDF navigation, local HTML images, blocked scripts, media metadata, errors and size fallback, with no uncaught browser errors. Earlier isolation checks also covered embedded DOCX HTML scripts and style cleanup. Temporary fixtures were removed after testing.

## Boundaries

This is read-only browsing, not Office editing or a promise of pixel-perfect Microsoft Office compatibility. Modern DOCX/XLSX/PPTX were smoke-tested; legacy Office fidelity depends on the adapter. Audio/video codecs depend on Chromium. Remote document resources remain blocked, and large-file streaming is outside this change.

The dependency installs optional-format packages, but Office/table code is loaded only when needed. Existing build size warnings remain; chunk splitting is not a claim that every optional dependency is free of install cost.
