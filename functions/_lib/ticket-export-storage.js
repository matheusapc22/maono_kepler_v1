import {
  ensureDropboxFolder,
  getDropboxMetadata,
  downloadDropboxBinaryFile,
  deleteDropboxPathIfExists,
} from "./dropbox.js";
import {
  startLargeDropboxUploadSession,
  finishLargeDropboxUploadSession,
} from "./dropbox-large-upload.js";
import { dropboxContentHashHex } from "./dropbox-content-hash.js";
import { exportError } from "./ticket-export-domain.js";

export function exportStorage(env) {
  // Dedicated private application namespace, never a project folder or a shared-link URL.
  const root = "/maono-private-ticket-exports-v1";
  const location = (part) => ({
    root: `${root}/${part.organization_id}/${part.job_id}`,
    name: `${part.id}.csv`,
  });
  return {
    async put(part, bytes) {
      const path = location(part),
        expected = await dropboxContentHashHex(bytes);
      let existing;
      try {
        existing = await getDropboxMetadata(env, path.root, path.name);
      } catch (error) {
        if (error.code !== "DROPBOX_PATH_NOT_FOUND") throw error;
      }
      if (existing) {
        if (
          existing.size !== bytes.length ||
          existing.content_hash !== expected
        )
          throw exportError("STORAGE_CONFLICT", 503);
        return;
      }
      await ensureDropboxFolder(env, path.root);
      // Each durable partition is capped at 1 MiB. Finishing a fresh session with the
      // entire partition needs no ambiguous append; a lost finish is reconciled by metadata.
      const session = await startLargeDropboxUploadSession(env);
      try {
        await finishLargeDropboxUploadSession(
          env,
          session.session_id,
          0,
          path.root,
          path.name,
          bytes,
          { writeMode: "create" },
        );
      } catch (error) {
        const verified = await getDropboxMetadata(
          env,
          path.root,
          path.name,
        ).catch(() => null);
        if (
          !verified ||
          verified.size !== bytes.length ||
          verified.content_hash !== expected
        )
          throw error;
      }
      const verified = await getDropboxMetadata(env, path.root, path.name);
      if (verified.size !== bytes.length || verified.content_hash !== expected)
        throw exportError("STORAGE_INTEGRITY", 503);
    },
    async get(part) {
      const path = location(part);
      return downloadDropboxBinaryFile(env, path.root, path.name);
    },
    async remove(part) {
      const path = location(part);
      await deleteDropboxPathIfExists(env, `${path.root}/${path.name}`);
    },
  };
}
