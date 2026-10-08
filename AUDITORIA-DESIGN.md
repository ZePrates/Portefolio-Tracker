# Auditoria de design e UX — Portefólio Tracker

Parte 2/2 · Fase A (diagnóstico) · 08/10/2026 · branch `audit/design-review` (a partir do `main` com a Parte 1 fundida, `2286fd2`).

Âmbito: só design, UX, acessibilidade e mobile. Nada de lógica financeira, queries ou schema.

## 1. Como foi feita a análise

- **Código:** `styles.css`, `components/ui-bits.tsx`, `app-sidebar.tsx`, `asset-class-page.tsx`, `asset-position-modal.tsx`, as 15 rotas autenticadas e `__root.tsx`.
- **App real** (`portefolio-tracker.lovable.app`, com a tua sessão): capturas em desktop e em 390 px, e medições de overflow por rota.
- **Contrastes:** calculados a partir dos tokens `oklch` do tema (rácios WCAG abaixo).
- **Limitação:** o Chrome não deixa redimensionar a janela, por isso o mobile foi simulado com uma moldura de 390 px na mesma sessão (media queries reais). As capturas ficaram só na tua máquina, porque mostram valores reais da carteira. Para o "antes/depois" do PR proponho refazê-las com o **modo privado** ligado.
- **Lighthouse:** só se consegue correr sem login na página `/auth`. Para as páginas autenticadas, ou o corres tu no DevTools (separador Lighthouse), ou uso um build local com sessão simulada. Ver decisão D7.

## 2. Resumo executivo

A base é boa: tema escuro coerente, acento dourado, tokens semânticos em `oklch`, formatadores PT-PT (`formatEUR`, `formatDatePt`) e modo privado. Os problemas estão em quatro sítios:

1. **O dashboard parte em mobile.** A 390 px a página fica com 649 px de largura (+259 px) e os cartões "Alocação" e "Melhores desempenhos" ficam cortados. Causa: itens de grelha sem `min-w-0`.
2. **Tabelas só de desktop.** `min-w-[820px]` com scroll horizontal; no telemóvel o nome do ativo quebra em 5 linhas e as colunas de valores ficam fora do ecrã. Não há cabeçalho fixo, filtros nem colunas configuráveis.
3. **Formatação PT-PT incompleta.** `1448,40 €` e `8595,51 €` convivem com `11 656,15 €` (o `pt-PT` só agrupa a partir de 5 dígitos). Percentagens com ponto (`62.1%`, `4.1% da carteira`), eixos de gráficos em ISO (`2026-01`) e sem separador de milhares (`16000`). Países em inglês (`United States`, `Other`).
4. **Sem design system efetivo.** Há 46 componentes shadcn em `components/ui` que quase ninguém usa; as páginas usam `ui-bits.tsx` (Button, Modal, Field), cartões `div` repetidos e um `Card` local só no dashboard. O `Modal` próprio não tem `role="dialog"`, Escape nem prisão de foco.

## 3. Diagnóstico por área

Gravidade: **C** crítico · **A** alto · **M** médio · **B** baixo. Esforço: S (≤ 2 h) · M (≤ 1 dia) · L (> 1 dia).

### 3.1 Consistência visual

| # | Problema | Evidência | Grav. | Esf. |
|---|---|---|---|---|
| V1 | Tokens duplicados: `:root` e `.dark` têm os mesmos 40 valores. O tema é só escuro e não há claro. | `styles.css:55-132` | M | S |
| V2 | Cartões, painéis e tabelas repetem `rounded-xl border bg-card p-4/5` à mão. Existe `Card` local só em `index.tsx` e `components/ui/card.tsx` por usar. | `ui-bits.tsx`, `index.tsx:102` | M | M |
| V3 | Tooltip de gráficos: `TOOLTIP_STYLE` definido duas vezes (`index.tsx:92`, `performance.tsx:61`) e as outras páginas passam estilos próprios; em `performance.tsx:332` há um `<Tooltip>` sem estilo. | grep `Tooltip` | M | S |
| V4 | Ícones repetidos para destinos diferentes: `PieChart` em Análise e Inteligência, `TrendingUp` em Ações Crescimento e Simulador. | `app-sidebar.tsx:42-47` | B | S |
| V5 | Cores fixas fora dos tokens (`#hex`, `text-red-*`) em `exposicao.tsx` (6) e `performance.tsx` (3). | grep | M | S |
| V6 | Escala tipográfica informal: `text-[10px]`, `text-xs`, `text-2xl md:text-3xl` espalhados; sem `tabular-nums` nos números. | vários | M | S |

