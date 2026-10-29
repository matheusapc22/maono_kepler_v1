// Typed surfaces used by this application for packages that ship JavaScript/Flow
// only. Signatures follow the installed implementations; no wildcard modules.
declare module "global/window" {
  const browser: Window & typeof globalThis;
  export default browser;
}
declare module "global" {
  export const fetch: typeof globalThis.fetch;
}
declare module "global/console" {
  const runtimeConsole: Console;
  export default runtimeConsole;
}
declare module "d3-format" {
  export function format(specifier: string): (value: number) => string;
}
declare module "redux-logger" {
  import type { Middleware } from "redux";
  export function createLogger(options?: {
    collapsed?: boolean | ((getState: () => unknown, action: unknown, logEntry: unknown) => boolean);
  }): Middleware;
}
declare module "redux-thunk" {
  import type { Middleware } from "redux";
  const thunk: Middleware;
  export default thunk;
}
declare module "react-router-redux" {
  export function push(location: string): {
    type: "@@router/CALL_HISTORY_METHOD";
    payload: { method: "push"; args: [string] };
  };
}
declare module "react-palm/tasks" {
  interface Task<Result, Failure = unknown> {
    bimap<Next, NextFailure>(success: (value: Result) => Next, failure: (error: Failure) => NextFailure): Task<Next, NextFailure>;
  }
  const Tasks: {
    fromPromise<Arg, Result>(operation: (arg: Arg) => Promise<Result>, name?: string): (arg: Arg) => Task<Result>;
  };
  export function withTask<State, Result, Failure>(state: State, task: Task<Result, Failure>): State;
  export default Tasks;
}
