# Sistema da lanchonete

Projeto privado com publicação GitHub → Netlify.

- web/: login próprio, painel da plataforma, cadastro de estabelecimentos e administração de usuários.
- backend/: código do serviço auth-access, SQL de autenticação e extensão de suporte.
- checks/: verificação isolada de acesso, sem dados reais.
- erp/: fonte da publicação atual no Sites; dados comerciais ainda no D1/R2.
- LEIA-ME.md: situação real, configuração inicial privada e instruções de suporte.

No Netlify: importar este repositório, branch main, base vazia, build vazio e pasta de publicação web. O arquivo netlify.toml já declara a pasta.

A publicação externa fornece login e administração de acessos. A migração/integração do PDV, produtos, financeiro e demais dados por estabelecimento ainda está pendente. Não apontar a publicação para erp/web: o ERP precisa de backend e banco.

Não há login Google obrigatório. O primeiro administrador da plataforma define sua senha na área privada já autorizada do ERP atual: Configurações → Seu acesso de administrador da plataforma. Não existe senha padrão nem cadastro público de administrador.
