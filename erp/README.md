# Mesa & Caixa

Aplicativo de lanchonete em desenvolvimento. Backend Worker ESM com D1 e R2 integrados ao Sites. Nenhum cadastro de exemplo é criado em produção.

## Etapa atual
- Cadastro e edição de produtos, com nome e preço obrigatórios; custo direto opcional.
- Fotos JPG/PNG/WebP até 2 MB, armazenadas separadamente em R2.
- Favoritos por identidade autenticada; busca e filtro por categoria.
- Mesas numeradas e cadastro preparatório de funcionários/permissões.
- Configurações do estabelecimento e formato de impressão.
- Prévia privada de cardápio sem exposição de custos na API dedicada.
- Controle otimista de concorrência nos produtos e log de alterações.

## Acesso
O Sites permanece privado para o proprietário. A API exige identidade do gateway Sites e e-mail correspondente a OWNER_EMAIL, configurado no runtime, nunca enviado ao cliente. O domínio Worker não deve ser exposto diretamente sem esse gateway. Contas não autorizadas não acessam as APIs. Autenticação externa Google e usuário/senha para funcionários ainda NÃO foram implementados. A tabela employees é preparatória, não armazena senhas e não concede acesso. Não existe cadastro público ou primeiro visitante administrador.

## Desenvolvimento e publicação
`npm run build` embute os arquivos de web no Worker em dist/server/index.js, sem dependências externas. `npm test` usa SQLite em memória para verificar autorização, validação e operações; não altera banco hospedado. Migração em migrations deve ser aplicada pelo provedor antes de usar as APIs. Não executar DDL nas requisições. Preservar migrações aplicadas.

Sites deve conectar DB (D1) e BUCKET (R2). A configuração de vínculo e publicação exige validação do provedor. OWNER_EMAIL é configurado pelo proprietário em variável de runtime.

## Limites
Ainda sem pedidos, recebimentos, fechamento, relatórios ou estoque. Modo Completo não libera recursos futuros automaticamente. Foto enviada antes de um cadastro abandonado pode ficar sem produto vinculado; adicionar limpeza segura posteriormente. Atualização do catálogo a cada 15 segundos nas telas relevantes, não WebSocket. Limite atual de 500 produtos e 200 funcionários: implementar paginação antes de ultrapassá-los. Sem backups automáticos configurados. Não usar em produção comercial antes de validar fluxo completo nos equipamentos reais.

A versão deixou de ser uma hospedagem estática compatível diretamente com Netlify. Para migrar, adaptar o Worker/API e migrar também D1/R2. Código pelo GitHub não migra dados.

## PDV e financeiro (etapa atual)
O PDV ocupa toda a área do navegador; o botão Tela inteira solicita fullscreen. Catálogo visual com fotos reais quando cadastradas, busca, favoritos, comanda de balcão ou mesa, novos itens, consulta de comandas, conferência e impressão para cozinha. A impressora é escolhida na janela do navegador. O sistema não instala, enumera nem imprime silenciosamente em impressoras locais. Reimpressão completa: conferir duplicidade antes de produzir.

Abertura com fundo de troco; uma sessão de caixa aberta por estabelecimento. Suprimento, sangria e despesa pela gaveta. Pagamentos manuais em dinheiro, Pix ou cartão, parciais e divididos; troco calculado no servidor. Finalização exige quitação; entrega é um estado separado. Mesas continuam vinculadas até a quitação/finalização e entrega. Cancelamentos apenas sem recebimento, com motivo e orientação para avisar a cozinha.

Ledger único integra pagamentos e movimentos ao financeiro; sangria/suprimento não contam como despesas/receitas. Contas a pagar/receber têm vencimento e liquidação integral. Pagamento bancário não mexe na gaveta; pagamento em dinheiro exige caixa aberto e saldo. Histórico de caixa guarda contado, esperado e diferença. Proteções contra duplicidade por chave de operação, transações e restrições SQL. Alterações de produtos não alteram preços/custos históricos dos itens vendidos.