### 3.2 Hierarquia de informação do dashboard

O que um investidor FIRE core-satellite precisa de ver primeiro: **quanto tenho, quanto rende, estou no caminho?** Hoje a ordem é 8 KPIs iguais, depois filtro de período, mais 4 KPIs de dividendos, evolução, alocação, exposição, melhores/piores, dividendos por mês/ativo, posições por classe.

| # | Problema | Grav. | Esf. |
|---|---|---|---|
| D1 | 12 KPIs com o mesmo peso visual; nenhum "herói" (valor atual + variação). | A | M |
| D2 | Progresso FIRE e desvio face a alvos opcionais (Parte 1: `getFireProgress`, `getAllocation`) não aparecem em lado nenhum. | A | M |
| D3 | A evolução mostra capital investido (linha) e uma série quase nula que dá a ideia de "valor de mercado = 0". Os snapshots diários da Parte 1 só enchem com o tempo. | M | S |
| D4 | Os alertas de qualidade de dados (`getDataQualityAlerts`) e a data da última atualização de preços não têm sítio visível. | M | S |
| D5 | Rótulos como "Dados não disponíveis" a 24 px no lugar de um valor. | B | S |

### 3.3 Tabelas

| # | Problema | Grav. | Esf. |
|---|---|---|---|
| T1 | Mobile: `min-w-[820px]` → scroll horizontal, nome em 5 linhas, valores fora do ecrã. | **C** | M |
| T2 | Sem cabeçalho fixo, sem pesquisa/filtro, sem colunas configuráveis; ordenação só por clique no cabeçalho (sem `aria-sort`). | A | M |
| T3 | Agrupamento de milhares inconsistente (ver 3.5). | A | S |
| T4 | Ganhos/perdas só por cor (verde/vermelho), sem sinal consistente nem ícone. Destrutivo/vermelho a 4,72:1 passa por pouco. | M | S |
| T5 | Paginação inexistente: `/dividendos` tem 10 735 px de altura em mobile (119 registos). | A | M |
| T6 | Ações por linha são 4 botões só-ícone (têm `aria-label`, bom) mas sem alvo de toque ≥ 44 px em mobile. | M | S |

### 3.4 Gráficos

| # | Problema | Grav. | Esf. |
|---|---|---|---|
| G1 | Eixos em ISO (`2026-01`, `2025-07`) e sem milhares (`16000`). | A | S |
| G2 | Paleta: `chart-3` (azul) e `chart-6` (ciano) distinguem-se mal (mesma luminosidade); sem padrões nem rótulos diretos para daltónicos. | M | S |
| G3 | Legenda do donut: percentagem cortada à direita (`60.9%`, `8.9%`) e ponto decimal. | A | S |
| G4 | Sem estado vazio nem de carregamento nos gráficos; sem `aria-label`/descrição textual alternativa. | M | M |
| G5 | Tooltips só em parte formatados em PT-PT; alguns mostram `name` técnico (`invested`). | M | S |

### 3.5 Formatação PT-PT (transversal)

- `Intl.NumberFormat("pt-PT")` **não agrupa 4 dígitos** (`1448,40 €`). Em finanças, na mesma tabela, isto parece erro. Correção: `useGrouping: "always"` no `formatEUR`/`formatMoney`.
- `toFixed(...)` em 33 sítios da interface (ponto decimal na maioria): `index.tsx`, `analise.tsx`, `inteligencia.tsx`, `simulador.tsx`, `exposicao.tsx`, `asset-class-page.tsx`.
- Percentagens: `formatPercent` produz `+24,24 %` (com espaço), mas há `62.1%` e `+21,79 %` na mesma página. Convenção a fixar: **`24,24 %` com espaço fino não separável**.
- Datas de eixos e países em inglês. Inputs de data são `type="date"` (6) e dependem da língua do browser.
- Severidade **A**, esforço **S** (um módulo de formatação + substituições mecânicas).

