export type LoadingToken = number;

type LoadingListener = (activeCount: number) => void;
type LoadingOperation<T> = () => Promise<T> | T;

export class LoadingController {
  private nextToken = 0;
  private readonly activeTokens = new Set<LoadingToken>();
  private readonly listeners = new Set<LoadingListener>();

  get activeCount() {
    return this.activeTokens.size;
  }

  get isLoading() {
    return this.activeTokens.size > 0;
  }

  begin() {
    const token = ++this.nextToken;
    this.activeTokens.add(token);
    this.emit();
    return token;
  }

  end(token: LoadingToken) {
    const removed = this.activeTokens.delete(token);

    if (removed) {
      this.emit();
    }
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
