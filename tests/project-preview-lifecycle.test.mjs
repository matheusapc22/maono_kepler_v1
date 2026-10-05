import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";
import { config as mapConfig, create as createDurable, update as updateDurable, status as operationStatus } from "./helpers/durable-project-http.mjs";
import { markProjectPreviewFailed, markProjectPreviewReady } from "../functions/_lib/project-preview.js";

const urls = {
  migration: new URL(
    "../migrations/0015_project_preview_lifecycle.sql",
    import.meta.url,
  ),
  thumbnail: new URL(
    "../functions/api/projects/[slug]/thumbnail/index.js",
    import.meta.url,
  ),
  oldThumbnail: new URL(
    "../functions/api/projects/[slug]/thumbnail.js",
    import.meta.url,
  ),
  status: new URL(
    "../functions/api/projects/[slug]/thumbnail/status.js",
    import.meta.url,
  ),
  previewHelper: new URL(
    "../functions/_lib/project-preview.js",
    import.meta.url,
  ),
  list: new URL("../functions/_lib/project-list.js", import.meta.url),
  saveButton: new URL(
    "../src/pages/Kepler/components/maono-save-button.tsx",
    import.meta.url,
  ),
  saveResilience: new URL(
    "../src/pages/Kepler/durable-save-controller.ts",
    import.meta.url,
  ),
  job: new URL(
    "../src/pages/Kepler/thumbnail/background-thumbnail-job.ts",
    import.meta.url,
  ),
  provider: new URL(
    "../src/pages/Kepler/cloud-providers/dropbox/dropbox-provider.ts",
    import.meta.url,
  ),
  reconcile: new URL(
    "../functions/api/admin/project-previews/reconcile.js",
    import.meta.url,
  ),
};

const [
  migration,
  thumbnail,
  status,
  previewHelper,
  list,
  saveButton,
  saveResilience,
  job,
  provider,
  reconcile,
] = await Promise.all([
  readFile(urls.migration, "utf8"),
  readFile(urls.thumbnail, "utf8"),
  readFile(urls.status, "utf8"),
  readFile(urls.previewHelper, "utf8"),
  readFile(urls.list, "utf8"),
  readFile(urls.saveButton, "utf8"),
  readFile(urls.saveResilience, "utf8"),
  readFile(urls.job, "utf8"),
  readFile(urls.provider, "utf8"),
  readFile(urls.reconcile, "utf8"),
]);

function createPreviewDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL,
      default_config_file TEXT NOT NULL DEFAULT 'config.kepler.json',
      dropbox_root_path TEXT NOT NULL DEFAULT '/projects/example',
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO projects (id, organization_id) VALUES (1, 7);
  `);
  database.exec(migration);
  return database;
}

function d1Environment(database) {
  return {
    DB: {
      prepare(sql) {
        const statement = database.prepare(sql);
        let parameters = [];

        return {
          bind(...values) {
            parameters = values;
            return this;
          },
          first() {
            return statement.get(...parameters) ?? null;
          },
          run() {
            return statement.run(...parameters);
          },
          all() {
            return { results: statement.all(...parameters) };
          },
        };
      },
    },
  };
}

test("migration 0015 adiciona ciclo completo, defaults e índices", () => {
  const database = createPreviewDatabase();
  const columns = database
    .prepare("PRAGMA table_info(projects)")
    .all()
    .map((column) => column.name);

  for (const column of [
    "config_revision",
    "preview_status",
    "preview_revision",
    "preview_updated_at",
    "preview_attempts",
    "preview_last_error",
    "preview_capture_method",
  ]) {
    assert.ok(columns.includes(column), `coluna ${column} ausente`);
  }

  const row = database
    .prepare(
      `SELECT config_revision, preview_status, preview_attempts
     FROM projects WHERE id = 1`,
    )
    .get();
  assert.deepEqual(
    { ...row },
    {
      config_revision: 0,
      preview_status: "UNKNOWN",
      preview_attempts: 0,
    },
  );

  const indexes = database
    .prepare("PRAGMA index_list(projects)")
    .all()
    .map((index) => index.name);
  assert.ok(indexes.includes("idx_projects_preview_status_org"));
  assert.ok(indexes.includes("idx_projects_preview_revision"));
  assert.throws(() =>
    database
      .prepare("UPDATE projects SET preview_status = 'INVALID' WHERE id = 1")
      .run(),
  );
});

test("revisão obsoleta nunca altera o estado da revisão atual", async () => {
  const database = createPreviewDatabase();
  database
    .prepare(
      `UPDATE projects
       SET config_revision = 2, preview_status = 'PENDING'
       WHERE id = 1`,
    )
    .run();
  const env = d1Environment(database);
  const {
    markProjectPreviewAttempt,
    markProjectPreviewFailed,
    markProjectPreviewReady,
  } = await import(urls.previewHelper);

  assert.equal(
    await markProjectPreviewAttempt(env, {
      projectId: 1,
      organizationId: 7,
      revision: 1,
      captureMethod: "canvas",
    }),
    null,
  );

  const accepted = await markProjectPreviewAttempt(env, {
    projectId: 1,
    organizationId: 7,
    revision: 2,
    captureMethod: "canvas",
  });
  assert.equal(accepted.preview_attempts, 1);

  assert.equal(
    await markProjectPreviewReady(env, {
      projectId: 1,
      organizationId: 7,
      revision: 1,
      captureMethod: "canvas",
    }),
    null,
  );

  const ready = await markProjectPreviewReady(env, {
    projectId: 1,
    organizationId: 7,
    revision: 2,
    captureMethod: "canvas",
  });
  assert.equal(ready.preview_status, "READY");
  assert.equal(ready.preview_revision, 2);

  database
    .prepare(
      `UPDATE projects
       SET config_revision = 3, preview_status = 'PENDING'
       WHERE id = 1`,
    )
    .run();
  assert.equal(
    await markProjectPreviewFailed(env, {
      projectId: 1,
      organizationId: 7,
      revision: 2,
      captureMethod: "canvas",
      errorCode: "OLD_JOB",
    }),
    null,
  );
  assert.equal(
    database
      .prepare("SELECT preview_status FROM projects WHERE id = 1")
      .get().preview_status,
    "PENDING",
  );
});

test("durable publication responds PENDING without waiting for PNG and retains a previously saved thumbnail", async t => {
  const f=persistenceFixture(t),created=await createDurable(f);
  assert.equal(created.data.operation.state,"PUBLISHED");
  assert.equal(f.project().preview_status,"PENDING");
  await markProjectPreviewReady(f.env,{projectId:1,organizationId:1,revision:1,captureMethod:"canvas"});
  const png=new Uint8Array([137,80,78,71,13,10,26,10]);
  const path=`${f.project().dropbox_root_path}/config.kepler.r1.png`;
  await f.store(path,png);
  const saved=await updateDurable(f,mapConfig("new revision"));
  assert.equal(saved.data.operation.state,"PUBLISHED");
  assert.equal(f.project().preview_status,"PENDING");
  assert.equal(f.project().preview_revision,1,"retain previously published PNG identity while replacement is pending");
  assert.deepEqual(f.objects.get(path).bytes,png);
  assert.equal(f.calls.some(call=>call.op==="delete_v2"&&call.args.path===path),false);
});

test("PNG failure after initial activation cannot downgrade config, receipt or committed quota", async t => {
  const f=persistenceFixture(t),created=await createDurable(f);
  await markProjectPreviewFailed(f.env,{projectId:1,organizationId:1,revision:1,captureMethod:"canvas",errorCode:"PNG_UNAVAILABLE"});
  assert.equal(f.project().preview_status,"FAILED");
  assert.equal(f.project().active,1);assert.equal(f.project().lifecycle_state,"ACTIVE");
  assert.equal(f.db.prepare("SELECT status FROM organization_resource_reservations").get().status,"COMMITTED");
  const recovered=await operationStatus(f,created.registered.input.operationId);
  assert.equal(recovered.data.operation.state,"PUBLISHED");
  assert.deepEqual(recovered.data.operation.receipt,created.data.operation.receipt);
});

test("endpoint binário valida permissão, revisão, tipo, tamanho e assinatura", () => {
  assert.match(thumbnail, /"project\.save"/);
  assert.match(thumbnail, /"project\.view"/);
  assert.match(thumbnail, /MAX_THUMBNAIL_BYTES = 4 \* 1024 \* 1024/);
  assert.match(thumbnail, /contentType !== "image\/png"/);
  assert.match(thumbnail, /PNG_SIGNATURE/);
  assert.match(thumbnail, /STALE_THUMBNAIL_REVISION/);
  assert.match(thumbnail, /context\.waitUntil\(task\)/);
  assert.match(thumbnail, /status:\s*202/);
});

test("arquivo versionado e atualização condicional impedem overwrite antigo", () => {
  assert.match(thumbnail, /getRevisionedPreviewFileNameFromConfigFile/);
  assert.match(
    thumbnail,
    /Number\(current\?\.config_revision\) !== Number\(revision\)/,
  );
  assert.match(thumbnail, /deleteDropboxPathIfExists/);
  assert.match(previewHelper, /AND config_revision = \?/);
});

test("rota de thumbnail aceita status separado sem conflito de Pages Functions", async () => {
  await assert.rejects(access(urls.oldThumbnail));
  await access(urls.thumbnail);
  await access(urls.status);
  assert.match(status, /request\.method !== "GET"/);
  assert.match(status, /"project\.view"/);
});

test("frontend queues thumbnail only after the durable receipt and guards later editor generations", () => {
  const accepted=saveButton.slice(saveButton.indexOf("async function accepted("),saveButton.indexOf("async function runSnapshot("));
  assert.match(accepted,/receiptRevision\(result\.data\)/);
  assert.match(accepted,/confirmationMatchesEditor/);
  assert.match(accepted,/currentRevision === revision/);
  assert.match(accepted,/void enqueueProjectThumbnailJob/);
  assert.ok(accepted.indexOf("receiptRevision(")<accepted.indexOf("enqueueProjectThumbnailJob("));
  assert.match(saveResilience,/PUBLISHED/);
  assert.match(saveButton,/ASYNC_THUMBNAIL_ENABLED/);
});

test("job possui cancelamento, retry limitado e storage só de metadados", () => {
  assert.match(job, /const RETRY_DELAYS_MS = \[800, 1800, 3600\]/);
  assert.match(job, /existing\.controller\.abort\(\)/);
  assert.match(job, /ProjectThumbnailRequestError/);
  assert.match(job, /error\.stale/);
  assert.match(job, /window\.sessionStorage\.setItem/);

  const persistence = job.match(
    /function persistJobMetadata\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(persistence);
  assert.doesNotMatch(persistence, /mapState|savedConfig|blob|dataUrl/);
});

test("provider Dropbox não executa uma segunda captura na rota Maono", () => {
  assert.match(provider, /isMaonoManagedProjectRoute/);
  assert.match(provider, /ASYNC_PROJECT_THUMBNAIL_ENABLED/);
  assert.match(
    provider,
    /ASYNC_PROJECT_THUMBNAIL_ENABLED && isMaonoManagedProjectRoute\(\)\s*\?\s*null/,
  );
});

test("listagem pública expõe somente metadados operacionais do preview", () => {
  assert.match(list, /publicProjectPreview\(project\)/);
  assert.match(list, /projects\.config_revision/);
  assert.match(list, /projects\.preview_status/);
  assert.doesNotMatch(list, /preview_last_error|preview_capture_method/);
});

test("reconciliador legado de preview segue em lote, por organização e Super Admin", () => {
  assert.match(reconcile, /request\.method !== "POST"/);
  assert.match(reconcile, /user\?\.role[\s\S]*super_admin/);
  assert.match(reconcile, /Math\.min\(25/);
  assert.match(reconcile, /preview_status = 'UNKNOWN'/);
  assert.match(reconcile, /organization_id = \?/);
  assert.match(reconcile, /getDropboxMetadata/);
  assert.match(reconcile, /markProjectPreviewMissing/);
  assert.match(reconcile, /markProjectPreviewReady/);
});
