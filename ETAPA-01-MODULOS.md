# Etapa 1 — módulos e limite de usuários

Esta é a cópia de desenvolvimento `lucivansilva-jpg/C-pia-id-sistema`.
Não publicar como substituta do sistema original nesta etapa.

## Isolamento

`web/config.js` ativa `developmentOnly`. Em localhost o SDK usa o projeto
**demo-idsistema-test**, Firestore em `127.0.0.1:8185` e Authentication em
`127.0.0.1:9099`, incluindo contas temporárias de provisionamento.
Em qualquer outro host a inicialização do Firebase é bloqueada antes da primeira
operação. Não há fallback para a nuvem. O banco Remix configurado no arquivo
herdado não é utilizado em execução de desenvolvimento.

A prévia `/demo/?kind=food` ou `?kind=retail` continua isolada em sql.js.
Ela não testa as regras de segurança nem o contrato Firebase. As mudanças da
administração foram verificadas separadamente no navegador e em emuladores.
Não foram publicadas regras, criadas contas ou migrados dados na nuvem.

## Uso

Na administração da plataforma, **Cadastrar estabelecimento** tem modalidade,
módulos independentes e limite de usuários ativos (padrão 1, inclui proprietário).
**Gerenciar** permite editar o contrato de novos cadastros. O proprietário vê
os acessos e o consumo de vagas, mas não edita módulos ou limite.

Base obrigatória: venda direta, produtos, clientes, caixa e conferência,
recebimentos e resumo. Na alimentação inclui comanda de balcão e cardápio de
consulta. Módulos: `tables`, `finance`, `inventory`, `costs`.
Varejo nunca habilita `tables`. Não há módulo comercial obrigatório de equipe:
a quantidade de contas é independente dos módulos.

O backend do navegador valida o contrato e as regras do Firestore impedem
operações diretas nos recursos protegidos. Permissões individuais continuam
necessárias. A preferência visual essencial/completo não concede módulos.

A criação/reativação/desativação de um membro usa uma transação que lê membro e
settings antes das escritas. Contador, membro, vínculo de login e auditoria são
confirmados juntos. O UID vinculado ao incremento impede criar vários membros
com o mesmo incremento. Duas criações concorrentes disputam a mesma versão de
settings. Contas inativas não ocupam vaga; aparelhos não são contados.

A pré-checagem evita criar Auth quando já não há vagas. Caso a reserva falhe após
provisionar, o cliente tenta remover a conta recém-criada sem vínculo confirmado.
Falha de limpeza não concede acesso ao estabelecimento.

Reduções exigem caixa fechado, ausência de pedidos/entregas pendentes e resolução
das dependências do módulo (garçons ativos, produtos com estoque e contas pendentes).
Os dados históricos não são apagados. Estoque/compras sem Financeiro não gera conta
a pagar; esse comportamento aparece na tela de compras. Custo direto não exige
estoque; a composição por ingredientes continua com suas dependências operacionais.

## Cadastros anteriores

Ausência de `modules` mantém o comportamento anterior; não é equivalente a módulos
explicitamente desativados. Cadastros legados não recebem limite de 1 silenciosamente.
A ativação do contrato de um cadastro legado requer migração explícita da contagem.

O ensaio abaixo opera **somente no emulador local**, em janela sem outros cadastros:

```
FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 npm run migrate:contracts:local
FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 npm run migrate:contracts:local -- --apply
```

O primeiro comando apenas gera relatório em `artifacts/contracts-migration.json`.
O segundo preserva os módulos anteriores e define limite igual ao número ativo
(mínimo 1). Não é ferramenta de migração de produção: exige projeto e endpoint de
emulador, sem credenciais Google. A migração real será preparada/revisada no fechamento
das etapas, com janela controlada e cópia de segurança.

## Verificações

```
npm ci
npm run build
npm run test:firebase:simulator
# Com Firestore Emulator local ativo:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 node firestore.rules.test.ts
FIRESTORE_EMULATOR_HOST=127.0.0.1:8185 npm run test:contracts:emulator
```

Para prévia local: iniciar Authentication e Firestore com `firebase.emulator.json`
e executar `npm start`. Não existem senhas de demonstração padrão no código.

## Publicação futura — ainda pendente

Código do GitHub não publica regras do Firestore nem executa migrações.
Antes de uma publicação futura, escolher o ambiente Firebase de destino, revisar
a configuração de autenticação, aplicar a migração aprovada e publicar as regras
compatíveis com o código. Só então retirar o bloqueio de desenvolvimento.
Não fazer isso automaticamente ao importar esta cópia no AI Studio.