### 3.6 Formulários

| # | Problema | Grav. | Esf. |
|---|---|---|---|
| F1 | Validação só por `toast.error` ao submeter (`asset-class-page.tsx:264-320`, `asset-position-modal.tsx`); sem erro junto ao campo, sem `aria-invalid`/`aria-describedby`. | A | M |
| F2 | `Field` usa `<label>` a envolver o input (bom), mas sem marca de obrigatório nem texto de ajuda. | M | S |
| F3 | `window.confirm` em 3 sítios para apagar (nativo, em inglês consoante o browser, sem contexto). | A | S |
| F4 | `Modal` próprio: sem `role="dialog"`, `aria-modal`, Escape, prisão/devolução de foco nem bloqueio de scroll. O `Dialog` Radix já existe em `components/ui`. | A | S |
| F5 | Sem pré-visualização no import de CSV/XTB (a lógica existe: `previewXtbImport`). | M | M |
| F6 | `autoComplete`/`inputMode` incompletos; 19 inputs numéricos sem teclado numérico garantido em mobile. | M | S |

### 3.7 Estados (loading, vazio, erro, sucesso)

- **Loading:** só `asset-class-page` usa `animate-pulse`; as outras páginas mostram vazio ou texto "A carregar…" (`dividendos.tsx:357`). Sem skeletons nos KPIs e gráficos. **A / M**
- **Vazio:** existe `EmptyState` e é usado; falta variante para filtros sem resultados e para gráficos. **M / S**
- **Erro:** o componente de erro da raiz e o 404 estão **em inglês** ("Page not found", "Try again"). As queries tratam erros em 4 de 7 páginas. **A / S**
- **Sucesso/feedback:** `sonner` bem usado. Falta anular ("Desfazer") nas eliminações. **M / M**

### 3.8 Responsividade e mobile

| # | Problema | Grav. | Esf. |
|---|---|---|---|
| R1 | Dashboard com overflow horizontal a 390 px (649 px). Falta `min-w-0` nos filhos das grelhas `lg:grid-cols-2` e `truncate` nas linhas de ranking. | **C** | S |
| R2 | Tabelas (T1). | **C** | M |
| R3 | Navegação mobile é um menu hambúrguer + gaveta de 256 px; as 15 rotas e o rodapé (Modo privado/Sair) ocupam o ecrã; a lista tem scroll interno com **barra branca nativa**. | A | M |
| R4 | Sem `color-scheme: dark`: barras de scroll, `<input type="date">` e seletores nativos aparecem claros sobre o tema escuro. | M | S |
| R5 | Contentor `max-w-6xl` fixo: em monitores largos sobra espaço e o dashboard não aproveita mais colunas. | B | S |
| R6 | Sem manifest nem ícones: não é instalável. | B | S |

### 3.9 Dark/light mode

Tema **permanentemente escuro** (por decisão original). Os tokens existem como variáveis, por isso adicionar claro e "automático" é barato **se** os tokens forem consolidados antes (V1). Gráficos e `TOOLTIP_STYLE` já usam `var(--color-*)`, o que ajuda.

### 3.10 Acessibilidade (WCAG 2.2 AA)

Rácios medidos a partir dos tokens (fundo `oklch(.155)`, card `oklch(.195)`):

| Par | Rácio | Veredicto |
|---|---|---|
| Texto principal / fundo | 16,9 | OK |
| `muted-foreground` / fundo · / card | 6,05 · 5,66 | OK |
| **`muted-foreground/60` (rótulos "ATIVOS", "VALORES EM EUR") / fundo** | **4,03** | **Falha** (10 px, exige 4,5) |
| `primary` (dourado) / card | 10,4 | OK |
| `success` / card | 8,0 | OK |
| `destructive` / card | 4,72 | OK (por pouco) |
| Texto do botão primário | 10,1 | OK |
| **Borda de inputs / fundo** | **3,23** | OK (≥ 3:1) |
| **Borda dos cartões / fundo** | **2,67** | n/a (decorativa) |
| `chart-3` vs `chart-6` entre si | 1,04 (luminância) | Distinguem-se mal |

