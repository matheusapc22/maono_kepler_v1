import { fail } from "../production-acceptance-lib.mjs";

export const manifest = Object.freeze({
  id: "cc04-selective-access",
  version: 1,
  description: "CC-04 selective ticket access authenticated Production acceptance",
  mutationMode: "controlled_mutation",
  requiresBrowser: true,
  requiredProfiles: ["manager", "allowed", "restricted"],
  requiredPermissions: {
    manager: ["ticket.view", "ticket.create", "ticket.manage", "ticket.access.manage"],
    allowed: ["ticket.view"],
    restricted: ["ticket.view"],
  },
  managedFlags: {
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: {
      requiredBefore: false,
      activeValue: true,
      safeValue: false,
    },
  },
  cases: ["CT-11", "CT-12", "CT-13", "CT-50"],
});

function expectStatus(response, expected, label) {
  const values = Array.isArray(expected) ? expected : [expected];
  if (!values.includes(response.status)) {
    fail("ACCEPTANCE_ASSERTION_FAILED", `${label}: HTTP ${response.status}, esperado ${values.join("/")}.`);
  }
  return response;
}

function ticketPath(org, ticketId, suffix = "") {
  return `/api/organizations/${org}/tickets/${ticketId}${suffix}`;
}

function listCount(facets) {
  return Object.values(facets?.byStatus || {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

async function createAttachment(ctx, ticketId) {
  const bytes = Buffer.from(`Maono QA acceptance ${ctx.runId}\n`, "utf8");
  const base = ticketPath(ctx.organizationId, ticketId, "/attachments");
  const started = expectStatus(await ctx.api("manager", base, {
    method: "POST",
    json: {
      name: `qa-${ctx.runId}.txt`,
      mimeType: "text/plain",
      size: bytes.length,
    },
  }), 201, "iniciar anexo sintético");
  const attachmentId = started.body?.upload?.attachmentId;
  const offset = Number(started.body?.upload?.offset || 0);
  if (!attachmentId) fail("ACCEPTANCE_ASSERTION_FAILED", "Upload sintético não retornou attachmentId.");
  // Register immediately: a failed append must still remove the reservation.
  ctx.registerCleanup(async () => {
    await ctx.cleanupApi("manager", `${base}/${attachmentId}`, { method: "DELETE" }, [200, 204, 404]);
  });
  expectStatus(await ctx.api("manager", `${base}/${attachmentId}`, {
    method: "PATCH",
    body: bytes.subarray(offset),
    headers: {
      "Content-Type": "application/octet-stream",
      "Upload-Offset": String(offset),
    },
  }), 200, "concluir anexo sintético");
  return attachmentId;
}

async function configureAccess(ctx, ticketId, acl) {
  return expectStatus(await ctx.api("manager", ticketPath(ctx.organizationId, ticketId, "/access"), {
    method: "PUT",
    json: { visibility: "private", acl, policyIds: [] },
  }), 200, "configurar ACL privada");
}

async function browserRevocationCheck(ctx, subject, groupId) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const browserContext = await browser.newContext();
    const rawCookie = ctx.profiles.allowed.cookie;
    const separator = rawCookie.indexOf("=");
    await browserContext.addCookies([{
      name: rawCookie.slice(0, separator),
      value: rawCookie.slice(separator + 1),
      url: ctx.baseUrl,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }]);
    const page = await browserContext.newPage();
    await page.goto(`${ctx.baseUrl}/projects`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByRole("button", { name: "Central de Chamados" }).click();
    await page.getByRole("heading", { name: "Central de Chamados" }).waitFor({ timeout: 30_000 });
    const search = page.getByPlaceholder("Código, assunto ou descrição");
    await search.fill(subject);
    await page.waitForTimeout(900);
    const subjectButton = page.getByRole("button", { name: subject, exact: true });
    await subjectButton.waitFor({ timeout: 30_000 });
    await subjectButton.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: subject, exact: true }).waitFor({ timeout: 30_000 });

    expectStatus(await ctx.api("manager", `/api/organizations/${ctx.organizationId}/ticket-access/groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      json: { members: [] },
    }), 200, "revogar membro do grupo");

    await page.locator("button.ticket-subject-button", { hasText: subject }).evaluate((element) => element.click());
    await page.getByText("O chamado não está mais disponível para seu acesso.", { exact: true }).waitFor({ timeout: 30_000 });
    if (await page.getByRole("dialog").count() !== 0) {
      fail("ACCEPTANCE_ASSERTION_FAILED", "CT-12 UI: drawer permaneceu aberto após revogação.");
    }
    if (await page.getByRole("button", { name: subject, exact: true }).count() !== 0) {
      fail("ACCEPTANCE_ASSERTION_FAILED", "CT-12 UI: chamado revogado permaneceu na lista local.");
    }
  } finally {
    await browser.close();
  }
}

export async function run(ctx) {
  const org = ctx.organizationId;
  const managerId = Number(ctx.profiles.manager.user.id);
  const allowedId = Number(ctx.profiles.allowed.user.id);
  const restrictedId = Number(ctx.profiles.restricted.user.id);
  const subject = `QA-CC04-${ctx.runId}`;

  const capability = expectStatus(
    await ctx.api("manager", `/api/organizations/${org}/tickets?limit=1`),
    200,
    "ler capabilities da Central",
  );
  const lifecycleEnabled = capability.body?.lifecycleEnabled === true;
  const triageEnabled = capability.body?.triageEnabled === true;

  const ticketPayload = {
    subject,
    description: "Dados sintéticos para Production Acceptance CC-04.",
    category: "support",
    priority: "normal",
    ...(triageEnabled ? {
      demandNature: "question_request",
      expectedResult: "Validar isolamento seletivo com dados sintéticos.",
      context: "Production Acceptance automatizado.",
      impact: "individual",
      urgency: "flexible",
      priorityReason: "",
      triageAnswers: {},
      triageFormVersion: 1,
    } : {}),
  };
  const createOptions = {
    method: "POST",
    json: ticketPayload,
    ...(lifecycleEnabled ? { headers: { "Idempotency-Key": `qa-cc04-${ctx.runId}` } } : {}),
  };
  const created = expectStatus(
    await ctx.api("manager", `/api/organizations/${org}/tickets`, createOptions),
    201,
    "criar chamado sintético",
  );
  const ticketId = created.body?.ticket?.id;
  if (!ticketId) fail("ACCEPTANCE_ASSERTION_FAILED", "Chamado sintético não retornou id.");

  ctx.registerCleanup(async () => {
    await ctx.cleanupApi("manager", ticketPath(org, ticketId, "/access"), {
      method: "PUT",
      json: { visibility: "organization", acl: [], policyIds: [] },
    });
  });
  ctx.registerCleanup(async () => {
    await ctx.cleanupApi("manager", ticketPath(org, ticketId, "/labels"), {
      method: "PUT",
      json: { labels: [] },
    });
  });

  const attachmentId = await createAttachment(ctx, ticketId);

  const managerAllow = {
    principalType: "user",
    principalId: managerId,
    action: "ticket.manage",
    effect: "allow",
  };
  await configureAccess(ctx, ticketId, [managerAllow]);

  const query = encodeURIComponent(subject);
  const hiddenList = expectStatus(await ctx.api("restricted", `/api/organizations/${org}/tickets?limit=100&q=${query}`), 200, "CT-11 lista");
  if ((hiddenList.body?.tickets || []).some((ticket) => String(ticket.id) === String(ticketId)) ||
      Number(hiddenList.body?.pagination?.total || 0) !== 0 ||
      listCount(hiddenList.body?.facets) !== 0) {
    fail("ACCEPTANCE_ASSERTION_FAILED", "CT-11: lista, total ou facets revelaram o chamado privado.");
  }
  expectStatus(await ctx.api("restricted", ticketPath(org, ticketId)), 404, "CT-11 detalhe");
  expectStatus(await ctx.api("restricted", ticketPath(org, ticketId, "/state")), 404, "CT-11 state");
  expectStatus(await ctx.api("restricted", ticketPath(org, ticketId, "/attachments")), 404, "CT-11 anexos");
  expectStatus(await ctx.api("restricted", ticketPath(org, ticketId, `/attachments/${attachmentId}/download`)), 404, "CT-11 download");
  ctx.record("CT-11", "PASS", { list: true, detail: true, state: true, attachments: true, download: true });

  expectStatus(await ctx.api("manager", ticketPath(org, ticketId, "/labels"), {
    method: "PUT",
    json: { labels: [`QA-${ctx.runId}`] },
  }), 200, "CT-13 etiqueta");
  expectStatus(await ctx.api("restricted", ticketPath(org, ticketId)), 404, "CT-13 etiqueta não concede acesso");
  expectStatus(await ctx.api("restricted", `/api/organizations/${org}/ticket-access/groups`), 403, "CT-13 gestão sem permissão");
  expectStatus(await ctx.api("manager", `/api/organizations/${org}/ticket-access/groups`), 200, "CT-13 gestão com permissão");
  ctx.record("CT-13", "PASS", { labelsDoNotGrant: true, separateManagePermission: true });

  const group = expectStatus(await ctx.api("manager", `/api/organizations/${org}/ticket-access/groups`, {
    method: "POST",
    json: {
      name: `QA CC04 ${ctx.runId}`,
      description: "Grupo sintético do Production Acceptance.",
      members: [allowedId],
    },
  }), 201, "criar grupo sintético");
  const groupId = group.body?.group?.id;
  if (!groupId) fail("ACCEPTANCE_ASSERTION_FAILED", "Grupo sintético não retornou id.");
  ctx.registerCleanup(async () => {
    await ctx.cleanupApi("manager", `/api/organizations/${org}/ticket-access/groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      json: { active: false, members: [] },
    });
  });

  const groupAllow = {
    principalType: "group",
    principalId: groupId,
    action: "ticket.view",
    effect: "allow",
  };
  await configureAccess(ctx, ticketId, [managerAllow, groupAllow]);
  expectStatus(await ctx.api("allowed", ticketPath(org, ticketId)), 200, "CT-12 acesso antes da revogação");
  await browserRevocationCheck(ctx, subject, groupId);
  expectStatus(await ctx.api("allowed", ticketPath(org, ticketId)), 404, "CT-12 acesso após revogação");
  ctx.record("CT-12", "PASS", { nextRequestRevoked: true, staleDrawerCleared: true });

  expectStatus(await ctx.api("manager", `/api/organizations/${org}/ticket-access/groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    json: { active: true, members: [allowedId] },
  }), 200, "CT-50 restaurar membro sintético");
  const explicitDeny = {
    principalType: "user",
    principalId: allowedId,
    action: "ticket.view",
    effect: "deny",
  };
  await configureAccess(ctx, ticketId, [managerAllow, groupAllow, explicitDeny]);
  expectStatus(await ctx.api("allowed", ticketPath(org, ticketId)), 404, "CT-50 deny vence allow");
  await configureAccess(ctx, ticketId, [managerAllow, groupAllow]);
  expectStatus(await ctx.api("allowed", ticketPath(org, ticketId)), 200, "CT-50 allow volta após retirar deny");
  expectStatus(await ctx.api("manager", `/api/organizations/${org}/ticket-access/groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    json: { members: [] },
  }), 200, "CT-50 revogar vínculo");
  expectStatus(await ctx.api("allowed", ticketPath(org, ticketId)), 404, "CT-50 revogação de vínculo");
  ctx.record("CT-50", "PASS", { denyPrecedence: true, activeLinkRevocation: true });

  return {
    syntheticTicketId: ticketId,
    syntheticAttachmentId: attachmentId,
    syntheticGroupId: groupId,
    userIds: { manager: managerId, allowed: allowedId, restricted: restrictedId },
    lifecycleEnabled,
    triageEnabled,
  };
}
