# Portefolio Tracker — migração do Base44 para o Lovable

O link continua a pedir login (só consigo ver o ecrã de entrada), por isso a réplica vai ser feita a partir da tua descrição e das screenshots/exportações que me enviares. O visual base já é visível: fundo claro, cartão branco com sombra suave, azul-petróleo muito escuro como cor principal e acentos em turquesa, tipografia geométrica.

## O que vou construir

Uma app de gestão e análise de carteira de investimentos com autenticação e base de dados no Lovable Cloud.

Páginas:
- Dashboard (visão geral: valor total, ganho/perda, alocação por classe, evolução)
- ETFs
- REITs
- Ações Dividendos
- Ações Growth
- Metais
- P2P
- Dividendos (calendário e histórico de recebimentos)
- Análise (desempenho, comparações, concentração)

Cada página de classe de ativo terá: lista de posições, adicionar/editar/eliminar, métricas de topo (investido, valor atual, P/L, %) e gráficos.

## Dados

- Modelo: contas/carteiras, ativos, posições, transações (compra/venda), dividendos, preços.
- Cada utilizador só vê os seus próprios dados (regras de segurança por utilizador).
- Migração: exportas os dados do Base44 em CSV/JSON e eu importo-os para as tabelas correspondentes. Um ecrã de importação CSV fica disponível para futuras cargas.

## Dados em tempo real

Cotações e preços em tempo real precisam de uma fonte externa. Proponho começar com preços manuais/importados e, numa segunda fase, ligar um fornecedor de cotações (ex.: Finnhub, Twelve Data, Alpha Vantage) com a tua chave de API.

## O que preciso de ti

1. Screenshots das páginas principais (sobretudo Dashboard e uma página de classe de ativo) para replicar o layout com fidelidade.
2. Exportação dos dados do Base44 (CSV/JSON) — assim consigo mapear os campos exatos.

Podes enviar já ou depois: começo pela estrutura e visual, e importo os dados quando chegarem.

## Detalhes técnicos

- TanStack Start + Tailwind, tokens de design semânticos (tema escuro/claro consistentes).
- Lovable Cloud: autenticação (email/password + Google), Postgres com RLS por `auth.uid()`, tabelas `assets`, `positions`, `transactions`, `dividends`, `price_snapshots`.
- Rotas protegidas sob `_authenticated/`; leituras via server functions autenticadas.
- Gráficos com Recharts; tabelas com ordenação e filtros.
- Importação CSV processada em server function com validação Zod.

## Faseamento

1. Cloud + auth + esquema de dados + layout/navegação e Dashboard.
2. Páginas por classe de ativo com CRUD e métricas.
3. Dividendos e Análise.
4. Importação dos dados do Base44 e, opcionalmente, cotações automáticas.