Acesso operacional atual exclusivo do proprietário autorizado via Sites. Cadastro de permissões da equipe continua preparatório: nenhuma senha ou login de funcionário está ativo. Garçom não pode receber permissões de caixa. Ainda pendentes: autenticação externa dos funcionários, estornos de pagamentos, cancelamento parcial de itens, impressão incremental por setor, conciliação bancária, backups automáticos e validação da impressora física. O painel inicial e relatórios avançados ainda não foram conectados ao ledger. Não tratar esta versão como validada para produção comercial.

## Separação entre comandas e PDV
O menu operacional contém uma única entrada Caixa / PDV. Pedidos e comandas é uma tela independente para consultar os pedidos do estabelecimento, filtrar por mesa, imprimir para cozinha e abrir a mesma comanda no caixa. Receber no caixa faz apenas a leitura da comanda existente e a seleção no PDV: não cria pedido, itens ou lançamento financeiro. Rascunhos não enviados são protegidos antes de trocar a comanda. O endereço antigo #balcao permanece como alias de compatibilidade, sem segundo item de menu.

A lista inclui filtro de vendas finalizadas para reimpressão, dentro das últimas 150 comandas. Cupom não fiscal é emitido somente para venda quitada e finalizada; conferência e pedido da cozinha permanecem identificados separadamente. O documento inclui código fixo, nome, quantidade, valor unitário, subtotal, total, pagamentos/troco, dados do estabelecimento e agradecimento editável. Novos produtos recebem código sequencial imutável; produtos anteriores sem código usam identificação permanente derivada do ID. Códigos são guardados nos itens da comanda para preservar histórico. A janela de impressão não confirma impressão física nem envio para cozinha.

## Cardápio Lanches Progresso
Fonte: PDF fornecido pelo proprietário, 14 páginas, SHA-256 5e39d4e8e3d8d880b413e7ecb53d01e7b47ecfcd6a2ae64c2a5f9482aa96a934. Manifesto revisado em imports/cardapio-progresso.json com 125 itens e 17 categorias. Preços comparados com transcrição independente por página. Nomes repetidos foram qualificados pelo recheio, bebida ou tamanho sem alterar valores. Código de origem fica no ID determinístico; importação não sobrescreve cadastros anteriores ou posteriores já editados. Fotos decorativas do PDF não foram atribuídas a produtos específicos. A marca foi renderizada diretamente da área da logomarca na página 1, sem redesenho.

Escolhas de massa, sabores e marcas têm validação obrigatória no servidor e são registradas nas observações da cozinha, sem acréscimo presumido de preço. Opcionais do cuscuz sem preço informado permanecem descritivos; não foram criados adicionais gratuitos. Produtos com preços diferentes permanecem separados.

A importação administrativa depende de um segredo temporário em CATALOG_IMPORT_TOKEN e da proteção privada do Sites; o segredo deve ser removido e a versão republicada imediatamente após concluir e verificar o lote. Sem o segredo a rota é desabilitada. Não cria usuários nem altera movimentações financeiras. O CPF do rodapé não foi copiado para CNPJ; endereço e custos ausentes não foram presumidos. Produto removido é arquivado para preservar história e pode ser reativado. Fotos podem ser trocadas ou retiradas pelo editor.
Após a importação concluída, a rota HTTP administrativa foi encerrada explicitamente no código (404), independentemente de valores residuais de runtime. A rotina interna permanece apenas como registro técnico e para os testes locais de idempotência; não é acessível pelo site. As 125 linhas foram verificadas no banco hospedado contra o manifesto revisado.

## Melhorias operacionais
Mapa de mesas com consumo, saldo, responsável autenticado e situação de entrega/pagamento. O responsável é obtido da identidade do servidor e gravado na comanda; não é um seletor livre para atribuir vendas a terceiros. Dados antigos sem nome usam Administrador.

