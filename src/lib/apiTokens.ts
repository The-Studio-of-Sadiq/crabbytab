import { createHash, randomBytes } from "node:crypto";

export * from "./apiScopes";

export function createApiToken(): string {
  return `ct_live_${randomBytes(32).toString("hex")}`;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer (ct_live_[a-f0-9]{64})$/i.exec(header.trim());
  return match?.[1] ?? null;
}
