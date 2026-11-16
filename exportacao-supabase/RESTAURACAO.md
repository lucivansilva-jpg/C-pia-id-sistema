# Restauração e limites desta exportação

Esta é uma exportação lógica de aplicação e código, NÃO um pg_dump integral do cluster nem um instalador independente. Não execute este pacote sobre o sistema em uso. Não foi feita restauração em outro projeto.

## Preservado
- Todas as linhas das 60 tabelas dos schemas da aplicação public e erp_*, inclusive tabelas vazias e histórico de auditoria. A única coluna de aplicativo omitida é public.platform_setup.token_hash.
- Metadados de 5 contas Auth, sem credenciais/senhas/hashes de senha/tokens/MFA/sessões. Os vínculos do aplicativo mantêm os IDs originais.
- Catálogo de 557 colunas, constraints, índices, sequences, permissões, políticas RLS, triggers e 20 funções próprias. Também há 17 migrations registradas, em JSON e SQL.
- Código real das três Edge Functions publicadas e suas versões.
- Configuração pública do bucket e inventário de arquivos: zero objetos encontrados.

## Não exportado
- Senhas/hashes de senha, sessões Auth, refresh/access tokens, segredos JWT, chaves secret/service_role, senha do Postgres, tokens de configuração inicial, Vault/decrypted_secrets, MFA, credenciais OAuth ou SMTP. A coluna public.platform_setup.token_hash é omitida; não reutilize o fluxo inicial por copiar esse registro.
- Arquivos internos e logs do provedor, WAL/PITR, backups de infraestrutura, configurações de cobrança, projetos/organização, segredos e configurações administrativas sem endpoint disponível.
- Definições e dados internos dos schemas gerenciados auth/storage/realtime/extensions, exceto metadados Auth selecionados, bucket/objetos e políticas de storage necessárias ao aplicativo.
- O banco do antigo site Sites/ChatGPT é OUTRO ambiente; não foi exportado nesta coleta do Supabase. Seu código de referência está em erp/.

## Roteiro de restauração em Supabase
1. Criar um projeto de destino separado, habilitar extensões compatíveis e gerar chaves NOVAS.
2. Revisar as migrations registradas e o catálogo; resolver dependências e aplicar a estrutura no destino em ordem. Arquivos SQL são fonte de referência, não um restaurador de um clique.
3. Recriar as contas Auth por API administrativa com senhas temporárias novas. Se os UUIDs forem diferentes, mapear todos os vínculos e referências em business_members, businesses, platform_admins, auditoria, equipe e funções relacionadas. Não inserir usuários diretamente em auth.users sem o fluxo suportado de provisionamento.
4. Reconstituir public (ordem de FKs), os schemas erp por empresa e seus dados usando os JSONs; conferir contagem e constraints. Triggers de bootstrap/registro exigem análise específica. O estado de configuração inicial não deve ser importado cegamente. Preservar auditoria e IDs quando aplicável.
5. Reaplicar e verificar RLS, grants, funções, triggers e estados de sequence pelo catálogo; assegurar que nomes das sequences acompanhem os dados.
6. Recriar bucket erp-images e políticas. Neste snapshot não existem arquivos binários no bucket.
7. Publicar os serviços de exportacao-supabase/servicos/*/codigo e configurar SUPABASE_URL, SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY e outros nomes exigidos pelos fontes, com valores NOVOS. Não incluir esses valores no frontend.
8. Ajustar web/config.js para o destino, revisar URLs de autenticação e publicar a pasta web.
9. Conferir login, permissões, isolamento entre estabelecimentos, cadastro, comanda, pagamentos, estoque e impressão antes de liberar o destino.

## Migração para Firebase ou instalação local
Os SQLs e serviços não são automaticamente compatíveis. Será necessário adaptar autenticação, consultas, transações, permissões, armazenamento e rotinas de suporte. O ZIP serve como fonte e dados para esse trabalho.

## Consistência
As tabelas da aplicação foram lidas numa transação REPEATABLE READ READ ONLY. Metadados Auth, catálogo, migrations, funções publicadas e inventário do storage foram coletados em leituras separadas. Não se trata de snapshot atômico de todos os serviços do Supabase.

Referências: https://supabase.com/docs/guides/self-hosting/restore-from-platform e https://supabase.com/docs/guides/platform/migrating-within-exportacao-supabase/dashboard-restore .
