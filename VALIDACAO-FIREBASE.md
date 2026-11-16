# Validação e publicação das regras do ID Sistema

## Executar sem acessar o projeto real

Requisitos: Node 22.18 ou superior, Java 21 e dependências instaladas com `npm ci`.

```sh
npm run test:firebase:rules
npm run test:firebase:simulator
npm run build
```

O comando de regras baixa/utiliza firebase-tools 15.36.0 e inicia o Firestore Emulator na porta 8185. Usa somente o projeto fictício `demo-idsistema-test`. A suíte limpa esse banco LOCAL antes de preparar os dados. Não utilizar esta configuração para deploy nem apontar testes destrutivos a um serviço remoto.

Se o emulador configurado não responder, a suíte falha. Uma execução estática sem emulador continua sendo identificada como PENDENTE e não serve como aprovação de publicação.

## O que foi conferido

- Leitura isolada por estabelecimento e por autoria do garçom.
- Custos privados; bloqueio de acesso pelo garçom e revogação de alteração de preços pelo perfil.
- Bloqueio de pedido pago sem lançamento financeiro e de sessão duplicada sem lock.
- Recebimento atômico: pedido + ledger + sessão.
- Código real de `web/firebase-client.js` e `web/system/firebase-api.js`, com SDK oficial conectado ao emulador: cadastro de produto com custo privado; criação de pedido em mesa; inclusão de itens; entrega; recebimento; liberação de mesa; repetição idempotente; venda direta; suprimento; fechamento e abertura de caixa.
- Dois recebimentos concorrentes para a mesma comanda: um retorna 201, outro 409; somente um recebimento integra o saldo.

O adaptador roda em VM com normalização de objetos entre contextos. As identidades dos testes são injetadas por `@firebase/rules-unit-testing`. As gravações e as regras são do SDK/emulador oficiais; não usa o simulador próprio para aprovar esses fluxos. Login real no provedor, interface no navegador e impressora física precisam de conferência no ambiente de publicação.

## Publicação é separada do GitHub

Banco esperado: projeto `zippy-helper-q6ppv`, database `ai-studio-idsistema-a88ce91d-746f-4ce3-9882-3c20c94ca389`.

1. Sincronizar o código corrigido entre GitHub e AI Studio, sem sobrescrever as regras validadas com uma versão antiga.
2. No banco correto, publicar o conteúdo COMPLETO de `firestore.rules` desta versão. Não publicar no banco de outro aplicativo nem ativar faturamento para este procedimento.
3. Confirmar a nova versão publicada e publicar o aplicativo correspondente.
4. Conferir login de proprietário/garçom/caixa e impressora no endereço público antes de iniciar atendimento de clientes.

O console identifica este projeto como Starter do AI Studio com cota compartilhada de IA. Os limites Spark citados anteriormente não devem ser assumidos como limites deste projeto.

As verificações locais não publicam regras e não alteram dados reais. Esta validação cobre os fluxos acima; não representa auditoria integral de todos os módulos do ERP.
