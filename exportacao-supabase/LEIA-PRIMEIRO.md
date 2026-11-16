# ID Sistema — código e exportação do Supabase

Coleta: 2026-11-14 18:44:47.978224+00

## O que está salvo no Supabase agora
- 2 estabelecimentos e seus vínculos/perfis.
- 5 contas de autenticação (incluindo a administração da plataforma).
- 15 mesas em cada estabelecimento, configurações e histórico de acesso.
- 60 tabelas da aplicação, totalizando 73 registros.
- Produtos, pedidos/vendas, movimentos financeiros e estoque: tabelas presentes, porém vazias neste snapshot.
- 1 bucket de imagens, sem objetos armazenados.

Os dez produtos e trinta dias de vendas exibidos na demonstração são fictícios e gerados no navegador. Os dados geradores, fotos e logo estão em web/demo. Não são vendas ou produtos reais salvos no Supabase.

## Organização
- Raiz deste projeto: fonte do sistema e referência do ERP original.
- exportacao-supabase/dados/: snapshot consolidado e JSON/CSV por tabela/schema. CSVs neutralizam células que poderiam virar fórmulas; para importação fiel, use JSON.
- exportacao-supabase/autenticacao/: identificação das contas, sem credenciais.
- exportacao-supabase/estrutura/: catálogo, definições SQL de funções e migrations registradas.
- exportacao-supabase/servicos/: código efetivamente publicado de login, suporte e operação comercial.
- exportacao-supabase/armazenamento/: bucket e inventário; não havia imagens no Supabase a baixar.
- INSTRUCAO-PARA-AI-STUDIO.txt: orientação para analisar sem modificar a produção.
- exportacao-supabase/RESTAURACAO.md: dependências, omissões e roteiro de restauração.
- MANIFESTO-SHA256.json: tamanho e hash de cada arquivo.

## Importante
Este pacote contém dados dos estabelecimentos, nomes e identificadores das contas. Guarde-o com acesso restrito; não o publique num repositório público. Nenhuma senha, chave administrativa ou sessão de login foi incluída. Para restaurar os acessos, será necessário recriar/resetar credenciais e conferir os vínculos.

O pacote NÃO é um backup integral pg_dump, nem um instalador que dispensa Supabase. A exportação lógica preserva os dados e os fontes de aplicação acessíveis; limitações estão documentadas. Não foi realizado teste de restauração em outro servidor. Não desligue nem exclua o ambiente atual com base neste ZIP.

Nenhum dado do sistema online foi alterado ou removido para produzir esta exportação.
