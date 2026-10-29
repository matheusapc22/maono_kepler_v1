import {createContext,useContext} from 'react';
import type {LoadingToken,LoadingTokenMetadataInput} from './loading-controller';

export type LoadingOperation<T> = () => Promise<T> | T;

export type BeginLoadingOptions = {
  immediate?: boolean;
  metadata?: LoadingTokenMetadataInput;
};

export type LoadingContextValue = {
  isLoading: boolean;
  isVisible: boolean;
  initialBootActive: boolean;
  activeCount: number;
  beginLoading: (options?: BeginLoadingOptions) => LoadingToken;
  endLoading: (token: LoadingToken) => void;
  handoffLoading: (
    key: string,
    token: LoadingToken,
    destination: string,
  ) => void;
  claimLoadingHandoff: (key: string) => boolean;
  completeLoadingHandoff: (key: string) => boolean;
  cancelLoadingHandoff: (key: string) => boolean;
  getLoadingHandoffCount: () => number;
  completeInitialBootLoading: () => boolean;
  withLoading: <T>(
    operation: LoadingOperation<T>,
    options?: BeginLoadingOptions,
  ) => Promise<T>;
};

export const LoadingContext = createContext<LoadingContextValue | null>(null);

export function useLoading() {
  const context = useContext(LoadingContext);

  if (!context) {
    throw new Error("useLoading precisa estar dentro de LoadingProvider.");
  }

  return context;
}
