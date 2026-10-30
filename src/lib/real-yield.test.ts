import { describe, expect, it } from "vitest";
import {
  classifyEvents,
  netYield,
  paymentEvents,
  realYield,
  yieldOnCost,
  type DividendLine,
} from "@/lib/real-yield";

const TODAY = "2026-10-30";

/** Uma linha XTB "consolidada" (com ex-date) por pagamento. */
const ex = (exDate: string, paid: string, dps: number): DividendLine => ({
  ex_date: exDate,
  payment_date: paid,
  paid_at: paid,
  per_share_native: dps,
  status: "received",
  source: "xtb",
});
/** Linha de lote sem ex-date (a XTB parte o pagamento por lote). */
const lot = (paid: string, dps: number): DividendLine => ({
  ex_date: null,
  payment_date: paid,
  paid_at: paid,
  per_share_native: dps,
  status: "received",
  source: "xtb",
});

/** HST real (BD, out/2026): 0,20 $ regular; especiais em dez/25 (0,15) e jun/26 (0,72). */
const HST: DividendLine[] = [
  ex("2025-03-31", "2025-04-15", 0.2),
  ex("2025-06-30", "2025-07-15", 0.2),
  ex("2025-09-30", "2025-10-15", 0.2),
  lot("2026-01-15", 0.15),
  lot("2026-01-15", 0.15),
  lot("2026-01-15", 0.2),
  ex("2025-12-31", "2026-01-15", 0.35),
  lot("2026-04-15", 0.2),
  ex("2026-03-31", "2026-04-15", 0.2),
  lot("2026-07-15", 0.2),
  lot("2026-07-15", 0.2),
  lot("2026-07-15", 0.72),
  ex("2026-06-30", "2026-07-15", 0.92),
  ex("2026-09-30", "2026-10-15", 0.2),
];

