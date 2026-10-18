# Roadmap

- [x] Uniformizar eixos temporais com mês/ano PT-PT e etiquetas mensais/trimestrais; tooltip com data completa quando existe um dia (agregados mensais mantêm mês/ano), sem mudar cálculos; 93 testes e verificação visual em computador/telemóvel com dados de teste.

- [x] FIRE: patamares (Half/Barista, Lean, FIRE, Fat), Coast FIRE (sem mais aportes) e FIRE com 28 % sobre mais-valias, sem schema/RLS; testes, typecheck e build verificados.
- [ ] FIRE: confirmação visual na carteira real (pendente do utilizador no preview).
- [ ] Carteira vs. benchmark real (mesmos aportes em S&P 500/VWCE) na página Desempenho.
- [x] Ficha ETF: "Principais posições" fixa nas 10 maiores (sem "Ver todas", pesquisa ou paginação) + linha de resumo com N e data; cálculos de bastidores inalterados.
- [x] Redesenhar ficha ETF e barras de setores/países; 62 testes e verificação visual com dados de teste, sem schema/RLS.

- [x] Sidebar "Dourado refinado": item ativo com barra dourada + gradiente, separadores limpos, tokens do tema
- [x] Modal do ativo: botões editar/apagar como ícones alinhados com o tema
- [x] Modal do ativo: histórico de movimentos com scroll próprio (header fixo), janela alargada
- [x] Typecheck, lint e CSS compilado verificados (confirmação visual pendente do utilizador no preview)
- [x] Mostrar yield médio no topo de REITs e Ações de Dividendos
- [x] ETFs: composição e exposição exclusivamente pelo JustETF
- [x] Ações de Crescimento em 2.º na barra lateral, logo abaixo de ETFs (2026-10-08)
- [x] Mesma ordem no Simulador, Análise, Dashboard e Desempenho (CLASS_ORDER) + teste que a bloqueia
- [x] Regra de segurança da tabela de perfis na base externa — confirmada no Supabase a 15/10/2026 (security_profiles só de leitura para autenticados; RLS em todas as tabelas)
- [x] Exposição: holdings completas, peso por empresa, cobertura por ETF e sincronização com gestoras sem alterações de schema/RLS
- [x] Corrigir os tipos da base externa sem alterar schema/RLS — pré-visualização compilada sem erros.
- [x] Validar exposição e sincronização na carteira real — 18 de 22 ETFs com lista completa (iShares, Vanguard, Xtrackers) a 15/10/2026; BNP, Global X, VanEck e WisdomTree só com o top 10
