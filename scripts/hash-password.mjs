import { webcrypto } from "node:crypto";

const password = process.argv[2];
const PASSWORD_HASH_ITERATIONS = 100000;

if (!password) {
  console.error("Uso: node scripts/hash-password.mjs sua-senha");
  process.exit(1);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(value) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return `${toHex(salt)}:${toHex(bits)}`;
}

const hash = await hashPassword(password);
console.log(hash);
