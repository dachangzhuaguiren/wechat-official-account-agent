const FORMAT = "wechat-agent-encrypted-backup";
const ITERATIONS = 210_000;

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string" || !/^[a-z0-9+/]+={0,2}$/i.test(value)) throw new Error("加密备份格式无效");
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function deriveKey(passphrase, salt, usage) {
  if (typeof passphrase !== "string" || passphrase.length < 10 || passphrase.length > 200) throw new Error("备份密码必须为 10–200 个字符");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, material, { name: "AES-GCM", length: 256 }, false, usage);
}

export function isEncryptedBackup(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.format === FORMAT);
}

export async function encryptBackup(value, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return { format: FORMAT, version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: bytesToBase64(salt) }, cipher: { name: "AES-GCM", iv: bytesToBase64(iv) }, data: bytesToBase64(ciphertext) };
}

export async function decryptBackup(value, passphrase) {
  if (!isEncryptedBackup(value) || value.version !== 1 || value.kdf?.name !== "PBKDF2" || value.kdf?.hash !== "SHA-256" || value.kdf?.iterations !== ITERATIONS || value.cipher?.name !== "AES-GCM") throw new Error("加密备份格式无效");
  try {
    const salt = base64ToBytes(value.kdf.salt);
    const iv = base64ToBytes(value.cipher.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error("invalid length");
    const key = await deriveKey(passphrase, salt, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(value.data));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("备份密码错误或文件已损坏");
  }
}
