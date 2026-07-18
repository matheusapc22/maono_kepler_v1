import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canCreatorDeleteAttachment,
  getTicketAttachmentOrThrow,
  getTicketOrThrow,
  normalizeLegacyTicketRow,
  normalizeTicketStatus,
  parseTicketListOptions,
  publicTicketAttachment,
  readTicketAttachmentUpload,
  TICKET_ATTACHMENT_LIMITS,
  validateTicketAttachmentMetadata,
  validateTicketCreatePayload,
  validateTicketPatchPayload,
} from "../functions/_lib/ticket-center.js";

test("normaliza aliases legados para o domínio canônico", () => {
  assert.equal(normalizeTicketStatus("pending"), "open");
  assert.equal(normalizeTicketStatus("review"), "in_review");
  assert.equal(normalizeTicketStatus("resolved"), "closed");
  assert.throws(
    () => normalizeTicketStatus("unknown"),
    (error) => error.code === "INVALID_STATUS",
  );
});

test("importação legada tolera valores antigos sem bloquear a Central", () => {
  const row = normalizeLegacyTicketRow(
    {
      id: 17,
      title: "x".repeat(300),
      body: "y".repeat(7000),
      status: "status-fora-do-dominio",
      priority: "urgente",
      category: "categoria-antiga",
      due_at: "data-inválida",
      created_by: 999,
    },
    {
      organizationId: 3,
      fallbackUserId: 9,
      validUserIds: new Set(["9"]),
    },
  );

  assert.equal(row.status, "open");
  assert.equal(row.priority, "normal");
  assert.equal(row.category, "support");
  assert.equal(row.createdBy, 9);
  assert.equal(row.subject.length, 160);
  assert.equal(row.description.length, 5000);
  assert.equal(row.dueAt, null);
});

test("limites canônicos aceitam 80 MB por arquivo e 150 MB por chamado", () => {
  assert.equal(TICKET_ATTACHMENT_LIMITS.maxFileBytes, 80 * 1024 * 1024);
  assert.equal(TICKET_ATTACHMENT_LIMITS.maxTicketBytes, 150 * 1024 * 1024);
  assert.equal(TICKET_ATTACHMENT_LIMITS.chunkBytes, 8 * 1024 * 1024);

  const metadata = validateTicketAttachmentMetadata({
    name: "evidencia.pdf",
    mimeType: "application/pdf",
    size: 80 * 1024 * 1024,
  });
  assert.equal(metadata.size, 80 * 1024 * 1024);
  assert.throws(
    () =>
      validateTicketAttachmentMetadata({
        name: "evidencia.pdf",
        mimeType: "application/pdf",
        size: 80 * 1024 * 1024 + 1,
      }),
    (error) => error.code === "ATTACHMENT_TOO_LARGE",
  );
});

test("valida criação, prazo e limites dos filtros", () => {
  const payload = validateTicketCreatePayload({
    subject: "  Revisar mapa  ",
    description: " Conferir as camadas ",
    priority: "high",
    category: "map",
    dueAt: "2026-07-30T15:00:00-03:00",
  });

  assert.equal(payload.subject, "Revisar mapa");
  assert.equal(payload.priority, "high");
  assert.equal(payload.category, "map");
  assert.match(payload.dueAt, /^2026-07-30T18:00:00\.000Z$/);

  const options = parseTicketListOptions(
    "https://maono.test/api/tickets?status=review&limit=900&page=2&assigneeId=unassigned",
  );
  assert.equal(options.status, "in_review");
  assert.equal(options.limit, 100);
  assert.equal(options.page, 2);
  assert.equal(options.unassigned, true);

  assert.throws(
    () => validateTicketPatchPayload({}),
    (error) => error.code === "EMPTY_PATCH",
  );
});

