// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { logger } from '../util/logger';

// Type for the silk-wasm decode result (silk-wasm is an optional runtime dep).
interface DecodeResult {
  data: Uint8Array;
  duration: number;
}

type SilkDecodeFn = (
  input: ArrayBufferView | ArrayBuffer,
  sampleRate: number,
) => Promise<DecodeResult>;

/**
 * Sample rate (Hz) used for SILK encoding/decoding.
 * WeChat voice messages use 24 kHz mono SILK.
 */
export const SILK_SAMPLE_RATE = 24000 as const;

/**
 * Wrap raw PCM s16le (little-endian 16-bit signed) audio bytes in a
 * standard RIFF/WAV header.
 *
 * @param pcm        - Raw PCM s16le byte buffer.
 * @param sampleRate - Sample rate of the PCM data (e.g. 24000).
 * @returns A complete `.wav` file as a Buffer.
 */
export function pcmBytesToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const headerSize = 44;

  const wav = Buffer.alloc(headerSize + dataSize);
  let offset = 0;

  // RIFF header
  wav.write('RIFF', offset);         offset += 4;
  wav.writeUInt32LE(headerSize + dataSize - 8, offset); offset += 4; // file size - 8
  wav.write('WAVE', offset);         offset += 4;

  // fmt sub-chunk
  wav.write('fmt ', offset);         offset += 4;
  wav.writeUInt32LE(16, offset);     offset += 4;  // sub-chunk size (16 for PCM)
  wav.writeUInt16LE(1, offset);      offset += 2;  // PCM format
  wav.writeUInt16LE(numChannels, offset); offset += 2;
  wav.writeUInt32LE(sampleRate, offset);  offset += 4;
  wav.writeUInt32LE(byteRate, offset);    offset += 4;
  wav.writeUInt16LE(blockAlign, offset);  offset += 2;
  wav.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  wav.write('data', offset);         offset += 4;
  wav.writeUInt32LE(dataSize, offset); offset += 4;

  // PCM sample data
  pcm.copy(wav, offset);

  return wav;
}

/**
 * Decode a SILK audio buffer to WAV using the optional `silk-wasm` package.
 *
 * The `silk-wasm` module is loaded via a dynamic import so that the adapter
 * works without it (returns `null`) when the dependency is not installed.
 *
 * @param silkBuf - Raw SILK audio data.
 * @returns A complete `.wav` Buffer on success, or `null` if `silk-wasm`
 *          is unavailable or decoding fails.
 */
export async function silkToWav(silkBuf: Buffer): Promise<Buffer | null> {
  // Exception: dynamic import — silk-wasm is an optional runtime dependency
  // that may not be installed in every deployment.
  let decode: SilkDecodeFn;
  try {
    const silkModule: string = 'silk-wasm';
    const mod: { decode: SilkDecodeFn } = await import(silkModule) as unknown as { decode: SilkDecodeFn };
    decode = mod.decode;
  } catch {
    logger.warn('[silk-wasm] package not available; SILK→WAV transcoding disabled');
    return null;
  }

  try {
    const { data } = await decode(silkBuf, SILK_SAMPLE_RATE);
    return pcmBytesToWav(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      SILK_SAMPLE_RATE,
    );
  } catch (err: unknown) {
    logger.warn('[silk-wasm] decode failed: ' + String(err));
    return null;
  }
}
