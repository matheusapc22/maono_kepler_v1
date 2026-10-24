// Invalidation only: no notices, counts or credentials are cached on window.
export const NOTICE_CHANGED = 'maono:notices-changed';
export const NOTICE_SESSION_RESET = 'maono:notices-session-reset';
export const NOTICE_SESSION_READY = 'maono:notices-session-ready';
export const resetNoticeSession = () => window.dispatchEvent(new Event(NOTICE_SESSION_RESET));
export const publishNoticeSession = (userId: unknown, organizationId: unknown) => window.dispatchEvent(
  new CustomEvent(NOTICE_SESSION_READY, {detail: `${userId ?? ''}:${organizationId ?? ''}`}),
);
export const invalidateNotices = () => window.dispatchEvent(new Event(NOTICE_CHANGED));
