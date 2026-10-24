# Portefólio Tracker — instruções para o Claude

App pessoal (TanStack Start com SSR, React, Supabase) para gerir uma carteira de investimentos de um residente em Portugal (IRS, broker XTB). Responder sempre em **português europeu**, de forma direta, e explicar o que se alterou em cada passo.

Visão geral, estrutura e convenções: `README.md`. Decisões de arquitetura: @AGENTS.md

## Fluxo de trabalho

O Lovable deixou de fazer parte do fluxo: o código edita-se aqui, o GitHub guarda-o e a Vercel publica-o.

1. Cada alteração numa branch própria, a partir do `origin/main` atualizado. Nunca commit direto no `main`.
2. Antes de **cada** push, correr e ver passar:
   ```sh
   bun run lint
   bunx tsc --noEmit
   bun run test
   ```
   Se mexer em `vite.config.ts`, dependências ou `bun.lock`, correr também `NITRO_PRESET=vercel bun run build`.
3. Push da branch → a Vercel cria uma _preview_ (`portefolio-tracker-git-<branch>-zeduarte10-5394.vercel.app`) e a CI do GitHub corre os mesmos checks.
4. Merge no `main` (só quando o utilizador pedir) → a Vercel publica em produção: `https://portefolio-tracker.vercel.app`.

Instalar dependências com `bun install --frozen-lockfile`; o `bun.lock` aponta para o registo público do npm.

## Base de dados (Supabase externo `azekwmamjovoguauncrg`)

- Os dados reais estão neste projeto, não na Lovable Cloud. `supabase/migrations/` é a fonte de verdade.
- Alterações de schema só por migração: aplicar com `apply_migration` do Supabase e depois criar o ficheiro em `supabase/migrations/` com o nome **igual à versão registada** (`list_migrations`). Sem isso, o check do Supabase no GitHub falha.
- Antes de mudar o schema, ver as tabelas existentes. Todas as tabelas têm RLS (`auth.uid() = user_id`); tabelas novas também.
- `drizzle/` e `drizzle.config.ts` servem só a Lovable Cloud: não usar.
- A Edge Function `supabase/functions/sync-etf-holdings/` publica-se à parte (`deploy_edge_function`, `verify_jwt = true`); o ficheiro no repositório tem de ficar igual ao publicado.

## Segredos e configuração

Nunca pedir segredos no chat nem os escrever em ficheiros do repositório. Só dizer onde se definem:

| Onde                          | Nome                                              | Para quê                                           |
| ----------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Vercel (Production e Preview) | `EXTERNAL_SUPABASE_SERVICE_KEY`                   | chave `sb_secret_…`, usada só pelo snapshot diário |
| Vercel (Production e Preview) | `CRON_SECRET` (e `CRON_SECRET_PREVIOUS` ao rodar) | autentica o pedido do agendamento                  |
| GitHub Actions (variável)     | `SITE_URL`                                        | endereço de produção, sem barra final              |
| GitHub Actions (segredo)      | `CRON_SECRET`                                     | o mesmo valor da Vercel                            |

O URL e a chave pública do Supabase estão em `vite.config.ts` (são públicos).

O snapshot diário corre em `.github/workflows/daily-snapshot.yml` (21:30 UTC, só a partir do `main`) e chama `POST /api/public/cron/daily-snapshot`; só o HTTP 200 conta como sucesso.

## Regras

- Pedir confirmação explícita antes de operações destrutivas: `DROP`, `DELETE`/`UPDATE` em massa, apagar colunas, apagar ficheiros fora do âmbito, `force push`, reescrever histórico.
- Não fazer merge no `main` nem mexer nele sem pedido.
- Cálculos fiscais e financeiros: lógica pura em `src/lib/*.ts`, com testes; formatação sempre pelos helpers de `src/lib/format.ts` (PT-PT).
