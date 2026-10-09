import { describe, expect, it } from "vitest";
import {
  calibrateMonthlyRate,
  classifyCashType,
  maturityDateFor,
  parseRoundKey,
  parseScrambleCsv,
  paymentDateFor,
  planScrambleImport,
  scramblePassiveIncome,
  scrambleSummary,
} from "./scramble";

const HEADER = [
  '"A Scramble OÜ está registada no Registo Comercial da Estónia sob o número de registo 14991448."',
  "",
];

const CASH_CSV = [
  ...HEADER,
  "Movimentos de caixa",
  "Titular da conta,Investidor Teste",
  "País de residência,Portugal",
  "ID do usuário,L000000",
  "Período,01.01.2026 – 09.10.2026",
  "",
  "Gerado em: 2026-10-09 17:36 UTC",
  "",
  "Saldo inicial em 01 Jan 2026: €0.00",
  "",
  "Data,Tipo,Descrição,Montante (€),Saldo (€)",
  "05.10.2026,Juros recebidos,Taxa de sucesso do investidor recebida,5.80,143.88",
  "05.10.2026,Juros aumentados recebidos,Taxa de sucesso do investidor aumentada recebida,0.22,138.09",
  "05.10.2026,Reembolso do principal,Principal recebido,108.87,137.87",
  "17.09.2026,Bônus não monetário recebido,Bônus não monetário recebido,1.20,28.99",
  "17.09.2026,Direitos de cessão de créditos adquiridos,Valor do crédito adquirido,-101.00,27.79",
  "07.09.2026,Reembolso do principal,Principal recebido,27.79,128.79",
  "31.08.2026,Depósito do investidor,Recarga de fundos,100.00,101.00",
  "18.08.2026,Bônus não monetário recebido,Bônus não monetário recebido,1.00,1.00",
  "18.08.2026,Direitos de cessão de créditos adquiridos,Valor do crédito adquirido,-140.82,0.00",
  "05.08.2026,Reembolso do principal,Principal recebido,22.86,140.82",
  "27.07.2026,Depósito do investidor,Recarga de fundos,100.00,117.97",
  "17.07.2026,Bônus não monetário recebido,Bônus não monetário recebido,1.00,17.97",
  "17.07.2026,Direitos de cessão de créditos adquiridos,Valor do crédito adquirido,-111.54,16.97",
  "06.07.2026,Reembolso do principal,Principal recebido,16.96,128.51",
  "29.06.2026,Depósito do investidor,Recarga de fundos,100.00,111.55",
  "17.06.2026,Bônus não monetário recebido,Bônus não monetário recebido,0.60,11.55",
  "17.06.2026,Direitos de cessão de créditos adquiridos,Valor do crédito adquirido,-106.72,10.95",
  "05.06.2026,Reembolso do principal,Principal recebido,10.94,117.67",
  "01.06.2026,Depósito do investidor,Recarga de fundos,100.00,106.73",
  "18.05.2026,Bônus não monetário recebido,Bônus não monetário recebido,1.00,6.73",
  "18.05.2026,Direitos de cessão de créditos adquiridos,Valor do crédito adquirido,-110.00,5.73",
  "05.05.2026,Reembolso do principal,Principal recebido,5.73,115.73",
  "29.04.2026,Depósito do investidor,Recarga de fundos,100.00,110.00",
  "25.04.2026,Bônus não monetário recebido,Bônus não monetário recebido,5.00,10.00",
  "17.04.2026,Bônus não monetário recebido,Bônus não monetário recebido,5.00,5.00",
  "17.04.2026,Direitos de cessão de créditos adquiridos,Valor do crédito adquirido,-110.00,0.00",
  "07.04.2026,Depósito do investidor,Recarga de fundos,100.00,110.00",
  "14.03.2026,Bônus não monetário recebido,Bônus não monetário recebido,10.00,10.00",
  "",
].join("\r\n");

