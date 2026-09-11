# Portefólio Tracker — migração do Base44 para o Lovable

Já consegui aceder ao app sem login e explorei todas as páginas. Estrutura e design confirmados:

- **Tema escuro** (fundo quase preto), sidebar à esquerda com logo dourado, acentos em **amarelo/dourado**, valores em EUR, toggle "Modo privado" (oculta valores).
- Menu: Dashboard, ETFs, REITs, Ações Dividendos, Ações Crescimento, Metais Preciosos, P2P, Dividendos, Análise.
- O portefólio anónimo está vazio — os teus dados reais terão de vir por exportação CSV/JSON do Base44 (ou reintrodução manual).

## O que vou construir

Réplica fiel do app: gestão e análise de carteira de investimentos com autenticação e base de dados no Lovable Cloud.

### Layout

- Sidebar fixa: logo "Portefólio TRACKER", itens com ícones, "Modo privado" e "VALORES EM EUR" no rodapé.
- Cabeçalho de página: título + subtítulo descritivo + botões de ação ("Atualizar preços", "Importar exposição", "Adicionar").

### Páginas (rotas reais do original)

- `/` Dashboard — visão global; métricas e gráficos; estado vazio com "Adicionar primeiro ativo".
- `/etfs` — "Fundos negociados em bolsa — exposição diversificada por índice, setor ou geografia."
- `/reits` — "Fundos de investimento imobiliário — rendimento via dividendos."
- `/acoes-dividendos` — "Ações de empresas que distribuem dividendos regularmente."
- `/acoes-crescimento` — "Ações de empresas com foco em crescimento de capital."
- `/metais` — "Ouro e prata físicos em cofre — peso em gramas."
- `/p2p` — "Empréstimos a marcas europeias de bens de consumo. Grupo A até 12.4% · Grupo B até 25%." Métricas: valor total, investido, capital em empréstimos, rendimento anual; gestão por contas.
- `/dividendos` — recebidos no ano, projeção anual (com base no yield), média mensal projetada, total histórico; calendário e histórico.
- `/analise` — exposição, alocação e rentabilidade detalhadas.

### Cada página de classe de ativo

Cartões de métricas no topo (Valor atual, Total investido, Ganho/Perda com %, Posições), tabela de posições, adicionar/editar/eliminar ativo, e gráficos.

## Dados

- Tabelas: `assets` (classe, ticker, nome), `positions`, `transactions` (compra/venda), `dividends`, `price_snapshots`, `p2p_accounts`/`p2p_loans`, `metals_holdings`.
- Cada utilizador só vê os seus dados (RLS por utilizador).
- Importação CSV/JSON dos dados exportados do Base44.

## Preços

Fase 1: preços manuais/importados. Fase 2 (opcional): fornecedor de cotações (Finnhub, Twelve Data, etc.) com a tua chave API para o botão "Atualizar preços".

## Detalhes técnicos

- TanStack Start + Tailwind, tokens semânticos; tema escuro com dourado como cor primária.
- Lovable Cloud: auth (email/password + Google), Postgres com RLS por `auth.uid()`, rotas protegidas sob `_authenticated/`.
- Gráficos com Recharts; formatação EUR (pt-PT).
- Importação CSV em server function com validação Zod.

## Faseamento

1. Cloud + auth + esquema + layout/sidebar + Dashboard.
2. Páginas por classe de ativo com CRUD e métricas.
3. Dividendos e Análise.
4. Importação dos dados do Base44 e, opcionalmente, cotações automáticas.
