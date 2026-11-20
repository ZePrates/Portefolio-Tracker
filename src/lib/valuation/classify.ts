/**
 * Tipo de empresa: decide que modelos de avaliação se aplicam e com que peso.
 * Uma empresa madura avalia-se sobretudo pelos fluxos de caixa; uma em
 * crescimento pelo futuro (DCF e múltiplos de vendas); uma cíclica pela média
 * do ciclo; um banco pelo capital próprio e pelos dividendos; um REIT pelo FFO.
 */

import { formatPct } from "@/lib/format";
import type { CompanyData } from "@/lib/valuation/types";
import { at, isNum, seriesCagr } from "@/lib/valuation/stats";

export type ProfileType = "madura" | "crescimento" | "ciclica" | "financeira" | "reit";

export const PROFILE_LABELS: Record<ProfileType, string> = {
  madura: "Madura",
  crescimento: "Em crescimento",
  ciclica: "Cíclica",
  financeira: "Banco / financeira",
  reit: "REIT",
};

export const PROFILE_DESCRIPTIONS: Record<ProfileType, string> = {
  madura:
    "Negócio estável: o valor vem sobretudo dos fluxos de caixa atuais e do valor terminal, que depende do WACC e do crescimento perpétuo.",
  crescimento:
    "Receita a crescer depressa: o valor está no futuro, por isso pesam o DCF e os múltiplos de vendas; os dividendos quase não contam.",
  ciclica:
    "Lucros que sobem e descem com a economia: a grande dúvida é a margem média do ciclo, por isso usa-se a média de vários anos e múltiplos de EBITDA e de vendas.",
  financeira:
    "Banco, seguradora ou financeira: a dívida é matéria-prima e não financiamento, por isso não se usam EBIT nem WACC; avalia-se pelo capital próprio (P/VC justificado) e pelos dividendos.",
  reit: "Sociedade de investimento imobiliário: o lucro contabilístico é deprimido pelas amortizações, por isso usa-se o FFO/AFFO, o valor dos imóveis (NAV) e os dividendos.",
};

export interface Classification {
  type: ProfileType;
  /** Motivos, em linguagem simples. */
  reasons: string[];
  revenueCagr: number | null;
}

const CYCLICAL_SECTORS = new Set(["energy", "basic materials"]);
const CYCLICAL_INDUSTRY =
  /auto manufacturers|auto parts|steel|aluminum|copper|chemicals|airlines|oil|gas|mining|residential construction|homebuild|machinery|marine shipping|trucking|metal fabrication|lumber|paper|building materials|travel|lodging|resorts|cruise|recreational|semiconductor equipment|coal|uranium/;
/** Sempre financeiras: a dívida (ou as reservas) é a matéria-prima do negócio. */
const FINANCIAL_ALWAYS = /bank|insurance|mortgage finance|shell companies/;
/**
 * Financeiras só quando as contas têm estrutura de banco (sem resultado
 * operacional ou sem ativo corrente). Visa, Mastercard, bolsas e fornecedores
 * de dados financeiros são empresas operacionais e avaliam-se pelo DCF.
 */
const FINANCIAL_IF_NO_OPERATIONS =
  /credit services|capital markets|asset management|financial conglomerates|stock exchanges|financial data/;

export function classifyCompany(data: CompanyData): Classification {
  const sector = (data.profile.sector ?? "").toLowerCase();
  const industry = (data.profile.industry ?? "").toLowerCase().replace(/[—–]/g, "-");
  const s = data.statements;
  const revenueCagr = seriesCagr(s.revenue);
  const reasons: string[] = [];

  if (/reit/.test(industry)) {
    reasons.push(`Indústria «${data.profile.industry}»: é um REIT.`);
    return { type: "reit", reasons, revenueCagr };
  }

  const noOperatingLines = at(s.operatingIncome) == null || at(s.currentAssets) == null;
  if (
    FINANCIAL_ALWAYS.test(industry) ||
    (FINANCIAL_IF_NO_OPERATIONS.test(industry) && noOperatingLines) ||
    (sector === "financial services" && noOperatingLines)
  ) {
    reasons.push(
      `Setor financeiro («${data.profile.industry ?? data.profile.sector}»): a dívida faz parte do negócio.`,
    );
    return { type: "financeira", reasons, revenueCagr };
  }

  const nextYear = data.analysts.revenueGrowthNextYear;
  const fastHistory = isNum(revenueCagr) && revenueCagr >= 0.15;
  const fastForecast = isNum(nextYear) && nextYear >= 0.15 && (revenueCagr ?? 0) >= 0.08;
  if (fastHistory || fastForecast) {
    if (fastHistory)
      reasons.push(`Receita a crescer ${pctText(revenueCagr!)} ao ano nos últimos anos.`);
    if (fastForecast)
      reasons.push(`Os analistas esperam ${pctText(nextYear!)} de crescimento no próximo ano.`);
    return { type: "crescimento", reasons, revenueCagr };
  }

  if (CYCLICAL_SECTORS.has(sector) || CYCLICAL_INDUSTRY.test(industry)) {
    reasons.push(
      `«${data.profile.industry ?? data.profile.sector}» é um negócio cíclico: os lucros acompanham a economia.`,
    );
    return { type: "ciclica", reasons, revenueCagr };
  }

  reasons.push(
    isNum(revenueCagr)
      ? `Crescimento moderado da receita (${pctText(revenueCagr)} ao ano) num negócio estável.`
      : "Negócio estável, sem sinais de crescimento rápido nem de ciclo.",
  );
  return { type: "madura", reasons, revenueCagr };
}

function pctText(v: number): string {
  return formatPct(v * 100);
}