test("valida assinatura e bloqueia arquivo executável ou MIME fraudado", async () => {
  const executableForm = new FormData();
  executableForm.set(
    "file",
    new File([new Uint8Array([0x4d, 0x5a])], "programa.exe", {
      type: "application/octet-stream",
    }),
  );
  await assert.rejects(
    () =>
      readTicketAttachmentUpload(
        new Request("https://maono.test", {
          method: "POST",
          body: executableForm,
        }),
      ),
    (error) => error.code === "ATTACHMENT_TYPE_NOT_ALLOWED",
  );

  const fakePdfForm = new FormData();
  fakePdfForm.set(
    "file",
    new File(["não é pdf"], "arquivo.pdf", {
      type: "application/pdf",
    }),
  );
  await assert.rejects(
    () =>
      readTicketAttachmentUpload(
        new Request("https://maono.test", {
          method: "POST",
          body: fakePdfForm,
        }),
      ),
    (error) => error.code === "ATTACHMENT_SIGNATURE_INVALID",
  );

  const validPdfForm = new FormData();
  validPdfForm.set(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "ok.pdf", {
      type: "application/pdf",
    }),
  );
  const valid = await readTicketAttachmentUpload(
    new Request("https://maono.test", {
      method: "POST",
      body: validPdfForm,
    }),
  );
  assert.equal(valid.originalName, "ok.pdf");
  assert.equal(valid.size, 6);
});

class ScopeDb {
  prepare(sql) {
    const state = { sql, params: [] };
    return {
      bind(...params) {
        state.params = params;
        return this;
      },
      async first() {
        if (state.sql.includes("FROM organization_tickets")) {
          const [ticketId, organizationId] = state.params;
          if (ticketId === 7 && organizationId === 1) {
            return {
              id: 7,
              organization_id: 1,
              status: "open",
              subject: "Teste",
              description: "Teste",
              priority: "normal",
              category: "support",
              created_by: 9,
            };
          }
          return null;
        }

        if (state.sql.includes("FROM ticket_attachments")) {
          const [attachmentId, organizationId, ticketId] = state.params;
          if (
            attachmentId === 11 &&
            organizationId === 1 &&
            ticketId === 7
          ) {
            return {
              id: 11,
              organization_id: 1,
              ticket_id: 7,
              original_name: "evidencia.pdf",
              stored_name: "private.pdf",
              storage_key: "/projects/org/tickets/7/attachments/private.pdf",
              mime_type: "application/pdf",
              size_bytes: 10,
              status: "ACTIVE",
              uploaded_by: 9,
            };
          }
          return null;
        }

        return null;
      },
    };
  }
}

test("impede acesso cruzado por organização, chamado e anexo", async () => {
  const env = { DB: new ScopeDb() };

  await assert.rejects(
    () => getTicketOrThrow(env, 2, 7),
    (error) => error.code === "TICKET_NOT_FOUND",
  );
  await assert.rejects(
    () => getTicketAttachmentOrThrow(env, 1, 8, 11),
    (error) => error.code === "ATTACHMENT_NOT_FOUND",
  );
  await assert.rejects(
    () => getTicketAttachmentOrThrow(env, 2, 7, 11),
    (error) => error.code === "ATTACHMENT_NOT_FOUND",
  );

  const attachment = await getTicketAttachmentOrThrow(env, 1, 7, 11);
  const publicAttachment = publicTicketAttachment(attachment);
  assert.equal(publicAttachment.id, 11);
  assert.equal("storageKey" in publicAttachment, false);
});

test("criador exclui o próprio anexo ativo aberto e sempre cancela upload pendente", () => {
  assert.equal(
    canCreatorDeleteAttachment(
      { status: "open" },
      { uploaded_by: 9 },
      9,
    ),
    true,
  );
  assert.equal(
    canCreatorDeleteAttachment(
      { status: "closed" },
      { uploaded_by: 9 },
      9,
    ),
    false,
  );
  assert.equal(
    canCreatorDeleteAttachment(
      { status: "closed" },
      { uploaded_by: 9, status: "PENDING" },
      9,
    ),
    true,
  );
  assert.equal(
    canCreatorDeleteAttachment(
      { status: "open" },
      { uploaded_by: 9 },
      10,
    ),
    false,
  );
});

test("migration cria tabelas e índices de isolamento", async () => {
  const sql = await readFile(
    new URL("../migrations/0010_ticket_center.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS organization_tickets/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ticket_attachments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ticket_events/);
  assert.match(sql, /idx_ticket_attachments_scope/);
  assert.match(sql, /UNIQUE \(organization_id, legacy_ticket_id\)/);
  assert.match(sql, /\('owner', 'ticket\.manage', 'organization', 1\)/);
  assert.match(sql, /\('editor', 'ticket\.view', 'organization', 1\)/);
  assert.doesNotMatch(sql, /\('viewer', 'ticket\.view'/);
});
