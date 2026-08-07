/**
 * Shared wire-protocol limits.
 *
 * Kept in the protocol package so the server (enforcement), the RPC client
 * (pre-flight check), and the renderer (user-facing attachment errors) all
 * agree on the same numbers.
 */

/**
 * Hard cap on a single WebSocket message (the serialized RPC envelope) in
 * bytes. Enforced server-side (frame-level `maxPayload` plus the M-9 guard)
 * and checked client-side before send so oversized payloads fail with a
 * clear error instead of silently killing the connection.
 *
 * Sized to the strictest runtime in the stack: the Bun-based embedded server
 * hard-limits WebSocket messages at 16 MiB (`maxPayloadLength` default) and
 * ignores the `maxPayload` option of the `ws` shim. Files up to ~12 MiB fit
 * as base64; larger payloads must be pre-flighted and rejected client-side.
 */
export const MAX_MESSAGE_PAYLOAD_BYTES = 16 * 1024 * 1024

/**
 * Client-side pre-flight margin: the envelope adds a fixed overhead
 * (id, type, channel, args wrapper) on top of the payload estimate, and the
 * server counts UTF-8 bytes while `JSON.stringify` counts UTF-16 code units.
 * Estimates are allowed to exceed the hard cap by at most this many bytes.
 */
export const MAX_MESSAGE_PAYLOAD_MARGIN_BYTES = 4 * 1024
