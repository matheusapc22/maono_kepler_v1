import { assertHttpResponse, fail } from "../production-acceptance-lib.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const check = (value, code = "SYNTHETIC_RESOURCE_SCOPE_MISMATCH") => {
  if (!value) fail(code, "O recurso sintético não corresponde ao inventário desta execução.");
};
function body(response) {
  assertHttpResponse(response, response.status === 200 && response.body?.ok !== false,
    "Não foi possível verificar o recurso sintético.", "RESOURCE_CLEANUP_UNVERIFIED");
  return response.body;
}

export function assertQaContext(ctx) {
  check(UUID.test(ctx.runId), "QA_RUN_ID_INVALID");
  check(Number.isSafeInteger(ctx.organizationId) && ctx.organizationId > 0 && !ctx.projectSlug, "QA_ORGANIZATION_MISMATCH");
  const profiles = ["manager", "allowed", "restricted"].map(name => ctx.profiles[name]);
  check(new Set(profiles.map(profile => Number(profile?.user?.id))).size === 3, "QA_IDENTITIES_NOT_DISTINCT");
  for (const profile of profiles) {
    check(Number.isSafeInteger(Number(profile?.user?.id)) && Number(profile.user.id) > 0, "QA_IDENTITY_INVALID");
    check(!["admin", "super_admin"].includes(profile.user.role), "QA_PRIVILEGED_IDENTITY_FORBIDDEN");
    check(Number(profile.organization?.id) === ctx.organizationId, "QA_ORGANIZATION_MISMATCH");
  }
  for (const name of ["allowed", "restricted"]) {
    const user = ctx.profiles[name].user;
    check(!(user.permissions || []).includes("ticket.access.manage") || (user.deniedPermissions || []).includes("ticket.access.manage"), "QA_NEGATIVE_PROFILE_PRIVILEGED");
  }
}

