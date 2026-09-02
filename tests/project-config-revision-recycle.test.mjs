import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const revisionsPath = new URL(
  "../functions/_lib/project-config-revisions.js",
  import.meta.url,
);

test("revisão READY antiga e não publicada pode ser reclamada sem relaxar HEAD CAS", async () => {
  const source = await readFile(revisionsPath, "utf8");

  assert.match(source, /const ABANDONED_READY_GRACE_SECONDS = 30/);
  assert.match(source, /status = 'FAILED'/);
  assert.match(source, /error_code = 'PROJECT_CONFIG_READY_ABANDONED'/);
  assert.match(source, /error_stage = 'PUBLISH'/);
  assert.match(source, /AND status = 'READY'/);
  assert.match(source, /AND published_at IS NULL/);
  assert.match(
    source,
    /updated_at <= datetime\('now', '-\$\{ABANDONED_READY_GRACE_SECONDS\} seconds'\)/,
  );

  const headCheck = source.indexOf("if (currentRevision !== expected)", source.indexOf("recycleUnpublishedRevisionCandidate"));
  const artifactRemoval = source.indexOf("removeUnpublishedRevisionArtifact(", headCheck);
  const recycleWrite = source.indexOf("SET status = 'WRITING'", artifactRemoval);

  assert.ok(headCheck > 0, "recycle deve revalidar o HEAD antes de remover artefato");
  assert.ok(artifactRemoval > headCheck, "artefato só pode ser removido após revalidar o HEAD");
  assert.ok(recycleWrite > artifactRemoval, "ledger só muda para novo conteúdo após remover órfão");
});

test("reciclagem limpa artefato imutável órfão e substitui metadata somente se nunca publicada", async () => {
  const source = await readFile(revisionsPath, "utf8");

  assert.match(source, /deleteDropboxPathIfExists/);
  assert.match(source, /getMapConfigRevisionFileName/);
  assert.match(source, /joinDropboxPath/);
  assert.match(source, /storage_provider_version = NULL/);
  assert.match(source, /storage_provider_hash = NULL/);
  assert.match(source, /ready_at = NULL/);
  assert.match(source, /published_at = NULL/);
  assert.match(source, /AND status = 'FAILED'[\s\S]*AND published_at IS NULL[\s\S]*RETURNING \*/);
  assert.match(source, /replacedUnpublishedCandidate: true/);
});

test("conteúdo diferente consulta reciclagem antes de emitir PROJECT_CONFIG_REVISION_CONFLICT", async () => {
  const source = await readFile(revisionsPath, "utf8");
  const mismatch = source.indexOf("String(existing.checksum_algorithm)");
  const recycle = source.indexOf("recycleUnpublishedRevisionCandidate(env", mismatch);
  const conflict = source.indexOf('"PROJECT_CONFIG_REVISION_CONFLICT"', recycle);

  assert.ok(mismatch > 0);
  assert.ok(recycle > mismatch);
  assert.ok(conflict > recycle);
});

test("revisão realmente publicada continua idempotente e nunca entra na reciclagem", async () => {
  const source = await readFile(revisionsPath, "utf8");
  const publishedRecovery = source.indexOf("currentRevision === nextRevision");
  const currentConflict = source.indexOf("if (currentRevision !== expected)", publishedRecovery);
  const recycle = source.indexOf("recycleUnpublishedRevisionCandidate(env", currentConflict);

  assert.ok(publishedRecovery > 0);
  assert.ok(currentConflict > publishedRecovery);
  assert.ok(recycle > currentConflict);
  assert.match(source, /alreadyPublished: true/);
});
