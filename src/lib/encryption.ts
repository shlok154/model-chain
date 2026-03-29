/**
 * Client-side AES-256-GCM encryption for IPFS uploads.
 *
 * Why client-side:
 *   Files are encrypted in the browser before reaching the backend.
 *   This means even the server operator cannot decrypt purchased content
 *   without the per-model key, which is stored backend-side and only
 *   returned to verified purchasers at download time.
 *
 * Flow (upload):
 *   1. Generate a random 256-bit AES-GCM key per file
 *   2. Encrypt the file bytes → encrypted blob
 *   3. Upload encrypted blob to IPFS via /api/ipfs/upload
 *   4. POST the exported key (base64) + ipfs_hash to /api/ipfs/register-key
 *      (backend stores key, keyed by ipfs_hash, service-side only)
 *   5. Return the ipfs_hash to the form — this CID now points to ciphertext
 *
 * Flow (download):
 *   1. Fetch encrypted blob from /api/ipfs/download/{hash} (purchase-gated)
 *   2. Fetch decryption key from /api/ipfs/key/{hash} (purchase-gated)
 *   3. Decrypt in browser → offer plaintext file for download
 *
 * The raw key never leaves the backend after registration.
 * The CID on IPFS is ciphertext — useless without the key.
 */

const ALGO = "AES-GCM";
const KEY_BITS = 256;
const IV_BYTES = 12; // 96-bit IV for AES-GCM

/** Generate a new random AES-256-GCM key. */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGO, length: KEY_BITS }, true, ["encrypt", "decrypt"]);
}

/** Export a CryptoKey to a base64 string for storage. */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/** Import a base64 key string back to a CryptoKey. */
export async function importKey(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, ["decrypt"]);
}

/**
 * Encrypt a File using AES-256-GCM.
 * Returns { encryptedBlob, keyB64, ivB64 }
 * The caller should store keyB64 securely (backend) and include ivB64 in metadata.
 */
export async function encryptFile(
  file: File,
  key?: CryptoKey
): Promise<{ encryptedBlob: Blob; key: CryptoKey; keyB64: string; ivB64: string }> {
  const cryptoKey = key ?? await generateKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = await file.arrayBuffer();

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    cryptoKey,
    plaintext
  );

  // Prepend IV to ciphertext so it travels with the file
  const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_BYTES);

  const keyB64 = await exportKey(cryptoKey);
  const ivB64  = btoa(String.fromCharCode(...iv));

  return {
    encryptedBlob: new Blob([combined], { type: "application/octet-stream" }),
    key:    cryptoKey,
    keyB64,
    ivB64,
  };
}

/**
 * Decrypt an encrypted blob downloaded from the backend.
 * The blob is expected to have the IV prepended (first 12 bytes).
 * keyB64 is returned by /api/ipfs/key/{hash} after purchase verification.
 */
export async function decryptBlob(
  encryptedBlob: Blob,
  keyB64: string
): Promise<Blob> {
  const key = await importKey(keyB64);
  const combined = await encryptedBlob.arrayBuffer();
  const iv        = new Uint8Array(combined, 0, IV_BYTES);
  const ciphertext = new Uint8Array(combined, IV_BYTES);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext
  );

  return new Blob([plaintext], { type: "application/octet-stream" });
}
