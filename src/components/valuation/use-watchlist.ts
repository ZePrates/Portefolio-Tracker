import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listWatchlist } from "@/lib/watchlist.functions";

/** Lista da watchlist (partilhada pelo botão do cabeçalho e pelo cartão da página). */
export function useWatchlist() {
  const fetchFn = useServerFn(listWatchlist);
  return useQuery({
    queryKey: ["watchlist"],
    queryFn: () => fetchFn(),
    staleTime: 60_000,
  });
}
