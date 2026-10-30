# Auditoria de funcionamento — 30/10/2026

**Base:** `main` @ `241bae1` (depois dos PR #72–#78) · **Âmbito:** dados, infraestrutura e código.
Complementa a [auditoria de 07/10](AUDITORIA-CODIGO.md) — os achados F1–F26 dessa auditoria foram revistos no fim deste documento.

## 1. Resumo

A app está em bom estado. Os dados estão consistentes, há 536 testes e não aparecem erros recorrentes em produção.
Corrigi três problemas reais (a fotografia fantasma, a data do snapshot diário e as dependências vulneráveis). O que falta é sobretudo manutenção e um par de ações tuas.

| Área            | Estado          | Notas                                                                                                                 |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Dados           | ✅              | Ledger = quantidades guardadas em todos os ativos; sem órfãos; fotografias total = soma das classes em todas as datas |
| Snapshot diário | ⚠️ → ✅         | O GitHub atrasa a execução para depois da meia-noite; a data ficava errada (corrigido neste PR)                       |
| Supabase        | ✅ / 1 ação tua | Sem avisos de desempenho; 1 aviso de segurança (proteção de passwords vazadas desligada)                              |
| Vercel (7 dias) | ✅              | 1 erro isolado (`PGRST303 JWT issued at future`, desfasamento de relógio)                                             |
| Dependências    | ⚠️ → ✅         | `bun audit`: 23 vulnerabilidades → 1 (zod 3)                                                                          |
| Código          | ✅              | lint 0 erros (7 avisos inofensivos), tsc limpo, 55 ficheiros / 536 testes                                             |

## 2. Dados (Supabase)

| Verificação                                                | Resultado                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Fotografias: total vs soma das classes (investido e valor) | ✅ 0 divergências, depois de apagar as 210 linhas fantasma                                                                                  |
| Fotografias: dias sem total desde 19/02/2024               | ⚠️ 1 dia em falta: **26/10/2026** (ver 3.1)                                                                                                 |
| Quantidade guardada vs livro de movimentos                 | ✅ 0 divergências                                                                                                                           |
| Transações, dividendos, holdings e exposições órfãos       | ✅ 0                                                                                                                                        |
| Holdings de ETFs fechados                                  | ✅ 0                                                                                                                                        |
| Duplicados aparentes (1 transação, 16 dividendos)          | ✅ Falsos: a XTB parte cada pagamento por lote (O 4+4, KMB 1+1) e cada linha tem ID de evento próprio; a VWCE de 19/02/2024 são duas ordens |
| Dividendos dos EUA sem retenção                            | ✅ 0 (o F2 de 07/10 está resolvido nos dados)                                                                                               |
| Câmbio das transações em moeda estrangeira                 | ✅ 36 históricas, 8 do broker, 1 atual (compra de hoje)                                                                                     |
| Preços com mais de 3 dias                                  | ✅ 0                                                                                                                                        |
| Ações e REITs sem ISIN                                     | ℹ️ 32 de 32 (ver 5.3)                                                                                                                       |
| Tabela `security_profiles`                                 | ℹ️ 0 linhas e nenhum código a usa (ver 5.4)                                                                                                 |

### 2.1 Corrigido: posição fantasma

Entre 17/02 e 14/09/2025 havia 210 fotografias `class:acao_dividendo` com 183,11 € investidos, de uma reconstrução antiga (`rebuild`), sem nenhuma transação correspondente. As fotografias do total estavam certas; a soma das classes não.
Efeito: o TWR desde o início das ações de dividendos dava −99,7% e o gráfico da classe mostrava um período que não existiu. **Apagadas** (com confirmação), numa transação limitada a essa classe, datas, origem e valor.

## 3. Infraestrutura

### 3.1 Corrigido: data do snapshot diário

O `daily-snapshot.yml` está marcado para as 21:30 UTC, mas o GitHub atrasa os agendamentos: as últimas execuções foram às 23:29, 00:42, 00:40 e 01:10 UTC. A fotografia usava a data de "hoje", por isso:

- a execução de 26/10 correu a 27/10 às 00:42 e ficou com a data de 27/10 → **26/10 em falta**;
- as fotografias de 27, 28 e 29/10 têm, na prática, os fechos do dia anterior;
- no horário de verão, qualquer atraso para depois das 23:00 UTC já mudava o dia.

**Correção:** `cronSnapshotDate()` usa a data de Lisboa 6 horas antes da execução (uma execução até às 06:00 pertence ao dia anterior) e a resposta do endpoint passa a mostrar `snapshotDate` no log do Actions. Testes com as execuções reais.

**Depois do merge:** corre **Importar → Reconstruir histórico**. Volta a calcular todas as fotografias até ontem a partir do ledger e dos fechos do Yahoo: preenche o dia 26/10 e corrige o desfasamento dos dias anteriores.

### 3.2 Supabase

- Desempenho: sem avisos. Os índices de `dividends` já estão consolidados (o ponto pendente do F14).
- Segurança: **Leaked password protection desligada** (F23, continua por fazer). Ação tua: Supabase → Authentication → Passwords → ativar. [Documentação](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

### 3.3 Vercel

Nos últimos 7 dias há só um erro: `PGRST303 JWT issued at future`, uma vez, na função dos alertas de qualidade de dados. É um desfasamento de segundos entre os relógios do Supabase Auth e da base de dados; passa ao recarregar. Se se repetir, a correção é tentar outra vez uma única vez quando o erro for `PGRST303`.

### 3.4 Segredos

O `.env` que esteve no histórico (F5) tinha só `SUPABASE_URL`, `PROJECT_ID` e chaves `sb_publishable_` de três projetos antigos da Lovable Cloud — não o Supabase atual e nenhuma chave secreta. **Sem risco; F5 fechado.** Li apenas os nomes das variáveis e o prefixo das chaves.

## 4. Código

| Verificação           | Resultado                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`        | 0 erros, 7 avisos: 6 de _fast refresh_ (ficheiros que exportam componentes e constantes; inofensivo) e 1 `exhaustive-deps` intencional em `asset-position-trade.tsx`                                 |
| `bunx tsc --noEmit`   | ✅ limpo                                                                                                                                                                                             |
| `bun run test`        | ✅ 55 ficheiros, 536 testes                                                                                                                                                                          |
| `bun audit`           | 23 → **1** depois de `bun audit fix` (seroval 1.6.11, vite 8.1.6, vitest 4.1.12, brace-expansion, js-yaml, nanoid, source-map-js). Fica o **zod 3** (correção só no zod 4)                           |
| Bundle do browser     | 73 ficheiros, 1,57 MB (455 KB gzip). Maior: `index` 516 KB (148 KB gzip); `recharts` 333 KB (87 KB gzip)                                                                                             |
| Código morto (`knip`) | Nada relevante: os 3 "ficheiros sem uso" são falsos positivos (`server.ts`, `error-capture.ts` e a Edge Function); os exports sem uso são sobretudo constantes usadas nos testes e componentes `ui/` |

## 5. O que pode ser limado (por prioridade)

| #   | O quê                                    | Porquê                                                                                                                 | Esforço                                                    | Quem                   |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------- |
| 5.1 | Correr **Reconstruir histórico**         | Preenche 26/10 e corrige o desfasamento das fotografias                                                                | 1 clique                                                   | Tu, depois do merge    |
| 5.2 | Ativar **Leaked password protection**    | Último aviso de segurança do Supabase                                                                                  | 1 clique                                                   | Tu                     |
| 5.3 | **ISIN nas 32 ações e REITs**            | O look-through já agrega por ISIN (#72), mas nas posições diretas cai no ticker/nome. Com ISIN a identidade fica exata | S (formulário do ativo, ou eu preencho com confirmação)    | Tu ou eu               |
| 5.4 | Remover a tabela **`security_profiles`** | 0 linhas e nenhum código a usa. Migração `DROP TABLE`                                                                  | S                                                          | Eu, só com confirmação |
| 5.5 | Migrar para **zod 4**                    | Última vulnerabilidade (DoS em coleções enormes; risco baixo numa app pessoal com login)                               | M (APIs mudaram: `.email()`, mensagens, `z.string().min`…) | Eu                     |
| 5.6 | Dividir o bundle principal               | 148 KB gzip no primeiro carregamento; carregar o `recharts` e as páginas pesadas (Importar, IRS) só quando se abrem    | M                                                          | Eu                     |
| 5.7 | Atualizações menores                     | React 19.3, supabase-js 2.118, TanStack Query 5.105, Radix. Majors à espera: recharts 3, lucide 1, zod 4               | S por grupo                                                | Eu                     |
| 5.8 | Repetir uma vez em `PGRST303`            | Se o erro de relógio voltar a aparecer                                                                                 | S                                                          | Eu, se se repetir      |

## 6. Estado dos achados de 07/10

| #   | Antes                  | Agora                                                                                                    |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| F1  | ⏳ dados por confirmar | ✅ 44 de 45 movimentos com câmbio histórico ou do broker; 1 com o câmbio atual (compra de hoje, correto) |
| F2  | ⏳ recálculo           | ✅ dividendos dos EUA com retenção registada                                                             |
| F5  | ⏳ ação tua            | ✅ sem segredos (ver 3.4)                                                                                |
| F14 | ⏳ índices             | ✅ índices de `dividends` consolidados                                                                   |
| F23 | ⏳ ação tua            | ⏳ continua por fazer (ver 5.2)                                                                          |

## 7. Trabalho de 29–30/10/2026

| PR       | Mudança                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #72      | Depósitos P2P ("Investor pay-in") e look-through agrupado por ISIN                                                                                                                                  |
| —        | 14 movimentos da Scramble reclassificados na BD (investido do P2P = 600 €)                                                                                                                          |
| #73      | Yield com mudança de cadência dos dividendos (STAG mensal → trimestral)                                                                                                                             |
| #74      | Atualização de preços grava a frequência dos dividendos                                                                                                                                             |
| #75      | TWR e XIRR por classe                                                                                                                                                                               |
| #76      | Riscos de concentração com a identidade ISIN                                                                                                                                                        |
| #77      | Calendário de resultados (Finnhub)                                                                                                                                                                  |
| #78      | Verificação cruzada do yield com o Finnhub                                                                                                                                                          |
| —        | 210 fotografias fantasma apagadas                                                                                                                                                                   |
| este     | Data do snapshot diário, `bun audit fix`, esta auditoria                                                                                                                                            |
| seguinte | Yield real a partir dos dividendos recebidos (XTB): especiais à parte, 4 yields no ecrã do ativo; sai a verificação pelo Finnhub (#78), que errava em 6 de 6 casos por usar cotações desatualizadas |
