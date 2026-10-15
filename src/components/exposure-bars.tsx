import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpAZ, ChevronDown } from "lucide-react";
import { Button, IconButton } from "@/components/ui-bits";
import type { Slice } from "@/lib/exposure-types";
import {
  exposurePct,
  exposureSector,
  mergeDisplaySlices,
  sortExposureRows,
} from "@/lib/exposure-display";
import { countryFlag, countryLabel, regionSlices, sectorColor } from "@/lib/exposure-visuals";
import { privateExposureEUR } from "@/components/private-value";

export function ExposureBars({
  title,
  slices,
  hidden,
  kind = "plain",
  basis = "carteira",
}: {
  title: string;
  slices: Slice[];
  hidden: boolean;
  kind?: "sector" | "country" | "plain";
  basis?: "carteira" | "ETF";
}) {
  const [regions, setRegions] = useState(false);
  const [alphabetic, setAlphabetic] = useState(false);
  const rows = useMemo(() => {
    const translated = mergeDisplaySlices(
      slices,
      kind === "sector" ? exposureSector : kind === "country" ? countryLabel : (s) => s,
    );
    const grouped = kind === "country" && regions ? regionSlices(translated) : translated;
    return sortExposureRows(
      grouped,
      (r) => (alphabetic ? r.value : r.pct),
      alphabetic ? "asc" : "desc",
      (r) => r.value,
    );
  }, [slices, kind, regions, alphabetic]);
  return (
    <section className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          {kind === "country" && (
            <div
              className="flex rounded-md bg-secondary p-0.5"
              role="group"
              aria-label={`${title} — vista`}
            >
              <Button
                size="sm"
                variant={regions ? "ghost" : "outline"}
                aria-pressed={!regions}
                onClick={() => setRegions(false)}
              >
                Países
              </Button>
              <Button
                size="sm"
                variant={regions ? "outline" : "ghost"}
                aria-pressed={regions}
                onClick={() => setRegions(true)}
              >
                Regiões
              </Button>
            </div>
          )}
          <IconButton
            label={alphabetic ? "Ordenar por peso" : "Ordenar alfabeticamente"}
            onClick={() => setAlphabetic(!alphabetic)}
          >
            {alphabetic ? (
              <ArrowUpAZ className="h-4 w-4" />
            ) : (
              <ArrowDownWideNarrow className="h-4 w-4" />
            )}
          </IconButton>
        </div>
      </header>
      <div className="flex justify-end gap-5 text-xs text-muted-foreground">
        <span>% {basis}</span>
        <span className="w-28 text-right">Valor da posição</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Ainda sem dados de composição.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.value} className="py-3">
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_7rem] items-start gap-2 text-sm">
                <span className="min-w-0 font-medium">
                  {kind === "country" && !regions && (
                    <span aria-hidden className="mr-2">
                      {countryFlag(row.value)}
                    </span>
                  )}
                  {row.value}
                </span>
                <span className="num text-right">{exposurePct(row.pct)}</span>
                <span className="num whitespace-nowrap text-right text-muted-foreground">
                  {privateExposureEUR(row.amount, hidden)}
                </span>
              </div>
              <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-sm bg-secondary">
                <div
                  className="h-full rounded-sm bg-primary transition-[width] motion-reduce:transition-none"
                  style={{
                    width: `${Math.max(0, Math.min(100, row.pct))}%`,
                    ...(kind === "sector" ? { backgroundColor: sectorColor(row.value) } : {}),
                  }}
                />
              </div>
              {row.contributors.length > 0 && (
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="flex w-fit cursor-pointer list-none items-center gap-1">
                    <ChevronDown className="h-3 w-3" />
                    Contributos · {row.contributors.length}
                  </summary>
                  <ul className="mt-2 space-y-2 border-l border-border pl-3">
                    {[...row.contributors]
                      .sort((a, b) => b.amount - a.amount)
                      .map((c) => (
                        <li className="flex justify-between gap-3" key={c.assetId}>
                          <span className="min-w-0">{c.name}</span>
                          <span className="num whitespace-nowrap">
                            {privateExposureEUR(c.amount, hidden)}
                          </span>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
