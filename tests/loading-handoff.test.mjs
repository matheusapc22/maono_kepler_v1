import assert from "node:assert/strict";
import test from "node:test";

import {
  clearLoadingHandoffsForTests,
  completeLoadingHandoff,
  getLoadingHandoffToken,
  hasLoadingHandoff,
  primeLoadingHandoff,
} from "../src/components/loading/loading-handoff.ts";

test("loading handoff mantém o token até conclusão explícita", () => {
  clearLoadingHandoffsForTests();

  assert.equal(primeLoadingHandoff("login-projects", 11), null);
  assert.equal(hasLoadingHandoff("login-projects"), true);
  assert.equal(getLoadingHandoffToken("login-projects"), 11);
  assert.equal(getLoadingHandoffToken("login-projects"), 11);

  assert.equal(completeLoadingHandoff("login-projects"), 11);
  assert.equal(hasLoadingHandoff("login-projects"), false);
  assert.equal(completeLoadingHandoff("login-projects"), null);
});

test("novo handoff devolve o token anterior para evitar vazamento", () => {
  clearLoadingHandoffsForTests();

  assert.equal(primeLoadingHandoff("map:/projects/a/edit", 21), null);
  assert.equal(primeLoadingHandoff("map:/projects/a/edit", 22), 21);
  assert.equal(
    completeLoadingHandoff("map:/projects/a/edit"),
    22,
  );
});
