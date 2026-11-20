import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { addToWatchlist, removeFromWatchlist } from "@/lib/watchlist.functions";
import { useWatchlist } from "@/components/valuation/use-watchlist";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir.");

/** Botão do cabeçalho da análise: adiciona ou retira a empresa da watchlist. */
export function WatchlistButton({ symbol, name }: { symbol: string; name: string }) {
  const qc = useQueryClient();
  const list = useWatchlist();
  const addFn = useServerFn(addToWatchlist);
  const removeFn = useServerFn(removeFromWatchlist);
  const key = symbol.toUpperCase();
  const inList = !!list.data?.some((e) => e.symbol === key);

  const toggle = useMutation({
    mutationFn: async () => {
      if (inList) await removeFn({ data: { symbol: key } });
      else await addFn({ data: { symbol: key, name } });
      return !inList;
    },
    onSuccess: (added) => {
      toast.success(added ? `${key} adicionada à watchlist.` : `${key} retirada da watchlist.`);
      void qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => toggle.mutate()}
      loading={toggle.isPending}
      disabled={list.isLoading}
      aria-pressed={inList}
      title={inList ? "Retirar da watchlist" : undefined}
    >
      {!toggle.isPending && (
        <Star aria-hidden className={cn("h-3.5 w-3.5", inList && "fill-warning text-warning")} />
      )}
      {inList ? "Na watchlist" : "Adicionar à watchlist"}
    </Button>
  );
}