describe("paymentEvents", () => {
  it("um evento por pagamento, com o total da linha com ex-date", () => {
    const e = paymentEvents(HST);
    expect(e.map((x) => x.dps)).toEqual([0.2, 0.2, 0.2, 0.35, 0.2, 0.92, 0.2]);
    expect(e[3]!.date).toBe("2025-12-31");
  });

  it("sem linha com ex-date usa o maior valor por ação do pagamento", () => {
    expect(paymentEvents([lot("2026-06-04", 0.4), lot("2026-06-04", 0.4)])).toEqual([
      { date: "2026-06-04", dps: 0.4 },
    ]);
  });

  it("conta o anunciado com ex-date já passada e ainda por pagar (MAA), sem duplicar", () => {
    const lines: DividendLine[] = [
      ex("2026-04-15", "2026-04-30", 1.53),
      ex("2026-07-15", "2026-07-31", 1.53),
      {
        ex_date: "2026-10-15",
        payment_date: "2026-10-31",
        paid_at: "2026-10-31",
        per_share_native: 1.53,
        status: "scheduled",
        source: "yahoo",
      },
      // Previsto do Yahoo para um pagamento já registado pela XTB: ignorado.
      {
        ex_date: "2026-07-14",
        payment_date: "2026-07-31",
        paid_at: "2026-07-31",
        per_share_native: 1.53,
        status: "scheduled",
        source: "yahoo",
      },
      // Ex-date ainda no futuro: ignorado.
      {
        ex_date: "2027-01-15",
        payment_date: "2027-01-31",
        paid_at: "2027-01-31",
        per_share_native: 1.53,
        status: "scheduled",
        source: "yahoo",
      },
    ];
    expect(paymentEvents(lines, "2026-10-30").map((e) => e.date)).toEqual([
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
    expect(paymentEvents(lines).map((e) => e.date)).toEqual(["2026-04-15", "2026-07-15"]);
  });

  it("ignora previstos e, havendo XTB, as linhas do Yahoo", () => {
    const e = paymentEvents([
      ex("2026-09-30", "2026-10-15", 0.2),
      { ...ex("2026-12-31", "2027-01-15", 0.2), status: "scheduled" },
      { ...ex("2026-09-29", "2026-10-15", 0.2), source: "yahoo", payment_date: "2026-10-14" },
    ]);
    expect(e).toHaveLength(1);
  });
});

describe("realYield — HST (dividendos especiais)", () => {
  const r = realYield(HST, 25.7, TODAY)!;

  it("o yield atual usa só o regular: 0,20 × 4 ÷ 25,70 = 3,1%", () => {
    expect(r.paymentsPerYear).toBe(4);
    expect(r.frequency).toBe("Trimestral");
    expect(r.forwardDps).toBeCloseTo(0.8, 6);
    expect(r.forwardPct).toBeCloseTo(3.11, 2);
  });

  it("os 12 meses incluem os especiais: 0,35 + 0,20 + 0,92 + 0,20 = 1,67 → 6,5%", () => {
    expect(r.ttmDps).toBeCloseTo(1.67, 6);
    expect(r.ttmPct).toBeCloseTo(6.5, 1);
    expect(r.ttmSpecialDps).toBeCloseTo(0.87, 6);
    expect(r.ttmPartial).toBe(false);
  });
});

describe("realYield — mudança de frequência e cortes", () => {
  it("STAG: mensal 0,124 → trimestral 0,388 não é tratado como especial", () => {
    const lines = [
      ...[
        "2025-05-30",
        "2025-06-30",
        "2025-07-31",
        "2025-08-29",
        "2025-09-30",
        "2025-10-31",
        "2025-11-28",
        "2025-12-31",
      ].map((d) => ex(d, d, 0.124)),
      ex("2026-03-31", "2026-04-15", 0.388),
      ex("2026-06-30", "2026-07-15", 0.388),
      ex("2026-09-30", "2026-10-15", 0.388),
    ];
    const r = realYield(lines, 37.27, TODAY)!;
    expect(r.frequency).toBe("Trimestral");
    expect(r.events.every((e) => e.special === 0)).toBe(true);
    expect(r.forwardDps).toBeCloseTo(1.552, 6);
    expect(r.forwardPct).toBeCloseTo(4.16, 2);
  });

  it("ARE: corte de 1,32 para 0,72 reflete-se logo no yield atual", () => {
    const lines = [
      ex("2025-06-30", "2025-07-15", 1.32),
      ex("2025-09-30", "2025-10-15", 1.32),
      ex("2025-12-31", "2026-01-15", 0.72),
      ex("2026-03-31", "2026-04-15", 0.72),
      ex("2026-06-30", "2026-07-15", 0.72),
      ex("2026-09-30", "2026-10-15", 0.72),
    ];
    const r = realYield(lines, 40.6, TODAY)!;
    expect(r.forwardPct).toBeCloseTo(7.09, 2);
  });

  it("Novo Nordisk: semestral desigual (final + intercalar) soma o último ano", () => {
    const lines = [
      ex("2025-03-28", "2025-04-10", 1.2),
      ex("2025-08-15", "2025-08-25", 0.55),
      ex("2026-03-30", "2026-04-13", 1.275),
      ex("2026-08-17", "2026-08-25", 0.579),
    ];
    const r = realYield(lines, 39.14, TODAY)!;
    expect(r.paymentsPerYear).toBe(2);
    expect(r.forwardDps).toBeCloseTo(1.854, 6);
    expect(r.forwardPct).toBeCloseTo(4.74, 2);
  });
});

describe("realYield — quando não há dados fiáveis devolve null", () => {
  it("menos de 3 pagamentos", () => {
    expect(
      realYield(
        [ex("2026-03-30", "2026-04-13", 1.275), ex("2026-08-17", "2026-08-25", 0.579)],
        39,
        TODAY,
      ),
    ).toBeNull();
  });

  it("último pagamento demasiado antigo (importação em atraso ou dividendo suspenso)", () => {
    const old = ["2025-01-31", "2025-04-30", "2025-07-31"].map((d) => ex(d, d, 0.5));
    expect(realYield(old, 20, TODAY)).toBeNull();
  });

  it("sem cotação", () => {
    expect(realYield(HST, 0, TODAY)).toBeNull();
  });

  it("posição com menos de um ano: 12 meses marcado como parcial", () => {
    const r = realYield(
      ["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-15"].map((d) => ex(d, d, 0.5)),
      20,
      TODAY,
    )!;
    expect(r.ttmPartial).toBe(true);
  });
});

describe("classifyEvents", () => {
  it("só marca especial com pelo menos 3 pagamentos de referência", () => {
    const e = classifyEvents(
      [
        { date: "2026-03-31", dps: 0.2 },
        { date: "2026-06-30", dps: 0.9 },
      ],
      4,
    );
    expect(e.every((x) => x.special === 0)).toBe(true);
  });
});

describe("yield sobre o custo e líquido", () => {
  it("dividendo anual em EUR ÷ preço médio pago", () => {
    // 0,80 $ × 0,895 €/$ ÷ 14,64 € = 4,9%
    expect(yieldOnCost(0.8, 0.895, 14.64)).toBeCloseTo(4.89, 2);
    expect(yieldOnCost(0.8, 0.895, 0)).toBeNull();
  });

  it("líquido em Portugal: a carga é a maior entre 28% e a retenção estrangeira", () => {
    expect(netYield(4, 0.15)).toBeCloseTo(2.88, 6); // EUA: 4% × 0,72
    expect(netYield(4, 0)).toBeCloseTo(2.88, 6); // ETF irlandês
    expect(netYield(4, 0.35)).toBeCloseTo(2.6, 6); // Suíça 35%: fica a retenção
  });
});
