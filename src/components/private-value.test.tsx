import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { privateEUR, privateMoney, privateText } from "@/components/private-value";

const html = (node: ReturnType<typeof privateEUR>) => renderToStaticMarkup(<>{node}</>);

describe("valores no modo privado", () => {
  it("mostra o montante formatado fora do modo privado", () => {
    expect(privateEUR(1234.5, false)).toMatch(/^1\s234,50\s€$/);
  });

  it("desfoca um montante fictício e nunca escreve o valor real", () => {
    const out = html(privateEUR(98765.43, true));
    expect(out).toContain('aria-label="Valor escondido"');
    expect(out).toContain("blur");
    expect(out).not.toContain("98");
    // O mesmo texto para qualquer valor: não deixa adivinhar a ordem de grandeza.
    expect(html(privateEUR(3, true))).toBe(out);
  });

  it("mantém a moeda e o texto fictício indicado", () => {
    expect(html(privateMoney(10, "USD", true))).toContain("US$");
    expect(html(privateText("12,5 g", true, "000,00 g"))).toContain("000,00 g");
    expect(html(privateText("12,5 g", true, "000,00 g"))).not.toContain("12,5");
  });
});
