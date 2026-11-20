/** Partes puras da interface do assistente (sugestões por página, histórico a enviar). */
import type { ChatTurn } from "@/lib/assistant-data";

export interface PanelMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Resposta de erro: mostra-se, mas nunca entra no histórico enviado ao servidor. */
  error?: boolean;
}

const GENERAL = [
  "Qual o valor total da carteira e como está distribuída?",
  "Quanto recebi em dividendos este ano?",
  "Quais as minhas maiores posições?",
];

const BY_PAGE: Array<[prefix: string, suggestions: string[]]> = [
  [
    "/metais",
    [
      "Quantos gramas tenho e quanto paguei de custódia até agora?",
      "Qual o valor ao spot e à recompra?",
      "Quanto do resultado se deve ao ágio e ao armazenamento?",
    ],
  ],
  [
    "/dividendos",
    [
      "Quanto recebi em dividendos este ano?",
      "Que ativos pagaram mais dividendos?",
      "Quanto vou receber nos próximos 12 meses?",
    ],
  ],
  [
    "/exposicao",
    [
      "Qual a minha exposição por país?",
      "Quais as empresas a que estou mais exposto, contando os ETFs?",
      "Quanto da carteira está em dólares?",
    ],
  ],
  [
    "/irs",
    [
      "Que mais-valias realizei este ano?",
      "Quanto recebi em dividendos brutos e que imposto foi retido?",
    ],
  ],
  [
    "/performance",
    ["Como evoluiu o valor da carteira no último ano?", "Quais os melhores e piores ativos?"],
  ],
  ["/etfs", ["Quanto tenho em ETFs e quais pesam mais?", "Qual a exposição por setor?"]],
  [
    "/calendario",
    ["Que dividendos esperam-se nos próximos 3 meses?", "Quais os próximos pagamentos?"],
  ],
];

export function suggestionsFor(pathname: string): string[] {
  const hit = BY_PAGE.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : GENERAL;
}

/** Últimas trocas completas e válidas, no formato esperado pelo servidor. */
export function historyToSend(messages: PanelMessage[], maxMessages = 16): ChatTurn[] {
  return messages
    .filter((m) => !m.error)
    .slice(-maxMessages)
    .map((m) => ({ role: m.role, content: m.content }));
}
