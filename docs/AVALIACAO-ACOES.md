# Avaliação de ações — metodologia

Página `/avaliacao` (menu **Análise › Avaliação de ações**, atalho `g j`). Avalia qualquer ação ou REIT cotado no Yahoo Finance e, sem ticker, mostra o **radar de valor** das ações e REITs em carteira.

Inspirada nas ferramentas do Holygrail AI (Lucrar.pt), com **implementação própria**: os modelos são os clássicos da literatura (Damodaran, Stern Stewart, Graham, Altman, Piotroski, Beneish, Yardeni) e os dados são públicos. Ferramenta de estudo: os valores são estimativas, não recomendações.

## Arquitetura

| Peça                                         | Papel                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/valuation/fundamentals.server.ts`   | Recolha no servidor: Yahoo (quoteSummary com crumb, fundamentals-timeseries, gráfico, pesquisa), BCE, Finnhub |
| `src/lib/valuation/yahoo-parse.ts`           | Leitura das respostas para `CompanyData` (puro, testado): moedas em cêntimos, ADR, câmbio das contas          |
| `src/lib/valuation.functions.ts`             | Server functions autenticadas: dados de uma empresa, pesquisa e posições em carteira                          |
| `src/lib/valuation/analyze.ts`               | Motor: corre **no browser**, para os pressupostos se alterarem sem novo pedido                                |
| `src/lib/valuation/{dcf,multiples,ddm,…}.ts` | Um ficheiro por modelo, todos com testes                                                                      |
| `src/lib/valuation/damodaran-data.ts`        | Tabelas do Damodaran (jan/2026): 94 indústrias dos EUA e 178 países                                           |
| `src/components/valuation/`                  | Interface (separadores Resumo, Valor justo, Saúde, Gestão, REIT, Macro, Demonstrações, Notícias)              |

Todos os valores monetários chegam na **moeda da cotação**: as contas de uma ADR (ex.: TSM, em TWD) são convertidas ao câmbio do dia, e as ações implícitas são capitalização ÷ preço (resolve rácios de ADR e cotações em GBp).

## Tipo de empresa e pesos

| Tipo           | Como se deteta                                                                                                                                                                                           | Modelos e pesos base                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Madura         | Por omissão                                                                                                                                                                                              | DCF 35 % · múltiplos 30 % · EVA 20 % · DDM 15 %                             |
| Em crescimento | Receita a crescer ≥ 15 %/ano (histórico ou analistas)                                                                                                                                                    | DCF 50 % · múltiplos 35 % · EVA 15 %                                        |
| Cíclica        | Energia, materiais, auto, aço, companhias aéreas, …                                                                                                                                                      | DCF 30 % · múltiplos 45 % · EVA 15 % · DDM 10 %                             |
| Banco          | Bancos e seguradoras; financeiras (crédito, gestoras, bolsas) só se as contas não tiverem resultado operacional ou ativo corrente — Visa, Mastercard ou S&P Global avaliam-se como empresas operacionais | P/VC justificado 30 % · retorno em excesso 25 % · múltiplos 25 % · DDM 20 % |
| REIT           | Indústria «REIT»                                                                                                                                                                                         | P/AFFO 35 % · NAV 30 % · DDM 20 % · múltiplos 15 %                          |

Um modelo sai do valor justo, com o motivo à vista, quando não dá valor positivo, quando não se aplica (DDM com payout < 25 %; EVA com capital investido < 25 % do valor de mercado, porque marcas e intangíveis ficam fora do balanço) ou quando fica a mais de 3× (ou menos de ⅓) da mediana dos restantes. Os pesos voltam a somar 100 %. Veredito: potencial ≥ +15 % abaixo do valor justo; ≤ −15 % acima; entre os dois, perto do valor justo.

## Modelos

- **WACC**: rE = rf + βL × ERP + CRP. O beta é o da indústria do Damodaran sem dívida (βU), ajustado à dívida da empresa (Hamada: βL = βU × (1 + (1 − t) × D/E)); nos bancos usa-se o beta médio da indústria. rD = rf + spread do rating sintético (cobertura de juros → rating, tabela do Damodaran) + spread do país fora dos EUA. rf: Treasury a 10 anos (USD) ou curva AAA do BCE (EUR).
- **DCF (FCFF)**: 10 anos; receita a crescer à taxa da fase 1 nos anos 1–5 e a abrandar até ao crescimento perpétuo nos anos 6–10; margem a convergir para a margem-alvo; imposto efetivo → marginal; reinvestimento = Δ receita ÷ (vendas/capital); valor terminal de Gordon com reinvestimento g/ROIC. Três cenários (25/50/25), **DCF invertido** (crescimento implícito no preço), sensibilidade WACC × g e **Monte Carlo** de 2 000 simulações com semente fixa.
- **Múltiplos**: P/E, P/E futuro, EV/EBITDA, EV/EBIT, EV/Vendas e P/VC; mediana dos pares sem negativos nem extremos (P/E > 80, EV/EBIT > 60…), nunca o múltiplo da própria empresa. Com menos de 3 pares válidos usa-se a indústria do Damodaran. Pares do Finnhub (com `FINNHUB_API_KEY`) ou sugeridos pelo Yahoo e filtrados pelo setor.
- **DDM**: duas fases (5 anos + Gordon), três cenários e **PVGO** (parte do preço que paga crescimento).
- **EVA / EP / MVA**: histórico do ROIC face ao WACC, valor das operações atuais (CI + EVA/WACC) e avaliação com o ROIC a convergir para WACC + 30 % do diferencial.
- **Bancos**: P/VC justificado (ROE − g)/(kₑ − g) e modelo de retorno em excesso.
- **REITs**: FFO pela definição da NAREIT (as imparidades de imóveis voltam a somar, porque não saem da caixa), AFFO (capex de manutenção estimado em 10 % das amortizações; fica o mais baixo entre o AFFO pelo FFO e o AFFO pelo fluxo de caixa operacional, porque o FFO volta a somar todas as imparidades — também as de investimentos que não são imóveis — e as rendas lineares ainda por receber), P/FFO, P/AFFO, cap rate implícita, NAV com o NOI aproximado pelo EBITDA normalizado, e nota de 0 a 10 (valorização, payout do AFFO, dívida/EBITDA, juros, crescimento do FFO). O AFFO e o NOI do valor justo ajustam-se ao crescimento da receita esperado pelos analistas para o ano em curso (entre −30 % e +15 %). Nos múltiplos dos REITs conta só o EV/EBITDA: o valor contabilístico (imóveis ao custo) não compara REITs entre si.

## Saúde financeira e gestão

- **Altman Z** (original para indústria; Z'' para serviços) e zonas; não se aplica a bancos nem REITs.
- **Piotroski F** com os 9 critérios explicados, nos anos disponíveis.
- **Beneish M** (8 índices; acima de −1,78 há sinais a vigiar — penaliza o crescimento rápido).
- **Equilíbrio financeiro** (FM = NFM + TL): tesouraria líquida pelo método direto (caixa − dívida de curto prazo), para que receitas diferidas não pareçam dívida bancária.
- Rácios de rentabilidade, liquidez, solvência, conversão em caixa, acréscimos (Sloan), DuPont de 5 fatores.
- **Gestão**: ROIC > WACC, tendência, recompras/diluição, remuneração em ações, surpresas de resultados e insiders (nos REITs conta o crescimento do FFO por ação e a cobertura do dividendo).
- **Nota global (0–100)**: 35 % valorização, 25 % saúde (ou nota REIT), 20 % rentabilidade, 20 % gestão.

## Alertas

Ação especulativa (queima caixa com menos de 12 meses de liquidez), prejuízo operacional, queda ≥ 35 % numa semana (possível cisão/fusão), **armadilha de valor** (queda ≥ 35 % em 12 meses com potencial ≥ 50 %), **modelos discordantes** (o mais alto vale mais de 3× o mais baixo), valor justo muito afastado do preço sem analistas para comparar, holding (desconto típico de 20–50 %), contas noutra moeda, histórico curto e diferença grande face ao consenso dos analistas (aviso quando os modelos ficam muito acima dos analistas e o potencial passa de 50 %).

Com qualquer um destes avisos de fiabilidade, a página marca o **potencial como pouco fiável** e a nota global conta-o como neutro, tal como o radar assinala a posição com ⚠.

## Watchlist

- Botão **Adicionar à watchlist** no cabeçalho da análise; o cartão **Watchlist** aparece na página sem ticker, por baixo do radar.
- Cada empresa é avaliada como no radar (sem pares nem notícias, dois pedidos de cada vez, cache partilhada de 30 min): preço, valor justo, potencial, veredito e ⚠ com os avisos de fiabilidade.
- O **preço-alvo** escreve-se na moeda da cotação (unidade principal: GBP e não GBp); vazio retira o alvo. Tabela `watchlist` (único por utilizador e símbolo, RLS).
- **Resumo das 9h**: lista as empresas cujo último fecho ficou abaixo do alvo, com a distância em percentagem (sem preços, por causa do ecrã bloqueado). O aviso repete-se enquanto estiverem abaixo; primeiro as que passaram agora para baixo do alvo. Regras puras em `morning-digest.ts`, fechos do Yahoo em `morning-digest.server.ts`.

## Holygrail AI → esta app

| Holygrail                                                                   | Aqui                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Valor justo por modelo, ponderado pelo tipo de empresa                      | ✅ Resumo e Valor justo                                          |
| DCF com 3 cenários, sensibilidade, Monte Carlo, DCF invertido               | ✅                                                               |
| Múltiplos dos pares, DDM + PVGO, EVA/MVA/EP                                 | ✅                                                               |
| Damodaran (WACC, beta de Hamada, risco do país)                             | ✅ dados de jan/2026                                             |
| Altman, Piotroski, qualidade da informação, equilíbrio financeiro           | ✅ + Beneish e DuPont                                            |
| Qualidade da gestão, insiders, surpresas, consenso                          | ✅                                                               |
| REIT: P/FFO, P/AFFO, NAV, dividendo e dívida, nota 0–10                     | ✅ (ocupação não vem nas contas públicas)                        |
| FED Model e Yardeni                                                         | ✅ (Aaa aproximado por Treasury + spread AAA)                    |
| Notícias da ação, exportar PDF                                              | ✅ (PDF pela impressão do browser)                               |
| Carteira, FIRE, dividendos                                                  | ✅ já existiam (mais completos aqui: IRS, XTB, TWR/XIRR)         |
| Radar de oportunidades                                                      | ✅ radar de valor da carteira                                    |
| Watchlist com alertas                                                       | ✅ cartão Watchlist, com preço-alvo e aviso no resumo das 9h     |
| Perfil de investidor (Markowitz)                                            | ⏳ no roadmap                                                    |
| ETFs (custos, comparar), cripto, IA a ler relatórios e chamadas, comunidade | ❌ fora do âmbito atual (sem cripto na carteira; sem LLM na app) |

## Limites conhecidos

- O Yahoo publica 4 anos de contas; médias e tendências usam esse histórico.
- O radar usa a indústria do Damodaran nos múltiplos (sem pares) para não sobrecarregar o Yahoo: o valor pode diferir um pouco da ficha completa.
- Fora do USD e do EUR, a taxa sem risco usa o Treasury dos EUA (editável nos pressupostos).
- As referências de cap rate e P/AFFO por segmento de REIT são indicativas e editáveis.
