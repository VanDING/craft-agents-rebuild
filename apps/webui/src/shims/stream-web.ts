/** Use native browser streams for packages that also support Node's stream/web. */
export const ReadableStream = globalThis.ReadableStream
export const WritableStream = globalThis.WritableStream
export const TransformStream = globalThis.TransformStream
export default { ReadableStream, WritableStream, TransformStream }
