import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search } from "lucide-react";
import { Button, TextInput } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { cleanSymbol } from "@/lib/valuation/symbol";
import { searchCompanies, type ValuationCandidate } from "@/lib/valuation.functions";

const EXAMPLES = ["NVDA", "ASML.AS", "MSFT", "KO", "O", "SAN.MC"];

export function ValuationSearch({
  onPick,
  candidates,
  current,
}: {
  onPick: (symbol: string) => void;
  candidates: ValuationCandidate[];
  current?: string | undefined;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searchFn = useServerFn(searchCompanies);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const hits = useQuery({
    queryKey: ["valuation-search", debounced],
    queryFn: () => searchFn({ data: { q: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 10 * 60_000,
  });
  const results = debounced.length >= 2 ? (hits.data ?? []) : [];

  const pick = (symbol: string) => {
    setOpen(false);
    setText("");
    onPick(symbol);
  };

  const submit = () => {
    const hit = results[active];
    if (open && hit) return pick(hit.symbol);
    const s = cleanSymbol(text);
    if (s) pick(s);
  };

  const chips = [
    ...candidates.slice(0, 10).map((c) => ({ symbol: c.symbol, label: c.name })),
    ...EXAMPLES.filter((e) => !candidates.some((c) => c.symbol === e)).map((e) => ({
      symbol: e,
      label: e,
    })),
  ].slice(0, 14);

  return (
    <div className="space-y-3" data-print-hide>
      <form
        role="search"
        className="relative flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <TextInput
            aria-label="Ticker ou nome da empresa"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="Ticker ou nome: NVDA, Apple, ASML.AS, SAN.MC…"
            className="pl-9"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {open && results.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
            >
              {results.map((h, i) => (
                <li
                  key={h.symbol}
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-[13px]",
                    i === active ? "bg-accent" : "hover:bg-accent/60",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(h.symbol)}
                >
                  <span className="min-w-0 truncate">
                    <strong>{h.symbol}</strong>{" "}
                    <span className="text-muted-foreground">{h.name}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{h.exchange}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="submit">Analisar</Button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-muted-foreground">
          {candidates.length ? "Da tua carteira e exemplos:" : "Experimenta:"}
        </span>
        {chips.map((c) => (
          <button
            key={c.symbol}
            type="button"
            onClick={() => pick(c.symbol)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[12px] transition-colors hover:bg-accent",
              current === c.symbol ? "border-primary text-primary" : "border-border",
            )}
            title={c.label}
          >
            {c.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}
