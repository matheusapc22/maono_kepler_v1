import "./ticket-accessibility.css";
import { TicketKnowledgeReuse } from "./TicketKnowledgePanel";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  cancelTicketAttachmentUpload,
  createTicketConversationDraft,
  deleteTicketAttachment,
  discardTicketConversationDraft,
  downloadTicketAttachment,
  editTicketConversationMessage,
  listTicketAttachmentUploadSessions,
  listTicketConversationMessages,
  listTicketConversationRevisions,
  resumeTicketAttachmentUpload,
  sendTicketConversationMessage,
  toTicketApiError,
  updateTicketConversationDraft,
  uploadTicketAttachment,
} from "./tickets-api";
import { formatTicketDateTime, ticketPersonName } from "./ticket-format";
import type {
  Ticket,
  TicketAttachment,
  TicketAttachmentLimits,
  TicketAttachmentUploadSession,
  TicketConversationBundle,
  TicketConversationDraft,
  TicketConversationKind,
  TicketConversationMessage,
  TicketConversationRevision,
} from "./ticket-types";

type TicketConversationPanelProps = {
  organizationId: number | string;
  ticket: Ticket;
  bundle?: TicketConversationBundle;
  currentUserId?: number | string | null;
  attachmentLimits: TicketAttachmentLimits;
  onReload: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCloseBlockedChange?: (blocked: boolean) => void;
};

type DraftMap = Partial<
  Record<TicketConversationKind, TicketConversationDraft>
>;
type RevisionMap = Record<string, TicketConversationRevision[] | undefined>;

function draftsByKind(drafts: TicketConversationDraft[]): DraftMap {
  const map: DraftMap = {};
  for (const draft of drafts) map[draft.kind] = draft;
  return map;
}

function replaceMessage(
  messages: TicketConversationMessage[],
  replacement: TicketConversationMessage,
) {
  return messages.map((message) =>
    message.id === replacement.id ? replacement : message,
  );
}

function mergeOlder(
  older: TicketConversationMessage[],
  current: TicketConversationMessage[],
) {
  const currentIds = new Set(current.map((message) => message.id));
  return [
    ...older.filter((message) => !currentIds.has(message.id)),
    ...current,
  ];
}

function readableBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TicketConversationPanel({
  organizationId,
  ticket,
  bundle,
  currentUserId,
  attachmentLimits,
  onReload,
  onDirtyChange,
  onCloseBlockedChange,
}: TicketConversationPanelProps) {
  const [kind, setKind] = useState<TicketConversationKind>("response");
  const [messages, setMessages] = useState<TicketConversationMessage[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [body, setBody] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<
    TicketAttachmentUploadSession[]
  >([]);
  const [busyUploadId, setBusyUploadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editingSaving, setEditingSaving] = useState(false);
  const [revisions, setRevisions] = useState<RevisionMap>({});
  const [loadingRevisions, setLoadingRevisions] = useState<string | null>(null);

  const draftsRef = useRef<DraftMap>({});
  const bodyRef = useRef("");
  const kindRef = useRef<TicketConversationKind>("response");
  const dirtyRef = useRef(false);
  const persistPromiseRef =
    useRef<Promise<TicketConversationDraft | null> | null>(null);
  const mountedRef = useRef(true);
  const serverDraftsRef = useRef<DraftMap>({});
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  const sendIntentRef = useRef<{
    key: string;
    payload: Parameters<typeof sendTicketConversationMessage>[2];
  } | null>(null);
  const [uncertainSend, setUncertainSend] = useState(false);
  const operationRef = useRef(false);
  const uploadControllerRef = useRef<AbortController | null>(null);

  const enabled = bundle?.enabled === true;
  const permissions = bundle?.permissions;
  const closed = ticket.status === "closed";
  const canRespond = enabled && permissions?.comment === true && !closed;
  const canUseInternal =
    canRespond &&
    permissions?.noteView === true &&
    permissions?.noteCreate === true;
  const accessRef = useRef({ canRespond, canUseInternal });
  accessRef.current = { canRespond, canUseInternal };
  function stillAllowed(kindValue: TicketConversationKind) {
    return (
      mountedRef.current &&
      accessRef.current.canRespond &&
      (kindValue !== "internal" || accessRef.current.canUseInternal)
    );
  }
  const activeDraft = drafts[kind];
  const attachments = activeDraft?.attachments || [];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const nextDrafts = draftsByKind(bundle?.drafts || []);
    serverDraftsRef.current = { ...nextDrafts };
    // Refresh messages without replacing an unsaved draft or its original CAS version.
    const keepLocal =
      canRespond &&
      (kindRef.current !== "internal" || canUseInternal) &&
      (dirtyRef.current ||
        persistPromiseRef.current ||
        sendIntentRef.current ||
        conflictRef.current ||
        uploading ||
        busyUploadId);
    if (keepLocal)
      nextDrafts[kindRef.current] = draftsRef.current[kindRef.current];
    if (!canUseInternal) delete nextDrafts.internal;
    draftsRef.current = { ...nextDrafts };
    setDrafts({ ...nextDrafts });
    setMessages(bundle?.messages || []);
    setNextCursor(bundle?.nextCursor || null);
    setHasMore(bundle?.hasMore === true);
    const currentKind = kindRef.current;
    const allowedKind =
      currentKind === "internal" && !canUseInternal ? "response" : currentKind;
    if (allowedKind !== currentKind) {
      kindRef.current = allowedKind;
      setKind(allowedKind);
    }
    if (keepLocal) return;
    uploadControllerRef.current?.abort();
    sendIntentRef.current = null;
    setUncertainSend(false);
    conflictRef.current = false;
    setConflict(false);
    const selected = canRespond ? nextDrafts[allowedKind] : undefined;
    bodyRef.current = selected?.body || "";
    setBody(selected?.body || "");
    dirtyRef.current = false;
    setDraftSavedAt(selected?.updatedAt || null);
    setError(null);
  }, [bundle, canUseInternal, canRespond]); // Drawer remounts per ticket; preserve live edits between ordinary renders.

  useEffect(() => {
    kindRef.current = kind;
    const selected = draftsRef.current[kind];
    bodyRef.current = selected?.body || "";
    setBody(selected?.body || "");
    dirtyRef.current = false;
    setDraftSavedAt(selected?.updatedAt || null);
    setError(null);
  }, [kind]);

  function setDraft(
    kindValue: TicketConversationKind,
    draft: TicketConversationDraft | undefined,
  ) {
    const next = { ...draftsRef.current };
    if (draft) next[kindValue] = draft;
    else delete next[kindValue];
    draftsRef.current = next;
    if (mountedRef.current) setDrafts(next);
  }

  useEffect(() => {
    onDirtyChange?.(
      dirtyRef.current ||
        savingDraft ||
        sending ||
        uploading ||
        !!editingId ||
        uncertainSend,
    );
  }, [
    body,
    savingDraft,
    sending,
    uploading,
    editingId,
    uncertainSend,
    onDirtyChange,
  ]);

  useEffect(() => {
    onCloseBlockedChange?.(sending || uncertainSend);
  }, [sending, uncertainSend, onCloseBlockedChange]);

  function clearAndReload(message: string) {
    sendIntentRef.current = null;
    setUncertainSend(false);
    draftsRef.current = {};
    setDrafts({});
    setMessages([]);
    bodyRef.current = "";
    setBody("");
    dirtyRef.current = false;
    setError(message);
    onReload();
  }

  function handleRequestFailure(
    requestError: unknown,
    fallback: string,
    draftConflict = false,
  ) {
    const apiError = toTicketApiError(requestError, fallback);
    if ([401, 403, 404].includes(apiError.status || 0)) {
      clearAndReload(
        "Seu acesso à conversa mudou. O chamado será recarregado.",
      );
      return apiError;
    }
    if (apiError.status === 412 || apiError.status === 428) {
      if (draftConflict) {
        conflictRef.current = true;
        setConflict(true);
      }
      setError(
        "O conteúdo mudou em outra tentativa. Seu texto foi preservado. Revise a versão atual antes de salvar novamente.",
      );
      onReload();
      return apiError;
    }
    setError(apiError.message || fallback);
    return apiError;
  }

  async function refreshPendingUploads(
    draftId?: string | null,
    signal?: AbortSignal,
  ) {
    if (!enabled || !canRespond) {
      setPendingUploads([]);
      return [];
    }
    try {
      const sessions = await listTicketAttachmentUploadSessions(
        organizationId,
        ticket.id,
        signal,
      );
      const target = draftId ?? draftsRef.current[kindRef.current]?.id ?? null;
      const filtered = target
        ? sessions.filter((session) => session.draftId === target)
        : [];
      if (!signal?.aborted) setPendingUploads(filtered);
      return filtered;
    } catch (requestError) {
      if (signal?.aborted) return [];
      const apiError = toTicketApiError(requestError);
      if ([403, 404, 503].includes(Number(apiError.status || 0))) {
        setPendingUploads([]);
        return [];
      }
      setError(
        apiError.message || "Não foi possível consultar os envios pendentes.",
      );
      return [];
    }
  }

  useEffect(() => {
    const draft = draftsRef.current[kind];
    const controller = new AbortController();
    void refreshPendingUploads(draft?.id, controller.signal);
    return () => controller.abort();
  }, [organizationId, ticket.id, kind, activeDraft?.id, enabled, canRespond]);

  async function persistCurrentDraft() {
    if (conflictRef.current || !mountedRef.current) return null;
    if (!enabled || !canRespond || !dirtyRef.current)
      return draftsRef.current[kindRef.current] || null;
    if (persistPromiseRef.current) return persistPromiseRef.current;

    const task = (async () => {
      let last: TicketConversationDraft | null =
        draftsRef.current[kindRef.current] || null;
      setSavingDraft(true);
      try {
        while (dirtyRef.current && mountedRef.current) {
          dirtyRef.current = false;
          const snapshotKind = kindRef.current;
          const snapshotBody = bodyRef.current;
          let current = draftsRef.current[snapshotKind];
          try {
            if (!current) {
              current = await createTicketConversationDraft(
                organizationId,
                ticket.id,
                { kind: snapshotKind, body: snapshotBody },
              );
            } else if (current.body !== snapshotBody) {
              current = await updateTicketConversationDraft(
                organizationId,
                ticket.id,
                current.id,
                snapshotBody,
                current.etag,
              );
            }
            if (!stillAllowed(snapshotKind)) return null;
            setDraft(snapshotKind, current);
            last = current;
            if (
              kindRef.current === snapshotKind &&
              bodyRef.current === snapshotBody
            ) {
              setDraftSavedAt(current.updatedAt);
            }
          } catch (requestError) {
            if (!mountedRef.current) return null;
            last = null;
            dirtyRef.current = true;
            handleRequestFailure(
              requestError,
              "Não foi possível salvar o rascunho.",
              true,
            );
            break;
          }
        }
      } finally {
        setSavingDraft(false);
      }
      return last;
    })();
    persistPromiseRef.current = task;
    return task.finally(() => {
      if (persistPromiseRef.current === task) persistPromiseRef.current = null;
    });
  }

  useEffect(() => {
    if (
      !dirtyRef.current ||
      !enabled ||
      !canRespond ||
      conflict ||
      uncertainSend
    )
      return undefined;
    const timeout = window.setTimeout(() => {
      void persistCurrentDraft();
    }, 750);
    return () => window.clearTimeout(timeout);
  }, [body, kind, enabled, canRespond, conflict, uncertainSend]);

  function changeBody(value: string) {
    bodyRef.current = value;
    dirtyRef.current = true;
    setBody(value);
    setError(null);
  }

  async function changeKind(next: TicketConversationKind) {
    if (
      sending ||
      uploading ||
      savingDraft ||
      uncertainSend ||
      conflict ||
      operationRef.current
    )
      return;
    if (dirtyRef.current && !(await persistCurrentDraft())) return;
    if (mountedRef.current) setKind(next);
  }

  function reviewConflict() {
    // Explicit adoption of the refreshed server version; never silently rebase a failed CAS.
    setDraft(kindRef.current, serverDraftsRef.current[kindRef.current]);
    conflictRef.current = false;
    setConflict(false);
    dirtyRef.current = true;
    setError(null);
  }

  async function attachFiles(files: FileList | null) {
    if (!files?.length || uploading || !canRespond) return;
    setUploading(true);
    setError(null);
    const uploadKind = kindRef.current;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    try {
      dirtyRef.current = true;
      let draft = await persistCurrentDraft();
      if (!mountedRef.current) return;
      if (!draft) throw new Error("Rascunho indisponível para anexos.");
      const currentPending = await refreshPendingUploads(draft.id);
      const room = Math.max(
        0,
        attachmentLimits.maxFiles -
          draft.attachments.length -
          currentPending.length,
      );
      const selected = Array.from(files).slice(0, room);
      for (const file of selected) {
        if (!stillAllowed(uploadKind) || controller.signal.aborted) return;
        const attachment = await uploadTicketAttachment(
          organizationId,
          ticket.id,
          file,
          { draftId: draft.id, signal: controller.signal },
        );
        if (!stillAllowed(uploadKind) || controller.signal.aborted) return;
        draft = {
          ...draft,
          attachments: [...draft.attachments, attachment],
        };
        setDraft(uploadKind, draft);
        await refreshPendingUploads(draft.id);
      }
      if (files.length > selected.length) {
        setError(`O chamado aceita até ${attachmentLimits.maxFiles} anexos.`);
      }
    } catch (requestError) {
      if (!stillAllowed(uploadKind) || controller.signal.aborted) return;
      const draft = draftsRef.current[uploadKind];
      const sessions = draft ? await refreshPendingUploads(draft.id) : [];
      if (sessions.length) {
        setError(
          "O envio foi interrompido, mas a sessão foi preservada. Use Retomar e selecione o mesmo arquivo.",
        );
      } else {
        handleRequestFailure(
          requestError,
          "Não foi possível anexar o arquivo ao rascunho.",
        );
      }
    } finally {
      setUploading(false);
    }
  }

  async function resumeDraftUpload(
    session: TicketAttachmentUploadSession,
    file: File,
  ) {
    setBusyUploadId(session.id);
    setUploading(true);
    setError(null);
    try {
      const attachment = await resumeTicketAttachmentUpload(
        organizationId,
        ticket.id,
        session,
        file,
      );
      const current = draftsRef.current[kindRef.current];
      if (current && current.id === session.draftId) {
        setDraft(kindRef.current, {
          ...current,
          attachments: [
            ...current.attachments.filter(
              (item) => String(item.id) !== String(attachment.id),
            ),
            attachment,
          ],
        });
      }
      await refreshPendingUploads(session.draftId);
    } catch (requestError) {
      handleRequestFailure(
        requestError,
        "Não foi possível retomar o anexo do rascunho.",
      );
      await refreshPendingUploads(session.draftId);
    } finally {
      setBusyUploadId(null);
      setUploading(false);
    }
  }

  async function cancelDraftUpload(session: TicketAttachmentUploadSession) {
    setBusyUploadId(session.id);
    setError(null);
    try {
      await cancelTicketAttachmentUpload(organizationId, ticket.id, session.id);
      await refreshPendingUploads(session.draftId);
    } catch (requestError) {
      handleRequestFailure(
        requestError,
        "Não foi possível cancelar o envio pendente.",
      );
    } finally {
      setBusyUploadId(null);
    }
  }

  async function removeDraftAttachment(attachment: TicketAttachment) {
    const current = draftsRef.current[kindRef.current];
    if (!current) return;
    try {
      await deleteTicketAttachment(organizationId, ticket.id, attachment.id);
      setDraft(kindRef.current, {
        ...current,
        attachments: current.attachments.filter(
          (item) => String(item.id) !== String(attachment.id),
        ),
      });
    } catch (requestError) {
      handleRequestFailure(requestError, "Não foi possível remover o anexo.");
    }
  }

  async function discardCurrentDraft() {
    const current = draftsRef.current[kindRef.current];
    if (!current) {
      bodyRef.current = "";
      setBody("");
      dirtyRef.current = false;
      setDraftSavedAt(null);
      return;
    }
    setError(null);
    try {
      const sessions = await refreshPendingUploads(current.id);
      for (const session of sessions) {
        await cancelTicketAttachmentUpload(
          organizationId,
          ticket.id,
          session.id,
        );
      }
      await discardTicketConversationDraft(
        organizationId,
        ticket.id,
        current.id,
        current.etag,
      );
      setDraft(kindRef.current, undefined);
      bodyRef.current = "";
      setBody("");
      dirtyRef.current = false;
      setDraftSavedAt(null);
    } catch (requestError) {
      handleRequestFailure(
        requestError,
        "Não foi possível descartar o rascunho.",
      );
    }
  }

  async function sendMessage() {
    if (
      !canRespond ||
      sending ||
      operationRef.current ||
      conflict ||
      !body.trim()
    )
      return;
    operationRef.current = true;
    setSending(true);
    setError(null);
    try {
      let intent = sendIntentRef.current;
      if (!intent) {
        dirtyRef.current = true;
        const draft = await persistCurrentDraft();
        if (!mountedRef.current) return;
        if (!draft || draft.body !== bodyRef.current) {
          if (conflictRef.current) return;
          throw new Error("O rascunho ainda não foi confirmado pelo servidor.");
        }
        const sessions = await refreshPendingUploads(draft.id);
        if (!mountedRef.current) return;
        if (sessions.length)
          throw new Error(
            "Conclua ou cancele os envios pendentes antes de enviar a mensagem.",
          );
        const attachmentIds = draft.attachments
          .map((a) => Number(a.id))
          .filter((id) => Number.isSafeInteger(id) && id > 0);
        if (attachmentIds.length !== draft.attachments.length)
          throw new Error("Um anexo retornou um identificador inválido.");
        intent = {
          key: crypto.randomUUID(),
          payload: {
            kind: kindRef.current,
            body: draft.body,
            draftId: draft.id,
            draftVersion: draft.version,
            attachmentIds,
          },
        };
        sendIntentRef.current = intent;
      }
      // A response may be lost after consumption of the draft. Replay the exact original request.
      const message = await sendTicketConversationMessage(
        organizationId,
        ticket.id,
        intent.payload,
        intent.key,
      );
      if (!stillAllowed(intent.payload.kind)) return;
      sendIntentRef.current = null;
      setUncertainSend(false);
      setMessages((current) => [
        ...current.filter((item) => item.id !== message.id),
        message,
      ]);
      setDraft(kindRef.current, undefined);
      bodyRef.current = "";
      setBody("");
      dirtyRef.current = false;
      setDraftSavedAt(null);
      onReload();
    } catch (requestError) {
      if (!mountedRef.current) return;
      const failure = handleRequestFailure(
        requestError,
        "Não foi possível enviar a mensagem.",
        true,
      );
      if (
        !uncertainSend &&
        [400, 401, 403, 404, 412, 422, 428].includes(failure.status || 0)
      )
        sendIntentRef.current = null;
      setUncertainSend(!!sendIntentRef.current);
    } finally {
      operationRef.current = false;
      setSending(false);
    }
  }

  async function loadOlder() {
    if (!hasMore || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await listTicketConversationMessages(
        organizationId,
        ticket.id,
        nextCursor,
      );
      setMessages((current) => mergeOlder(page.messages, current));
      setNextCursor(page.nextCursor || null);
      setHasMore(page.hasMore);
    } catch (requestError) {
      handleRequestFailure(
        requestError,
        "Não foi possível carregar mensagens anteriores.",
      );
    } finally {
      setLoadingOlder(false);
    }
  }

  function beginEdit(message: TicketConversationMessage) {
    setEditingId(message.id);
    setEditBody(message.body);
    setEditReason("");
    setError(null);
  }

  async function saveEdit(message: TicketConversationMessage) {
    if (!editBody.trim() || !editReason.trim() || editingSaving) return;
    setEditingSaving(true);
    try {
      const updated = await editTicketConversationMessage(
        organizationId,
        ticket.id,
        message.id,
        { body: editBody, reason: editReason },
        message.etag,
        crypto.randomUUID(),
      );
      setMessages((current) => replaceMessage(current, updated));
      setEditingId(null);
      setEditBody("");
      setEditReason("");
      setRevisions((current) => ({ ...current, [message.id]: undefined }));
      onReload();
    } catch (requestError) {
      handleRequestFailure(requestError, "Não foi possível editar a mensagem.");
    } finally {
      setEditingSaving(false);
    }
  }

  async function toggleRevisions(message: TicketConversationMessage) {
    if (revisions[message.id]) {
      setRevisions((current) => ({ ...current, [message.id]: undefined }));
      return;
    }
    setLoadingRevisions(message.id);
    try {
      const history = await listTicketConversationRevisions(
        organizationId,
        ticket.id,
        message.id,
      );
      setRevisions((current) => ({ ...current, [message.id]: history }));
    } catch (requestError) {
      handleRequestFailure(
        requestError,
        "Não foi possível carregar as revisões.",
      );
    } finally {
      setLoadingRevisions(null);
    }
  }

  const saveStatus = useMemo(() => {
    if (savingDraft) return "Salvando rascunho…";
    if (dirtyRef.current) return "Alterações ainda não salvas";
    if (draftSavedAt)
      return `Rascunho salvo ${formatTicketDateTime(draftSavedAt)}`;
    return "O rascunho é salvo no servidor";
  }, [savingDraft, draftSavedAt, body]);

  if (!enabled) return null;

  return (
    <section
      className="ticket-conversation"
      aria-labelledby="ticket-conversation-title"
    >
      <div className="ticket-conversation-heading">
        <div>
          <span className="ticket-center-eyebrow">CC-05</span>
          <h4 id="ticket-conversation-title">Conversa</h4>
        </div>
        {hasMore ? (
          <button
            type="button"
            className="ticket-secondary-action"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Carregando…" : "Mensagens anteriores"}
          </button>
        ) : null}
      </div>

      {canRespond && (
        <TicketKnowledgeReuse
          key={`knowledge-reuse:${organizationId}:${ticket.id}:${currentUserId}`}
          organizationId={organizationId}
          ticketId={Number(ticket.id)}
          canUseInternal={canUseInternal}
          onSent={onReload}
        />
      )}
      <ol className="ticket-conversation-list">
        {messages.length === 0 ? (
          <li className="ticket-conversation-empty">
            Nenhuma resposta registrada ainda.
          </li>
        ) : (
          messages.map((message) => {
            const own =
              currentUserId != null &&
              String(message.author?.id) === String(currentUserId);
            const history = revisions[message.id];
            return (
              <li
                key={message.id}
                className={`ticket-conversation-message audience-${message.audience}`}
              >
                <div className="ticket-conversation-message-meta">
                  <strong>
                    {message.audience === "internal"
                      ? "Nota interna"
                      : ticketPersonName(message.author)}
                  </strong>
                  <span>
                    {message.audience === "internal"
                      ? `${ticketPersonName(message.author)} · `
                      : ""}
                    {formatTicketDateTime(message.createdAt)}
                  </span>
                </div>
                {editingId === message.id ? (
                  <div className="ticket-conversation-editor">
                    <textarea
                      aria-label="Texto da mensagem editada"
                      value={editBody}
                      maxLength={20_000}
                      onChange={(event) => setEditBody(event.target.value)}
                    />
                    <input
                      aria-label="Motivo da edição"
                      value={editReason}
                      maxLength={1_000}
                      placeholder="Motivo da edição"
                      onChange={(event) => setEditReason(event.target.value)}
                    />
                    <div className="ticket-conversation-actions">
                      <button
                        type="button"
                        className="ticket-secondary-action"
                        onClick={() => setEditingId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="ticket-primary-action"
                        disabled={
                          editingSaving ||
                          !editBody.trim() ||
                          !editReason.trim()
                        }
                        onClick={() => void saveEdit(message)}
                      >
                        {editingSaving ? "Salvando…" : "Salvar edição"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="ticket-conversation-body">{message.body}</p>
                    {message.knowledge && (
                      <small>
                        Base de conhecimento · versão{" "}
                        {message.knowledge.revisionNumber} · texto revisado no
                        envio
                      </small>
                    )}
                  </>
                )}
                {message.attachments.length ? (
                  <ul className="ticket-conversation-attachments">
                    {message.attachments.map((attachment) => (
                      <li key={String(attachment.id)}>
                        <button
                          type="button"
                          onClick={() =>
                            void downloadTicketAttachment(
                              organizationId,
                              ticket.id,
                              attachment,
                            ).catch((requestError) => {
                              handleRequestFailure(
                                requestError,
                                "Não foi possível baixar o anexo.",
                              );
                            })
                          }
                        >
                          {attachment.name}{" "}
                          <small>{readableBytes(attachment.size)}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="ticket-conversation-message-actions">
                  {message.version > 1 ? (
                    <button
                      type="button"
                      onClick={() => void toggleRevisions(message)}
                      disabled={loadingRevisions === message.id}
                    >
                      {history
                        ? "Ocultar revisões"
                        : loadingRevisions === message.id
                          ? "Carregando…"
                          : `Ver ${message.version} versões`}
                    </button>
                  ) : null}
                  {own &&
                  canRespond &&
                  (message.audience !== "internal" || canUseInternal) ? (
                    <button type="button" onClick={() => beginEdit(message)}>
                      Editar
                    </button>
                  ) : null}
                </div>
                {history ? (
                  <ol className="ticket-conversation-revisions">
                    {history.map((revision) => (
                      <li key={revision.version}>
                        <strong>v{revision.version}</strong> ·{" "}
                        {formatTicketDateTime(revision.createdAt)}
                        {revision.reason ? (
                          <small> — {revision.reason}</small>
                        ) : null}
                        <p>{revision.body}</p>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            );
          })
        )}
      </ol>

      {error ? (
        <p className="ticket-conversation-error" role="alert">
          {error}
        </p>
      ) : null}
      {canRespond ? (
        <div className={`ticket-conversation-composer kind-${kind}`}>
          <div
            className="ticket-conversation-kind"
            role="group"
            aria-label="Tipo da mensagem"
          >
            <button
              type="button"
              className={kind === "response" ? "is-active" : ""}
              aria-pressed={kind === "response"}
              disabled={
                sending || uploading || savingDraft || uncertainSend || conflict
              }
              onClick={() => void changeKind("response")}
            >
              Resposta
            </button>
            {canUseInternal ? (
              <button
                type="button"
                className={kind === "internal" ? "is-active" : ""}
                aria-pressed={kind === "internal"}
                disabled={
                  sending ||
                  uploading ||
                  savingDraft ||
                  uncertainSend ||
                  conflict
                }
                onClick={() => void changeKind("internal")}
              >
                Nota interna
              </button>
            ) : null}
          </div>
          {kind === "internal" ? (
            <p className="ticket-conversation-private-warning">
              Visível somente para pessoas com permissão de notas internas. Não
              é exibida ao solicitante sem essa permissão.
            </p>
          ) : null}
          <textarea
            aria-label={
              kind === "internal"
                ? "Texto da nota interna"
                : "Texto da resposta"
            }
            disabled={sending || uploading || uncertainSend}
            value={body}
            maxLength={20_000}
            placeholder={
              kind === "internal"
                ? "Escreva uma nota interna…"
                : "Escreva uma resposta…"
            }
            onChange={(event) => changeBody(event.target.value)}
          />
          <div className="ticket-conversation-draft-meta">
            <span role="status" aria-atomic="true">
              {saveStatus}
            </span>
            <span>{body.length.toLocaleString("pt-BR")}/20.000</span>
          </div>
          {attachments.length ? (
            <ul className="ticket-conversation-draft-attachments">
              {attachments.map((attachment) => (
                <li key={String(attachment.id)}>
                  <span>
                    {attachment.name} · {readableBytes(attachment.size)}
                  </span>
                  <button
                    type="button"
                    disabled={
                      sending ||
                      uploading ||
                      savingDraft ||
                      uncertainSend ||
                      conflict
                    }
                    aria-label={`Remover ${attachment.name}`}
                    onClick={() => void removeDraftAttachment(attachment)}
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {pendingUploads.length ? (
            <ul className="ticket-conversation-draft-attachments ticket-conversation-pending-uploads">
              {pendingUploads.map((session) => {
                const progress = Math.round(
                  (session.offset / Math.max(1, session.size)) * 100,
                );
                const busy = busyUploadId === session.id;
                return (
                  <li key={session.id}>
                    <span>
                      {session.name} · {progress}% de{" "}
                      {readableBytes(session.size)}
                    </span>
                    <span>
                      <label className="ticket-secondary-action ticket-file-action">
                        Retomar
                        <input
                          type="file"
                          disabled={
                            busy ||
                            sending ||
                            uploading ||
                            uncertainSend ||
                            conflict
                          }
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void resumeDraftUpload(session, file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          sending ||
                          uploading ||
                          uncertainSend ||
                          conflict
                        }
                        onClick={() => void cancelDraftUpload(session)}
                      >
                        Cancelar envio
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="ticket-conversation-actions">
            <label className="ticket-secondary-action ticket-file-action">
              {uploading ? "Enviando anexo…" : "Anexar"}
              <input
                type="file"
                multiple
                disabled={
                  sending ||
                  savingDraft ||
                  uncertainSend ||
                  conflict ||
                  uploading ||
                  attachments.length + pendingUploads.length >=
                    attachmentLimits.maxFiles
                }
                onChange={(event) => {
                  void attachFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {activeDraft || body ? (
              <button
                type="button"
                className="ticket-secondary-action"
                disabled={sending || savingDraft || uploading || uncertainSend}
                onClick={() => void discardCurrentDraft()}
              >
                Descartar rascunho
              </button>
            ) : null}
            <button
              type="button"
              className="ticket-primary-action"
              disabled={
                conflict ||
                sending ||
                savingDraft ||
                uploading ||
                pendingUploads.length > 0 ||
                !body.trim()
              }
              onClick={() => void sendMessage()}
            >
              {sending
                ? "Enviando…"
                : uncertainSend
                  ? "Verificar envio anterior"
                  : kind === "internal"
                    ? "Registrar nota interna"
                    : "Enviar resposta"}
            </button>
          </div>
          {uncertainSend ? (
            <p role="status">
              O resultado do envio ainda não foi confirmado. Use “Verificar
              envio anterior”; o mesmo conteúdo será consultado sem criar outro
              envio.
            </p>
          ) : null}
          {conflict ? (
            <div className="ticket-command-conflict">
              <p>
                Versão atual do rascunho:{" "}
                {serverDraftsRef.current[kind]?.body ||
                  "Nenhum rascunho disponível."}
              </p>
              <button type="button" onClick={reviewConflict}>
                Revisei a versão atual; salvar meu texto
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="ticket-conversation-readonly">
          {closed
            ? "O chamado está concluído; a conversa permanece disponível somente para leitura."
            : "Você possui acesso somente para leitura nesta conversa."}
        </p>
      )}
    </section>
  );
}