Restante:

- **A11y-1** (A/S): sem *skip link* para saltar a navegação; `<html lang="en">` (devia ser `pt-PT`); isto afeta leitores de ecrã e correção ortográfica.
- **A11y-2** (A/S): foco visível só no input (`focus:border-ring`); botões e links dependem do outline por defeito do browser, que o tema não trata. Falta `:focus-visible` global.
- **A11y-3** (A/M): `Modal` sem semântica (F4); `Link` ativo só indicado por cor/gradiente (sem `aria-current` explícito além do que o router dá).
- **A11y-4** (M/S): gráficos sem alternativa textual; tabela sem `<caption>`/`aria-sort`.
- **A11y-5** (M/S): `prefers-reduced-motion` não considerado (animações do `tw-animate-css`).
- **A11y-6** (B/S): 35 `aria-*` no código; bons nos botões de ação, ausentes nos KPIs ("variação positiva").

### 3.11 Microinterações e feedback

Bom: toasts do `sonner`, spinner no botão "Sincronizar". Falta: confirmações com contexto (F3), "Desfazer", animação de entrada dos números/gráficos, e indicação de **dados desatualizados** (os ETFs ficaram 19 dias sem preço e a app não avisou). **M / S**

### 3.12 Navegação e arquitetura de páginas

- 15 destinos em 3 grupos (Dashboard, Ativos×6, Análise×7). "Análise", "Inteligência", "Performance", "Exposição" e "Simulador" sobrepõem-se conceptualmente e escondem-se na gaveta em mobile.
- Não há pesquisa global nem atalhos de teclado (o `components/ui/command.tsx` já existe).
- As funcionalidades da Parte 1 ainda **não têm página**: Resumo fiscal (IRS), Import XTB, Alertas de qualidade, Alocação-alvo, FIRE, Calendário de dividendos, Sobreposição de ETFs, Exportação CSV. Proposta na secção 6.
- "Valores em EUR" fica no rodapé da barra lateral, escondido em mobile.

## 4. Proposta de design system

Sem novas dependências: Tailwind 4 + tokens CSS + os componentes shadcn/Radix que já estão no projeto.

### 4.1 Tokens

- **Cor (claro e escuro):** manter o dourado como acento (`primary`) e a escala neutra azulada. Consolidar `:root` (claro) e `.dark` (escuro) com os mesmos nomes; `color-scheme` por tema.
- **Semânticos novos:** `--gain`, `--loss`, `--warn`, `--info` (o `success`/`destructive` atuais mapeiam para estes), cada um com par `*-foreground` e versão `-subtle` (fundo a 12 %) para badges.
- **Paleta de gráficos:** 8 cores com luminosidade alternada (Okabe-Ito adaptada), ordem fixa por classe (ETF, REIT, Ações Div., Ações Cresc., Metais, P2P) para a mesma classe ter sempre a mesma cor em todo o lado.
- **Tipografia:** pilha do sistema (zero custo e já PT-PT-friendly); `tabular-nums` em todos os números. Escala: `display 32/36`, `h1 24/30`, `h2 18/24`, `body 14/20`, `caption 12/16`, `micro 11/14` (mínimo; elimina os 4 `text-[10px]`/`text-[11px]`).
- **Espaçamento:** grelha de 4 px; densidade "confortável" (cartões) e "compacta" (tabelas, comutável).
- **Raios/sombras/elevação:** raio 10 px nos cartões, 8 px nos controlos, 999 px em chips; 3 níveis de elevação (borda · borda+sombra suave · modal).
- **Movimento:** 150 ms/200 ms, `ease-out`; desligado com `prefers-reduced-motion`.

### 4.2 Componentes base

`Card` (+ `CardHeader`/`Stat`), `KpiTile` (valor, variação, sparkline opcional), `DataTable` (cabeçalho fixo, ordenação com `aria-sort`, colunas configuráveis, densidade, modo cartões em mobile), `Badge` (`gain/loss/warn/info`), `Money`/`Percent`/`DateText` (formatação PT-PT central e modo privado), `Field` (rótulo, ajuda, erro, obrigatório), `Dialog`/`ConfirmDialog` (Radix), `Skeleton`, `EmptyState`, `ErrorState`, `ChartFrame` (título, legenda, vazio, loading, tooltip PT-PT). Os atuais `ui-bits` passam a envolver estes (mantendo as assinaturas), para não partir as 15 páginas de uma vez.

