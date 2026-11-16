# ID Sistema — importação no Google AI Studio

Este é o repositório privado independente `lucivansilva-jpg/idsistema`, preparado para importar no Google AI Studio. O sistema em uso continua no repositório original `lucivansilva-jpg/sistema-lanchonete`, sem alterações. Este pacote contém dados exportados e uma configuração de prévia desconectada; não conecte a produção automaticamente.

## Abrir no AI Studio

1. Abra **Build**, selecione **+ / Add files → Import from GitHub**.
2. Autorize sua conta GitHub e selecione **lucivansilva-jpg/idsistema**.
3. Use a branch padrão **main**, que já contém o pacote completo. Se preferir, utilize o ZIP equivalente; não é preciso selecionar a ramificação do repositório antigo.
4. Leia `PROMPT-PARA-AI-STUDIO.md`. Peça à IA para preservar a arquitetura e começar pela demonstração local.

A aceitação direta de um ZIP de projeto inteiro depende da interface disponível. O caminho documentado do AI Studio é importar pelo GitHub. O ZIP pode ser extraído para enviar os arquivos aceitos pela interface.

## Executar a prévia

Requer Node.js 20 ou superior. Não há dependências npm obrigatórias para o servidor de prévia.

```sh
npm install
npm run dev
```

Use a porta indicada pela variável `PORT` da plataforma, ou 3000 localmente. O servidor atende em `0.0.0.0`. O comando `npm start` executa o mesmo servidor. `npm run build` apenas confere a integridade e os arquivos; o frontend já é HTML/CSS/JavaScript estático.

A página inicial abre `/demo/`: dez produtos com fotos, quinze mesas, trinta dias fictícios de vendas e perfis de proprietário/caixa/garçom. A demonstração usa banco em memória na aba, sem Supabase. É possível simular vendas, comandas, estoque e relatórios; atualizar a página reinicia os exemplos. Bibliotecas PDF/OCR/SQLite são baixadas de CDNs públicos quando necessárias.

## Organização

- `web/`: telas, imagens e demonstração.
- `backend/`: fontes dos serviços atuais e scripts SQL originais.
- `erp/`: fontes de referência do ERP anterior (Sites/D1).
- `exportacao-supabase/dados/snapshot.json`: dados reais exportados de 60 tabelas (73 registros, coleta 14/11/2026).
- `exportacao-supabase/dados/`: JSON/CSV por tabela e vínculo dos dois estabelecimentos com seus schemas.
- `exportacao-supabase/autenticacao/`: identificação de cinco contas, SEM senhas, hashes de senha, sessões ou tokens.
- `exportacao-supabase/estrutura/`: catálogo, RLS, grants, índices, constraints, funções e migrations registradas.
- `exportacao-supabase/servicos/`: código efetivamente publicado das três Edge Functions.
- `exportacao-supabase/armazenamento/`: inventário; havia zero objetos no bucket erp-images.
- `referencias/config-producao-publica.js`: configuração pública original, não carregada pela prévia.
- `scripts/`: servidor seguro de prévia e verificação do pacote.

## O que este pacote não faz automaticamente

Importar código não restaura banco, contas, fotos, funções ou permissões em outro provedor. Esta versão não está migrada para Firebase nem para instalação local. O snapshot não contém produtos/vendas reais; os exemplos da demonstração são gerados em `web/demo/store.js`.

A configuração em `web/config.js` aponta para `example.invalid` para isolar a prévia. Para usar banco real no futuro, crie um ambiente de teste separado e configure-o deliberadamente. Não reative a conexão de produção durante uma adaptação automática.

Leia `exportacao-supabase/RESTAURACAO.md`: esta é exportação lógica de aplicação, não um pg_dump integral. Credenciais precisam ser recriadas e os vínculos conferidos no destino. Não aplique as migrations automaticamente nem exclua o Supabase original.

Os scripts antigos em `tools/` e alguns testes podem referenciar caminhos absolutos do ambiente original; ajuste-os se precisar regenerar os arquivos. Os arquivos gerados necessários à prévia já estão presentes.

## Privacidade e histórico

Este repositório é privado e contém nomes/identificadores de contas e estabelecimentos. Não torne público nem copie a exportação para `web/` ou outro diretório publicado. O servidor de prévia expõe SOMENTE `web/`.

Este repositório preserva o histórico anterior do código por meio de seus commits de origem. O README inicial criado pelo proprietário foi preservado em `referencias/README-inicial-idsistema.md`. O ZIP contém o estado atual dos arquivos, sem a pasta `.git` ou histórico completo.

As últimas alterações do PDV (43% venda/57% produtos e abertura automática do cupom) estão incluídas. O e-mail do suporte continua pendente, conforme combinado.
