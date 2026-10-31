import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMorningDigest,
  digestNotification,
  lastSessionChange,
  lisbonClock,
  shouldSendDigest,
  type DigestInput,
  type DigestPosition,
} from "./morning-digest";

const pos = (over: Partial<DigestPosition>): DigestPosition => ({
  name: "Ativo",
  ticker: "AAA",
  valueEUR: 1000,
  priceEUR: 10,
  averagePriceEUR: 8,
  session: { date: "2026-10-30", previous: 100, close: 101, change: 0.01 },
  priceUpdatedAt: "2026-10-30T21:30:00Z",
  ...over,
});

const base = (over: Partial<DigestInput> = {}): DigestInput => ({
  today: "2026-11-02",
  positions: [],
  dividends: [],
  lastSnapshotDate: "2026-11-01",
  ...over,
});

describe("lisbonClock / shouldSendDigest", () => {
  it("converte para a hora de Lisboa no inverno e no verão", () => {
    expect(lisbonClock(new Date("2026-11-02T09:02:00Z"))).toEqual({
      date: "2026-11-02",
      hour: 9,
      weekday: 1,
    });
    // Verão (UTC+1): 08:02 UTC = 9h em Lisboa.
    expect(lisbonClock(new Date("2026-07-01T08:02:00Z")).hour).toBe(9);
    // Inverno: 08:02 UTC = 8h em Lisboa.
    expect(lisbonClock(new Date("2026-11-02T08:02:00Z")).hour).toBe(8);
  });

  it("só envia em dias úteis entre as 9h e as 12h", () => {
    expect(shouldSendDigest({ date: "2026-11-02", hour: 9, weekday: 1 }).send).toBe(true);
    expect(shouldSendDigest({ date: "2026-11-02", hour: 11, weekday: 1 }).send).toBe(true);
    expect(shouldSendDigest({ date: "2026-11-02", hour: 8, weekday: 1 })).toMatchObject({
      send: false,
    });
    expect(shouldSendDigest({ date: "2026-11-02", hour: 12, weekday: 1 }).send).toBe(false);
    expect(shouldSendDigest({ date: "2026-10-31", hour: 9, weekday: 6 }).reason).toMatch(
      /fim de semana/,
    );
    expect(shouldSendDigest({ date: "2026-11-01", hour: 9, weekday: 0 }).send).toBe(false);
  });
});

describe("lastSessionChange", () => {
  it("ignora a sessão de hoje e usa os dois últimos fechos completos", () => {
    const r = lastSessionChange(
      [
        { date: "2026-10-29", value: 100 },
        { date: "2026-10-30", value: 95 },
        { date: "2026-11-02", value: 50 },
      ],
      "2026-11-02",
    );
    expect(r).toMatchObject({ date: "2026-10-30", previous: 100, close: 95 });
    expect(r!.change).toBeCloseTo(-0.05, 10);
  });
  it("sem dois fechos devolve null", () => {
    expect(lastSessionChange([{ date: "2026-10-30", value: 1 }], "2026-11-02")).toBeNull();
    expect(lastSessionChange([], "2026-11-02")).toBeNull();
  });
});

