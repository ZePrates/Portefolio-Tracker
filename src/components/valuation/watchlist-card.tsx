import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Star, Target, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, IconButton, TextInput } from "@/components/ui-bits";
import { formatNumber, parseNumberPt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { analyzeCompany, type CompanyAnalysis } from "@/lib/valuation/analyze";
import type { CompanyData } from "@/lib/valuation/types";
import { getCompanyData } from "@/lib/valuation.functions";
import { isBelowTarget, targetGap, type WatchlistEntry } from "@/lib/watchlist";
import { removeFromWatchlist, setWatchlistTarget } from "@/lib/watchlist.functions";
import { SimpleTable, VerdictBadge } from "@/components/valuation/bits";
import { money, pct, signedPct } from "@/components/valuation/format";
import { useWatchlist } from "@/components/valuation/use-watchlist";

type RowState =
  | { status: "pending" }
  | { status: "ok"; data: CompanyData; analysis: CompanyAnalysis }
  | { status: "error"; message: string };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir.");

/**
 * Watchlist: empresas a acompanhar, com a mesma análise leve do radar (sem
 * pares nem notícias, dois pedidos de cada vez) e preço-alvo editável. O resumo
 * das 9h avisa quando o fecho fica abaixo do alvo.
 */
export function WatchlistCard({ onOpen }: { onOpen: (symbol: string) => void }) {
  const list = useWatchlist();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getCompanyData);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [generation, setGeneration] = useState(0);
  const started = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const entries = list.data ?? [];
  const symbolsKey = entries.map((e) => e.symbol).join(",");

  // Avalia os símbolos ainda sem análise, dois de cada vez (para não sobrecarregar o Yahoo).
  useEffect(() => {
    const seen = started.current;
    const queue = (symbolsKey ? symbolsKey.split(",") : []).filter((s) => !seen.has(s));
    if (!queue.length) return;
    let stop = false;
    for (const s of queue) seen.add(s);
    setRows((r) => ({ ...r, ...Object.fromEntries(queue.map((s) => [s, { status: "pending" }])) }));
    const worker = async () => {
      while (queue.length && !stop) {
        const symbol = queue.shift()!;
        let next: RowState;
        try {
          const data = await qc.fetchQuery({
            queryKey: ["valuation", symbol, "lite"],
            queryFn: () => fetchFn({ data: { symbol, peers: false, news: false } }),
            staleTime: 30 * 60_000,
          });
          next = { status: "ok", data, analysis: analyzeCompany(data) };
        } catch (e) {
          next = { status: "error", message: e instanceof Error ? e.message : "Sem dados." };
        }
        if (alive.current) setRows((r) => ({ ...r, [symbol]: next }));
      }
    };
    void Promise.all([worker(), worker()]);
    return () => {
      // Os que ainda não começaram voltam para a fila do próximo efeito.
      stop = true;
      for (const s of queue) seen.delete(s);
    };
  }, [symbolsKey, generation, qc, fetchFn]);

  const refresh = () => {
    for (const s of started.current) {
      qc.removeQueries({ queryKey: ["valuation", s, "lite"], exact: true });
    }
    started.current.clear();
    setRows({});
    setGeneration((g) => g + 1);
  };

  const pending = entries.filter((e) => rows[e.symbol]?.status === "pending").length;
  const below = entries.filter((e) => {
    const r = rows[e.symbol];
    return r?.status === "ok" && isBelowTarget(r.data.market.price, e.targetPrice);
  }).length;

  if (!list.isLoading && entries.length === 0) {
    return (
      <EmptyState
        icon={<Star aria-hidden className="h-6 w-6 text-muted-foreground" />}
        title="A watchlist está vazia"
        description="Pesquisa uma empresa acima e, na análise, carrega em «Adicionar à watchlist». Aqui vês o valor justo e defines o preço-alvo; o resumo das 9h avisa quando o fecho fica abaixo do alvo."
      />
    );
  }

  return (
    <Card
      title="Watchlist"
      icon={<Star aria-hidden className="h-4 w-4 text-muted-foreground" />}
      description="Empresas a acompanhar, com a mesma avaliação do radar (múltiplos pela indústria, sem pares). Define o preço-alvo na moeda da cotação: o resumo das 9h avisa quando o fecho fica abaixo dele."
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={list.isLoading || pending > 0}
        >
          <RefreshCw aria-hidden className={cn("h-3.5 w-3.5", pending > 0 && "animate-spin")} />
          {pending > 0
            ? `A avaliar ${entries.length - pending} de ${entries.length}…`
            : "Atualizar"}
        </Button>
      }
    >
      {list.error ? (
        <p className="text-[13px] text-destructive">{errMsg(list.error)}</p>
      ) : (
        <SimpleTable
          firstColWide
          head={[
            "Empresa",
            "Preço",
            "Valor justo",
            "Potencial",
            "Veredito",
            "Preço-alvo",
            "Face ao alvo",
            "",
          ]}
          rows={entries.map((e) => {
            const r = rows[e.symbol];
            const ok = r?.status === "ok" ? r : null;
            const cur = ok?.data.market.currency ?? "";
            const upside = ok?.analysis.composite.upside ?? null;
            const gap = ok ? targetGap(ok.data.market.price, e.targetPrice) : null;
            const warnings = ok?.analysis.flags.filter((f) => f.severity === "aviso") ?? [];
            return [
              <span key="n" className="block max-w-56">
                <span className="block truncate font-medium">{e.name}</span>
                <span className="text-[11px] text-muted-foreground">{e.symbol}</span>
              </span>,
              ok ? money(ok.data.market.price, cur) : r?.status === "pending" ? "…" : "—",
              ok ? money(ok.analysis.composite.fairValue, cur) : "—",
              ok ? (
                <span
                  key="u"
                  className={cn(
                    (upside ?? 0) >= 0.15 && "text-success",
                    (upside ?? 0) <= -0.15 && "text-destructive",
                  )}
                >
                  {signedPct(upside)}
                </span>
              ) : (
                "—"
              ),
              ok ? (
                <span key="v" className="inline-flex items-center gap-1.5">
                  <VerdictBadge verdict={ok.analysis.composite.verdict} />
                  {warnings.length > 0 && (
                    <span
                      className="inline-flex text-warning"
                      title={warnings.map((f) => f.text).join("\n\n")}
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
              <TargetInput key={`t-${e.symbol}-${e.targetPrice ?? ""}`} entry={e} currency={cur} />,
              gap == null ? (
                "—"
              ) : gap < 0 ? (
                <Badge key="g" tone="gain">
                  <Target aria-hidden className="h-3 w-3" />
                  {pct(-gap)} abaixo
                </Badge>
              ) : (
                <span key="g" className="text-muted-foreground">
                  {gap === 0 ? "No alvo" : `${pct(gap)} acima`}
                </span>
              ),
              <span key="a" className="inline-flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => onOpen(e.symbol)}>
                  Abrir
                </Button>
                <RemoveButton entry={e} />
              </span>,
            ];
          })}
        />
      )}
      {entries.length > 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {below === 1 ? "1 empresa abaixo" : `${below} empresas abaixo`} do preço-alvo.{" "}
          <Badge tone="neutral">Estudo, não recomendação</Badge>
        </p>
      )}
    </Card>
  );
}

/** Preço-alvo editável: grava ao sair do campo ou com Enter; vazio limpa o alvo. */
function TargetInput({ entry, currency }: { entry: WatchlistEntry; currency: string }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(setWatchlistTarget);
  const initial = entry.targetPrice == null ? "" : formatNumber(entry.targetPrice, 2);
  const [text, setText] = useState(initial);

  const save = useMutation({
    mutationFn: (targetPrice: number | null) =>
      saveFn({ data: { symbol: entry.symbol, targetPrice } }),
    onSuccess: (_r, targetPrice) => {
      toast.success(
        targetPrice == null
          ? `Preço-alvo de ${entry.symbol} retirado.`
          : `Preço-alvo de ${entry.symbol} guardado.`,
      );
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (e) => {
      setText(initial);
      toast.error(errMsg(e));
    },
  });

  const commit = () => {
    const raw = text.trim();
    if (raw === initial.trim()) return;
    if (!raw) return save.mutate(null);
    const n = parseNumberPt(raw);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Preço-alvo inválido: escreve um número positivo (ex.: 42,50).");
      setText(initial);
      return;
    }
    if (entry.targetPrice != null && Math.abs(n - entry.targetPrice) < 1e-9) return;
    save.mutate(n);
  };

  return (
    <span className="inline-flex items-center justify-end gap-1">
      <TextInput
        inputMode="decimal"
        value={text}
        placeholder="Definir"
        disabled={save.isPending}
        onChange={(ev) => setText(ev.target.value)}
        onBlur={commit}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.blur();
          if (ev.key === "Escape") {
            setText(initial);
            ev.currentTarget.blur();
          }
        }}
        aria-label={`Preço-alvo de ${entry.name}${currency ? ` (${currency})` : ""}`}
        className="num h-8 w-24 px-2 py-1 text-right sm:text-[13px]"
      />
      {currency && <span className="text-[11px] text-muted-foreground">{currency}</span>}
    </span>
  );
}

function RemoveButton({ entry }: { entry: WatchlistEntry }) {
  const qc = useQueryClient();
  const removeFn = useServerFn(removeFromWatchlist);
  const remove = useMutation({
    mutationFn: () => removeFn({ data: { symbol: entry.symbol } }),
    onSuccess: () => {
      toast.success(`${entry.symbol} retirada da watchlist.`);
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <IconButton
      label={`Retirar ${entry.name} da watchlist`}
      onClick={() => remove.mutate()}
      disabled={remove.isPending}
      className="h-8 w-8 sm:h-8 sm:w-8"
    >
      <X aria-hidden className="h-3.5 w-3.5" />
    </IconButton>
  );
}
