# Auditoria de código, dados e funcionalidade — Parte 1

**Data:** 07/10/2026 · **Branch:** `audit/code-review` · **Base:** `main` @ `4955559`
**Âmbito:** lógica, dados, segurança, performance e qualidade. O design visual e a UX ficam para a Parte 2.

---

## 0. Estado inicial (linha de base)

| Verificação | Resultado |
|---|---|
| `npm run build` | ✅ OK (2,3 s) |
| `npm run lint` | ✅ 0 erros, ⚠️ 32 avisos (todos `react-hooks/exhaustive-deps`) |
| `tsc --noEmit` | ✅ 0 erros (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` ativos). `npx tsc` falha: tem de se usar `./node_modules/.bin/tsc` ou `bunx tsc` |
| `vitest run` | ✅ 13 ficheiros, 134 testes a passar |
| `npm audit` | ❌ Não corre: o projeto usa `bun.lock` e não tem `package-lock.json`. A alternativa é `bun audit` |
| `npm outdated` | Só atualizações menores e de patch (supabase-js 2.112→2.117, TanStack, Radix). Majors disponíveis: eslint 10, @vitejs/plugin-react 6, @types/node 26 |
| Bundle cliente | 40 chunks JS, 1,4 MB no total. `index` 589 kB (171 kB gzip), `recharts` 370 kB (98 kB gzip) |
| Advisors Supabase | Segurança: 1 WARN (*leaked password protection* desativada). Performance: 1 INFO (índice não usado) |

**Pontos fortes:** `numeric` em todos os campos monetários; RLS ativo em todas as tabelas com `(select auth.uid()) = user_id`, que é a forma otimizada; zero `any` explícitos; FIFO correto e com comissões incluídas; TWR, XIRR e drawdown já implementados e testados; os server functions validam o input com zod.

---

## 1. Achados (ordenados por severidade)

Legenda: **Sev.** C = Crítico, A = Alto, M = Médio, B = Baixo · **Esf.** S/M/L · **Ord.** = ordem de execução proposta

### Críticos

| # | Achado | Evidência | Impacto | Correção proposta | Sev. | Esf. | Ord. |
|---|---|---|---|---|---|---|---|
| F1 | **Câmbio histórico errado nas transações.** `fxRateOf()` usa a taxa **atual** (`current_price / current_price_native`) para qualquer `traded_at`, seja numa compra, numa venda ou ao editar uma transação antiga. | [portfolio.functions.ts:220](src/lib/portfolio.functions.ts:220), usada em `buyAsset`, `sellAsset`, `updateTransaction` e `previewSale`. Na BD há 37 transações em USD entre 17/02/2025 e 06/10/2026 com só 11 taxas distintas. | O custo de aquisição, as mais-valias realizadas e o preço médio em EUR ficam errados. Para o IRS (Anexos G e J), o valor de aquisição e o de realização têm de usar o câmbio **da data de cada operação**. | Usar `getRateOnDate(moeda, traded_at)`, que já existe em `yahoo.server.ts`, quando `traded_at` ≠ hoje, e permitir que o utilizador indique a taxa do extrato XTB. Seguem-se testes e um script de recálculo das 37 transações a partir de `price_native` (mostro antes/depois e peço confirmação antes de gravar). | **C** | M | 1 |

### Altos

| # | Achado | Evidência | Impacto | Correção proposta | Sev. | Esf. | Ord. |
|---|---|---|---|---|---|---|---|
| F2 | **A retenção na fonte dos dividendos nunca é registada.** O sync do Yahoo grava `tax_amount = 0`, por isso líquido = bruto. | 119 de 119 dividendos (todos `yahoo`) com `tax_amount = 0`, incluindo os pagos em USD. | Ficam sobrestimados os dividendos líquidos, o *yield on cost*, o resultado total e o XIRR (nos EUA a retenção é de 15% com W-8BEN). O crédito de imposto para o Anexo J também não está disponível. | Criar uma taxa de retenção por ativo (por omissão derivada do domicílio: US 15%, IE/LU 0%, etc., e editável) e aplicá-la no sync e no `recalculateDividends`, com testes. Requer uma migração (`withholding_rate` em `assets`). | A | M | 2 |
| F3 | **As escritas no livro de movimentos não são atómicas e não são pré-validadas.** `buy` e `sell` inserem a transação e só depois atualizam o ativo. `delete` e `updateTransaction` mutam primeiro e só depois correm `recomputeAsset`, que pode lançar erro (por exemplo, ao apagar uma compra de que depende uma venda posterior). | [portfolio.functions.ts:242-282](src/lib/portfolio.functions.ts:242), [:512-528](src/lib/portfolio.functions.ts:512) | O ledger e os agregados de `assets` podem divergir: a transação fica apagada mas a posição não é recalculada. Duas vendas em simultâneo podem vender mais do que a quantidade detida. | Validar o ledger resultante em memória **antes** de mutar e, a seguir, fazer sempre `recomputeAsset` (uma única fonte de verdade). Como passo seguinte opcional, uma função Postgres transacional (`security invoker`). | A | M | 3 |
| F4 | **Os inputs numéricos em formato PT são mal interpretados.** `parseFloat(s.replace(",", "."))` transforma `"1.234,56"` em **1,234**. A mesma lógica está duplicada em 4 sítios. | [asset-class-page.tsx:104](src/components/asset-class-page.tsx:104), [asset-position-modal.tsx:72](src/components/asset-position-modal.tsx:72), [dividendos.tsx:181](src/routes/_authenticated/dividendos.tsx:181), [projecoes.tsx:42](src/routes/_authenticated/projecoes.tsx:42) | Quantidades e preços errados são gravados sem qualquer aviso. | Criar um `parseNumberPt()` partilhado em `format.ts` que aceite `1234,56`, `1.234,56`, `1 234,56` e `1234.56`, rejeite ambiguidades e tenha testes. | A | S | 4 |
| F5 | **Houve um `.env` commitado no histórico git.** Foi adicionado em `48c464f` (28/08/2026), alterado em `2050111` e `1af7b11` e removido em `6099c97` (11/09/2026). | `git log -- .env`. **Não li o conteúdo**: a leitura foi bloqueada por ser material de credenciais. | Se continha só `VITE_SUPABASE_URL` e a chave *publishable*, não há risco. Se tinha `service_role`, `sb_secret_`, `LOVABLE_DB_MIGRATION_URL` ou passwords, essas credenciais estão expostas no GitHub. | **Ação tua:** verificar com `git show 48c464f:.env` e, se houver segredos, **rodá-los** no Supabase e no Lovable. Não reescrevo o histórico (regra do Lovable). | A | S | 0 |

### Médios

| # | Achado | Evidência / impacto | Correção proposta | Sev. | Esf. | Ord. |
|---|---|---|---|---|---|---|
| F6 | O sync do Yahoo usa a **ex-date como data de pagamento**. | [dividends.functions.ts:99](src/lib/dividends.functions.ts:99). Um dividendo passa a "recebido" antes de ser pago, e uma ex-date em dezembro paga em janeiro cai no ano fiscal errado. | Guardar o pagamento como desconhecido (`unknown`/`scheduled`) até haver confirmação. A confirmação pode vir do import XTB (F-XTB) ou de um *lag* configurável por ativo. | M | M | 6 |
| F7 | Bruto e líquido são usados de forma inconsistente. | O `dashboard.ts` e o `performance.ts` usam `netOf`; o `totalReceived`, o `receivedByMonth`, o `receivedLast12Months` e outros de `dividends.ts` usam `grossOf`. Hoje a diferença não se nota porque net = gross (F2), mas passa a notar-se assim que F2 for corrigido. | Definir uma convenção explícita (o líquido nos KPIs e o bruto e a retenção no fiscal) e parametrizar as funções. | M | S | 5 |
| F8 | `totalReturnPct` tem uma base errada quando há posições fechadas. | [dashboard.ts:123](src/lib/dashboard.ts:123): `closedCost` lê `invested_amount`, que fica a 0 quando a posição é fechada. Logo `closedCost` é sempre 0 e a rentabilidade fica inflacionada. Hoje não tem impacto (não há posições fechadas). | Usar como base o custo histórico consumido (a soma dos `costBasis` das vendas) mais o custo atual. Escrever primeiro um teste que mostre o erro. | M | S | 5 |
| F9 | Os snapshots são esparsos e só são gravados quando se clica em "Atualizar preços". | 32 dias com snapshot em 2,6 anos. Por isso o TWR e o drawdown têm poucos pontos, e o TWR ignora os dividendos pagos em dinheiro (subestima o retorno). | Gravar um snapshot automático diário (rota cron do Lovable, que já existe em `cron-auth.ts`, ou ao abrir a app se o último tiver mais de 24 h) e tratar os dividendos como rendimento no TWR. | M | M | 8 |
| F10 | Os preços dos ETFs estão desatualizados. | Os 22 ETFs foram atualizados pela última vez a 18/09/2026; as restantes classes a 06/10/2026. Pode já estar resolvido por `bbad977`, mas falta validar. | Validar e acrescentar um alerta de "preço com mais de N dias" (qualidade de dados). | M | S | 7 |
| F11 | As APIs externas (Yahoo, justETF e FT) são chamadas **sem timeout, sem retry e em série**. | `fetch` sem `AbortSignal`. Uma atualização de 52 ativos é uma cascata serial e pode exceder o limite de tempo do Worker. | Criar um wrapper `fetchJson` com timeout de 8 s, 1 retry com backoff e concorrência limitada a 4, e cache de câmbio por pedido. | M | S | 9 |
| F12 | Cada server function faz `auth.getUser()` (uma ida ao servidor Auth) e o QueryClient usa `staleTime: 0`. | [auth-middleware-external.ts:88](src/integrations/supabase/auth-middleware-external.ts:88), [router.tsx:6](src/router.tsx:6). Há muitos refetches, cada um com latência extra. | Usar `auth.getClaims()` (verificação local com JWKS, se o projeto usar chaves assimétricas), `staleTime` de 60 s por omissão e invalidação dirigida. | M | S | 10 |
| F13 | Há escritas em série (N+1) e erros ignorados. | O `recomputeAsset` atualiza venda a venda; o sync de dividendos faz insert/update um a um. No `exposure.functions.ts:211-216` faz-se `delete` e depois `insert` **sem verificar erros**: se o insert falhar, as exposições perdem-se. | Fazer upserts em lote, verificar todos os erros e inserir antes de apagar (ou apagar por `as_of_date` antigo). | M | M | 11 |
| F14 | Faltam restrições na BD e há índices redundantes. | Sem `CHECK` em `transactions` (quantity > 0, price ≥ 0, fee ≥ 0, fx_rate > 0), em `assets.status` nem nos montantes de `dividends`. Há 5 índices únicos parciais sobrepostos em `dividends`, um deles `(user_id, asset_id, paid_at)`, que impede duas distribuições no mesmo dia. | Migração reversível com `CHECK ... NOT VALID` seguido de `VALIDATE` e consolidação dos índices. A remoção de índices só avança com a tua confirmação. | M | S | 12 |
| F15 | A validação zod é fraca. | As datas são `z.string().min(1)` (aceitam `"abc"` ou datas futuras numa compra) e as strings não têm limite de tamanho. | Criar um `isoDate` partilhado (`YYYY-MM-DD`, não futuro nos trades), `.max()` nas strings e `ticker` em maiúsculas. | M | S | 13 |

### Baixos

| # | Achado | Correção proposta | Esf. |
|---|---|---|---|
| F16 | "Hoje" é calculado em UTC (`toISOString().slice(0,10)`). Entre as 00:00 e a 01:00 da hora de verão de Lisboa, o "hoje" ainda é ontem (afeta snapshots e o estado dos dividendos). | Criar um `todayLisbon()` com `Intl` e `timeZone: "Europe/Lisbon"`. | S |
| F17 | **Código morto (knip):** 46 dos 46 componentes `components/ui/*` não são usados, há cerca de 38 dependências sem uso (Radix, cmdk, vaul, date-fns, react-hook-form, embla, input-otp, react-day-picker, …), `drizzle-orm` e `postgres`, e vários exports mortos (`refreshPricesFromYahoo`, `positionValueNative`, `futureValueByClass`, …). ⚠️ `auth-middleware.ts`, `client.server.ts`, `cron-auth.ts` e `integrations/lovable` são **gerados pelo Lovable**: não se apagam. | Remover só depois de confirmar por grep. Os componentes de UI podem fazer falta na Parte 2 (design), por isso **sugiro adiar a remoção de `components/ui` até à Parte 2**. As dependências e os exports mortos removem-se já. | S |
| F18 | Há componentes gigantes: `asset-class-page` (974 linhas), `asset-position-modal` (844), `index.tsx` (641) e `dividendos.tsx` (507). | Extrair hooks de dados e lógica para `lib/` sem mexer no JSX visual (a divisão visual fica para a Parte 2). | M |
| F19 | 32 avisos de lint: `data ?? []` cria um array novo em cada render e anula o `useMemo`. | Usar uma constante `EMPTY` estável ou um `useMemo` no fallback. | S |
| F20 | Formatação: `formatDatePt` devolve "7 out. 2026" em vez de **07/10/2026**; `formatPercent(NaN)` devolve "NaN %"; `formatPercent` não tem separador de milhares. | Criar `formatDatePt` em dd/mm/aaaa (com uma variante longa, se for precisa), guardas para NaN e `Intl.NumberFormat` nas percentagens, tudo com testes. | S |
| F21 | Bundle: o chunk principal tem 171 kB gzip e o `recharts` 98 kB gzip. As rotas já estão separadas em chunks. | Medir de novo depois de F17. Considerar *lazy* nos gráficos fora do dashboard. | S |
| F22 | Não há lockfile npm, por isso o `npm audit` não corre. | Documentar `bun audit` no README e na CI. | S |
| F23 | Advisor: *leaked password protection* desativada. | **Ação tua** no dashboard do Supabase (Auth → Passwords). | S |
| F24 | O `closed_at` é reposto a `now()` em cada recálculo, em vez de usar a data da última venda. | Usar o `traded_at` da última venda. | S |
| F25 | Holdings dos ETFs: alguns ETFs têm soma de pesos 0% e o máximo é 80%. O look-through já trata o resto como "desconhecido", mas o utilizador não é avisado. | Incluir um alerta de qualidade de dados (ver F-ALERTAS). | S |
| F26 | Os erros da BD chegam ao cliente em bruto (`error.message`). | Mapear para mensagens PT e registar o erro original no servidor. | S |
| — | `security_profiles` com `USING (true)` só para leitura por utilizadores autenticados: **aceitável** (dados de referência públicos; a escrita fica reservada à service role). Os advisors de RLS estão limpos. | Nenhuma. | — |
| — | O índice `asset_expenses_user_id_idx` está marcado como não usado, mas é útil para o RLS quando a tabela tiver dados. | Manter. | — |

---

## 2. Funcionalidades propostas (apenas lógica e dados; a apresentação fica para a Parte 2)

| # | Funcionalidade | Conteúdo | Depende de | Esf. |
|---|---|---|---|---|
| F-FISCAL | **Resumo fiscal anual PT** | Mais-valias por FIFO por ano, com valor de aquisição e de realização e datas e câmbio de cada operação (Anexo G para títulos nacionais e Anexo J para estrangeiros), dividendos brutos com retenção na fonte por país (Anexo J, quadro 8A), comparação entre englobamento e taxa liberatória de 28% e exportação CSV. | F1, F2, F6 | L |
| F-XTB | **Import CSV/XLSX da XTB** | Parser do relatório "Cash Operations" e "Closed/Open positions" para compras, vendas, dividendos e retenções reais. Usa o `import-history.ts`, que já existe e está testado mas não tem UI, e a deduplicação por fingerprint. Resolve na origem F1, F2 e F6. | — | L |
| F-ALERTAS | **Alertas de qualidade de dados** | Preço com mais de 3 dias, ativo sem ISIN ou ticker, ETF sem holdings ou com soma de pesos abaixo de 50%, dividendos sem retenção, ledger ≠ quantidade, câmbio em falta. Função pura e testável. | — | S |
| F-ALOC | **Alocação vs objetivo e rebalanceamento** | Pesos-alvo por classe e por ativo (core-satellite), desvio, sugestão de aportes para rebalancear sem vender (eficiente do ponto de vista fiscal). Requer a tabela `allocation_targets`. | — | M |
| F-DIVCAL | **Calendário e projeção de dividendos** | Próximos 12 meses por ativo, a partir da cadência inferida (o `yield.ts` já existe), em valores líquidos. | F2 | M |
| F-FIRE | **Progresso FIRE** | Objetivo (despesas anuais × 25 ou SWR configurável), % atingida, data estimada (reutiliza `projections.goalProjection`) e rendimento passivo face às despesas. Requer a tabela `fire_settings`. | — | S |
| F-OVERLAP | **Sobreposição entre ETFs** | Matriz de sobreposição entre pares de ETFs (soma do mínimo dos pesos comuns). Reutiliza as `etf_holdings`. | — | S |
| F-EXPORT | **Exportações** | CSV com `;`, decimal com vírgula e datas dd/mm/aaaa, para transações, dividendos e o resumo fiscal. | F20 | S |

---

## 3. Plano de execução proposto para a Fase B (após aprovação)

1. **Críticos e altos:** F5 (ação tua), F1, F2, F3 e F4, sempre com os testes primeiro a provar o comportamento atual e depois a correção.
2. **Correções de cálculo médias:** F7, F8, F6, F16, F20 e F24, também com testes.
3. **Limpeza:** F17 (sem `components/ui`, ver nota), F19 e utilitários partilhados (`parseNumberPt`, `isoDate`, `todayLisbon`).
4. **Qualidade:** F15, F26 e F18 (extração de lógica e hooks).
5. **Performance:** F11, F12, F13 e F21, medindo antes e depois.
6. **Base de dados:** F14 com migração reversível, que te mostro antes de aplicar. Mais F9 (snapshots diários).
7. **Funcionalidades aprovadas:** ordem sugerida F-ALERTAS → F-FISCAL → F-XTB → F-ALOC → F-FIRE → F-DIVCAL → F-OVERLAP → F-EXPORT.
8. **Testes:** Vitest para toda a lógica nova e para a formatação PT-PT.

### Decisões que preciso de ti

- **F1:** queres que o recálculo das 37 transações em USD use o câmbio de fecho do Yahoo do dia da operação, ou preferes indicar as taxas do extrato XTB, que são as que contam para o IRS? (Proponho o Yahoo como valor por omissão e o XTB como substituto quando o import existir.)
- **F2:** a retenção por omissão segue o país de domicílio do emitente (US 15%, …), sempre editável por ativo. Concordas?
- **F17:** removo já os 46 componentes `components/ui` não usados, ou espero pela Parte 2?
- **Funcionalidades:** quais aprovas, e por que ordem?
