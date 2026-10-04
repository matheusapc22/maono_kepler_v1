import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
const read = path => readFile(new URL(`../${path}`, import.meta.url));
const [login, css, accent, icons] = await Promise.all(['src/pages/Login.tsx', 'src/pages/login.css', 'src/pages/maono-login-accent.css', 'src/pages/LoginIcon.tsx'].map(async path => String(await read(path))));
const hash = value => createHash('sha256').update(value).digest('hex');

test('visual redesign preserves every original auth/validation/session/redirect function byte for byte', () => {
  const logic = login.slice(login.indexOf('function safeNextPath'), login.indexOf('  const pageStyle'));
  assert.equal(hash(logic), 'a9f37670a53e97b8320dd8b2e4f92b0b3b16cc9c10ea976c2ab72bef0bccf8cd');
  assert.match(login, /<form onSubmit=\{handleSubmit\}/);
  assert.match(login, /disabled=\{submitting \|\| redirecting\}/);
});

test('approved logo and background source files and remote URL are unchanged', async () => {
  assert.equal(hash(await read('src/assets/images/Logo_Maono.png')), 'd139b392a12fad6edcbfe0695305c6722977c77215462271800099e5e9ae8082');
  assert.equal(hash(await read('src/assets/images/login-background-maono.webp')), 'd72bca3b68c35b7502ae367207c18d0d00d3a585eb82cfb796757a8b0b34735d');
  assert.match(login, /https:\/\/pub-56c14c350e6c453c98cb6275d38db861\.r2\.dev\/Piramides_Maono\.png/);
});

test('minimal copy, semantic labels and icon-only visibility button follow the approved design', () => {
  assert.match(login, />ACESSE SUA CONTA<\/h1>/);
  assert.match(login, />Entre para continuar na Maõno Maps\.<\/p>/);
  assert.match(login, /<label[^>]+htmlFor="maono-login-email">E-mail<\/label>/);
  assert.match(login, /<label[^>]+htmlFor="maono-login-password">Senha<\/label>/);
  assert.match(login, /placeholder="seu e-mail"/);
  assert.match(login, /placeholder="sua senha"/);
  assert.match(login, /name=\{showPassword \? "eye" : "eye-off"\}/);
  assert.doesNotMatch(login, /showPassword \? "ocultar" : "ver"/);
  assert.match(icons, /aria-hidden="true" focusable="false"/);
  assert.match(css, /clip-path: inset\(50%\)/);
  assert.match(accent, /data-visible="false"[^}]+opacity: 0\.68/);
  assert.match(accent, /data-visible="true"[^}]+var\(--maono-accent-bright\)[^}]+opacity: 1/);
});

test('original recovery and signup placeholders remain unchanged in behavior, without fabricated routes', () => {
  for (const text of ['Esqueci minha senha', 'Ainda não tenho uma conta']) {
    assert.ok(login.includes(`<button type="button" className="maono-login-page__link-button">\n                ${text}`));
  }
  assert.doesNotMatch(login, /forgot-password|reset-password|sign-up|signup|register/);
});

test('Oxanium is self-hosted with retained license and restricted to the title', async () => {
  assert.equal(hash(await read('public/fonts/oxanium/Oxanium-Variable.ttf')), '2ce01d946e1e1ffc8d7eecfffbda8623bedd63eaf811a20488c4b69af45babb0');
  assert.match(String(await read('public/fonts/oxanium/OFL.txt')), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(css, /src: url\("\/fonts\/oxanium\/Oxanium-Variable\.ttf"\)/);
  assert.match(css, /\.maono-login-page--redesigned h1\s*\{[^}]+font-family: "Maono Login Oxanium"/);
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic/);
});

test('readable responsive controls grow with text and scope overrides only to login', () => {
  assert.match(css, /width: min\(100%, 500px\)/);
  assert.match(css, /min-height: 58px/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-height: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /--maono-density-\w+\s*:/);
});
