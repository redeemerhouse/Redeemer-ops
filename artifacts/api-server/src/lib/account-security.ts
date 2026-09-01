import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validEmail(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 12
    && value.length <= 200
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = Buffer.from(await scrypt(password, salt, KEY_LENGTH) as Buffer);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, keyText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !keyText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    const received = Buffer.from(await scrypt(password, salt, expected.length) as Buffer);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export function newActionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}