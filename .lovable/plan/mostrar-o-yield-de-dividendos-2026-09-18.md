# Mostrar o yield de dividendos

## Alterações
- Adicionar uma coluna **Yield** à tabela de Ações de Dividendos, usando o yield anual já obtido dos dados reais do mercado.
- Permitir ordenar as ações por yield, tal como as restantes colunas.
- Adicionar uma coluna **Yield** ao histórico da página Dividendos, associando cada pagamento ao ativo correspondente.
- Mostrar `—` quando o yield não estiver disponível, sem estimar nem inventar valores.

## Detalhes técnicos
- Reutilizar `assets.annual_yield`, já calculado a partir dos dividendos dos últimos 12 meses e do preço atual.
- Formatar o valor como percentagem e respeitar o modo privado.
- Não alterar a base de dados nem a lógica de importação de dividendos.

## Validação
- Confirmar tipos, formatação e testes existentes.
