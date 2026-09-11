# Auditoria e correção do sistema de vendas

## O que encontrei no código atual (verificado)

- A tabela `transactions` existe na base de dados mas **está completamente vazia (0 registos)** e **não é usada em lado nenhum da app**: a única referência é `listTransactions` em `src/lib/portfolio.functions.ts`, que nenhum ecrã chama.
- Não existe nenhum conceito de venda. `src/components/asset-class-page.tsx` só permite Adicionar / Editar / Eliminar ativo. Vender obriga hoje a editar a quantidade à mão (perde-se o histórico) ou a eliminar o ativo (perde-se tudo).
- Não existe tabela de lotes. Na importação do Base44 os 87 lotes foram agregados em 49 ativos com preço médio ponderado, por isso **hoje o método de custo é implicitamente preço médio e não há histórico de lotes individuais**.
- `invested_amount` / `current_value` são valores gravados na linha do ativo e recalculados no formulário (`quantity × preço`). Não há lucro realizado em lado nenhum.
- Todos os agregados (Dashboard, Análise, páginas de classe) somam **todos** os ativos, sem filtrar por quantidade > 0. Existe já 1 ativo com quantidade 0 que continua a contar como posição.

Conclusão: o problema é estrutural — falta um livro de movimentos. A correção passa por ativar a tabela `transactions` que já existe (vazia, logo sem risco de duplicação) como ledger, e derivar dela quantidade e lucro realizado.

## Como vou corrigir

### 1. Base de dados (uma migração, sem apagar nada)

Estender `transactions` (está vazia, portanto é seguro):

- `fee` (comissão, EUR, default 0), `fee_native`
- `native_currency`, `price_native`, `fx_rate`
- `realized_pl` (preenchido apenas nas vendas, EUR)
- `notes`, `updated_at` + trigger

Estender `assets`:

- `status` ('open' / 'closed') com default 'open'
- `realized_pl` (acumulado, default 0)
- `total_fees` (default 0)
- `closed_at` (data em que a quantidade chegou a zero)

Backfill preservando os dados atuais: para cada ativo existente com quantidade > 0 crio **uma** transação de compra sintética (`quantity`, `price = average_price`, `total = invested_amount`, data = `created_at`, `source = 'backfill'`). Assim o ledger passa a reconstituir exatamente a posição atual, sem alterar um único valor já visível na app. O ativo com quantidade 0 fica `status = 'closed'`.

### 2. Backend (`src/lib/portfolio.functions.ts`)

- `sellAsset({ assetId, quantity, price_native, fee, traded_at })`: valida que a quantidade vendida não excede a detida, calcula o custo com **FIFO** sobre as compras do ledger (as compras backfilled contam como um lote único ao preço médio, o que é a única informação de custo que existe), grava a transação de venda com `realized_pl`, e atualiza o ativo: nova quantidade, novo `invested_amount` (custo remanescente), `realized_pl` acumulado, `total_fees`. Quando a quantidade chega a 0 → `status = 'closed'`, `closed_at`, `current_value = 0`, mas a linha do ativo e todas as transações **mantêm-se**.
- `buyAsset(...)`: compras adicionais passam a criar transação e a recalcular quantidade/custo (mantém o preço médio como métrica de apresentação, com FIFO por trás).
- `listTransactions` passa a aceitar filtro por `assetId`.
- Comissões: subtraídas ao produto da venda antes de calcular o lucro realizado (`(preço × qtd) − fees − custo FIFO`).
- Toda a lógica FIFO fica numa função pura em `src/lib/fifo.ts` para poder ser testada isoladamente.

### 3. Frontend

- `src/lib/portfolio-types.ts`: helpers `isOpenPosition(a)`, `assetRealizedPL(a)`; `assetCurrentValue` devolve 0 para posições fechadas.
- `src/components/asset-class-page.tsx`: botão **Vender** por linha, com modal (quantidade, preço na moeda nativa, comissão, data) e pré-visualização do lucro realizado antes de confirmar. A tabela passa a mostrar só posições abertas; abaixo, uma secção recolhível **Histórico de vendas** com as posições fechadas e o P/L realizado. Novo cartão de métrica **Lucro realizado**.
- Dashboard e Análise: agregados passam a usar apenas posições abertas; o Dashboard ganha um cartão de lucro realizado (e passa a distinguir P/L não realizado de realizado).
- Nova página `/historico` com o extrato completo de compras e vendas.

## Preservação de dados

Nada é apagado: nenhum `DELETE`, nenhuma alteração a `quantity`, `average_price` ou `invested_amount` dos ativos existentes. Só se acrescentam colunas com defaults e as transações sintéticas de backfill (marcadas com `source = 'backfill'`, portanto reversíveis e identificáveis). O ativo já a zero é marcado como fechado, não removido.

## Como vou testar

1. **Teste do exemplo pedido**, via script sobre a base de dados real de teste: comprar 10 @ €100 → vender 4 @ €130 → confirmar 6 unidades, €120 de lucro realizado, investido remanescente €600 → vender 6 @ qualquer preço → confirmar 0 unidades, ativo fora das posições atuais, histórico completo intacto.
2. Caso com comissões (ex.: €2 na venda → lucro €118) e caso com prejuízo.
3. Venda superior à quantidade detida → tem de ser rejeitada.
4. Verificação de que os totais do Dashboard antes e depois da migração de backfill são idênticos (nada muda para o utilizador enquanto não houver vendas).
5. Percurso no browser (Playwright) autenticado: vender parcialmente, confirmar tabela e histórico.

Só depois de isto validado passamos aos outros pontos.
