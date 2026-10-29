import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui-bits";
import { getEarningsCalendar } from "@/lib/earnings.functions";
import { EARNINGS_HORIZON_DAYS, earningsHourLabel } from "@/lib/earnings";
import { formatDatePt } from "@/lib/format";

const MAX_ROWS = 8;

/**
 * Próximos resultados trimestrais das ações e REITs em carteira (Finnhub).
 * Sem chave configurada, explica onde a definir em vez de falhar.
 */
export function EarningsCard() {
  const fetchEarnings = useServerFn(getEarningsCalendar);
  const q = useQuery({
    queryKey: ["earnings-calendar"],
    queryFn: () => fetchEarnings(),
    // Datas de resultados mudam pouco; evita gastar o limite gratuito em cada visita.
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  const data = q.data;
  const rows = data?.events.slice(0, MAX_ROWS) ?? [];

  return (
    <Card
      headingLevel={2}
      title="Próximos resultados"
      description={`Ações e REITs em carteira, próximos ${EARNINGS_HORIZON_DAYS} dias. Fonte: Finnhub.`}
    >
      {q.isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">A carregar…</p>
      ) : q.isError ? (
        <p className="py-4 text-sm text-muted-foreground">
          Não foi possível obter o calendário de resultados.
        </p>
      ) : !data?.configured ? (
        <p className="py-4 text-sm text-muted-foreground">
          Calendário desativado: falta a variável <code>FINNHUB_API_KEY</code> na Vercel (Production
          e Preview).
        </p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Sem resultados anunciados para os próximos {EARNINGS_HORIZON_DAYS} dias.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((e) => {
            const hour = earningsHourLabel(e.hour);
            return (
              <li key={`${e.symbol}-${e.date}`} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="num w-[5.5rem] shrink-0 text-muted-foreground">
                  {formatDatePt(e.date)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{e.symbol}</span>{" "}
                  <span className="text-muted-foreground">{e.name}</span>
                </span>
                {hour && <span className="shrink-0 text-xs text-muted-foreground">{hour}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {data?.configured && data.failed.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem resposta para {data.failed.length} de {data.checked}: {data.failed.join(", ")}.
        </p>
      )}
    </Card>
  );
}
