# 📊 Portefólio Tracker

Aplicação pessoal para acompanhar, analisar e projetar uma carteira de investimentos multi-classe de ativos — ações, ETFs, dividendos, REITs, metais preciosos e P2P — pensada para um investidor residente em Portugal (IRS, broker XTB).

**App em produção:** https://portefolio-tracker.lovable.app

## O que faz

| Página                                                                 | O que mostra                                                                                                                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**                                                          | Valor da carteira, variação no período, rendimento passivo, alocação, FIRE, melhores e piores posições, exposição e avisos aos dados                                 |
| **ETFs · Ações Crescimento · REITs · Ações Dividendos · Metais · P2P** | Posições por classe, com a ficha de cada ativo (movimentos FIFO, composição dos ETFs, taxas em gramas dos metais, rondas da Scramble)                                |
| **Dividendos**                                                         | Separadores _Recebidos_ (retenção na fonte por país, valores líquidos, yield sobre o custo) e _Calendário_ (projeção dos próximos pagamentos)                        |
| **Desempenho**                                                         | TWR, XIRR, evolução do capital, carteira vs. S&P 500, desempenho por classe e queda máxima, a partir das fotografias diárias                                         |
| **Risco e exposição**                                                  | Riscos de concentração com look-through dos ETFs, peso real por empresa, países, setores, moedas e cobertura das gestoras                                            |
| **Objetivos**                                                          | Separadores _FIRE_ (patamares, Coast FIRE), _Alocação_ (alvos e rebalanceamento por aportes, sem vender), _Projeções_ (a partir do objetivo FIRE) e _Simular compra_ |
| **Resumo fiscal (IRS)**                                                | Mais-valias por lote (Anexo G), dividendos e juros (Anexos J e E), estimativa de imposto e simulação de englobamento                                                 |
| **Importar extrato XTB**                                               | Concilia movimentos com o valor real do broker e confirma dividendos e retenções; idempotente                                                                        |

Uma tarefa diária (21:30 UTC, agendada no Lovable) atualiza as cotações e guarda a fotografia da carteira em `/api/public/cron/daily-snapshot`.

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
| `supabase/migrations/`   | Migrações da base de dados da app (fonte de verdade; ver abaixo)                             |

Convenções: valores em EUR guardados em `numeric`; datas `YYYY-MM-DD` no fuso de Lisboa (`lib/dates.ts`); números lidos com `parseNumberPt` (aceita `1.234,56`); apresentação com `formatEUR`, `formatPercent` e `formatDatePt` (dd/mm/aaaa).

## Base de dados e migrações

A app usa o projeto Supabase **externo** `azekwmamjovoguauncrg` (definido em `vite.config.ts`), não a base da Lovable Cloud.

- **`supabase/migrations/` é a fonte de verdade** dessa base. Cada ficheiro tem de ter **exatamente** a versão registada no Supabase (`supabase_migrations.schema_migrations`; ver `list_migrations`). O `apply_migration` regista a hora a que a migração é aplicada, por isso o nome do ficheiro faz-se depois, com essa versão. Se faltar um ficheiro, o check do Supabase no GitHub falha com "Remote migration versions not found".
- **`drizzle/` é gerido pelo Lovable** para a base da Lovable Cloud (`LOVABLE_DB_MIGRATION_URL`), que não guarda os dados da carteira. Não se edita à mão.
- **`supabase/functions/sync-etf-holdings/`** é a Edge Function do botão "Sincronizar com gestoras". Corre com a sessão do utilizador e publica-se à parte no projeto externo (`deploy_edge_function`, `verify_jwt = true`); o ficheiro no repositório tem de ficar igual ao publicado. Gestoras com lista completa: **iShares**, **Vanguard**, **Xtrackers**, **Global X** e **VanEck**. A VanEck só mostra a composição depois de um aviso de investidor: a função envia os cookies de "investidor particular em Portugal", que o utilizador autorizou a 15/10/2026. No Excel da Xtrackers (DWS) as ações vêm com o tipo "Equities"; a leitura está em `dws.ts`, com testes. A BNP Paribas tem a ficha do fundo avariada no próprio site (certificado TLS errado e 403) e a WisdomTree bloqueia pedidos automáticos (Cloudflare). Por isso a composição destes dois ETFs foi carregada à mão a 15/10/2026: a da WisdomTree a partir do CSV do site (`manager_slug = 'wisdomtree'`) e a da BNP a partir do relatório anual, com as posições a 31/12/2025 (`manager_slug = 'bnpparibas'`). O sync não lhes toca; para os atualizar, volta a carregar-se um ficheiro novo.
- Todas as tabelas têm RLS: cada utilizador só lê e escreve as suas linhas (`auth.uid() = user_id`). A `security_profiles` é só de leitura para utilizadores autenticados.

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

O relatório da auditoria de código, dados e funcionalidade está em [docs/AUDITORIA-CODIGO.md](docs/AUDITORIA-CODIGO.md).

## Continuar no Lovable

Para desenvolver via prompt em vez de código, usa o [editor Lovable](https://lovable.dev/projects/fb89b30f-b81a-4611-baa2-9ab7f69a190f) — descreve o que queres construir e o Lovable trata da implementação, sincronizando diretamente com o `main` deste repositório.

## Design system

Tudo em PT-PT, com formatação europeia (`1 448,40 €`, `12,5 %`, `dd/mm/aaaa`) vinda de `src/lib/format.ts`; nunca formatar valores à mão.

| Peça                                         | Onde                              | Notas                                                                                                                          |
| -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tokens (cores, raios, gráficos `chart-1..8`) | `src/styles.css`                  | `:root` = claro, `.dark` = escuro; usar `var(--color-…)`, sem cores fixas                                                      |
| Tema claro / escuro / automático             | `src/components/theme.tsx`        | guardado em `localStorage` (`pt-theme`), sem flash inicial                                                                     |
| Componentes base                             | `src/components/ui-bits.tsx`      | `Card`, `MetricCard`, `Badge`, `Button`, `Field`, `Modal`, `EmptyState`, `ErrorState`, `useConfirm` (confirmações destrutivas) |
| Tabelas                                      | `src/components/data-table.tsx`   | ordenação, pesquisa, colunas configuráveis, cabeçalho fixo, paginação, cartões em mobile (`renderCard`)                        |
| Gráficos                                     | `src/components/chart-kit.tsx`    | `ChartFrame` (vazio/loading), `ChartTooltip`, eixos e grelha uniformes                                                         |
| Navegação                                    | `src/components/nav-config.ts`    | sidebar, barra inferior mobile, pesquisa global (Ctrl/⌘+K), atalhos (`?`)                                                      |
| Modo privado                                 | `src/components/private-mode.tsx` | esconde valores; passar `hidden` aos formatadores                                                                              |
| PWA                                          | `public/manifest.webmanifest`     | só instalável; sem service worker nem cache offline de dados financeiros                                                       |

Regras: foco visível sempre; contraste AA; números com a classe `num`; erros de formulário junto ao campo (`Field error`); `min-w-0` em filhos de grelhas para evitar overflow em mobile.
