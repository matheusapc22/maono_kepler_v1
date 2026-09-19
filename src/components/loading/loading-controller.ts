export type LoadingToken = Readonly<{
  id: number;
  owner: symbol;
}>;

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

  begin() {
    const token: LoadingToken = Object.freeze({
      id: ++this.nextToken,
      owner: this.owner,
    });
    this.activeTokens.add(token);
    this.emit();
    return token;
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

  async withLoading<T>(operation: LoadingOperation<T>): Promise<T> {
    const token = this.begin();

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