describe("buildMorningDigest", () => {
  it("calcula a variação ponderada pelo valor em EUR", () => {
    const d = buildMorningDigest(
      base({
        positions: [
          pos({
            valueEUR: 1100,
            session: { date: "2026-10-30", previous: 100, close: 110, change: 0.1 },
          }),
          pos({
            valueEUR: 900,
            session: { date: "2026-10-30", previous: 100, close: 90, change: -0.1 },
          }),
        ],
      }),
    );
    // Antes: 1000 + 1000 = 2000; depois: 2000 → 0 %.
    expect(d.portfolioChange).toBeCloseTo(0, 10);
    expect(d.pricedPositions).toBe(2);
  });

  it("destaca quedas a partir de 5 % e ordena da maior para a menor", () => {
    const d = buildMorningDigest(
      base({
        positions: [
          pos({
            ticker: "A",
            session: { date: "2026-10-30", previous: 1, close: 1, change: -0.049 },
          }),
          pos({
            ticker: "B",
            session: { date: "2026-10-30", previous: 1, close: 1, change: -0.05 },
          }),
          pos({
            ticker: "C",
            session: { date: "2026-10-30", previous: 1, close: 1, change: -0.12 },
          }),
        ],
      }),
    );
    expect(d.drops.map((m) => m.name)).toEqual(["C", "B"]);
    expect(d.topLoser!.name).toBe("C");
    expect(d.topGainer).toBeNull();
  });

  it("assinala só quem passou para baixo do preço médio no último fecho", () => {
    const d = buildMorningDigest(
      base({
        positions: [
          // 10,2 → 9,7 com preço médio 10: cruzou.
          pos({
            ticker: "CRUZOU",
            priceEUR: 9.7,
            averagePriceEUR: 10,
            session: { date: "2026-10-30", previous: 10.2, close: 9.7, change: 9.7 / 10.2 - 1 },
          }),
          // Já estava abaixo: não repete todos os dias.
          pos({
            ticker: "JA",
            priceEUR: 7,
            averagePriceEUR: 10,
            session: { date: "2026-10-30", previous: 7.5, close: 7, change: 7 / 7.5 - 1 },
          }),
          pos({ ticker: "SEM", averagePriceEUR: 0 }),
        ],
      }),
    );
    expect(d.crossedBelowAverage).toEqual(["CRUZOU"]);
  });

  it("agenda de dividendos para hoje e os 2 dias seguintes, sem repetidos", () => {
    const d = buildMorningDigest(
      base({
        dividends: [
          { assetName: "O", exDate: "2026-11-02", paymentDate: null, received: false },
          { assetName: "O", exDate: "2026-11-02", paymentDate: null, received: false },
          { assetName: "VICI", exDate: "2026-11-03", paymentDate: "2026-11-04", received: false },
          { assetName: "LONGE", exDate: "2026-11-10", paymentDate: null, received: false },
          { assetName: "PAGO", exDate: null, paymentDate: "2026-11-02", received: true },
        ],
      }),
    );
    expect(d.exDividends).toEqual(["O (hoje)", "VICI (amanhã)"]);
    expect(d.payments).toEqual(["VICI (qua.)"]);
  });

  it("avisa preços desatualizados e fotografia em falta", () => {
    const d = buildMorningDigest(
      base({
        positions: [pos({ priceUpdatedAt: "2026-10-20T00:00:00Z" }), pos({ priceUpdatedAt: null })],
        lastSnapshotDate: "2026-10-30",
      }),
    );
    expect(d.warnings).toEqual([
      "2 ativos sem preço atualizado",
      "a fotografia diária de ontem não correu",
    ]);
  });

  it("ativos sem cotação não entram na variação", () => {
    const d = buildMorningDigest(base({ positions: [pos({ session: null })] }));
    expect(d.portfolioChange).toBeNull();
    expect(d.pricedPositions).toBe(0);
  });
});

describe("digestNotification", () => {
  it("monta título e linhas em PT-PT sem valores em euros", () => {
    const d = buildMorningDigest(
      base({
        positions: [
          pos({
            ticker: "O.US",
            session: { date: "2026-10-30", previous: 1, close: 1, change: -0.058 },
          }),
          pos({
            ticker: "VWCE",
            session: { date: "2026-10-30", previous: 1, close: 1, change: 0.012 },
          }),
        ],
        dividends: [
          { assetName: "VICI", exDate: "2026-11-02", paymentDate: null, received: false },
        ],
      }),
    );
    const n = digestNotification(d);
    expect(n.title).toBe("Portefólio · seg. 2/11");
    expect(n.body).toContain("Último fecho (sex.):");
    expect(n.body).toContain("↓ Quedas ≥ 5 %: O −5,80");
    expect(n.body).toContain("Maior subida: VWCE +1,20");
    expect(n.body).toContain("Ex-dividendo: VICI (hoje)");
    expect(n.body).not.toMatch(/€/);
    expect(n.tag).toBe("morning-digest-2026-11-02");
    expect(n.url).toBe("/performance");
  });

  it("sem quedas mostra a maior queda e abre o painel", () => {
    const d = buildMorningDigest(
      base({
        positions: [
          pos({
            ticker: "X",
            session: { date: "2026-10-30", previous: 1, close: 1, change: -0.01 },
          }),
        ],
      }),
    );
    const n = digestNotification(d);
    expect(n.body).toContain("Maior queda: X −1,00");
    expect(n.url).toBe("/");
  });

  it("limita a lista de quedas a 4", () => {
    const positions = Array.from({ length: 6 }, (_, i) =>
      pos({
        ticker: `T${i}`,
        session: { date: "2026-10-30", previous: 1, close: 1, change: -0.06 - i / 100 },
      }),
    );
    expect(digestNotification(buildMorningDigest(base({ positions }))).body).toContain("e mais 2");
  });
});

describe("isolamento", () => {
  it("a lógica do resumo não faz pedidos externos nem usa IA", () => {
    const src = readFileSync("src/lib/morning-digest.ts", "utf8");
    expect(src).not.toMatch(/fetch\(|anthropic|openai|gemini/i);
  });
  it("a chave privada VAPID só é lida no servidor", () => {
    for (const f of [
      "src/lib/push.functions.ts",
      "src/components/push-settings.tsx",
      "public/sw.js",
    ]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/VAPID_PRIVATE_KEY/);
    }
  });
});
