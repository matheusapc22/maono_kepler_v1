export type ModuleImporter<T> = () => Promise<T>;

export function createCachedModuleLoader<T>(importer: ModuleImporter<T>) {
  let cached: Promise<T> | null = null;

  return function loadModule(): Promise<T> {
    if (cached) {
      return cached;
    }

    const guarded = Promise.resolve()
      .then(importer)
      .catch((error) => {
        if (cached === guarded) {
          cached = null;
        }

        throw error;
      });

    cached = guarded;
    return guarded;
  };
}
