# Auditoria de limpeza e usabilidade — Portefólio Tracker

Fase A (diagnóstico) · 14/10/2026 · `main` em `4604156` (depois dos PRs #38–#41: avisos, P2P Scramble e metais Elementum).

Objetivo: deixar a app **limpa e intuitiva**. Esta auditoria não repete a de 08/10 (`AUDITORIA-DESIGN.md`, já aplicada). Olha para o que se acumulou desde então: páginas que se sobrepõem, números que se contradizem, nomes e verbos inconsistentes e código que sobra.

**Estado técnico:** `tsc` limpo, `eslint` limpo, **325 testes a passar** (36 ficheiros). A base está saudável. Os problemas são de arquitetura de informação e coerência, não de estabilidade.

**Limitação:** não vi a app ao vivo. O browser da app não tem a tua sessão e eu não introduzo palavras-passe. A análise foi feita ao código (19 rotas, componentes e `lib`). Para a passagem visual da Fase C, basta iniciares sessão no painel do browser e eu revejo cada página com o modo privado ligado.

---

## 1. Resumo executivo

1. **Há páginas a mais para o que a app faz.** São 19 destinos no menu. O grupo "Análise" tem 7, e quatro deles respondem à mesma pergunta ("estou concentrado?") com números diferentes.
2. **A app contradiz-se.** A Inteligência diz que ter 60 % em ETFs não é risco. O Simulador avisa "A classe ETFs ultrapassaria 40 % da carteira" e baixa o score de diversificação. A Análise mostra a concentração no top 3 por instrumento. São três critérios em três páginas.
3. **Dados configurados num sítio são ignorados noutro.** As Projeções arrancam sempre com 500 €/mês e um objetivo de 50 000 €, mesmo que o FIRE em Objetivos já tenha o teu aporte e retorno guardados.
4. **"Próximos pagamentos" aparece em 4 sítios** (Dashboard, Dividendos, Calendário e P2P), com fontes diferentes: anunciados, projetados ou juros P2P.
5. **Os nomes não batem certo.** No menu chama-se "Desempenho" e a página diz "Performance". "Inteligência" abre "Inteligência da Carteira". "Objetivos e FIRE" abre "Objetivos". "P2P" abre "P2P · Scramble". Há 5 verbos para "ir buscar dados": Atualizar, Atualizar preços, Sincronizar, Auditar e Atualizar composição.
6. **Sobra código.** 34 dos 46 componentes em `components/ui` não são usados, assim como cerca de 25 dependências que só eles importam. Há 28 cartões feitos à mão em vez do `Card`, há listas de invalidação de cache copiadas em 6 sítios e há duas pastas de migrações.

---

## 2. Arquitetura de navegação

### 2.1 Hoje (19 destinos)

| Grupo | Páginas |
|---|---|
| Início | Dashboard |
| Carteira (6) | ETFs · Ações Crescimento · REITs · Ações Dividendos · Metais · P2P |
| Análise (7) | Dividendos · Análise · Desempenho · Exposição · Objetivos e FIRE · Projeções · Inteligência |
| Ferramentas (4) | Simulador · Calendário de dividendos · IRS · Importar XTB |

### 2.2 Sobreposições encontradas

| Pergunta do utilizador | Onde é respondida hoje |
|---|---|
| Quanto vale cada classe? | Dashboard (Alocação) · Análise (Investido vs. atual) · Exposição (Por classe) · Inteligência (Perfil por instrumento) · Simulador (Alocação atual) |
| Estou concentrado? | Análise (top 3 por instrumento) · Inteligência (look-through + score) · Exposição (concentração país/setor/moeda) · Simulador (score HHI por instrumento) |
| Maiores posições/empresas | Análise (Maiores posições) · Inteligência (Maiores exposições) · Exposição (Top 10 empresas) · Dashboard (Exposição) |
| Rentabilidade por classe | Análise (Rentabilidade por classe) · Desempenho (Desempenho por classe) |
| Que rendimento vou receber? | Dashboard · Dividendos (Próximos) · Calendário · P2P |
| Onde meto o próximo aporte? | Objetivos (Onde investir o próximo aporte) · Simulador |
| Quanto vou ter no futuro? | Objetivos (previsão FIRE) · Projeções |

### 2.3 Proposta (13 destinos)

| Grupo | Página | Absorve |
|---|---|---|
| Início | **Dashboard** | sem alterações |
| Carteira | ETFs · Ações Crescimento · REITs · Ações Dividendos · Metais · P2P | sem alterações |
| Rendimento | **Dividendos**, com separadores *Recebidos* e *Calendário* | Calendário de dividendos |
| Análise | **Desempenho** | "Investido vs. atual" e "Rentabilidade por classe" da Análise |
| | **Risco e exposição** | Exposição + Inteligência + "Maiores posições" da Análise |
| | **Objetivos**, com separadores *FIRE*, *Alocação-alvo* e *Projeções* | Projeções; o Simulador passa a ser o "Simular aporte" da alocação-alvo |
| Ferramentas | **IRS** · **Importar** | sem alterações |

Ganhos: o grupo Análise passa de 7 para 3 páginas. Cada pergunta fica com uma só resposta. Os atalhos `g`+letra mantêm-se, e as rotas antigas redirecionam para a nova (`/analise` → `/desempenho`, `/inteligencia` → `/exposicao`, `/calendario` → `/dividendos?tab=calendario`, `/projecoes` e `/simulador` → `/objetivos?tab=…`), para não partir marcadores.

---

## 3. Contradições e erros

Gravidade: **A** alta · **M** média · **B** baixa.

| # | Problema | Onde | Grav. |
|---|---|---|---|
| E1 | O Simulador penaliza ETFs, ao contrário do critério da Inteligência: o alerta ">40 % por classe" e o score HHI por instrumento disparam sempre que reforças o core. | `lib/decision.ts:96-101` vs. `lib/intelligence.ts:111-115` | **A** |
| E2 | No Simulador, a classe e o ativo escolhem-se em separado. É possível escolher um ETF existente com a classe "REITs", e a alocação simulada sai errada. | `simulador.tsx:18-61` | **A** |
| E3 | As Projeções ignoram o aporte e o retorno guardados no FIRE e arrancam com valores fixos (500 €/mês, 10 anos, 50 000 €). | `projecoes.tsx:50-52` | **A** |
| E4 | A Análise conta as posições fechadas em "Nº de posições" (`assets.length`), porque `listAssets` devolve também as fechadas. | `analise.tsx:49,103` | M |
| E5 | No Desempenho, o texto diz "Não existem snapshots diários" logo acima de um gráfico feito com snapshots, que são criados todos os dias ao entrar (`ensureDailySnapshot`). O estado vazio diz que só se criam com "Atualizar preços". | `performance.tsx:241,324` | M |
| E6 | O modo privado deixa ver percentagens no Simulador: peso da compra, maior posição e alocação. | `simulador.tsx:87,98,109` | M |
| E7 | O botão "Atualizar" do Dashboard não refresca a exposição, a Scramble nem o calendário. Cada ecrã invalida uma lista diferente de *queries* (35 chamadas espalhadas). | `index.tsx:247-252` e outros | M |
| E8 | No FIRE, "Despesas cobertas" diz "dividendos líquidos (12 m)", mas o cálculo já inclui os juros P2P. | `objetivos.tsx:269` | B |
| E9 | Ao escolher um ativo na pesquisa global vais para a página da classe, mas o ativo não abre. | `app-shell.tsx:164` | B |
| E10 | As mensagens de risco e alertas usam `toFixed`, o que dá ponto decimal (`12.3%`) no meio da app em PT-PT. | `intelligence.ts:157-174`, `decision.ts:97` | B |

---

## 4. Consistência e linguagem

| # | Problema | Proposta |
|---|---|---|
| C1 | O título da página e o rótulo do menu diferem: Desempenho/Performance, Inteligência/"Inteligência da Carteira", "Objetivos e FIRE"/Objetivos, P2P/"P2P · Scramble". | Uma única fonte: o `PageHeader` lê o rótulo do `nav-config`. |
| C2 | Cinco verbos para obter dados: Atualizar, Atualizar preços, Sincronizar, Auditar, Atualizar composição. "Auditar" é jargão. | **Atualizar cotações** · **Atualizar dividendos** · **Atualizar composição**. "Auditar" passa a "Verificar dividendos", no menu "⋯". |
| C3 | Mistura de registo: "Adicione ativos ao seu portefólio" e "Atualize os dados" contra "tu" no resto da app. | Tudo em "tu" (`analise.tsx:55`, `exposicao.tsx:174`, `inteligencia.tsx:134`). |
| C4 | Inglês na interface: "Cost basis (FIFO)", "Score", "ledger", "look-through", "snapshots", "Drawdown". | Custo (FIFO) · Pontuação · movimentos · "contando o que está dentro dos ETFs" · fotografias · Queda máxima. As siglas TWR/XIRR ficam com explicação. |
| C5 | Emoji como ícone (`⚠️`) e cartões de aviso feitos à mão. | `Badge`/`Alert` do design system. |
| C6 | Formulários com três estilos: `Field`+`TextInput` (Objetivos), `<input type="number">` cru (Projeções, Simulador) e `<select>` cru (4). O `type="number"` recusa a vírgula decimal em alguns browsers. | Tudo com `Field`, `TextInput inputMode="decimal"` e `SelectInput`. |
| C7 | O Simulador e a Inteligência não têm `head` (o separador do browser não mostra o nome da página) nem estados de carregamento ou vazio. | Igual às outras páginas. |
| C8 | Cada linha das tabelas de ativos tem 4 ícones (comprar/vender, importar dividendos, editar, eliminar). A ação principal tem o mesmo peso que eliminar. | Tocar na linha abre a ficha do ativo. Fica um ícone principal (movimento) e um menu "⋯" com o resto. |

---

## 5. Limpeza de código

| # | Item | Impacto |
|---|---|---|
| L1 | 34 componentes `components/ui/*` sem uso (accordion, calendar, carousel, chart, form, select, sidebar, tabs, etc.) e cerca de 25 dependências que só eles importam (Radix, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `vaul`, `react-hook-form`, `@hookform/resolvers`, `date-fns`). | Menos ruído no projeto e instalações mais rápidas. O *bundle* final não muda, porque o código sem uso já era descartado. Os componentes que vierem a fazer falta (`tabs`, por exemplo, na secção 2.3) ficam. |
| L2 | 28 cartões `rounded-xl border bg-card p-5` à mão, apesar de existir `Card` em `ui-bits`. | Aspeto uniforme e menos código. |
| L3 | `CLASS_ROUTE` duplicado em `app-shell.tsx:24` (já existe `CLASS_ROUTES` em `nav-config.ts`). | Uma só fonte. |
| L4 | Listas de invalidação de cache copiadas. | Um helper `invalidatePortfolio(queryClient, scope)`, que também resolve E7. |
| L5 | Duas pastas de migrações: `drizzle/migrations` (Lovable) e `supabase/migrations` (MCP/CLI). Já causou o desalinhamento corrigido no PR #41. | Documentar no `README` qual é a fonte de verdade, ou deixar de gerar uma delas. |
| L6 | Ficheiros de trabalho na raiz: `PR-DESCRICAO.md`, `roadmap.md` (com um item pendente de 08/10) e dois relatórios de auditoria antigos. | Mover para `docs/` e manter o `README` curto. |
| L7 | `vite-tsconfig-paths` já não é preciso: o Vite 8 resolve os paths sozinho e avisa disso em cada teste. | Retirar o plugin e ativar `resolve.tsconfigPaths`. |
| L8 | Ficheiros grandes: `asset-class-page.tsx` (1188 linhas), `asset-position-modal.tsx` (1160) e `scramble-panel.tsx` (604). Os metais e o P2P já têm lógica própria lá dentro. | Separar o formulário por classe e a tabela da página. Facilita mexer sem partir as outras classes. |

---

## 6. Plano proposto (Fase B, depois da tua aprovação)

Um branch, um PR por bloco e `tsc` + `eslint` + testes em cada um. Só o bloco 3 mexe em lógica.

1. **Correções rápidas** (S): E4, E5, E6, E8, E9, E10, C3, C4, C5 e C7.
2. **Coerência de nomes e ações** (S): C1, C2 e C8; helper de invalidação (L4, E7); L3.
3. **Critério único de concentração** (M): o Simulador passa a usar o motor da Inteligência (look-through) e os alvos de alocação, se existirem (E1, E2).
4. **Nova navegação** (M): fundir as páginas como na secção 2.3, com redirecionamentos e atalhos (E3 fica resolvido ao ligar as Projeções ao FIRE).
5. **Limpeza** (S): L1, L2, L6 e L7.
6. **Refatoração dos ficheiros grandes** (M, opcional): L8.
7. **Fase C:** passagem visual na app real (desktop e 390 px, modo privado) e capturas antes/depois.

## 6.1 Estado (15/10/2026)

- **Decisões D1–D5 aprovadas** (todas as recomendações).
- **Revalidação:** a análise foi feita sobre uma cópia local atrasada 60 commits (PRs #42–#45: FIRE com patamares, comparação com o S&P 500, fotografia diária automática, redesenho de ETFs e Exposição). Ao rever o `main` atualizado, todos os pontos continuam válidos, exceto o primeiro texto do E5, que já tinha sido corrigido. O estado vazio das fotografias continuava errado e foi corrigido no bloco 1.
- **Bloco 1 feito** no branch `cleanup/bloco-1-correcoes`: E2 (antecipado do bloco 3, por ser só de interface), E4, E5, E6, E8, E9, E10, C3, C5 e C7; de C4, os termos em inglês do Desempenho, do Simulador e da Inteligência, mais o "Cost basis". O título "Desempenho" (parte de C1) também ficou feito. Juntado no PR #46.
- **Bloco 2 feito** no branch `cleanup/bloco-2-coerencia`: C1 (títulos iguais ao menu, protegido por teste), C2 (verbos "Atualizar cotações" e "Atualizar dividendos"; "Auditar" passa a "Verificar dividendos" no menu "⋯"), C8 (o nome do ativo abre a ficha; nas linhas ficam a ação principal e o menu "⋯") e L4/E7 (`invalidatePortfolio`, com um teste que obriga cada chave de query nova a estar na lista). L3 já tinha ficado feito no bloco 1. O C6 (formulários das Projeções) passa para o bloco 4, junto com a fusão das Projeções em Objetivos. Juntado no PR #47 e publicado.
- **Bloco 3 feito** no branch `cleanup/bloco-3-concentracao` (E1): o Simulador usa o motor da Inteligência (`computeLookThrough`), com os mesmos limites (10 % por empresa, 30 % nas 5 maiores). O alerta fixo de 40 % por classe e o score HHI por instrumento saem. O peso das classes só se compara com os alvos de alocação, quando existem, com aviso se a compra afasta a classe do alvo e nota positiva se a aproxima. Um ETF novo, ainda sem composição, não conta como uma empresa. Juntado no PR #48 e publicado.
- **Bloco 4 feito** no branch `cleanup/bloco-4-navegacao` (D1, D2, D3, E3, C6): 13 destinos. **Dividendos** com os separadores Recebidos e Calendário. **Desempenho** absorve a Análise (coluna Investido na tabela por classe). **Risco e exposição** absorve a Inteligência: riscos e recomendações com sinal de estado, sem pontuação. **Objetivos** com os separadores FIRE, Alocação, Projeções e Simular compra; as Projeções partem do aporte, do retorno e do número FIRE guardados e usam os campos do design system. As rotas antigas (`/analise`, `/inteligencia`, `/calendario`, `/projecoes`, `/simulador`) redirecionam. Os atalhos `g n`, `g i`, `g k`, `g j` e `g s` deixam de existir. Juntado no PR #49 e publicado.
- **Bloco 5 feito** no branch `cleanup/bloco-5-limpeza`. **L1:** saem 39 componentes `ui/` sem uso (ficam command, dialog, dropdown-menu, popover, skeleton, tabs e tooltip) e 28 dependências que só eles usavam (`bun remove`, com o `bun.lock` atualizado). **L2:** os cartões feitos à mão já tinham saído com as páginas fundidas no bloco 4; os que restam são listas, esqueletos e avisos, e o aviso de risco da Scramble passa ao estilo de aviso. **L6:** os relatórios de auditoria passam para `docs/`; o `roadmap.md` fica na raiz, porque o Lovable o atualiza. **L7 fica de fora:** o `vite-tsconfig-paths` vem incluído no `@lovable.dev/vite-tanstack-config` e o aviso sai de lá; tirá-lo partiria a configuração. **L5** também fica de fora: falta confirmar com o utilizador qual das pastas de migrações é a fonte de verdade.

- **Supabase (15/10/2026)**, branch `fix/supabase-alinhamento`:
  - **L5:** fica documentado no README que `supabase/migrations` é a fonte de verdade da base externa e que `drizzle/` é do Lovable.
  - **Migrações:** havia 6 aplicadas a 13/10 sem ficheiro (pg_net, holdings completas da iShares, `map_gics_sector`). Os ficheiros foram recriados com as versões exatas.
  - **Segurança:** as 14 tabelas têm RLS. O único aviso é a proteção contra palavras-passe expostas, que se liga no painel.
  - **Dados:**
    - 54 cotações de 13/10. A tarefa diária, agendada para as 21:30 UTC, foi criada a 14/10 às 22:41, por isso a primeira execução é a 15/10.
    - 18 de 22 ETFs com a lista completa.
    - O iShares World Small Cap tem um erro de *timeout* da última sincronização.
    - O livro de movimentos bate com as quantidades.
  - **Desempenho por classe:** passa a seguir a CLASS_ORDER.

## 7. Decisões que preciso de ti

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Aceitas a navegação de 13 destinos (2.3)? Alternativa: manter as páginas e só corrigir as contradições. | **Sim.** É o que mais contribui para tornar a app intuitiva. |
| D2 | A **pontuação** da Inteligência mantém-se? É uma fórmula arbitrária (−12 por risco), difícil de interpretar. | Retirá-la e mostrar só os riscos com semáforo. |
| D3 | A **Análise** desaparece (o conteúdo vai para Desempenho e Risco)? | **Sim.** |
| D4 | Retiro os componentes `ui/*` e as dependências sem uso? O Lovable pode voltar a gerá-los se pedires algo lá. | **Sim.** |
| D5 | Ordem: correções primeiro (blocos 1–3) e navegação depois, ou tudo num só PR? | **Blocos separados**, para poderes testar no Lovable entre eles. |
