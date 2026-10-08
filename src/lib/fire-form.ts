import { parseNumberPt } from "@/lib/format";

/** Valores do formulário FIRE, tal como escritos (texto, vírgula decimal). */
export interface FireForm {
  annualExpenses: string;
  safeWithdrawalRate: string;
  monthlyContribution: string;
  expectedReturnPct: string;
  inflationPct: string;
}

export type FireErrors = Partial<Record<keyof FireForm, string>>;

export const FIRE_DEFAULTS: FireForm = {
  annualExpenses: "",
  safeWithdrawalRate: "4",
  monthlyContribution: "0",
  expectedReturnPct: "5",
  inflationPct: "2",
};

/**
 * Validação em tempo real, com as mesmas regras do servidor (`saveFireSettings`)
 * e mensagens em PT-PT. Devolve só os campos com erro.
 */
export function validateFire(f: FireForm): FireErrors {
  const e: FireErrors = {};
  const n = (s: string) => parseNumberPt(s);
  if (!(n(f.annualExpenses) > 0)) e.annualExpenses = "Indica as despesas anuais (maiores que 0).";
  const swr = n(f.safeWithdrawalRate);
  if (!(swr > 0 && swr <= 10))
    e.safeWithdrawalRate = "Usa um valor entre 0 e 10 (a regra comum é 4).";
  if (!(n(f.monthlyContribution) >= 0)) e.monthlyContribution = "O aporte não pode ser negativo.";
  const ret = n(f.expectedReturnPct);
  if (!(ret > -50 && ret < 50)) e.expectedReturnPct = "Usa um valor entre -50 e 50.";
  const inf = n(f.inflationPct);
  if (!(inf > -10 && inf < 30)) e.inflationPct = "Usa um valor entre -10 e 30.";
  return e;
}
