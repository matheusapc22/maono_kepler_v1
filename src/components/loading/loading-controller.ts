export type LoadingLabel =
  | "unclassified"
  | "session-bootstrap"
  | "auth-login"
  | "prepared-navigation"
  | "map-management"
  | "map-context"
  | "map-hydration";

export type LoadingScope =
  | "system"
  | "auth"
  | "navigation"
  | "map";

export type LoadingSurface =
  | "viewport"
  | "handoff";

export type LoadingTokenMetadataInput = Readonly<{
  label: LoadingLabel;
  scope: LoadingScope;
  surface: LoadingSurface;
}>;

export type LoadingTokenMetadata = Readonly<
  LoadingTokenMetadataInput & {
    createdAt: number;
  }
>;

export type LoadingToken = Readonly<{
  id: number;
  owner: symbol;
  metadata: LoadingTokenMetadata;
}>;

export type ActiveLoadingSnapshot = Readonly<{
  id: number;
  label: LoadingLabel;
  scope: LoadingScope;
  surface: LoadingSurface;
  createdAt: number;
  ageMs: number;
}>;

export const DEFAULT_LOADING_TOKEN_METADATA: LoadingTokenMetadataInput =
  Object.freeze({
    label: "unclassified",
    scope: "system",
    surface: "viewport",
  });

type LoadingListener = (activeCount: number) => void;
type LoadingOperation<T> = () => Promise<T> | T;

export class LoadingController {
  private nextToken = 0;
  private readonly owner = Symbol("maono-loading-controller");
  private readonly activeTokens = new Set<LoadingToken>();
  private readonly listeners = new Set<LoadingListener>();

  get activeCount() {
    return this.activeTokens.size;
  }

  get isLoading() {
    return this.activeTokens.size > 0;
  }

  begin(
    metadata: LoadingTokenMetadataInput =
      DEFAULT_LOADING_TOKEN_METADATA,
    now = Date.now(),
  ) {
    const token: LoadingToken = Object.freeze({
      id: ++this.nextToken,
      owner: this.owner,
      metadata: Object.freeze({
        ...metadata,
        createdAt: now,
      }),
    });
    this.activeTokens.add(token);
    this.emit();
    return token;
  }

  getActiveSnapshot(now = Date.now()): ActiveLoadingSnapshot[] {
    return Array.from(this.activeTokens, (token) => ({
      id: token.id,
      label: token.metadata.label,
      scope: token.metadata.scope,
      surface: token.metadata.surface,
      createdAt: token.metadata.createdAt,
      ageMs: Math.max(0, now - token.metadata.createdAt),
    }));
  }

  owns(token: LoadingToken) {
    return (
      token.owner === this.owner &&
      this.activeTokens.has(token)
    );
  }

  end(token: LoadingToken) {
    if (token.owner !== this.owner) {
      return false;
    }

    const removed = this.activeTokens.delete(token);

    if (removed) {
      this.emit();
    }

    return removed;
  }

  async withLoading<T>(
    operation: LoadingOperation<T>,
    metadata: LoadingTokenMetadataInput =
      DEFAULT_LOADING_TOKEN_METADATA,
  ): Promise<T> {
    const token = this.begin(metadata);

    try {
      return await operation();
    } finally {
      this.end(token);
    }
  }

  subscribe(listener: LoadingListener) {
    this.listeners.add(listener);
    listener(this.activeCount);

    return () => {
      this.listeners.delete(listener);
    };
  }

  clear() {
    if (this.activeTokens.size === 0) {
      return;
    }

    this.activeTokens.clear();
    this.emit();
  }

  private emit() {
    const activeCount = this.activeCount;

    for (const listener of this.listeners) {
      listener(activeCount);
    }
  }
}
