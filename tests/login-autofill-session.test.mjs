import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loginPage = await readFile(
  new URL("../src/pages/Login.tsx", import.meta.url),
  "utf8",
);
const loginCss = await readFile(
  new URL("../src/pages/login.css", import.meta.url),
  "utf8",
);
const loginEndpoint = await readFile(
  new URL("../functions/api/auth/login.js", import.meta.url),
  "utf8",
);

test("formulário lê os valores reais preenchidos pelo gerenciador de senhas", () => {
  assert.match(loginPage, /new FormData\(form\)/);
  assert.match(loginPage, /name="email"/);
  assert.match(loginPage, /name="password"/);
  assert.match(loginPage, /autoComplete="username"/);
  assert.match(loginPage, /autoComplete="current-password"/);
  assert.doesNotMatch(loginPage, /value=\{email\}/);
  assert.doesNotMatch(loginPage, /value=\{password\}/);
  assert.doesNotMatch(loginPage, /setEmail\(/);
  assert.doesNotMatch(loginPage, /setPassword\(/);
});

test("redirecionamento pós-login permanece interno à plataforma", () => {
  assert.match(loginPage, /value\.startsWith\("\/"\)/);
  assert.match(loginPage, /value\.startsWith\("\/\/"\)/);
  assert.match(loginPage, /return "\/projects"/);
});

test("tema escuro prevalece nos estados de preenchimento automático do Chrome", () => {
  assert.match(loginCss, /:-webkit-autofill/);
  assert.match(loginCss, /0 0 0 1000px #28282b inset/i);
  assert.match(loginCss, /-webkit-text-fill-color:\s*#fff\s*!important/i);
  assert.match(loginCss, /color-scheme:\s*dark/i);
});

test("endpoint normaliza e-mail, estado ativo e hash sem vazar detalhes", () => {
  assert.match(loginEndpoint, /lower\(trim\(email\)\) = \?/);
  assert.match(loginEndpoint, /Number\(user\.active\) !== 1/);
  assert.match(loginEndpoint, /String\(user\.password_hash \|\| ""\)\.trim\(\)/);
  assert.match(loginEndpoint, /DATABASE_NOT_CONFIGURED/);
  assert.match(loginEndpoint, /AUTH_DATABASE_UNAVAILABLE/);
  assert.doesNotMatch(loginEndpoint, /password_hash\s*:/);
});
