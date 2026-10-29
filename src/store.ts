// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { combineReducers, createStore, applyMiddleware, compose } from "redux";
import { createLogger } from "redux-logger";
import thunk from "redux-thunk";

import { enhanceReduxMiddleware } from "@kepler.gl/reducers";

import Window from "global/window";

import demoReducer from "./pages/Kepler/reducers/index";

const reducers = combineReducers({
  demo: demoReducer,
});

export const middlewares = enhanceReduxMiddleware([
  thunk,
  // routerMiddleware(browserHistory),
]);

if (import.meta.env.DEV) {
  // Redux logger
  const logger = createLogger({
    collapsed: () => true, // Collapse all actions for more compact log
  });
  middlewares.push(logger);
}

export const enhancers = [applyMiddleware(...middlewares)] as const;

declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: (options: { actionsBlacklist: string[] }) => typeof compose;
  }
}

const initialState = {};

let composeEnhancers = compose;

/**
 * comment out code below to enable Redux Devtools
 */

if (import.meta.env.DEV && Window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) {
  composeEnhancers = Window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
    actionsBlacklist: [
      "@@kepler.gl/MOUSE_MOVE",
      "@@kepler.gl/UPDATE_MAP",
      "@@kepler.gl/LAYER_HOVER",
    ],
  });
}

export type RootState = ReturnType<typeof reducers>;

const store = createStore(
  reducers,
  initialState,
  composeEnhancers(...enhancers)
);

export type AppStore = typeof store;
export type AppThunk<Result = void> = (dispatch: AppDispatch, getState: () => RootState) => Result;
// react-palm's task middleware returns a promise for ordinary actions; thunk
// returns the invoked function's result. Keep Redux's overload for consumers.
export type AppDispatch = {
  (action: import("redux").AnyAction): Promise<unknown>;
  <Result>(action: AppThunk<Result>): Result;
} & AppStore["dispatch"];

export default store;
