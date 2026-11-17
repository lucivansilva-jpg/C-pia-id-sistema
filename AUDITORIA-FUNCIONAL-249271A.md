# Auditoria funcional — versão 249271a

Data da auditoria: 17/11/2026.

Base analisada: commit `249271a`, sem considerar tentativas locais posteriores.

## Resultado principal

O sistema já possui uma base muito mais completa do que um PDV inicial. As próximas
etapas não devem reconstruir caixa, pagamentos, produtos ou ERP. Devem acrescentar
somente operações ainda inexistentes.

## Funcionalidades que já existem

### Plataforma, empresas e acessos

- Separação dos dados por estabelecimento.
- Modalidades Alimentação e Varejo definidas pelo administrador da plataforma.
- Módulos e limite de usuários definidos no contrato de cada estabelecimento.
- Proprietário, caixa e garçom com contas e permissões individuais.
- Perfis e exceções de permissão editáveis.
- Área de suporte com modo consulta ou alteração e registros de auditoria.
- Demonstrações públicas isoladas dos dados reais.

### Produtos e catálogo

- Cadastro, edição, arquivamento, foto, categoria, código e código de barras opcional.
- Favoritos individuais.
- Opções obrigatórias, adicionais pagos, observações rápidas e cálculo do novo preço.
- Disponível/esgotado com sincronização do catálogo e cardápio público.
- Cardápio por QR Code somente para consulta.
- Importação CSV/Excel e leitura orientada de PDF/JPG/PNG, com revisão antes de gravar.
- Custo direto ou ficha de composição, quando o módulo correspondente está ativo.

### Atendimento, comandas e PDV

- Venda direta no balcão sem criar comanda de produção.
- Comanda de balcão ou mesa, com autoria do atendente.
- Inclusão posterior de novos itens em comanda aberta.
- Vendas/contas em espera.
- Caixa abre uma comanda existente no PDV sem duplicar seus itens.
- Cancelamento sem recebimento e controle de entrega.
- Impressão para cozinha, conferência e cupom não fiscal em 58 ou 80 mm.
- Prévia automática do cupom após concluir a venda.

### Pagamentos e caixa — não refazer

- Dinheiro, Pix, crédito e débito.
- Pagamento integral ou parcial.
- Pagamento misto já é possível registrando cada forma em sequência na mesma comanda.
- Troco calculado no recebimento em dinheiro.
- Pix e cartão identificados como confirmação manual antes da baixa.
- Proteção transacional contra valor acima do saldo e pagamentos simultâneos.
- Idempotência contra clique/requisição repetida.
- Abertura, fechamento por forma, suprimento, sangria, despesa e caixa cego.
- Dinheiro físico separado das demais formas no fechamento.

### Estoque, compras e financeiro

- Produto sem estoque, produto pronto por unidade ou baixa por receita.
- Estoque mínimo, ajustes, fornecedores e compras com recebimento.
- Baixa atômica de estoque junto da venda.
- Clientes opcionais e histórico de compras.
- Desconto autorizado.
- Estorno, devolução, troca, reposição opcional de estoque e preservação do custo histórico.
- Contas a pagar/receber, recorrência, liquidação e integração com caixa.
- Visão geral, vendas, ticket, produtos, atendentes, despesas, custos e resultado estimado.

## Lacunas reais encontradas

### Prioridade operacional

1. Transferir uma comanda aberta de uma mesa para outra mesa livre.
2. Imprimir complemento de cozinha contendo somente os itens acrescentados desde a
   última impressão, sem perder a possibilidade de reimprimir o pedido completo.
3. Juntar duas comandas abertas e ainda não recebidas, sem baixar estoque novamente.
4. Separar itens ou quantidades de uma comanda aberta para outra conta, sem alterar o
   total geral e sem movimentar estoque novamente.
5. Histórico específico dessas operações: origem, destino, operador, data e motivo.

### Etapas futuras, não incluídas agora

- Fila opcional da cozinha com estados recebido, preparando e pronto.
- Combos/kits e promoções compostas.
- Delivery com endereço, taxa, entregador e acompanhamento.
- Emissão fiscal/NFC-e.
- Integração automática com WhatsApp.
- Envio de chamados por e-mail.

## Decisão da auditoria

Pagamento em várias formas numa única janela é uma melhoria de conveniência, não uma
falha funcional: o sistema já registra pagamentos mistos de forma segura, um por vez.
Ela não será prioridade e não justifica reescrever o fluxo existente.

A próxima etapa será exclusivamente **Gestão avançada de comandas**, conforme o
documento `ETAPA-03-COMANDAS.md`.
