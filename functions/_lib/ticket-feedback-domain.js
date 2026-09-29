export const feedbackError = (code, status = 400) =>
  Object.assign(
    new Error(
      "Não foi possível concluir a pesquisa. Atualize os dados e confira seu acesso.",
    ),
    { code: "TICKET_FEEDBACK_" + code, status },
  );
export function instrumentDefinition(v) {
  const text = (s, n) =>
    typeof s === "string" && s.trim().length > 0 && s.length <= n;
  if (
    !v ||
    !text(v.resultQuestion, 300) ||
    !text(v.effortQuestion, 300) ||
    !text(v.consentText, 2000) ||
    !Number.isInteger(v.windowHours) ||
    v.windowHours < 1 ||
    v.windowHours > 8760 ||
    !Array.isArray(v.outcomes) ||
    v.outcomes.length < 2 ||
    v.outcomes.length > 10 ||
    v.outcomes.some((x) => !text(x, 80)) ||
    new Set(v.outcomes).size !== v.outcomes.length ||
    !Array.isArray(v.effortLabels) ||
    v.effortLabels.length < 2 ||
    v.effortLabels.length > 10 ||
    v.effortLabels.some((x) => !text(x, 80)) ||
    !["ascending", "descending"].includes(v.effortDirection) ||
    v.individualAudience !== "requester" ||
    v.aggregateAudience !== "ticket.manage" ||
    v.eligibleActor !== "requester" ||
    v.approved !== true
  )
    throw feedbackError("INVALID_INSTRUMENT");
  return Object.fromEntries(
    [
      "resultQuestion",
      "effortQuestion",
      "consentText",
      "windowHours",
      "outcomes",
      "effortLabels",
      "effortDirection",
      "individualAudience",
      "aggregateAudience",
      "eligibleActor",
      "approved",
    ].map((k) => [k, v[k]]),
  );
}
export function responseValue(body, definition) {
  if (body.declined === true)
    return {
      outcome: null,
      effort: null,
      comment: "",
      consent: 0,
      declined: 1,
    };
  if (
    body.consent !== true ||
    !definition.outcomes.includes(body.outcome) ||
    !Number.isInteger(body.effort) ||
    body.effort < 0 ||
    body.effort >= definition.effortLabels.length ||
    typeof body.comment !== "string" ||
    body.comment.length > 2000
  )
    throw feedbackError("INVALID_RESPONSE");
  return {
    outcome: body.outcome,
    effort: body.effort,
    comment: body.comment.trim(),
    consent: 1,
    declined: 0,
  };
}
// Cohorts never mix instruments or immature replies into mature denominators.
export function aggregateFeedback(rows, window) {
  const groups = new Map();
  for (const r of rows) {
    if (
      !(
        r.closed_at >= window.from &&
        r.closed_at < window.to &&
        r.issued_at <= window.asOf
      )
    )
      continue;
    const version = r.instrument_version;
    if (!groups.has(version))
      groups.set(version, {
        version,
        definition: JSON.parse(r.definition_json),
        eligible: 0,
        mature: 0,
        responses: 0,
        nonresponse: 0,
        immature: 0,
        immatureResponses: 0,
        declined: 0,
        withdrawn: 0,
        deliverySuppressed: 0,
        deliveryFailed: 0,
        outcomes: {},
        effort: {},
      });
    const g = groups.get(version),
      responded = r.responded_at && r.responded_at <= window.asOf,
      valid = responded && !r.declined && !r.withdrawn_at;
    g.eligible++;
    if (r.withdrawn_at) g.withdrawn++;
    if (r.delivery_status === "delivered" && r.candidate_state === "suppressed")
      g.deliverySuppressed++;
    // Delivery failures remain in the eligible denominator.
    if (r.delivery_status === "failed") g.deliveryFailed++;
    if (responded && r.declined) g.declined++;
    if (r.eligible_until > window.asOf) {
      g.immature++;
      if (valid) g.immatureResponses++;
      continue;
    }
    g.mature++;
    if (valid) {
      g.responses++;
      g.outcomes[r.outcome] = (g.outcomes[r.outcome] || 0) + 1;
      g.effort[r.effort] = (g.effort[r.effort] || 0) + 1;
    } else g.nonresponse++;
  }
  const watermark =
    rows
      .flatMap((r) => [r.issued_at, r.responded_at, r.withdrawn_at])
      .filter((x) => x && x <= window.asOf)
      .sort()
      .at(-1) || null;
  return {
    enabled: true,
    cohort: "closed_cycles",
    window,
    watermark,
    groups: [...groups.values()]
      .sort((a, b) => a.version - b.version)
      .map((g) => ({ ...g, rate: g.mature ? g.responses / g.mature : null })),
    quality: {
      nonresponseIsPositive: false,
      effortIsDuration: false,
      deliveryState: "current",
      consentState: "current",
    },
  };
}
