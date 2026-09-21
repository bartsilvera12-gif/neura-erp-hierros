import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const KDF_SALT = "neura-sifen-kdf-v1";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const PREFIX = "neura:v1:";

/**
 * Deriva una clave AES-256 a partir de `SIFEN_SECRETS_KEY` (solo servidor).
 * La variable debe ser alta entropía (p. ej. 32+ bytes en base64 o string largo aleatorio).
 */
export function requireSifenSecretsKeyBytes(): Buffer {
  const raw = process.env.SIFEN_SECRETS_KEY?.trim();
  if (!raw || raw.length < 16) {
    throw new Error(
      "SIFEN_SECRETS_KEY no está definida o es demasiado corta (mínimo 16 caracteres). " +
        "Configure un secreto fuerte en el servidor."
    );
  }
  return scryptSync(raw, KDF_SALT, 32, SCRYPT_PARAMS);
}

/**
 * Cifra texto UTF-8 con AES-256-GCM.
 * Formato: neura:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 */
export function encryptSecret(plaintext: string): string {
  const key = requireSifenSecretsKeyBytes();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/**
 * Descifra un valor producido por `encryptSecret` (solo servidor; p. ej. firma digital).
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    throw new Error("Formato de secreto cifrado no reconocido o versión incompatible");
  }
  const rest = stored.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) {
    throw new Error("Payload cifrado corrupto");
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  if (iv.length !== IV_LEN) {
    throw new Error("IV inválido");
  }
  const key = requireSifenSecretsKeyBytes();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // GCM lanza "Unsupported state or unable to authenticate data" cuando el auth tag
    // no valida: casi siempre porque SIFEN_SECRETS_KEY cambió o el secreto se cifró en
    // otro entorno. Traducimos a un mensaje accionable para el usuario final.
    throw new Error(
      "No se pudo descifrar la contraseña del certificado. Reingrésela en " +
        "Configuración → Facturación electrónica y vuelva a guardar."
    );
  }
}
