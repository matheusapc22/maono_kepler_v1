// @ts-nocheck
import { applyMiddleware, combineReducers, compose, createStore } from "redux";
import thunk from "redux-thunk";
import { enhanceReduxMiddleware } from "@kepler.gl/reducers";

import demoReducer from "../../pages/Kepler/reducers";

const reducers = combineReducers({ demo: demoReducer });
const middlewares = enhanceReduxMiddleware([thunk]);

const benchmarkStore = createStore(
  reducers,
  {},
  compose(applyMiddleware(...middlewares)),
);

export default benchmarkStore;