## 5. Conceito do novo dashboard

Ordem de leitura de cima para baixo, uma pergunta por faixa:

1. **Faixa "Quanto tenho":** valor atual (grande) + variação do dia/período + P/L não realizado e realizado; botão de atualizar preços com "atualizado há X" e aviso se houver preços com mais de 3 dias.
2. **Faixa "Estou no caminho?":** progresso FIRE (barra + data estimada, `getFireProgress`) · rendimento de dividendos (12 m, yield sobre custo) · poupança necessária.
3. **Faixa "Como estou distribuído?":** donut por classe (cores fixas por classe) e abas região/setor (exposição consolidada). Sem divisão core/satélite: o desvio face a um objetivo só aparece por classe e **só se definires alvos** (opcional, `getAllocation`).
4. **Faixa "O que mudou?":** evolução temporal (valor vs. investido, com os snapshots), melhores/piores, próximos dividendos (`getDividendCalendar`).
5. **Faixa "O que preciso de tratar?":** alertas de qualidade de dados e fiscais (`getDataQualityAlerts`), importação pendente.

Em mobile: uma coluna, faixas colapsáveis, KPIs em carrossel horizontal com *snap*.

## 6. Melhorias priorizadas

| Pri. | Item | Esf. | Ref. |
|---|---|---|---|
| **Crítico** | Corrigir overflow do dashboard em mobile (`min-w-0`, `truncate`) | S | R1 |
| **Crítico** | Tabelas em cartões no mobile | M | T1, R2 |
| **Alto** | Módulo único de formatação PT-PT (milhares sempre, `%` fixo, eixos e países em PT) | S | 3.5, G1, G3 |
| **Alto** | `Dialog`/`ConfirmDialog` acessíveis (substituem `window.confirm` e o `Modal`) | S | F3, F4 |
| **Alto** | Foco visível global, `lang="pt-PT"`, skip link, contraste dos rótulos, `color-scheme` | S | A11y-1/2, R4 |
| **Alto** | Skeletons e estados de erro/vazio em todas as páginas; 404 e erro em PT-PT | M | 3.7 |
| **Alto** | Dashboard em 5 faixas (KPI herói, FIRE, alocação por classe) | M | D1, D2 |
| **Alto** | Validação em tempo real nos formulários, junto ao campo | M | F1 |
| **Alto** | `DataTable` com cabeçalho fixo, filtros, colunas e paginação | M | T2, T5 |
| **Médio** | Tema claro + automático; tokens consolidados | M | V1 |
| **Médio** | Navegação mobile inferior + "Mais"; pesquisa global (`Ctrl/⌘+K`) e atalhos | M | R3 |
| **Médio** | Páginas para as funcionalidades da Parte 1 (IRS, Import XTB com pré-visualização, FIRE, calendário, alocação) | L | 3.12 |
| **Médio** | Paleta de gráficos acessível + `ChartFrame` | M | G2, G4, G5 |
| **Baixo** | Manifest + ícones (instalável) | S | R6 |
| **Baixo** | Ícones únicos por destino; contentor largo; animações discretas | S | V4, R5 |

