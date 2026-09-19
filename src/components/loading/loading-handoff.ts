import type { LoadingToken } from "./loading-controller";

const handoffs = new Map<string, LoadingToken>();

export function primeLoadingHandoff(
  key: string,
  token: LoadingToken,
) {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    throw new Error("Loading handoff exige uma chave.");
  }

  const previous = handoffs.get(normalizedKey) ?? null;
  handoffs.set(normalizedKey, token);
  return previous;
}

export function getLoadingHandoffToken(key: string) {
  return handoffs.get(key.trim()) ?? null;
}

export function completeLoadingHandoff(key: string) {
  const normalizedKey = key.trim();
  const token = handoffs.get(normalizedKey) ?? null;
  if (token !== null) {
    handoffs.delete(normalizedKey);
  }
  return token;
}

export function hasLoadingHandoff(key: string) {
  return handoffs.has(key.trim());
}

export function clearLoadingHandoffsForTests() {
  handoffs.clear();
}