const PORTFOLIO_CSV = [
  ...HEADER,
  "Movimentos do portefólio",
  "Titular da conta,Investidor Teste",
  "Período,01.01.2026 – 09.10.2026",
  "",
  "Data,Ronda,Capital inicial (€),Investido (€),Capital reembolsado (€),Juros recebidos (€),Capital final (€)",
  "05.10.2026,September 2026,491.21,0.00,4.28,0.00,486.93",
  "05.10.2026,August 2026,498.04,0.00,6.82,0.00,491.21",
  "05.10.2026,July 2026,504.16,0.00,6.12,0.00,498.04",
  "05.10.2026,June 2026,509.23,0.00,5.07,0.00,504.16",
  "05.10.2026,May 2026,514.44,0.00,5.21,0.00,509.23",
  "05.10.2026,April 2026,595.81,0.00,81.36,6.02,514.44",
  "07.09.2026,September 2026,494.81,101.00,0.00,0.00,595.81",
  "07.09.2026,August 2026,501.16,0.00,6.36,0.00,494.81",
  "07.09.2026,July 2026,505.64,0.00,4.48,0.00,501.16",
  "07.09.2026,June 2026,511.66,0.00,6.01,0.00,505.64",
  "07.09.2026,May 2026,516.87,0.00,5.21,0.00,511.66",
  "07.09.2026,April 2026,522.60,0.00,5.73,0.00,516.87",
  "05.08.2026,August 2026,381.78,140.82,0.00,0.00,522.60",
  "05.08.2026,July 2026,387.68,0.00,5.90,0.00,381.78",
  "05.08.2026,June 2026,393.69,0.00,6.01,0.00,387.68",
  "05.08.2026,May 2026,398.91,0.00,5.21,0.00,393.69",
  "05.08.2026,April 2026,404.63,0.00,5.73,0.00,398.91",
  "06.07.2026,June 2026,410.65,0.00,6.01,0.00,404.63",
  "06.07.2026,May 2026,415.86,0.00,5.21,0.00,410.65",
  "06.07.2026,April 2026,421.59,0.00,5.73,0.00,415.86",
  "01.07.2026,July 2026,310.05,111.54,0.00,0.00,421.59",
  "05.06.2026,May 2026,315.26,0.00,5.21,0.00,310.05",
  "05.06.2026,April 2026,320.99,0.00,5.73,0.00,315.26",
  "02.06.2026,June 2026,214.27,106.72,0.00,0.00,320.99",
  "05.05.2026,April 2026,220.00,0.00,5.73,0.00,214.27",
  "01.05.2026,May 2026,110.00,110.00,0.00,0.00,220.00",
  "07.04.2026,April 2026,0.00,110.00,0.00,0.00,110.00",
].join("\n");

const TODAY = "2026-10-09";