## 7. Decisões que preciso de ti

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| **D1** | Tema | (a) só escuro, como agora; (b) claro + escuro + automático | **(b)**: o custo é baixo com os tokens consolidados e ajuda em ecrãs com muita luz. O escuro continua por defeito. |
| **D2** | Navegação mobile | (a) manter a gaveta; (b) barra inferior com 4 destinos (Painel, Ativos, Dividendos, Análise) + "Mais" | **(b)** |
| **D3** | Tabelas em mobile | (a) scroll horizontal com a 1.ª coluna fixa; (b) cartões com 3 métricas e detalhe ao tocar | **(b)**; o scroll mantém-se só nas tabelas de análise densas. |
| **D4** | Dashboard | (a) **Painel por faixas** (secção 5); (b) compacto, tipo terminal, muita densidade; (c) minimalista, só 4 KPIs e 2 gráficos | **(a)** |
| **D5** | Core vs satélite | **Decidido: não se define core.** O dashboard não mostra essa divisão. Alvos de alocação por classe ficam como funcionalidade opcional (`allocation_targets`), sem valores por defeito. | — |
| **D6** | PWA | (a) nada; (b) manifest + ícones (instalável, sem *service worker*, sem dependências); (c) `vite-plugin-pwa` com *offline* | **(b)**; dados financeiros não devem ficar em cache offline. |
| **D7** | Lighthouse | (a) corres tu no DevTools antes e depois nas 4 páginas principais; (b) uso o `/auth` + um build local com sessão simulada | **(a)** para os números reais; eu junto o `/auth` automático. |
| **D8** | Escopo das páginas da Parte 1 | (a) só redesenhar o que existe; (b) incluir também as páginas novas (IRS, Import XTB, FIRE, calendário, alocação, qualidade de dados) | **(b)**, em PRs separados dentro do mesmo branch, por esta ordem: Import XTB, IRS, FIRE+alocação, calendário. |

Dependências novas previstas: **nenhuma** (Radix, `cmdk`, Recharts, `sonner` e `lucide` já existem). Fica de fora `@tanstack/react-table`: a ordenação/filtragem atual cabe num hook próprio e evita ~15 kB.

## 8. Plano da Fase B (após aprovação)

Um commit por tema, com `build` + `lint` + `tsc` + testes antes e depois de cada bloco:

1. Formatação PT-PT central + testes (`formatEUR` agrupado, `%`, eixos, países).
2. Tokens e tema claro/escuro, `color-scheme`, `lang="pt-PT"`, foco visível, skip link.
3. Componentes base (`Card`, `KpiTile`, `Badge`, `Field`, `Skeleton`, `ErrorState`, `ChartFrame`) por cima de `ui-bits`.
4. `Dialog`/`ConfirmDialog` e substituição dos 3 `window.confirm`.
5. Correção do overflow mobile + novo dashboard em faixas.
6. `DataTable` (cartões em mobile, cabeçalho fixo, filtros, colunas, paginação) aplicado às 6 classes e a Dividendos.
7. Gráficos: paleta, tooltips e eixos PT-PT, estados vazio/loading.
8. Formulários: validação junto ao campo, atalhos, import CSV/XTB com pré-visualização.
9. Navegação mobile, pesquisa global e atalhos; modo privado coerente em todos os ecrãs.
10. Páginas novas da Parte 1 (D8).
11. Manifest/PWA (D6), Lighthouse antes/depois, capturas antes/depois, `README.md` com o guia do design system, PR.

## 9. Riscos e salvaguardas

- **Lógica intocada:** só se mexe em apresentação; os testes (250) correm em cada bloco e os formatadores mantêm as assinaturas.
- **Lovable:** o `main` sincroniza com o Lovable; trabalho sempre em `audit/design-review`, sem *rebase* nem *force push*.
- **Privacidade das capturas:** as imagens do "antes/depois" no repositório só com o modo privado ligado.
- **Backup Lovable `4efe7885-…`:** não tocado.

## 10. Execução e verificação (Fase C)

**Estado:** Fase B implementada em `audit/design-review` (commits pequenos por tema). Lógica financeira, queries e schema **não foram alterados**.

| Verificação | Resultado |
| --- | --- |
| `./check.sh` (prettier + tsc + eslint + vitest) | limpo; 273 testes a passar |
| Verificação manual (localhost, sessão real, modo privado ligado) | Dashboard, ETFs, Dividendos, IRS, Calendário e Objetivos carregam sem overflow horizontal; tema escuro e claro conferidos |
| Mobile (390 px) | Dashboard sem overflow; barra inferior e cartões nas tabelas |
| Dependências novas | nenhuma |

**Pendente (decisão D7):** Lighthouse antes/depois nas 4 páginas principais, a correr pelo utilizador no DevTools (as páginas exigem sessão). Registar aqui os valores de Desempenho / Acessibilidade / Boas práticas / SEO.

**Seguimento sugerido:** validação junto ao campo também em `asset-position-modal.tsx` (compra/venda; hoje usa avisos); passagem visual final no Claude Design.
