import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { AssetClass } from "@/lib/portfolio-types";

/**
 * Kit de gráficos: paleta, eixos, tooltip e estados partilhados por todas as
 * páginas. As cores vêm dos tokens `--chart-*` (claro e escuro) e a mesma
 * classe de ativo tem sempre a mesma cor. A cor nunca é o único portador de
 * informação: as legendas e tooltips trazem sempre nome e valor.
 */

export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
] as const;

/** Cor fixa por classe de ativo (ordem dos tokens chart-1..6). */
export const CLASS_COLOR: Record<AssetClass, string> = {
  etf: CHART_COLORS[0],
  reit: CHART_COLORS[1],
  acao_dividendo: CHART_COLORS[2],
  acao_crescimento: CHART_COLORS[3],
  metal: CHART_COLORS[4],
  p2p: CHART_COLORS[5],
};

export const AXIS_TICK = { fontSize: 11, fill: "var(--color-muted-foreground)" } as const;
export const AXIS_LINE = { stroke: "var(--color-border-strong)" } as const;
export const GRID_PROPS = {
  strokeDasharray: "3 3",
  stroke: "var(--color-border)",
  vertical: false,
} as const;

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/**
 * Tooltip uniforme (usa-se com `<Tooltip content={<ChartTooltip … />} />`).
 * Mostra o rótulo formatado em PT-PT e uma linha por série, com nome e valor.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormatter?: (label: string) => string;
  valueFormatter: (value: number, name: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const title = label != null && label !== "" ? String(label) : null;
  return (
    <div className="min-w-32 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      {title && (
        <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(title) : title}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((p, i) => {
          const name = String(p.name ?? p.dataKey ?? "");
          return (
            <li key={`${name}-${i}`} className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: p.color }}
              />
              <span className="text-muted-foreground">{name}</span>
              <span className="num ml-auto font-medium">
                {valueFormatter(Number(p.value), name)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Moldura de um gráfico: altura fixa (sem saltos de layout), estado de
 * carregamento, estado vazio e descrição textual para leitores de ecrã.
 */
export function ChartFrame({
  label,
  height = 256,
  loading,
  empty,
  emptyLabel = "Sem dados para mostrar.",
  className,
  children,
}: {
  /** Resumo do que o gráfico mostra (lido por leitores de ecrã). */
  label: string;
  height?: number;
  loading?: boolean;
  empty?: boolean;
  emptyLabel?: string;
  className?: string;
  children: ReactElement;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      aria-busy={loading || undefined}
      className={cn("w-full", className)}
      style={{ height }}
    >
      {loading ? (
        <Skeleton className="h-full w-full" />
      ) : empty ? (
        <p className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