describe("leitura dos CSV", () => {
  it("lê movimentos de caixa com período e tipos", () => {
    const p = parseScrambleCsv(CASH_CSV);
    expect(p.errors).toEqual([]);
    expect(p.kind).toBe("cash");
    expect(p.period).toEqual({ from: "2026-01-01", to: "2026-10-09" });
    expect(p.cash).toHaveLength(28);
    expect(p.cash[0]).toMatchObject({ date: "2026-10-05", type: "interest", amount: 5.8 });
    expect(p.cash[1]!.type).toBe("interest_increased");
    expect(p.cash[2]!.type).toBe("principal");
    expect(p.cash[3]!.type).toBe("bonus_noncash");
    expect(p.cash[4]).toMatchObject({ type: "purchase", amount: -101 });
    expect(p.cash[6]!.type).toBe("deposit");
    // seq cronológico: a primeira linha (mais recente) tem o maior seq.
    expect(p.cash[0]!.seq).toBe(27);
    expect(p.cash[27]!.seq).toBe(0);
  });

  it("lê movimentos do portefólio por ronda", () => {
    const p = parseScrambleCsv(PORTFOLIO_CSV);
    expect(p.errors).toEqual([]);
    expect(p.kind).toBe("portfolio");
    expect(p.rounds).toHaveLength(27);
    expect(p.rounds[5]).toMatchObject({
      date: "2026-10-05",
      roundKey: "2026-04",
      principalRepaid: 81.36,
      interestReceived: 6.02,
    });
  });

  it("recusa ficheiros que não são da Scramble", () => {
    const p = parseScrambleCsv("ID;Type;Time;Symbol;Comment;Amount\n1;Deposit;x;;;1");
    expect(p.errors.length).toBeGreaterThan(0);
  });

  it("classifica rótulos em PT e EN", () => {
    expect(classifyCashType("Levantamento de fundos")).toBe("withdrawal");
    expect(classifyCashType("Investor withdrawal")).toBe("withdrawal");
    expect(classifyCashType("Interest received")).toBe("interest");
    expect(classifyCashType("Bónus monetário recebido")).toBe("bonus_cash");
    expect(classifyCashType("Taxa de serviço Scramble")).toBe("fee");
  });

  it("converte nomes de ronda", () => {
    expect(parseRoundKey("September 2026")).toBe("2026-09");
    expect(parseRoundKey("março 2026")).toBe("2026-03");
    expect(parseRoundKey("2026-11")).toBe("2026-11");
    expect(parseRoundKey("Ronda X")).toBeNull();
  });
});

describe("calendário", () => {
  it("paga ao dia 5 ou no dia útil seguinte", () => {
    expect(paymentDateFor("2026-10")).toBe("2026-10-05"); // segunda
    expect(paymentDateFor("2026-09")).toBe("2026-09-07"); // 5 = sábado
    expect(paymentDateFor("2026-07")).toBe("2026-07-06"); // 5 = domingo
  });
  it("a ronda de abril vence em outubro", () => {
    expect(maturityDateFor("2026-04")).toBe("2026-10-05");
    expect(maturityDateFor("2026-09")).toBe("2027-03-05");
  });
});

