# Etapa 2 — Catálogo, opções, adicionais e disponibilidade

Estado: concluída e validada somente na cópia de desenvolvimento.

## O que foi implementado

- Editor estruturado de grupos de escolha, opções obrigatórias, adicionais pagos e observações rápidas.
- Uso das mesmas opções em Alimentação e Varejo, sem obrigar o cliente a preencher esses campos.
- Escolha das opções e da quantidade dos adicionais no PDV, com total calculado antes de incluir o item.
- Disponibilidade imediata do produto: `Disponibilizar` ou `Marcar esgotado`.
- Sincronização em tempo real do catálogo interno e do cardápio público.
- Projeção pública sanitizada: nome, imagem, preço, disponibilidade, opções e adicionais; custos e demais dados privados não são expostos.
- Gravação do produto e de sua projeção pública na mesma transação.
- Validação transacional no fechamento: a venda é recusada se preço, disponibilidade, estoque, nome ou configuração do produto mudar depois que ele foi colocado no carrinho.
- Preço histórico preservado nas vendas e comandas já confirmadas.
- Correção do carregamento do plano básico: módulos de mesas e estoque desativados não são consultados nem exibidos.

## Limites aplicados

- Até 8 grupos de escolha por produto.
- Até 30 valores por grupo.
- Até 30 adicionais por produto.
- Quantidade de 1 a 10 para cada adicional no atendimento.
- Nomes duplicados no mesmo grupo ou na lista de adicionais são rejeitados.

## Verificações executadas

- `npm run build`.
- `npm run test:firebase:simulator`: 12 fluxos funcionais aprovados.
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 node firestore.rules.test.ts`: verificações estáticas, 12 barreiras de segurança e 6 fluxos oficiais aprovados.
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 node checks/contracts-emulator.test.mjs`: módulos, limite de usuários e concorrência aprovados.
- Navegador local com Firebase Auth e Firestore Emulator: cadastro, cardápio público, esgotamento em tempo real e composição no PDV aprovados em Alimentação e Varejo.

## Segurança do ambiente

- Nenhuma regra foi publicada.
- Nenhum dado ou usuário do Firebase de produção foi acessado ou alterado.
- Nenhuma publicação do aplicativo foi feita.
- Todos os logins e dados utilizados nesta validação existem apenas nos emuladores locais.
