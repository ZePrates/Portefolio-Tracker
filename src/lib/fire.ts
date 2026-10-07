/**
 * Progresso FIRE (independência financeira) — lógica pura.
 * Tudo em euros de hoje: o retorno usado na projeção é o retorno REAL
 * (nominal descontado da inflação), por isso o "número FIRE" não precisa de
 * ser inflacionado.
 */

export interface FireSettings {
  /** Despesas anuais atuais (EUR). */
  annualExpenses: number;
  /** Taxa de levantamento segura, em % (ex.: 4 → regra dos 25×). */
  safeWithdrawalRate: number;
  /** Aporte mensal (EUR de hoje). */
  monthlyContribution: number;
  /** Retorno nominal anual esperado, em %. */
  expectedReturnPct: number;
  /** Inflação anual esperada, em %. */
  inflationPct: number;
}

export interface FireProgress {
  /** Capital necessário: despesas ÷ taxa de levantamento. */
  fireNumber: number;
  progressPct: number;
  remaining: number;
  /** Rendimento passivo (dividendos 12 m) ÷ despesas, em %. */
  passiveCoveragePct: number;
  /** Retorno real anual usado na projeção, em %. */
  realReturnPct: number;
  /** Anos até atingir o número FIRE (null se não for atingível em 100 anos). */
  yearsToFire: number | null;
  /** Mês estimado (YYYY-MM). */
  fireMonth: string | null;
}

const MAX_MONTHS = 100 * 12;

export function fireProgress(
  settings: FireSettings,
  portfolioValue: number,
  annualPassiveIncome: number,
  today: string,
): FireProgress {
  const swr = settings.safeWithdrawalRate / 100;
  const fireNumber = swr > 0 ? settings.annualExpenses / swr : Number.POSITIVE_INFINITY;
  const value = Math.max(0, portfolioValue);
  const realAnnual = (1 + settings.expectedReturnPct / 100) / (1 + settings.inflationPct / 100) - 1;
  const monthlyRate = Math.pow(1 + realAnnual, 1 / 12) - 1;

  let months: number | null = null;
  if (value >= fireNumber) months = 0;
  else {
    let v = value;
    for (let m = 1; m <= MAX_MONTHS; m++) {
      v = v * (1 + monthlyRate) + Math.max(0, settings.monthlyContribution);
      if (v >= fireNumber) {
        months = m;
        break;
      }
    }
  }

  let fireMonth: string | null = null;
  if (months != null) {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    fireMonth = d.toISOString().slice(0, 7);
  }

  return {
    fireNumber,
    progressPct: Number.isFinite(fireNumber) && fireNumber > 0 ? (value / fireNumber) * 100 : 0,
    remaining: Number.isFinite(fireNumber)
      ? Math.max(0, fireNumber - value)
      : Number.POSITIVE_INFINITY,
    passiveCoveragePct:
      settings.annualExpenses > 0
        ? (Math.max(0, annualPassiveIncome) / settings.annualExpenses) * 100
        : 0,
    realReturnPct: realAnnual * 100,
    yearsToFire: months == null ? null : Math.round((months / 12) * 10) / 10,
    fireMonth,
  };
}