describe("resumo da conta", () => {
  const cash = parseScrambleCsv(CASH_CSV).cash;
  const rounds = parseScrambleCsv(PORTFOLIO_CSV).rounds;
  const s = scrambleSummary({ cash, rounds, today: TODAY });

  it("bate com o painel da Scramble", () => {
    expect(s.outstanding).toBeCloseTo(486.93, 2);
    expect(s.cash).toBeCloseTo(143.88, 2);
    expect(s.totalValue).toBeCloseTo(630.81, 2);
    expect(s.investedTotal).toBeCloseTo(680.08, 2);
    expect(s.interestReceived).toBeCloseTo(6.02, 2);
    expect(s.bonusReceived).toBeCloseTo(24.8, 2);
    expect(s.deposits).toBe(600);
    expect(s.netDeposits).toBe(600);
  });

  it("valor total = depósitos + juros + bónus (sem comissões)", () => {
    expect(s.totalValue).toBeCloseTo(s.netDeposits + s.gain, 1);
  });

  it("calibra a taxa mensal na ronda vencida", () => {
    const rate = calibrateMonthlyRate(rounds)!;
    // abril: 6,02 € sobre 110+104,27+98,54+92,81+87,08+81,35 = 574,05 €·mês
    expect(rate).toBeCloseTo(6.02 / 574.05, 5);
    expect(s.monthlyRateSource).toBe("history");
  });

  it("estima os juros corridos perto dos 16,84 € da Scramble", () => {
    expect(s.interestAccrued).toBeGreaterThan(15.5);
    expect(s.interestAccrued).toBeLessThan(18);
  });

  it("marca abril como vencida e as outras como ativas", () => {
    const april = s.rounds.find((r) => r.roundKey === "2026-04")!;
    expect(april.status).toBe("matured");
    expect(april.outstanding).toBe(0);
    expect(april.paymentsMade).toBe(6);
    expect(s.activeRounds).toBe(5);
    const sep = s.rounds.find((r) => r.roundKey === "2026-09")!;
    expect(sep.status).toBe("active");
    expect(sep.outstanding).toBeCloseTo(96.72, 2);
    expect(sep.maturityDate).toBe("2027-03-05");
  });

  it("projeta o calendário até ao vencimento com o capital todo", () => {
    for (const r of s.rounds) {
      const principal = r.schedule.reduce((sum, p) => sum + p.principal, 0);
      expect(principal).toBeCloseTo(r.invested, 1);
      expect(r.schedule).toHaveLength(6);
      // Os juros só caem no último mês.
      expect(r.schedule.slice(0, 5).every((p) => p.interest === 0)).toBe(true);
    }
    const may = s.rounds.find((r) => r.roundKey === "2026-05")!;
    const last = may.schedule[5]!;
    expect(last.date).toBe("2026-11-05");
    expect(last.paid).toBe(false);
    expect(last.interest).toBeGreaterThan(4);
  });

  it("agrupa os próximos pagamentos por data", () => {
    expect(s.upcoming[0]!.date).toBe("2026-11-05");
    expect(s.upcoming[0]!.rounds).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(s.upcoming[0]!.interest).toBeGreaterThan(0);
  });

  it("rendimento por mês e por ano", () => {
    expect(s.interestByMonth).toEqual([{ key: "2026-10", amount: 6.02 }]);
    expect(s.interestByYear).toEqual([{ year: "2026", interest: 6.02, bonus: 24.8 }]);
  });

  it("calcula o XIRR do dinheiro depositado", () => {
    expect(s.xirrPct).not.toBeNull();
    expect(s.xirrPct!).toBeGreaterThan(5);
  });

  it("sem rondas vencidas usa a taxa base", () => {
    const early = rounds.filter((r) => r.date < "2026-10-01");
    const e = scrambleSummary({ cash: [], rounds: early, today: "2026-09-10" });
    expect(e.monthlyRateSource).toBe("default");
    expect(e.monthlyRate).toBe(0.0075);
  });
});

describe("plano de importação", () => {
  it("resume o ficheiro e o que substitui", () => {
    const plan = planScrambleImport(parseScrambleCsv(CASH_CSV), 3)!;
    expect(plan).toMatchObject({ kind: "cash", rows: 28, replaced: 3 });
    expect(plan.summary).toMatchObject({ deposits: 600, interest: 6.02, bonus: 24.8 });
    const p2 = planScrambleImport(parseScrambleCsv(PORTFOLIO_CSV), 0)!;
    expect(p2.summary.rounds).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(p2.summary.invested).toBeCloseTo(680.08, 2);
  });
  it("não planeia com erros", () => {
    expect(planScrambleImport(parseScrambleCsv("lixo"), 0)).toBeNull();
  });
});

describe("rendimento passivo", () => {
  const cash = parseScrambleCsv(CASH_CSV).cash;
  const rounds = parseScrambleCsv(PORTFOLIO_CSV).rounds;
  const summary = scrambleSummary({ cash, rounds, today: TODAY });
  const out = scramblePassiveIncome({ asset: { id: "s", name: "Scramble" }, summary, cash }, TODAY);

  it("só os juros contam como rendimento recebido", () => {
    expect(out.records.map((r) => [r.paid_at, r.amount])).toEqual([
      ["2026-10-05", 5.8],
      ["2026-10-05", 0.22],
    ]);
  });

  it("prevê os juros de cada ronda no vencimento", () => {
    expect(out.upcoming.map((u) => u.paymentDate)).toEqual([
      "2026-11-05",
      "2026-12-07",
      "2027-01-05",
      "2027-02-05",
      "2027-03-05",
    ]);
    expect(out.upcoming.every((u) => u.net > 0)).toBe(true);
  });

  it("sem conta não há nada", () => {
    expect(scramblePassiveIncome(null, TODAY)).toEqual({ records: [], upcoming: [] });
  });
});
