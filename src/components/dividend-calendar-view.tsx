import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePrivateMode } from "@/components/private-mode";
import { privateEUR } from "@/components/private-value";
import {
  buildMonthGrid,
  calendarMonths,
  shortCompanyName,
  type CalendarMonth,
  type ProjectedDividend,
} from "@/lib/dividend-calendar";
import { cn } from "@/lib/utils";

type View = "year" | "month";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const monthLong = new Intl.DateTimeFormat("pt-PT", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthShort = new Intl.DateTimeFormat("pt-PT", { month: "short", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("pt-PT", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const utc = (iso: string) => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "2026-11" → "Novembro de 2026". */
const formatMonthLong = (key: string) => capitalize(monthLong.format(utc(key)));
/** "2026-11" → "Nov" (com o ano em janeiro e no primeiro mês da lista). */
const formatMonthShort = (key: string, withYear: boolean) => {
  const name = capitalize(monthShort.format(utc(key)).replace(".", ""));
  return withYear ? `${name} ${key.slice(0, 4)}` : name;
};
const paymentsLabel = (n: number) => `${n} ${n === 1 ? "pagamento" : "pagamentos"}`;

/**
 * Calendário dos dividendos previstos, com vista de ano (ativos que pagam em
 * cada mês) e vista de mês (grelha de dias com os pagamentos).
 */
export function DividendCalendarView({
  events,
  today,
  months,
}: {
  events: ProjectedDividend[];
  today: string;
  months: number;
}) {
  const { hidden } = usePrivateMode();
  const [view, setView] = useState<View>("year");
  const [monthIdx, setMonthIdx] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const calendar = useMemo(
    () => calendarMonths({ events, today, months }),
    [events, today, months],
  );
  const idx = Math.min(monthIdx, calendar.length - 1);

  const openMonth = (i: number) => {
    setMonthIdx(i);
    setSelectedDay(null);
    setView("month");
  };

  return (
    <div className="space-y-4">
      <ViewToggle view={view} onChange={setView} />

      {view === "year" ? (
        <YearView calendar={calendar} today={today} hidden={hidden} onOpenMonth={openMonth} />
      ) : (
        <MonthView
          month={calendar[idx]!}
          today={today}
          hidden={hidden}
          selectedDay={selectedDay}
          onSelectDay={(d) => setSelectedDay((cur) => (cur === d ? null : d))}
          onPrev={idx > 0 ? () => openMonth(idx - 1) : undefined}
          onNext={idx < calendar.length - 1 ? () => openMonth(idx + 1) : undefined}
        />
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div
      role="group"
      aria-label="Vista do calendário"
      className="flex w-fit gap-0.5 rounded-[9px] bg-background p-[3px]"
    >
      {(
        [
          ["year", "Ano"],
          ["month", "Mês"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-9 rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
            view === v
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function YearView({
  calendar,
  today,
  hidden,
  onOpenMonth,
}: {
  calendar: CalendarMonth[];
  today: string;
  hidden: boolean;
  onOpenMonth: (i: number) => void;
}) {
  const current = today.slice(0, 7);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {calendar.map((m, i) => (
        <li key={m.month} className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenMonth(i)}
            aria-label={`${formatMonthLong(m.month)}: ${paymentsLabel(m.count)}. Abrir mês`}
            className={cn(
              "flex h-full w-full flex-col gap-2 rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-foreground/30",
              m.month === current ? "border-primary/60" : "border-border",
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">
                {formatMonthShort(m.month, i === 0 || m.month.endsWith("-01"))}
              </span>
              {m.count > 0 && (
                <span className="num text-xs text-muted-foreground">
                  {privateEUR(m.net, hidden)}
                </span>
              )}
            </span>
            {m.assets.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {m.assets.map((a) => (
                  <span
                    key={a}
                    title={a}
                    className="max-w-full truncate rounded bg-success/15 px-1.5 py-0.5 text-[11px] font-medium text-success"
                  >
                    {shortCompanyName(a)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Sem pagamentos</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MonthView({
  month,
  today,
  hidden,
  selectedDay,
  onSelectDay,
  onPrev,
  onNext,
}: {
  month: CalendarMonth;
  today: string;
  hidden: boolean;
  selectedDay: string | null;
  onSelectDay: (day: string) => void;
  onPrev: (() => void) | undefined;
  onNext: (() => void) | undefined;
}) {
  const weeks = useMemo(() => buildMonthGrid(month.month), [month.month]);
  const selected = selectedDay ? month.byDay[selectedDay] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <NavButton label="Mês anterior" onClick={onPrev}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </NavButton>
        <div className="text-center" aria-live="polite">
          <p className="text-sm font-semibold">{formatMonthLong(month.month)}</p>
          <p className="text-xs text-muted-foreground">
            {month.count > 0 ? (
              <>
                {paymentsLabel(month.count)} ·{" "}
                <span className="num">{privateEUR(month.net, hidden)}</span> líquido
              </>
            ) : (
              "Sem pagamentos previstos"
            )}
          </p>
        </div>
        <NavButton label="Mês seguinte" onClick={onNext}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </NavButton>
      </div>

      <div
        className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground"
        aria-hidden
      >
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((day, i) => {
          if (!day) return <span key={`empty-${i}`} />;
          const pays = month.byDay[day] ?? [];
          const num = (
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full text-xs sm:self-start",
                day === today
                  ? "bg-primary px-1 font-semibold text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {Number(day.slice(8))}
            </span>
          );
          const cellClass =
            "flex min-h-11 min-w-0 flex-col items-center gap-0.5 rounded-md border p-1 sm:min-h-20 sm:items-stretch";
          if (pays.length === 0) {
            return (
              <div key={day} className={cn(cellClass, "border-border/60")}>
                {num}
              </div>
            );
          }
          return (
            <button
              key={day}
              type="button"
              aria-pressed={selectedDay === day}
              aria-label={`${dayLong.format(utc(day))}: ${pays.map((p) => p.assetName).join(", ")}`}
              onClick={() => onSelectDay(day)}
              className={cn(
                cellClass,
                "text-left transition-colors hover:border-foreground/30",
                selectedDay === day ? "border-primary ring-1 ring-primary" : "border-border",
              )}
            >
              {num}
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success sm:hidden" />
              {pays.slice(0, 2).map((p) => (
                <span
                  key={`${p.assetId}-${p.exDate}`}
                  className="hidden truncate rounded bg-success/15 px-1 py-px text-[11px] text-success sm:block"
                >
                  {shortCompanyName(p.assetName)}{" "}
                  <span className="num">{privateEUR(p.net, hidden)}</span>
                </span>
              ))}
              {pays.length > 2 && (
                <span className="hidden text-[11px] text-muted-foreground sm:block">
                  +{pays.length - 2} mais
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="border-t border-border pt-3 text-sm">
        {selected ? (
          <>
            <p className="mb-1.5 font-medium">{capitalize(dayLong.format(utc(selectedDay!)))}</p>
            <ul className="space-y-1">
              {selected.map((p) => (
                <li
                  key={`${p.assetId}-${p.exDate}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="min-w-0 truncate">{p.assetName}</span>
                  <span className="num shrink-0 font-medium">{privateEUR(p.net, hidden)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {month.count > 0
              ? "Escolhe um dia marcado para ver os pagamentos."
              : "Usa as setas para ver outros meses."}
          </p>
        )}
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
