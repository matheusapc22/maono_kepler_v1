import { useEffect, useMemo, useState } from "react";

import {
  formatTicketDate,
  ticketDueDateKey,
} from "./ticket-format";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Ticket,
} from "./ticket-types";

type TicketCalendarViewProps = {
  tickets: Ticket[];
  onOpen: (ticket: Ticket) => void;
  onRangeChange: (from: string, to: string) => void;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(date: Date) {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthRange(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();

  return {
    from: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    to: `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function monthCells(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from(
    { length: firstWeekday },
    () => null,
  );

  for (let day = 1; day <= totalDays; day += 1) {
    cells.push(new Date(year, month, day));
  }

  while (cells.length % 7 !== 0 || cells.length < 35) cells.push(null);
  return cells;
}

function monthTitle(date: Date) {
  const value = date.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function TicketCalendarView({
  tickets,
  onOpen,
  onRangeChange,
}: TicketCalendarViewProps) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const range = useMemo(() => monthRange(month), [month]);

  useEffect(() => {
    onRangeChange(range.from, range.to);
  }, [onRangeChange, range.from, range.to]);

  const byDate = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const ticket of tickets) {
      const key = ticketDueDateKey(ticket);
      if (!key) continue;
      const items = map.get(key) || [];
      items.push(ticket);
      map.set(key, items);
    }
    for (const items of map.values()) {
      items.sort((left, right) => {
        const priorityRank = { high: 0, normal: 1, low: 2 };
        return priorityRank[left.priority] - priorityRank[right.priority];
      });
    }
    return map;
  }, [tickets]);

  const withoutDate = tickets.filter((ticket) => !ticket.dueAt);
  const agendaTickets = [...tickets]
    .filter((ticket) => ticket.dueAt)
    .sort(
      (left, right) =>
        new Date(left.dueAt || 0).getTime() -
        new Date(right.dueAt || 0).getTime(),
    );

  return (
    <section className="ticket-calendar" aria-label="Calendário de chamados">
      <header className="ticket-calendar-toolbar">
        <div>
          <h3>{monthTitle(month)}</h3>
          <p>Chamados posicionados pelo prazo operacional.</p>
        </div>
        <div>
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() =>
              setMonth(
                (current) =>
                  new Date(current.getFullYear(), current.getMonth() - 1, 1),
              )
            }
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
          >
            Hoje
          </button>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() =>
              setMonth(
                (current) =>
                  new Date(current.getFullYear(), current.getMonth() + 1, 1),
              )
            }
          >
            ›
          </button>
        </div>
      </header>

      <div className="ticket-calendar-grid">
        {WEEKDAYS.map((weekday) => (
          <div className="ticket-calendar-weekday" key={weekday}>
            {weekday}
          </div>
        ))}

        {monthCells(month).map((date, index) => {
          if (!date) {
            return (
              <div
                className="ticket-calendar-day is-outside"
                key={`empty-${index}`}
                aria-hidden="true"
              />
            );
          }

          const key = dateKey(date);
          const dayTickets = byDate.get(key) || [];
          const visible =
            expandedDay === key ? dayTickets : dayTickets.slice(0, 3);
          const hiddenCount = dayTickets.length - visible.length;
          const fullDate = date.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          });

          return (
            <section
              className="ticket-calendar-day"
              key={key}
              aria-label={fullDate}
            >
              <time dateTime={key}>{date.getDate()}</time>
              <div className="ticket-calendar-events">
                {visible.map((ticket) => (
                  <button
                    type="button"
                    key={ticket.id}
                    className={`ticket-calendar-event priority-${ticket.priority} status-${ticket.status}`}
                    aria-label={`${ticket.code}, ${ticket.subject}, prioridade ${PRIORITY_LABELS[ticket.priority]}, situação ${STATUS_LABELS[ticket.status]}, prazo ${fullDate}`}
                    onClick={() => onOpen(ticket)}
                  >
                    <strong>{ticket.code}</strong>
                    <span>{ticket.subject}</span>
                  </button>
                ))}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    className="ticket-calendar-more"
                    onClick={() => setExpandedDay(key)}
                  >
                    +{hiddenCount} mais
                  </button>
                ) : expandedDay === key && dayTickets.length > 3 ? (
                  <button
                    type="button"
                    className="ticket-calendar-more"
                    onClick={() => setExpandedDay(null)}
                  >
                    Recolher
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <div className="ticket-calendar-agenda" aria-label="Agenda do mês">
        {agendaTickets.length === 0 ? (
          <p>Nenhum chamado com prazo neste mês.</p>
        ) : (
          agendaTickets.map((ticket) => (
            <button
              type="button"
              key={ticket.id}
              onClick={() => onOpen(ticket)}
            >
              <time>{formatTicketDate(ticket.dueAt)}</time>
              <span>
                <strong>{ticket.code}</strong>
                {ticket.subject}
              </span>
              <span className={`ticket-priority priority-${ticket.priority}`}>
                {PRIORITY_LABELS[ticket.priority]}
              </span>
            </button>
          ))
        )}
      </div>

      <aside className="ticket-calendar-undated">
        <header>
          <h4>Sem data</h4>
          <span>{withoutDate.length}</span>
        </header>
        {withoutDate.length === 0 ? (
          <p>Todos os chamados exibidos possuem prazo.</p>
        ) : (
          <div>
            {withoutDate.map((ticket) => (
              <button
                type="button"
                key={ticket.id}
                onClick={() => onOpen(ticket)}
              >
                <strong>{ticket.code}</strong>
                <span>{ticket.subject}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </section>
  );
}

