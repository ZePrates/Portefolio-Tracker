import { describe, it, expect } from "vitest";
import { formatDatePt, formatEUR, formatPercent, parseNumberPt, parseNumberOr } from "@/lib/format";
import { todayLisbon } from "@/lib/dates";

/** Normaliza espaços inseparáveis do Intl para comparar com strings legíveis. */
const plain = (s: string) => s.replace(/\s/g, " ");

describe("parseNumberPt", () => {
  it("aceita vírgula decimal (PT)", () => {
    expect(parseNumberPt("1234,56")).toBe(1234.56);
    expect(parseNumberPt("0,5")).toBe(0.5);
  });

  it("aceita separador de milhares PT com ponto ou espaço", () => {
    // Antes: parseFloat("1.234,56".replace(",", ".")) === 1.234 (erro silencioso)
    expect(parseNumberPt("1.234,56")).toBe(1234.56);
    expect(parseNumberPt("1 234,56")).toBe(1234.56);
    expect(parseNumberPt("1 234,56")).toBe(1234.56);
    expect(parseNumberPt("1.234.567")).toBe(1234567);
  });

  it("aceita ponto decimal (formato EN, como no extrato XTB)", () => {
    expect(parseNumberPt("135.20")).toBe(135.2);
    expect(parseNumberPt("1,234.56")).toBe(1234.56);
    expect(parseNumberPt("0.125")).toBe(0.125);
  });

  it("ignora símbolos de moeda e percentagem", () => {
    expect(parseNumberPt("1.234,56 €")).toBe(1234.56);
    expect(parseNumberPt("€ 12,5")).toBe(12.5);
    expect(parseNumberPt("15 %")).toBe(15);
  });

  it("aceita negativos", () => {
    expect(parseNumberPt("-12,5")).toBe(-12.5);
  });

  it("devolve NaN para entradas inválidas", () => {
    expect(parseNumberPt("")).toBeNaN();
    expect(parseNumberPt("abc")).toBeNaN();
    expect(parseNumberPt("1,2,3")).toBeNaN();
    expect(parseNumberPt("1.2.3,4,5")).toBeNaN();
  });

  it("parseNumberOr usa o valor por omissão quando inválido", () => {
    expect(parseNumberOr("abc", 0)).toBe(0);
    expect(parseNumberOr("2,5", 0)).toBe(2.5);
  });
});

describe("formatDatePt", () => {
  it("usa dd/mm/aaaa", () => {
    expect(formatDatePt("2026-10-07")).toBe("07/10/2026");
  });

  it("não desloca datas simples por fuso horário", () => {
    expect(formatDatePt("2026-01-01")).toBe("01/01/2026");
  });

  it("converte timestamps para a hora de Lisboa", () => {
    // 23:30 UTC de 31/07 = 00:30 de 01/08 em Lisboa (UTC+1)
    expect(formatDatePt("2026-07-31T23:30:00Z")).toBe("01/08/2026");
  });

  it("devolve travessão para vazio ou inválido", () => {
    expect(formatDatePt(null)).toBe("—");
    expect(formatDatePt("xyz")).toBe("—");
  });
});

describe("formatEUR / formatPercent", () => {
  it("formata euros em pt-PT", () => {
    expect(plain(formatEUR(1234.5))).toBe("1234,50 €");
    expect(plain(formatEUR(12345.5))).toBe("12 345,50 €");
  });

  it("não mostra NaN", () => {
    expect(formatEUR(Number.NaN)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formata percentagens com sinal e vírgula", () => {
    expect(plain(formatPercent(12.345))).toBe("+12,35 %");
    expect(plain(formatPercent(-3))).toBe("-3,00 %");
    expect(plain(formatPercent(0))).toBe("0,00 %");
    expect(plain(formatPercent(12345.6))).toBe("+12 345,60 %");
  });

  it("modo privado esconde valores", () => {
    expect(formatEUR(10, true)).toBe("••••");
    expect(formatPercent(10, true)).toBe("••••");
  });
});

describe("todayLisbon", () => {
  it("no verão, 23:30 UTC já é o dia seguinte em Lisboa", () => {
    expect(todayLisbon(new Date("2026-07-31T23:30:00Z"))).toBe("2026-08-01");
  });

  it("no inverno, Lisboa coincide com UTC", () => {
    expect(todayLisbon(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });
});
