# 📊 Portefólio Tracker

Aplicação pessoal para acompanhar, analisar e projetar uma carteira de investimentos multi-classe de ativos — ações, ETFs, dividendos, REITs, metais preciosos e P2P.

**App em produção:** https://asset-replicator-bot.lovable.app

## O que faz

- **Dashboard de exposição** — visão global da carteira por classe de ativo e métricas agregadas
- **Mais-valias por FIFO** — cálculo automático de ganhos/perdas realizados
- **Desempenho histórico e projeções** — evolução da carteira e projeções determinísticas para o futuro
- **Simulador de decisões** — testa cenários de compra sem alterar a carteira real
- **Análise de concentração e inteligência** — deteta sobreposição e risco de concentração entre posições
- **Importação de histórico** — carregamento de transações com normalização e deteção de duplicados
- **Dividendos auditados** — acompanhamento de rendimentos com verificação automática face ao histórico de transações
- **Câmbios em tempo real** — conversão automática para ativos denominados em moeda estrangeira

## Stack

- **Frontend:** TanStack Start + TypeScript
- **Backend:** Supabase
- Construído e mantido no [Lovable](https://lovable.dev) — as alterações no editor sincronizam automaticamente com este repositório, e vice-versa

## Desenvolvimento local

Precisas de Node.js e npm ([instala via nvm](https://github.com/nvm-sh/nvm#installing-and-updating)):

```sh
git clone <url-deste-repositório>
cd Portefolio-Tracker
npm i
npm run dev
```

## Continuar no Lovable

Para desenvolver via prompt em vez de código, usa o [editor Lovable](https://lovable.dev/projects/fb89b30f-b81a-4611-baa2-9ab7f69a190f) — descreve o que queres construir e o Lovable trata da implementação, sincronizando diretamente com o `main` deste repositório.
