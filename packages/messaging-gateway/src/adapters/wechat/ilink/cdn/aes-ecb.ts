// Vendored from @tencent-weixin/openclaw-weixin@2.4.4 (MIT, Copyright (C) 2026 Tencent).
// See ../LICENSE and ../README.md (paths relative to ilink/) for license text and local adaptations.

import { createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-128-ecb' as const;

/**
 * Encrypts plaintext using AES-128-ECB with PKCS#7 padding.
 * The IV is set to null as ECB mode does not use one.
 */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv(ALGORITHM, key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/**
 * Decrypts ciphertext using AES-128-ECB.
 * The IV is set to null as ECB mode does not use one.
 */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Returns the padded size of plaintext when PKCS#7 padded to 16-byte blocks.
 * ECB uses 16-byte block size; padding is always added (1-16 bytes).
 */
export function aesEcbPaddedSize(plaintextSize: number): number {
  const blockSize = 16;
  const padding = blockSize - (plaintextSize % blockSize);
  return plaintextSize + padding;
}
