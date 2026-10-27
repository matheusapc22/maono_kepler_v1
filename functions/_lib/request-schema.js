// Opt in at a schema-stable request boundary (GET may write snapshot/legacy
// rows, but these routes do not execute DDL). Never attach this state to a shared
// Worker env/DB, and never use this scope for DDL or application/access data.
const requestSchema = Symbol('requestSchema');

export function withRequestSchema(env) {
  return { ...env, [requestSchema]: new Map() };
}

export function readRequestSchema(env, key, read) {
  const cache = env?.[requestSchema];
  if (!cache) return read();
  if (!cache.has(key)) {
    const pending = Promise.resolve().then(read);
    cache.set(key, pending);
    // A failed introspection is not a successful schema observation.
    pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  return cache.get(key);
}
