# Etapa 4 — Cancelamento parcial de itens

Estado: concluída e validada localmente em 17/11/2026; ainda não publicada.

## Regras implementadas

- Apenas administrador ou caixa com `orders.cancel` pode cancelar itens.
- A comanda precisa estar aberta, sem recebimento e sem desconto.
- O operador escolhe item e quantidade, informa motivo e ao menos um item precisa
  permanecer na comanda. Para cancelar tudo, permanece o cancelamento total já existente.
- Itens e total são alterados juntos em uma transação; não há exclusão de histórico.
- A operação é registrada de forma imutável, com operador, motivo, itens e horário.
- Produtos com estoque controlado têm somente a quantidade cancelada devolvida ao estoque.
- Se o item já tinha sido enviado à cozinha, a tela abre uma prévia de
  `CANCELAMENTO PARA COZINHA` para impressão imediata.
- Garçom não pode acionar o endpoint, inclusive por chamada direta.

## Fora do escopo

- Cancelamento parcial após desconto ou pagamento: exige uma futura rotina de ajuste
  financeiro/estorno, portanto é bloqueado para proteger caixa e relatórios.
- Delivery e pedido pelo cardápio público não fazem parte desta etapa.

## Validação

- Teste funcional local: cancelamento parcial, total recalculado, aviso de cozinha,
  permissões e continuidade das operações de comanda.
- Firestore Emulator: regras, transação real e integrações de comanda aprovadas.
