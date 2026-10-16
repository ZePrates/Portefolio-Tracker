import { describe, expect, it } from "vitest";
import {
  closeReminderMonth,
  closeWindowOpen,
  defaultCloseMonth,
  monthClose,
  monthCloseAlert,
  shiftMonth,
  type MonthCloseInput,
} from "./month-close";

const assets: MonthCloseInput["assets"] = [
  { id: "vwce", name: "Vanguard All-World", ticker: "VWCE", class: "etf" },
  { id: "o", name: "Realty Income", ticker: "O", class: "reit" },
  { id: "ag", name: "Prata", ticker: null, class: "metal" },
  { id: "scr", name: "Scramble", ticker: null, class: "p2p" },
];

const div = (over: Partial<MonthCloseInput["dividends"][number]>) => ({
  asset_id: "o",
  asset_name: "Realty Income",
  payment_date: "2026-09-15",
  paid_at: "2026-09-15",
  source: "xtb",
  payment_date_estimated: false,
  net_amount: 0.8,
  amount: 0.94,
  ...over,
});

const base: MonthCloseInput = {
  month: "2026-09",
  today: "2026-10-15",
  assets,
  transactions: [],
  dividends: [],
  p2pMovements: [],
};

describe("monthClose", () => {
  it("mês fechado: tudo veio do extrato, Elementum e Scramble confirmadas", () => {
    const r = monthClose({
      ...base,
      confirmed: ["elementum", "scramble"],
      transactions: [
        { asset_id: "vwce", type: "buy", traded_at: "2026-09-03", source: "xtb", fee: 0 },
        { asset_id: "ag", type: "buy", traded_at: "2026-09-10", source: "elementum", fee: 1.2 },
      ],
      dividends: [div({})],
      p2pMovements: [{ occurred_on: "2026-09-20", type: "purchase" }],
    });
    expect(r.steps.map((s) => [s.key, s.done])).toEqual([
      ["xtb", true],
      ["dividends", true],
      ["elementum", true],
      ["scramble", true],
    ]);
    expect(r.doneCount).toBe(4);
    expect(r.dividendsNet).toBeCloseTo(0.8);
  });

  it("lista movimentos à mão e dividendos estimados por confirmar", () => {
    const r = monthClose({
      ...base,
      transactions: [
        { asset_id: "vwce", type: "buy", traded_at: "2026-09-21", source: "manual", fee: 0 },
        // Mês seguinte: não conta.
        { asset_id: "vwce", type: "buy", traded_at: "2026-10-01", source: "manual", fee: 0 },
      ],
      dividends: [
        div({ source: "yahoo", payment_date: "2026-09-30", payment_date_estimated: true }),
        // Ainda não pago: não conta.
        div({ source: "yahoo", payment_date: "2026-10-30", paid_at: null }),
      ],
    });
    const xtb = r.steps.find((s) => s.key === "xtb")!;
    expect(xtb.done).toBe(false);
    expect(xtb.pending).toEqual(["VWCE · 21/09 · compra"]);
    const dividends = r.steps.find((s) => s.key === "dividends")!;
    expect(dividends.done).toBe(false);
    expect(dividends.pending).toEqual(["O · 30/09 · data estimada"]);
    expect(r.steps.find((s) => s.key === "elementum")!.done).toBe(false);
    expect(r.steps.find((s) => s.key === "scramble")!.done).toBe(false);
  });

  it("sem nada do extrato no mês, o passo XTB fica por fazer", () => {
    const r = monthClose(base);
    expect(r.steps.find((s) => s.key === "xtb")!.done).toBe(false);
  });

  it("só mostra os passos das classes que tens", () => {
    const r = monthClose({ ...base, assets: [assets[0]!] });
    expect(r.steps.map((s) => s.key)).toEqual(["xtb", "dividends"]);
  });
});

