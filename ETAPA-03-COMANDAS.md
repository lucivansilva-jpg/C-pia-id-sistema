# Etapa 3 — Gestão avançada de comandas

Estado: concluída e validada localmente em 17/11/2026; ainda não publicada.

## Objetivo

Completar as operações do salão que ainda não existem, preservando integralmente os
fluxos já aprovados de pagamento, caixa, estoque, impressão e permissões.

## Escopo desta etapa

### 1. Transferência de mesa

- Disponível somente para comanda aberta.
- A mesa de destino precisa existir, estar ativa e livre.
- A troca da mesa e dos dois bloqueios ocorre na mesma transação.
- Exige motivo e registra mesa anterior, mesa nova, operador e horário.
- Não altera itens, valores, atendente, estoque ou pagamentos.

### 2. Impressão de complemento

- Cada lançamento de itens recebe identificação própria de lote.
- A primeira impressão envia o pedido completo.
- Depois de acrescentar produtos, o botão `Imprimir complemento` mostra somente o
  conjunto novo, identificado como complemento da mesma comanda.
- Continua existindo `Reimprimir pedido completo` para contingência.
- Imprimir não modifica pagamento, entrega ou estoque.
- O sistema registra quem imprimiu, qual lote e quando, evitando complemento duplicado
  por engano e permitindo reimpressão intencional.

### 3. Junção de comandas

- Somente comandas abertas, sem recebimentos e do mesmo estabelecimento.
- A comanda de destino recebe os itens da origem preservando preço, opções, adicionais,
  observações, autoria e histórico.
- A origem é encerrada, nunca apagada; o registro imutável da operação identifica a
  comanda de destino, o operador, o motivo e o horário.
- O total da operação antes e depois precisa permanecer igual.
- Nenhuma nova baixa de estoque é realizada.
- Bloqueios das mesas são atualizados na mesma transação.

### 4. Separação de conta por itens

- Somente comanda aberta e ainda sem recebimentos.
- O caixa seleciona item e quantidade a transferir para uma nova conta.
- Quantidades não podem ficar negativas ou fracionadas indevidamente.
- Soma dos totais das duas comandas deve ser igual ao total original.
- Custos e preços históricos dos itens são preservados.
- Não existe nova baixa nem devolução de estoque.
- A nova conta pode permanecer no balcão ou ocupar uma mesa livre.

## Fora do escopo

- Não alterar pagamento parcial, formas de pagamento, troco ou estorno.
- Não alterar abertura/fechamento de caixa.
- Não criar delivery, tela de cozinha, combos ou emissão fiscal.
- Não publicar o aplicativo nem regras remotas durante o desenvolvimento.

## Permissões

- Caixa e administrador: transferir, juntar e separar comandas.
- Garçom: apenas consultar a nova mesa e continuar acrescentando itens quando sua
  permissão atual permitir; não junta nem separa contas.
- Impressão continua exclusiva de quem possui `orders.print`.

## Critérios obrigatórios de aceitação

1. Duas pessoas tentando transferir/juntar a mesma comanda: somente uma operação vence.
2. Falha em qualquer documento: toda a operação é revertida.
3. Total combinado antes e depois permanece exatamente igual.
4. Estoque não sofre nova movimentação ao transferir, juntar ou separar.
5. Comanda com qualquer recebimento não pode ser juntada nem separada.
6. Uma mesa nunca fica vinculada a duas comandas ativas.
7. Garçom não consegue executar as operações por chamada direta.
8. Complemento contém somente itens novos; reimpressão completa continua disponível.
9. Todas as ações deixam auditoria legível.
10. Alimentação recebe as funções; Varejo não exibe mesas nem comandos de salão.

## Ordem de implementação

1. Modelo e regras transacionais.
2. Transferência de mesa.
3. Lotes e complemento de impressão.
4. Junção de comandas.
5. Separação por item/quantidade.
6. Interface responsiva do caixa.
7. Testes locais de concorrência, permissões, totais, estoque e impressão.

## Resultado da implementação

- As quatro funções foram adicionadas somente à modalidade Alimentação.
- Pagamentos, caixa, estoque e fluxo original do PDV foram preservados.
- Transferência, junção e separação usam transações atômicas e registros imutáveis em
  `orderOperations`.
- O controle de impressão complementar fica isolado em `orderPrintStates`, sem alterar
  versão, valores ou ciclo financeiro da comanda.
- Validação funcional: 13 fluxos completos aprovados.
- Validação oficial no Firestore Emulator: regras, API real, concorrência, permissões,
  impressão complementar, transferência, separação e junção aprovadas.
- Build, lint e conferência do pacote aprovados.

A publicação continua reservada para o final do conjunto de etapas.
