import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button, Card, useConfirm } from "@/components/ui-bits";
import { rebuildPortfolioHistory } from "@/lib/history.functions";
import { formatDatePt } from "@/lib/format";

/** Reconstrói as fotografias diárias desde o primeiro movimento com fechos históricos. */
export function HistoryRebuildCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const rebuildFn = useServerFn(rebuildPortfolioHistory);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);

  const run = async () => {
    const ok = await confirm({
      title: "Reconstruir o histórico?",
      description:
        "As fotografias anteriores a hoje (as da app e as importadas) são substituídas por valores calculados a partir dos teus movimentos e dos fechos de cada dia. A fotografia de hoje fica como está. Podes repetir quando quiseres.",
      confirmLabel: "Reconstruir",
    });
    if (!ok) return;
    setRunning(true);
    const toastId = toast.loading("A obter os fechos históricos…");
    try {
      const r = await rebuildFn();
      await queryClient.invalidateQueries({ queryKey: ["portfolio-snapshots"] });
      if (r.days === 0 || !r.from) {
        toast.info("Ainda não há movimentos para reconstruir.", { id: toastId });
        setSummary(null);
        return;
      }
      const notes: string[] = [
        `${r.days} dias, de ${formatDatePt(r.from)} a ${formatDatePt(r.to)}.`,
      ];
      if (r.missingPrices.length > 0) {
        notes.push(`Sem fechos no Yahoo: ${r.missingPrices.join(", ")}.`);
      }
      if (r.atCost.length > 0) {
        notes.push(`Avaliados ao preço de compra em alguns dias: ${r.atCost.join(", ")}.`);
      }
      if (r.missingFx.length > 0) notes.push(`Sem câmbio histórico: ${r.missingFx.join(", ")}.`);
      setSummary(notes);
      toast.success(`Histórico reconstruído: ${r.days} dias.`, { id: toastId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reconstruir o histórico.", {
        id: toastId,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card
      title="Reconstruir o histórico"
      description="Calcula o valor da carteira em cada dia desde a primeira compra: as unidades que tinhas nesse dia ao preço de fecho, convertidas ao câmbio do dia. Inclui a prata (preço de recompra, já sem as taxas em gramas) e a P2P. Dá aos gráficos de Desempenho, à rentabilidade e à queda máxima o histórico completo."
    >
      <Button onClick={() => void run()} loading={running}>
        Reconstruir histórico
      </Button>
      {summary && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
