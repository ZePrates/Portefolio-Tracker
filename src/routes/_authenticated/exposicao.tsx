import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getExposure, syncAllAssetExposure } from "@/lib/exposure.functions";
import type { Slice } from "@/lib/exposure-types";
import { formatEUR } from "@/lib/format";
import { usePrivateMode } from "@/components/private-mode";
import { Button, EmptyState, MetricCard, PageHeader } from "@/components/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/exposicao")({
  head: () => ({
    meta: [
      { title: "Exposição — Portefólio Tracker" },
      {
        name: "description",
        content: "Exposição económica real da carteira: geografia, setores, moedas, empresas e concentração.",
      },
      { property: "og:title", content: "Exposição — Portefólio Tracker" },
      {
        property: "og:description",
        content: "Exposição económica real da carteira: geografia, setores, moedas, empresas e concentração.",
      },
    ],
  }),
  component: ExposicaoPage,
});

const pct = (v: number, hidden: boolean) => (hidden ? "••" : `${v.toFixed(1).replace(".", ",")}%`);

function SliceList({
  title,
  note,
  slices,
  hidden,
  limit = 8,
}: {
  title: string;
  note?: string;
  slices: Slice[];
  hidden: boolean;
  limit?: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = slices.slice(0, limit);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <ul className="mt-4 space-y-2">
        {rows.length === 0 && <li className="text-sm text-muted-foreground">Não disponível</li>}
        {rows.map((s) => (
          <li key={s.value} className="rounded-lg border border-border/60">
            <button
              onClick={() => setOpen(open === s.value ? null : s.value)}
              className="w-full px-4 py-2.5 text-left"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{s.value}</span>
                <span className="text-muted-foreground">
                  {formatEUR(s.amount, hidden)} · {pct(s.pct, hidden)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, s.pct)}%` }}
                />
              </div>
            </button>
            {open === s.value && (
              <ul className="space-y-1 border-t border-border/60 px-4 py-2">
                {s.contributors.map((c) => (
                  <li key={c.assetId} className="flex justify-between text-xs text-muted-foreground">
                    <span>{c.name}</span>
                    <span>{formatEUR(c.amount, hidden)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExposicaoPage() {
  const { hidden } = usePrivateMode();
  const queryClient = useQueryClient();
  const fetchExposure = useServerFn(getExposure);
  const syncFn = useServerFn(syncAllAssetExposure);

  const { data, isLoading } = useQuery({
    queryKey: ["exposure"],
    queryFn: () => fetchExposure(),
  });

  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (res) => {
      toast.success(`Composição atualizada: ${res.updated} de ${res.total} ativos.`);
      queryClient.invalidateQueries({ queryKey: ["exposure"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const report = data?.report;
  const meta = data?.meta ?? [];

  const actions = (
    <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
      <RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} />
      Atualizar composição
    </Button>
  );

  if (!isLoading && (!report || report.total === 0)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exposição" subtitle="Exposição económica real da carteira." actions={actions} />
        <EmptyState
          title="Sem exposição calculada"
          description="Adicione ativos e atualize a composição para ver a exposição subjacente."
        />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="space-y-6">
        <PageHeader title="Exposição" subtitle="Exposição económica real da carteira." actions={actions} />
        <p className="text-sm text-muted-foreground">A calcular…</p>
      </div>
    );
  }

  const c = report.concentration;
  const derived = meta.filter((m) => m.derived);
  const lowCoverage = meta.filter((m) => m.coverage < 99);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exposição"
        subtitle="Exposição direta e indireta (via ETFs) calculada a partir dos dados reais dos ativos."
        actions={actions}
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <MetricCard label="Valor analisado" value={formatEUR(report.total, hidden)} />
        <MetricCard
          label="Cobertura dos dados"
          value={pct(report.coverage, hidden)}
          sub="Parte da carteira com composição conhecida"
        />
        <MetricCard label="Maior empresa" value={pct(c.largest, hidden)} sub={report.companies[0]?.name ?? "—"} />
        <MetricCard label="Top 10 empresas" value={pct(c.top10, hidden)} sub={`Top 5: ${pct(c.top5, hidden)}`} />
      </div>

      {lowCoverage.length > 0 && (
        <div className="rounded-xl border border-border bg-card/60 p-4 text-xs text-muted-foreground">
          A fonte publica apenas as principais posições de alguns ETFs, pelo que a composição não representa
          100% do fundo. Ativos com cobertura parcial:{" "}
          {lowCoverage.map((m) => `${m.name} (${m.coverage.toFixed(0)}%)`).join(", ")}.
          {derived.length > 0 && (
            <>
              {" "}
              Geografia e setores derivados das holdings em: {derived.map((m) => m.name).join(", ")}.
            </>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SliceList title="Por classe de ativo" slices={report.byClass} hidden={hidden} />
        <SliceList
          title="Por país"
          note="Exposição económica subjacente, não o país de domiciliação do fundo."
          slices={report.country}
          hidden={hidden}
        />
        <SliceList title="Por região" slices={report.region} hidden={hidden} />
        <SliceList title="Por continente" slices={report.continent} hidden={hidden} />
        <SliceList title="Desenvolvido vs. emergente" slices={report.development} hidden={hidden} limit={4} />
        <SliceList title="Por setor" slices={report.sector} hidden={hidden} limit={12} />
        <SliceList
          title="Por moeda económica"
          note="Moeda dos ativos subjacentes, não a moeda de cotação."
          slices={report.currency}
          hidden={hidden}
        />
        <SliceList title="Por indústria" slices={report.industry} hidden={hidden} limit={10} />
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Top 10 empresas (direta + indireta)</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Empresa</th>
                <th className="py-2 pr-3 font-medium">País</th>
                <th className="py-2 pr-3 font-medium">Setor</th>
                <th className="py-2 pr-3 text-right font-medium">Direta</th>
                <th className="py-2 pr-3 text-right font-medium">Via ETFs</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="py-2 text-right font-medium">% carteira</th>
              </tr>
            </thead>
            <tbody>
              {report.companies.slice(0, 10).map((co) => (
                <tr key={(co.symbol ?? co.name) + co.name} className="border-b border-border/50">
                  <td className="py-2 pr-3 font-medium">
                    {co.name}
                    {co.symbol && <span className="ml-2 text-xs text-muted-foreground">{co.symbol}</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{co.country ?? "Não disponível"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{co.sector ?? "Não disponível"}</td>
                  <td className="py-2 pr-3 text-right">{formatEUR(co.direct, hidden)}</td>
                  <td className="py-2 pr-3 text-right">{formatEUR(co.indirect, hidden)}</td>
                  <td className="py-2 pr-3 text-right font-medium">{formatEUR(co.amount, hidden)}</td>
                  <td className="py-2 text-right text-muted-foreground">{pct(co.pct, hidden)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
        <MetricCard label="Concentração por país" value={pct(c.topCountry, hidden)} sub="Maior país" />
        <MetricCard label="Concentração por setor" value={pct(c.topSector, hidden)} sub="Maior setor" />
        <MetricCard label="Concentração por moeda" value={pct(c.topCurrency, hidden)} sub="Maior moeda" />
      </div>

      <p className="text-xs text-muted-foreground">
        Fonte dos dados de composição: Yahoo Finance (quoteSummary). Nenhum dado financeiro é gerado por IA.
      </p>
    </div>
  );
}
