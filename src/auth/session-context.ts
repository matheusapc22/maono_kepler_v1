import {createContext,useContext} from 'react';
import type {SessionState} from './session-types';

export const SessionContext = createContext<SessionState | null>(null);

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error("useSession precisa estar dentro de SessionProvider.");
  }

  return context;
}
