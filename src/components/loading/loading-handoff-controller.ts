import type { LoadingToken } from "./loading-controller";

export type LoadingHandoffState = "handed-off" | "claimed";

export type LoadingHandoffEntry = {
  key: string;
  token: LoadingToken;
  destination: string;
  state: LoadingHandoffState;
  createdAt: number;
  claimedAt: number | null;
};

function normalizeKey(key: string) {
  const normalized = String(key || "").trim();

  if (!normalized) {
    throw new Error("Loading handoff exige uma chave.");
  }

  return normalized;
}

export function normalizeLoadingDestination(destination: string) {
  const value = String(destination || "").trim();

  if (!value) {
    throw new Error("Loading handoff exige um destino.");
  }

  const parsed = new URL(value, "https://maono.local");
  const pathname =
    parsed.pathname.length > 1
      ? parsed.pathname.replace(/\/+$/, "")
      : parsed.pathname;

  return `${pathname || "/"}${parsed.search}`;
}

export class LoadingHandoffController {
  private readonly entries = new Map<string, LoadingHandoffEntry>();

  get activeCount() {
    return this.entries.size;
  }

  prime({
    key,
    token,
    destination,
    now = Date.now(),
  }: {
    key: string;
    token: LoadingToken;
    destination: string;
    now?: number;
  }) {
    const normalizedKey = normalizeKey(key);
    const previous = this.entries.get(normalizedKey) ?? null;

    this.entries.set(normalizedKey, {
      key: normalizedKey,
      token,
      destination: normalizeLoadingDestination(destination),
      state: "handed-off",
      createdAt: now,
      claimedAt: null,
    });

    return previous;
  }

  claim(key: string, now = Date.now()) {
    const normalizedKey = normalizeKey(key);
    const entry = this.entries.get(normalizedKey);

    if (!entry) {
      return null;
    }

    if (entry.state !== "claimed") {
      entry.state = "claimed";
      entry.claimedAt = now;
    }

    return { ...entry };
  }

  complete(key: string) {
    return this.remove(key);
  }

  cancel(key: string) {
    return this.remove(key);
  }

  cancelOutsideLocation(location: string) {
    const normalizedLocation = normalizeLoadingDestination(location);
    const cancelled: LoadingHandoffEntry[] = [];

    for (const [key, entry] of this.entries) {
      if (entry.destination === normalizedLocation) {
        continue;
      }

      this.entries.delete(key);
      cancelled.push({ ...entry });
    }

    return cancelled;
  }

  cancelAll() {
    const cancelled = [...this.entries.values()].map((entry) => ({
      ...entry,
    }));
    this.entries.clear();
    return cancelled;
  }

  get(key: string) {
    const entry = this.entries.get(normalizeKey(key));
    return entry ? { ...entry } : null;
  }

  snapshot() {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  private remove(key: string) {
    const normalizedKey = normalizeKey(key);
    const entry = this.entries.get(normalizedKey) ?? null;

    if (entry) {
      this.entries.delete(normalizedKey);
    }

    return entry ? { ...entry } : null;
  }
}
