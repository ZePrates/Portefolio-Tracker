import { Link } from "@tanstack/react-router";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { AssetPerformance } from "@/lib/dashboard";
import { formatPct, formatPercent, formatSignedEUR } from "@/lib/format";
import { Card } from "@/components/ui-bits";
import { CLASS_ROUTES } from "@/components/nav-config";

/** Abas segmentadas (Radix Tabs: `role="tablist"`, setas esquerda/direita). */
function SegmentedList({ label, items }: { label: string; items: Array<[string, string]> }) {
  return (
    <Tabs.List
      aria-label={label}
      className="flex gap-0.5 rounded-[9px] bg-background p-[3px] text-[12.5px]"
    >
      {items.map(([value, text]) => (
        <Tabs.Trigger
          key={value}
          value={value}
          className="min-h-11 rounded-md px-[11px] py-[5px] font-medium text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground lg:min-h-0"
        >
          {text}
        </Tabs.Trigger>
      ))}
    </Tabs.List>
  );
}

function EmptyRows({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

/* ------------------------------------------------------------------ */
/* Desempenho: melhores / piores                                       */
/* ------------------------------------------------------------------ */

function PerfRows({ rows, hidden }: { rows: AssetPerformance[]; hidden: boolean }) {
  if (rows.length === 0) return <EmptyRows label="Dados não disponíveis" />;
  return (
    <ul>
      {rows.map((r) => {
        const pct = r.unrealizedPct ?? 0;
        const up = r.unrealized >= 0;
        const Icon = up ? ArrowUpRight : ArrowDownRight;
        return (
          <li
            key={r.id}
            className="flex min-h-11 items-center gap-3 border-b border-foreground/5 py-2 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={CLASS_ROUTES[r.class]}
                className="block truncate text-[13.5px] hover:underline"
                title={r.name}
              >
                {r.name}
              </Link>
              <p className="num text-[12px] text-muted-foreground">
                {formatPct(r.weight, 1, hidden)} da carteira
              </p>
            </div>
            <span className="num shrink-0 text-[13px] text-muted-foreground">
              {formatSignedEUR(r.unrealized, hidden)}
            </span>
            <span
              className={cn(
                "num inline-flex w-[84px] shrink-0 items-center justify-center gap-0.5 rounded-full px-[7px] py-0.5 text-[12.5px] font-semibold",
                up ? "bg-success/[0.14] text-success" : "bg-destructive/[0.14] text-destructive",
              )}
            >
              <Icon aria-hidden className="h-3 w-3" />
              <span className="sr-only">{up ? "Subida de " : "Descida de "}</span>
              {formatPercent(pct, hidden)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PerformanceCard({
  best,
  worst,
  hidden,
}: {
  best: AssetPerformance[];
  worst: AssetPerformance[];
  hidden: boolean;
}) {
  const [tab, setTab] = useState("best");
  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0">
      <Card
        headingLevel={2}
        title="Desempenho"
        action={
          <SegmentedList
            label="Desempenho"
            items={[
              ["best", "Melhores"],
              ["worst", "Piores"],
            ]}
          />
        }
        className="h-full"
      >
        <Tabs.Content value="best">
          <PerfRows rows={best} hidden={hidden} />
        </Tabs.Content>
        <Tabs.Content value="worst">
          <PerfRows rows={worst} hidden={hidden} />
        </Tabs.Content>
      </Card>
    </Tabs.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Exposição: países / setores / empresas                              */
/* ------------------------------------------------------------------ */

export interface ExposureRow {
  label: string;
  pct: number;
}

function ExposureRows({ rows, hidden }: { rows: ExposureRow[]; hidden: boolean }) {
  if (rows.length === 0) return <EmptyRows label="Sem dados" />;
  const max = Math.max(...rows.map((r) => r.pct), 0);
  return (
    <ul>
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid min-h-11 grid-cols-[120px_1fr_56px] items-center gap-3 border-b border-foreground/5 py-2 text-[13.5px] last:border-b-0"
        >
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-foreground/5">
            <span
              className="block h-full rounded-full bg-muted-foreground/70"
              style={{ width: hidden || max <= 0 ? 0 : `${(r.pct / max) * 100}%` }}
            />
          </span>
          <span className="num text-right text-muted-foreground">
            {formatPct(r.pct, 1, hidden)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ExposureCard({
  countries,
  sectors,
  companies,
  hidden,
}: {
  /** `undefined` quando ainda não há composição calculada. */
  countries: ExposureRow[] | undefined;
  sectors: ExposureRow[] | undefined;
  companies: ExposureRow[] | undefined;
  hidden: boolean;
}) {
  const [tab, setTab] = useState("countries");
  const empty = !countries || countries.length === 0;
  return (
    <Tabs.Root value={tab} onValueChange={setTab} className="min-w-0">
      <Card
        headingLevel={2}
        title="Exposição"
        action={
          <SegmentedList
            label="Exposição"
            items={[
              ["countries", "Países"],
              ["sectors", "Setores"],
              ["companies", "Empresas"],
            ]}
          />
        }
        className="h-full"
      >
        {empty ? (
          <EmptyRows label="Sem dados — atualiza a composição em Exposição." />
        ) : (
          <>
            <Tabs.Content value="countries">
              <ExposureRows rows={countries} hidden={hidden} />
            </Tabs.Content>
            <Tabs.Content value="sectors">
              <ExposureRows rows={sectors ?? []} hidden={hidden} />
            </Tabs.Content>
            <Tabs.Content value="companies">
              <ExposureRows rows={companies ?? []} hidden={hidden} />
            </Tabs.Content>
            <Link
              to="/exposicao"
              className="mt-3 inline-flex min-h-6 items-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Exposição →
            </Link>
          </>
        )}
      </Card>
    </Tabs.Root>
  );
}
