# 📊 Portefólio Tracker

Aplicação pessoal para acompanhar, analisar e projetar uma carteira de investimentos multi-classe de ativos — ações, ETFs, dividendos, REITs, metais preciosos e P2P — pensada para um investidor residente em Portugal (IRS, broker XTB).

**App em produção:** https://asset-replicator-bot.lovable.app

## O que faz

- **Dashboard de exposição** — visão global da carteira por classe de ativo e métricas agregadas
- **Mais-valias por FIFO** — custo por lote, com o câmbio da data de cada movimento (exigido pelo IRS)
- **Desempenho histórico e projeções** — TWR, XIRR e drawdown a partir de fotografias diárias da carteira
- **Simulador de decisões** — testa cenários de compra sem alterar a carteira real
- **Análise de concentração e inteligência** — look-through dos ETFs e risco de concentração
- **Dividendos auditados** — elegibilidade reconstruída do histórico, retenção na fonte por país, valores líquidos
- **Câmbios em tempo real** — conversão automática para ativos denominados em moeda estrangeira

Lógica e dados já disponíveis (interface na próxima fase):

- **Resumo fiscal anual** — mais-valias por lote (Anexos G/J, códigos G01/G20), dividendos (E11), estimativa a 28% com crédito de imposto estrangeiro e simulação de englobamento
- **Import do extrato XTB** (Cash Operations, CSV) — concilia movimentos manuais com o valor real do broker, confirma dividendos e retenções; idempotente
- **Alertas de qualidade de dados** — preços desatualizados, livro ≠ quantidade, ETFs sem composição, dividendos sem retenção, câmbios por confirmar
- **Alocação-alvo e rebalanceamento** por aportes, sem vender
- **Progresso FIRE**, **calendário de dividendos projetado**, **sobreposição entre ETFs** e **exportações CSV** em formato PT

> ⚠️ Os cálculos fiscais são uma ajuda ao preenchimento, não aconselhamento fiscal. Confirma sempre no Portal das Finanças.

## Stack

- **Frontend:** TanStack Start + TypeScript (strict), React Query, Recharts
- **Backend:** Supabase (Postgres com RLS em todas as tabelas) via server functions com autenticação
- Construído e mantido no [Lovable](https://lovable.dev) — as alterações no editor sincronizam automaticamente com este repositório, e vice-versa

## Estrutura

| Pasta                    | Conteúdo                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `src/lib/*.ts`           | Lógica pura e testada (FIFO, câmbio, dividendos, fiscalidade, performance, formatação PT-PT) |
| `src/lib/*.functions.ts` | Server functions (cada uma exige sessão; os dados ficam protegidos por RLS)                  |
| `src/lib/*.server.ts`    | Acesso a fontes externas (Yahoo Finance, justETF, Financial Times) com timeout e retry       |
| `src/routes/`            | Páginas (TanStack Router)                                                                    |
| `supabase/migrations/`   | Migrações SQL (cada uma com instruções para reverter no cabeçalho)                           |

Convenções: valores em EUR guardados em `numeric`; datas `YYYY-MM-DD` no fuso de Lisboa (`lib/dates.ts`); números lidos com `parseNumberPt` (aceita `1.234,56`); apresentação com `formatEUR`, `formatPercent` e `formatDatePt` (dd/mm/aaaa).

## Desenvolvimento local

Precisas de [Bun](https://bun.sh) (ou Node.js + npm):

```sh
git clone <url-deste-repositório>
cd Portefolio-Tracker
bun install
bun run dev
```

Verificações (as mesmas da CI):

```sh
bun run lint          # ESLint
bunx tsc --noEmit     # tipos
bun run test          # Vitest
bun audit             # vulnerabilidades das dependências
```

## Auditoria

O relatório da auditoria de código, dados e funcionalidade está em [AUDITORIA-CODIGO.md](AUDITORIA-CODIGO.md).

## Continuar no Lovable

Para desenvolver via prompt em vez de código, usa o [editor Lovable](https://lovable.dev/projects/fb89b30f-b81a-4611-baa2-9ab7f69a190f) — descreve o que queres construir e o Lovable trata da implementação, sincronizando diretamente com o `main` deste repositório.

## Design system

Tudo em PT-PT, com formatação europeia (`1 448,40 €`, `12,5 %`, `dd/mm/aaaa`) vinda de `src/lib/format.ts`; nunca formatar valores à mão.

| Peça | Onde | Notas |
| --- | --- | --- |
| Tokens (cores, raios, gráficos `chart-1..8`) | `src/styles.css` | `:root` = claro, `.dark` = escuro; usar `var(--color-…)`, sem cores fixas |
| Tema claro / escuro / automático | `src/components/theme.tsx` | guardado em `localStorage` (`pt-theme`), sem flash inicial |
| Componentes base | `src/components/ui-bits.tsx` | `Card`, `MetricCard`, `Badge`, `Button`, `Field`, `Modal`, `EmptyState`, `ErrorState`, `useConfirm` (confirmações destrutivas) |
| Tabelas | `src/components/data-table.tsx` | ordenação, pesquisa, colunas configuráveis, cabeçalho fixo, paginação, cartões em mobile (`renderCard`) |
| Gráficos | `src/components/chart-kit.tsx` | `ChartFrame` (vazio/loading), `ChartTooltip`, eixos e grelha uniformes |
| Navegação | `src/components/nav-config.ts` | sidebar, barra inferior mobile, pesquisa global (Ctrl/⌘+K), atalhos (`?`) |
| Modo privado | `src/components/private-mode.tsx` | esconde valores; passar `hidden` aos formatadores |
| PWA | `public/manifest.webmanifest` | só instalável; sem service worker nem cache offline de dados financeiros |

Regras: foco visível sempre; contraste AA; números com a classe `num`; erros de formulário junto ao campo (`Field error`); `min-w-0` em filhos de grelhas para evitar overflow em mobile.
