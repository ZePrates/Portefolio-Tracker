# ETFs apenas com JustETF

## Alterações
- Fazer a sincronização de composição e exposição dos ETFs consultar exclusivamente o JustETF pelo ISIN.
- Remover do fluxo de ETFs o Yahoo Finance e os fornecedores das gestoras iShares/Vanguard.
- Manter o Yahoo Finance apenas para os restantes ativos, incluindo preços e dividendos fora desta sincronização de exposição.
- Atualizar os textos do formulário para indicar que o ISIN identifica o ETF no JustETF.
- Remover os módulos e testes das gestoras que deixarem de ser usados.

## Validação
- Confirmar que o código dos ETFs não referencia Yahoo, iShares ou Vanguard para composição/exposição.
- Executar lint, verificação de tipos e testes relevantes.
