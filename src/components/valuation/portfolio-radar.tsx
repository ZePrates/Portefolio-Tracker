import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Radar, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ui-bits";
import { CLASS_LABELS } from "@/lib/portfolio-types";
import { analyzeCompany, type CompanyAnalysis } from "@/lib/valuation/analyze";
import { isNum } from "@/lib/valuation/stats";
import type { CompanyData } from "@/lib/valuation/types";
import { getCompanyData, type ValuationCandidate } from "@/lib/valuation.functions";
import { ScorePill, SimpleTable, VerdictBadge } from "@/components/valuation/bits";
import { money, num, signedPct } from "@/components/valuation/format";

type RowState =
  | { status: "pending" }
  | { status: "ok"; data: CompanyData; analysis: CompanyAnalysis }
  | { status: "error"; message: string };

/** Chave da cache da versão leve (sem pares nem notícias), partilhada com a página. */
const liteKey = (symbol: string) => ["valuation", symbol, "lite"] as const;

/**
 * Radar de valor: avalia as ações e REITs da carteira, dois de cada vez (para
 * não sobrecarregar o Yahoo), e ordena-os pelo potencial face ao valor justo.
 */
export function PortfolioRadar({
  candidates,
  loading,
  onOpen,
}: {
  candidates: ValuationCandidate[];
  loading: boolean;
  onOpen: (symbol: string) => void;
}) {
  const fetchFn = useServerFn(getCompanyData);
  const qc = useQueryClient();
  const [started, setStarted] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = async () => {
    setStarted(true);
    const queue = [...new Set(candidates.map((c) => c.symbol))];
    setRows(Object.fromEntries(queue.map((s) => [s, { status: "pending" } as RowState])));
    const worker = async () => {
      while (queue.length && !cancelled.current) {
        const symbol = queue.shift()!;
        try {
          const data = await qc.fetchQuery({
            queryKey: liteKey(symbol),
            queryFn: () => fetchFn({ data: { symbol, peers: false, news: false } }),
            staleTime: 30 * 60_000,
          });
          const analysis = analyzeCompany(data);
          if (!cancelled.current)
            setRows((r) => ({ ...r, [symbol]: { status: "ok", data, analysis } }));
        } catch (e) {
          if (!cancelled.current) {
            setRows((r) => ({
              ...r,
              [symbol]: { status: "error", message: e instanceof Error ? e.message : "Sem dados." },
            }));
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
  };

  const sorted = useMemo(() => {
    const list = candidates.filter(
      (c, i, arr) => arr.findIndex((x) => x.symbol === c.symbol) === i,
    );
    const up = (c: ValuationCandidate) => {
      const r = rows[c.symbol];
      return r?.status === "ok" && isNum(r.analysis.composite.upside)
        ? r.analysis.composite.upside
        : -Infinity;
    };
    return [...list].sort((x, y) => up(y) - up(x));
  }, [candidates, rows]);

  const done = Object.values(rows).filter((r) => r.status !== "pending").length;

  if (!loading && candidates.length === 0) {
    return (
      <EmptyState
        icon={<Radar aria-hidden className="h-6 w-6 text-muted-foreground" />}
        title="Sem ações nem REITs em carteira"
        description="Pesquisa qualquer empresa acima para ver o valor justo, a saúde financeira e a qualidade da gestão."
      />
    );
  }

  return (
    <Card
      title="Radar de valor da tua carteira"
      icon={<Radar aria-hidden className="h-4 w-4 text-muted-foreground" />}
      description="Avalia todas as tuas ações e REITs com os mesmos modelos e ordena-as pelo potencial. Aqui os múltiplos usam a referência da indústria (sem pares), por isso o valor pode diferir um pouco da análise completa."
      action={
        <Button
          size="sm"
          onClick={() => void run()}
          disabled={loading || (started && done < Object.keys(rows).length)}
        >
          {started
            ? done < Object.keys(rows).length
              ? `A avaliar ${done} de ${Object.keys(rows).length}…`
              : "Avaliar de novo"
            : `Avaliar ${candidates.length} posições`}
        </Button>
      }
    >
      <SimpleTable
        firstColWide
        head={["Posição", "Preço", "Valor justo", "Potencial", "Veredito", "Nota", "Saúde", ""]}
        rows={sorted.map((c) => {
          const r = rows[c.symbol];
          const ok = r?.status === "ok" ? r : null;
          const cur = ok?.data.market.currency ?? "EUR";
          return [
            <span key="n" className="block max-w-56">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {c.symbol} · {CLASS_LABELS[c.class]}
              </span>
            </span>,
            ok ? money(ok.data.market.price, cur) : "—",
            ok ? money(ok.analysis.composite.fairValue, cur) : r?.status === "pending" ? "…" : "—",
            ok ? (
              <span
                key="u"
                className={
                  (ok.analysis.composite.upside ?? 0) >= 0.15
                    ? "text-success"
                    : (ok.analysis.composite.upside ?? 0) <= -0.15
                      ? "text-destructive"
                      : ""
                }
              >
                {signedPct(ok.analysis.composite.upside)}
              </span>
            ) : (
              "—"
            ),
            ok ? (
              <span key="v" className="inline-flex items-center gap-1.5">
                <VerdictBadge verdict={ok.analysis.composite.verdict} />
                {ok.analysis.flags.some((f) => f.severity === "aviso") && (
                  <span
                    className="inline-flex text-warning"
                    title={ok.analysis.flags
                      .filter((f) => f.severity === "aviso")
                      .map((f) => f.text)
                      .join("\n\n")}
                  >
                    <TriangleAlert aria-hidden className="h-3.5 w-3.5" />
                    <span className="sr-only">Com alertas: abre a análise para ler</span>
                  </span>
                )}
              </span>
            ) : r?.status === "error" ? (
              <span
                key="e"
                className="inline-block max-w-56 whitespace-normal text-left text-[11px] text-destructive"
              >
                {r.message}
              </span>
            ) : (
              "—"
            ),
            ok ? (
              <ScorePill key="s" score={ok.analysis.score.total} label={`Nota de ${c.name}`} />
            ) : (
              "—"
            ),
            ok ? num(ok.analysis.health.score.score, 0) : "—",
            <Button key="b" size="sm" variant="ghost" onClick={() => onOpen(c.symbol)}>
              Abrir
            </Button>,
          ];
        })}
      />
      {started && done === Object.keys(rows).length && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {
            Object.values(rows).filter(
              (r) => r.status === "ok" && r.analysis.composite.verdict === "subavaliada",
            ).length
          }{" "}
          posições abaixo do valor justo e{" "}
          {
            Object.values(rows).filter(
              (r) => r.status === "ok" && r.analysis.composite.verdict === "sobreavaliada",
            ).length
          }{" "}
          acima. <Badge tone="neutral">Estudo, não recomendação</Badge>
        </p>
      )}
    </Card>
  );
}
