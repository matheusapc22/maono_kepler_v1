import type { Ticket, TicketPerson } from "./ticket-types";

export function formatTicketDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatTicketDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFileSize(bytes?: number | null) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function ticketPersonName(person?: TicketPerson | null) {
  return person?.name || person?.email || "Não atribuído";
}

export function dateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function dateInputToIso(value: string) {
  if (!value) return null;
  // Meio-dia UTC preserva o dia civil selecionado nas visualizações mensais
  // e evita que fusos negativos desloquem o prazo para o dia anterior.
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ticketDueDateKey(ticket: Ticket) {
  return dateInputValue(ticket.dueAt);
}

export function isTicketOverdue(ticket: Ticket) {
  if (!ticket.dueAt || ticket.status === "closed") return false;
  return new Date(ticket.dueAt).getTime() < Date.now();
}