describe("confirmação de Elementum e Scramble", () => {
  const silver = {
    transactions: [
      { asset_id: "ag", type: "buy", traded_at: "2026-10-02", source: "elementum", fee: 0 },
    ],
    p2pMovements: [{ occurred_on: "2026-10-03", type: "purchase" }],
  };
  const october: MonthCloseInput = { ...base, month: "2026-10", today: "2026-10-12", ...silver };
  const step = (r: ReturnType<typeof monthClose>, key: string) =>
    r.steps.find((s) => s.key === key)!;

  it("a primeira compra não chega: continua por fazer até confirmares", () => {
    const r = monthClose(october);
    for (const key of ["elementum", "scramble"]) {
      expect(step(r, key).done).toBe(false);
      expect(step(r, key).confirmable).toBe(true);
    }
    expect(step(r, "elementum").summary).toContain("O mês ainda não acabou");
  });

  it("fica feito quando confirmas, mesmo sem movimentos", () => {
    const r = monthClose({ ...october, ...{ transactions: [] }, confirmed: ["elementum"] });
    expect(step(r, "elementum").done).toBe(true);
    expect(step(r, "elementum").confirmed).toBe(true);
    expect(step(r, "scramble").done).toBe(false);
  });

  it("nos últimos dias do mês o texto pede a confirmação", () => {
    const r = monthClose({ ...october, today: "2026-10-30" });
    expect(r.windowOpen).toBe(true);
    expect(step(r, "elementum").summary).toContain("Confirma quando estiver tudo registado");
  });

  it("meses antigos continuam a valer pelos dados", () => {
    const r = monthClose({
      ...october,
      month: "2026-08",
      today: "2026-10-12",
      transactions: [
        { asset_id: "ag", type: "buy", traded_at: "2026-08-02", source: "elementum", fee: 0 },
      ],
      p2pMovements: [{ occurred_on: "2026-08-03", type: "purchase" }],
    });
    expect(step(r, "elementum").done).toBe(true);
    expect(step(r, "elementum").confirmable).toBe(false);
    expect(step(r, "scramble").done).toBe(true);
  });
});

describe("lembrete de fecho", () => {
  it("a janela abre nos últimos 3 dias do mês", () => {
    expect(closeWindowOpen("2026-10", "2026-10-28")).toBe(false);
    expect(closeWindowOpen("2026-10", "2026-10-29")).toBe(true);
    expect(closeWindowOpen("2026-10", "2026-11-04")).toBe(true);
    // Fevereiro de ano não bissexto: 26, 27 e 28.
    expect(closeWindowOpen("2027-02", "2027-02-25")).toBe(false);
    expect(closeWindowOpen("2027-02", "2027-02-26")).toBe(true);
  });

  it("lembra o mês atual no fim e o anterior até ao dia 10", () => {
    expect(closeReminderMonth("2026-10-15")).toBeNull();
    expect(closeReminderMonth("2026-10-28")).toBeNull();
    expect(closeReminderMonth("2026-10-29")).toBe("2026-10");
    expect(closeReminderMonth("2026-10-31")).toBe("2026-10");
    expect(closeReminderMonth("2026-11-01")).toBe("2026-10");
    expect(closeReminderMonth("2026-11-10")).toBe("2026-10");
    expect(closeReminderMonth("2026-11-11")).toBeNull();
    expect(closeReminderMonth("2027-01-05")).toBe("2026-12");
  });

  it("só avisa se faltarem passos e a mensagem não muda com o progresso", () => {
    const open = monthClose({ ...base, month: "2026-10", today: "2026-10-30" });
    const alert = monthCloseAlert(open)!;
    expect(alert.code).toBe("month_close_due");
    expect(alert.href).toBe("/fecho");
    expect(alert.message).toContain("outubro de 2026");
    expect(alert.count).toBe(open.steps.length - open.doneCount);

    const partial = monthClose({
      ...base,
      month: "2026-10",
      today: "2026-10-30",
      confirmed: ["elementum"],
    });
    expect(monthCloseAlert(partial)!.message).toBe(alert.message);

    const none: MonthCloseInput = { ...base, month: "2026-10", today: "2026-10-30", assets: [] };
    expect(monthCloseAlert(monthClose(none))).toBeNull();
  });
});

describe("meses", () => {
  it("nos primeiros 10 dias fecha o mês anterior", () => {
    expect(defaultCloseMonth("2026-11-05")).toBe("2026-10");
    expect(defaultCloseMonth("2026-10-15")).toBe("2026-10");
    expect(defaultCloseMonth("2026-01-03")).toBe("2025-12");
  });

  it("shiftMonth atravessa o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