Adicionais pagos configuráveis no editor de produtos (nome, preço e custo opcional), cobrados por unidade. O servidor valida o catálogo e ignora preços enviados pelo navegador. Custos desconhecidos permanecem desconhecidos. Observações rápidas configuráveis por produto e atalhos de teclado F6 sangria, F7 suprimento, F8 cancelamento, F10 fechamento, desativados durante digitação e modais.

Venda em espera persistida em sale_drafts, sem gerar receita ou comanda. A retomada confere preços e disponibilidade; a conversão para pedido é transacional e só pode ocorrer uma vez. Alterações de uma venda guardada usam versão; descarte preserva o registro. Sem promessa de operação offline.

Desconto em valor ou percentual com motivo, versão, autorização da conta administradora e histórico antes/depois. Não pode reduzir a comanda abaixo do recebido. Estornos totais/parciais geram saídas novas vinculadas ao lançamento original, com motivo, autor e autorizador. Exigem caixa aberto, saldo para devolução em dinheiro e confirmação de devolução externa. Pix/cartão não são estornados automaticamente no provedor; não alteram a gaveta física. Cancelamento de venda recebida exige primeiro devolver integralmente. Não há estorno automático de ingredientes, pois produção/consumo não podem ser presumidos.

Crédito e débito separados, mantendo Cartão sem classificação para históricos anteriores. Fechamento grava conferido, esperado e diferença por forma de pagamento, com histórico consultável. Opção de fechamento cego oculta o saldo no PDV antes da conferência; o administrador continua autorizado a consultar dados gerenciais. Operadores reais ainda dependem de definir o provedor de autenticação.

A identidade hospedada continua exclusiva do proprietário via Sites. Não foram criadas senhas, PIN de gerente nem contas fictícias para contornar a autenticação. A escolha entre contas ChatGPT individuais ou migração para autenticação externa está pendente; nenhuma audiência do site foi alterada. Recursos de impressão silenciosa, estoque, KDS, delivery, balança e sincronização offline permanecem fora desta etapa.

## Base de autorização dos acessos individuais
A identidade ativa continua sendo a do proprietário autenticado pelo Sites. A API agora passa por uma matriz central de autorização por rota e perfil, sem aceitar perfil, permissões ou autor enviados no corpo do pedido. As regras estão em worker/permissions.js e serão reutilizadas na integração de identidade externa; este módulo não cria sessões nem senhas.

Garçom pode lançar e acompanhar os próprios atendimentos; não recebe pagamentos, finaliza vendas, movimenta caixa ou consulta custos/financeiro. Caixa consulta as comandas e recebe; abertura, fechamento, movimentações e edição de produtos podem exigir permissões adicionais. Edição de produto não concede acesso a custos. Financeiro gerencial, equipe, configuração, estornos e descontos autorizados permanecem administrativos. Cancelamento por operador autorizado é limitado a comandas sem recebimentos; operações que tiveram recebimento exigem administrador e devolução prévia.

Custos são removidos também das respostas JSON e dos adicionais serializados para perfis sem products.costs. Leitura de comanda por ID e listagem verifica participação do atendente ou orders.shared. Mesas de outro atendente podem informar ocupação sem expor os detalhes da conta. Fechamento cego não entrega o saldo esperado nem a lista de movimentações ao perfil operacional antes do fechamento; histórico do operador é restrito às próprias sessões.

Foram verificados cenários de negação por perfil, permissões incompatíveis, concessão de cadastro sem custos, revogação e consulta a comanda de terceiro, além de um ensaio transacional de mesa → pedido → dados de impressão → pagamentos divididos → finalização → entrega → fechamento. O ensaio usa SQLite em memória, não vendas de produção; não substitui teste nos celulares e impressora físicos.

Existe uma organização Supabase conectada, lucivansilva, com projetos de outros sistemas. A escolha da organização para um projeto separado deve ser confirmada pelo proprietário antes de consultar o custo e provisionar qualquer recurso. Nenhum projeto existente foi modificado, retomado ou reutilizado. Login por usuário/senha e Google ainda dependem da configuração do provedor e da hospedagem compatível, sem contornar a autenticação do Sites.