// This is preservation/containment, never deletion. The reviewed run contract
// approves at most these four new fixtures; arbitrary existing IDs are not input.
export function syntheticResources(ctx) {
  assertQaContext(ctx);
  const managerId = Number(ctx.profiles.manager.user.id);
  const names = {
    ticket: `QA-CC04-${ctx.runId}`,
    attachment: `qa-${ctx.runId}.txt`,
    group: `QA CC04 ${ctx.runId}`,
    label: `QA-${ctx.runId}`,
  };
  const items = new Map();
  const journal = { version: 1, policy: "preserve-private-v1", organizationId: ctx.organizationId,
    runId: ctx.runId, cleanupVerified: false, unknownCreation: false, resources: [] };
  const publish = async () => {
    journal.resources = [...items.values()].map(item => ({ ...item }));
    journal.unknownCreation = [...items.values()].some(item => item.state === "intent");
    await ctx.publishResourceJournal(journal);
  };
  const ticketPath = () => `/api/organizations/${ctx.organizationId}/tickets/${items.get("ticket")?.id}`;
  const groupsPath = `/api/organizations/${ctx.organizationId}/ticket-access/groups`;
  const ownTicket = ticket => check(ticket && String(ticket.id) === items.get("ticket")?.id &&
    Number(ticket.organizationId) === ctx.organizationId && ticket.subject === names.ticket && Number(ticket.createdBy?.id) === managerId);
  const ownGroup = group => check(group && String(group.id) === items.get("group")?.id &&
    Number(group.organizationId) === ctx.organizationId && group.name === names.group);
  const readGroup = async () => {
    const groups = body(await ctx.api("manager", groupsPath)).groups;
    check(Array.isArray(groups));
    const group = groups.find(row => String(row.id) === items.get("group")?.id);
    ownGroup(group);
    return group;
  };
  const managerAcl = [{ principalType: "user", principalId: managerId, action: "ticket.manage", effect: "allow" }];

  const cleanup = async () => {
    const errors = [];
    // A failed or lost create response remains uncertain. Never discover/adopt
    // IDs by prefix and never retry a create or delete an unverified resource.
    if ([...items.values()].some(item => item.state === "intent")) errors.push("SYNTHETIC_RESOURCE_OUTCOME_UNCERTAIN");
    if (items.get("group")?.id) {
      try {
        await readGroup();
        await ctx.cleanupApi("manager", `${groupsPath}/${encodeURIComponent(items.get("group").id)}`,
          { method: "PATCH", json: { active: false, members: [] } });
        const group = await readGroup();
        check(group.active === false && Array.isArray(group.members) && group.members.length === 0 && Number(group.memberCount) === 0);
        items.get("group").state = "preserved_inactive";
        await publish();
      } catch (error) { errors.push(error.code || "RESOURCE_CLEANUP_UNVERIFIED"); }
    }
    if (items.get("ticket")?.id) {
      try {
        ownTicket(body(await ctx.api("manager", ticketPath())).ticket);
        await ctx.cleanupApi("manager", `${ticketPath()}/access`, { method: "PUT",
          json: { visibility: "private", acl: managerAcl, policyIds: [] } });
        await ctx.cleanupApi("manager", `${ticketPath()}/labels`, { method: "PUT", json: { labels: [] } });
        await ctx.cleanupApi("manager", ticketPath(), { method: "PATCH", json: { status: "closed" } });
        const ticket = body(await ctx.api("manager", ticketPath())).ticket;
        ownTicket(ticket);
        check(ticket.status === "closed" && ticket.visibility === "private");
        const access = body(await ctx.api("manager", `${ticketPath()}/access`)).access;
        const acl = access?.acl;
        check(access?.visibility === "private" && acl?.length === 1 && acl[0].principalType === "user" &&
          Number(acl[0].principalId) === managerId && acl[0].action === "ticket.manage" && acl[0].effect === "allow" && access.policies?.length === 0);
        const labels = body(await ctx.api("manager", `${ticketPath()}/labels`));
        check(Array.isArray(labels.labels) && labels.labels.length === 0);
        if (items.get("label")?.id) {
          check(labels.available?.some(label => String(label.id) === items.get("label").id && label.name === names.label));
          items.get("label").state = "preserved_detached";
        }
        if (items.get("attachment")?.id) {
          const attachments = body(await ctx.api("manager", `${ticketPath()}/attachments`)).attachments;
          const attachment = attachments?.find(row => String(row.id) === items.get("attachment").id);
          check(attachment && Number(attachment.organizationId) === ctx.organizationId && String(attachment.ticketId) === items.get("ticket").id &&
            attachment.name === names.attachment && attachment.status === "ACTIVE");
          items.get("attachment").state = "preserved_private";
        }
        for (const profile of ["allowed", "restricted"]) {
          const paths = [ticketPath(), `${ticketPath()}/attachments`];
          if (items.get("attachment")?.id) paths.push(`${ticketPath()}/attachments/${items.get("attachment").id}/download`);
          for (const path of paths) {
            const response = await ctx.api(profile, path);
            assertHttpResponse(response, response.status === 404, "A contenção do recurso sintético não foi confirmada.", "RESOURCE_CLEANUP_UNVERIFIED");
          }
        }
        items.get("ticket").state = "preserved_private_closed";
        await publish();
      } catch (error) { errors.push(error.code || "RESOURCE_CLEANUP_UNVERIFIED"); }
    }
    journal.cleanupVerified = errors.length === 0;
    journal.failureCodes = [...new Set(errors.filter(code => /^[A-Z0-9_]{1,100}$/.test(code)))];
    await publish();
    ctx.record("CC04-CLEANUP", errors.length ? "FAIL" : "PASS", { policy: journal.policy,
      verified: journal.cleanupVerified, retainedResources: items.size, permanentDeletion: false, unknownCreation: journal.unknownCreation });
    if (errors.length) fail(errors.includes("SYNTHETIC_RESOURCE_OUTCOME_UNCERTAIN") ? "SYNTHETIC_RESOURCE_OUTCOME_UNCERTAIN" : "RESOURCE_CLEANUP_UNVERIFIED",
      "Preservação dos recursos incompleta; consultar inventário antes de outra janela.");
  };
  ctx.registerCleanup(cleanup);
  return {
    names,
    async begin(kind) {
      check(Object.hasOwn(names, kind) && !items.has(kind));
      items.set(kind, { kind, id: null, name: names[kind], state: "intent" });
      await publish();
    },
    async observe(kind, row) {
      const item = items.get(kind);
      check(item?.state === "intent" && ID.test(String(row?.id || "")));
      if (["ticket", "attachment"].includes(kind)) check(Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0);
      check((kind === "ticket" ? row.subject : row.name) === names[kind]);
      if (kind === "ticket") check(Number(row.organizationId) === ctx.organizationId && Number(row.createdBy?.id) === managerId);
      if (kind === "group") check(Number(row.organizationId) === ctx.organizationId);
      if (kind === "attachment") check(Number(row.organizationId) === ctx.organizationId && String(row.ticketId) === items.get("ticket")?.id);
      item.id = String(row.id);
      item.state = "observed";
      await publish();
    },
  };
}
