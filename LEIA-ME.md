# Login próprio e administração da plataforma

## Acessos

- Criador do sistema: e-mail + senha própria, na aba Administrador da plataforma. Não usa a senha Gmail nem OAuth Google.
- Proprietários, caixas e garçons: código do estabelecimento + usuário + senha. O link de cada loja preenche o código.
- Novos usuários recebem senha temporária definida em formulário protegido e precisam trocá-la no primeiro acesso.
- O administrador da plataforma cadastra novas empresas e seus proprietários. Não há cadastro público nem promoção do primeiro visitante a administrador.

## Primeiro acesso do criador

1. Abra o ERP privado atual em https://lanchonete-mesa-caixa.woodylace.chatgpt.site com sua conta já autorizada.
2. Configurações → Seu acesso de administrador da plataforma → Definir meu acesso à plataforma.
3. Informe seu nome e uma senha própria de 12 a 128 caracteres. Não use a senha Gmail e não envie a senha pelo chat.
4. O e-mail autorizado é mostrado na tela. A configuração é de uso único, vinculada ao proprietário autenticado. A autorização inicial expira após sete dias; caso expire sem uso, deve ser reemitida pela manutenção.
5. Na página externa publicada pelo Netlify, use esse e-mail e a senha criada, na aba Administrador da plataforma.

O ChatGPT continua protegendo apenas a configuração inicial no Sites existente. Depois de criado o acesso externo, o login é do próprio sistema, validado pelo Supabase Auth.

## Suporte

Na área de trabalho do suporte, selecione a empresa e clique em Abrir sistema do cliente. O atendimento e as alterações são registrados automaticamente.

- Novos atendimentos abrem com edição habilitada para o administrador da plataforma.
- Cada sessão dura até 30 minutos.
- Não é necessário habilitar gravação a cada atendimento; o acesso mantém a identidade do administrador da plataforma e o histórico automático.
- Encerrar atendimento remove o contexto de suporte.
- O banco registra o usuário original da plataforma, empresa, horário, motivo, leituras e solicitações/alterações de cadastro, sem gravar senhas.
- A identificação de suporte vem do registro no servidor, nunca de um perfil escolhido no navegador. O histórico não permite editar ou apagar eventos pela chave de serviço usada no aplicativo.

Essa confirmação documenta a declaração do operador. Não é uma aprovação eletrônica emitida pelo cliente; a política de suporte e acesso deve ser alinhada com os clientes.

## Publicação GitHub → Netlify

Repositório: https://github.com/lucivansilva-jpg/sistema-lanchonete
Branch main; base vazia; comando de build vazio; pasta de publicação web.
O netlify.toml e web/_headers já configuram a página. Depois do vínculo inicial, o Netlify pode publicar os próximos envios ao GitHub automaticamente. Alterações nesta conversa precisam ser enviadas ao repositório para chegar ao Netlify.

Não é necessário configurar provedor Google nem callbacks OAuth para este login.

## ERP integrado no Netlify

A página /system/ abre o ERP depois do login. Proprietários e suporte usam Abrir sistema; funcionários entram no atendimento após trocar a senha temporária. A empresa e os privilégios são obtidos no servidor a cada solicitação.

Cada estabelecimento possui tabelas comerciais em um schema PostgreSQL privado, provisionadas pelo backend, sem acesso direto dos navegadores. public.erp_run é executável somente pela chave de serviço no Edge Function. A camada de compatibilidade aceita apenas consultas geradas pelo código do servidor; não existe endpoint para o navegador enviar SQL.

Módulos: catálogo com fotos e favoritos, 15 mesas iniciais, pedidos dos garçons, comandas e impressão, PDV com venda direta e venda por comanda, pagamentos divididos e troco, espera, abertura/fechamento/sangria/suprimento/despesa, financeiro a pagar/receber e recorrência, estoque, fornecedores, compras, custos diretos ou por ingredientes, relatórios, equipe e perfis.

O modo essencial oculta estoque/compras/fornecedores/fichas. O modo completo é opcional; não exige esses cadastros para vender. Garçons não podem receber pagamentos ou imprimir, mesmo com exceções de perfil. O caixa recebe as comandas e imprime o pedido completo.

Configurações permite logomarca, cor, dados da empresa, mensagem do cupom e bobina 58/80 mm. A impressora é selecionada no diálogo do navegador; o site não instala drivers nem imprime silenciosamente.

/cardapio/?empresa=CODIGO é somente consulta pública: exibe produtos ativos/visíveis, descrições, fotos e preços, sem pedidos nem acesso financeiro. QR Code imprimível em Configurações. Fotos de produtos e logomarcas são públicas no Storage; o envio é autorizado no backend e separado por empresa.

As atualizações das comandas/mesas ocorrem a cada cinco segundos com a tela visível; produtos do atendimento a cada quinze segundos; cardápio público a cada trinta segundos. Não é operação offline.

Novos estabelecimentos começam com catálogo vazio. Os dados comerciais e fotos antigos do Lanches Progresso continuam preservados na publicação Sites/D1/R2 e não foram copiados para os cadastros NB Criações. O diretório erp contém a fonte antiga, não seu banco. Sua migração depende de identificar o estabelecimento de destino.

NFC-e/fiscal, delivery, integração WhatsApp e autoatendimento permanecem fora desta etapa, conforme o escopo combinado.

## Credenciais e verificações

As senhas ficam no Supabase Auth; não são gravadas nas tabelas comerciais. web/config.js contém apenas a chave publicável. Chaves administrativas ficam no runtime. A credencial de configuração inicial fica somente no runtime privado do Sites, e seu hash no Supabase; nunca no frontend ou GitHub.

Verificações essenciais: node --experimental-vm-modules checks/access.mjs (isolamento, autorização, suporte sem escrita, expiração e troca obrigatória), endpoint sem sessão rejeitado e proteção SQL das tabelas. Também foi conferido um fluxo focado de venda/comanda/financeiro/compra/custo em SQLite e sua tradução executada no PostgreSQL com ROLLBACK, sem deixar dados de teste. Não foi repetida a suíte completa do ERP. A impressão física depende da impressora do estabelecimento.

SDK local com versão fixa: @supabase/supabase-js 2.119.0, licença MIT.

## Cadastro fechado e nomes repetidos

Não há cadastro público. O banco rejeita contas novas sem uma autorização administrativa de uso único, criada pelo backend para um endereço interno aleatório. Isso bloqueia tentativas diretas no endpoint signup. A marca em app_metadata é apenas informativa: vínculos e privilégios continuam nas tabelas protegidas. O primeiro administrador da plataforma continua sendo provisionado somente pelo formulário privado de uso único.

Somente a plataforma cadastra empresas e proprietários. Cada proprietário administra funcionários apenas da sua empresa. Nome de exibição pode repetir; login deve ser único dentro do estabelecimento. O mesmo login pode existir em empresas diferentes porque o acesso inclui o código do estabelecimento. Se duas pessoas se chamam Matheus na mesma empresa, use identificadores como matheus.silva e matheus.souza; ao sair alguém, inative seu cadastro em vez de compartilhar a identidade com outra pessoa.

Correção de provisionamento: a API Auth preenche os metadados após o INSERT inicial. A proteção atual usa managed_registration_permits, com validade curta, consumo único e sem acesso público. O cadastro administrativo real foi conferido e a conta de verificação foi removida imediatamente. Nenhuma senha do proprietário foi solicitada ou alterada.

## Área de trabalho do suporte e chamados

O administrador da plataforma vê lojas, busca por nome/código, última atividade, usuários online, total de chamados e mensagens não lidas. Pode abrir o ERP da empresa com edição habilitada e consultar seu histórico. A sessão de manutenção continua vinculada à identidade do administrador e tem validade de 30 minutos.

Online indica um funcionário autenticado com sinal de atividade nos últimos dois minutos. O ERP envia esse sinal a cada 45 segundos enquanto a aba está visível. Atividade recente indica até dez minutos; ausência de atividade não é diagnóstico de indisponibilidade. O painel atualiza a cada 30 segundos. Não existe monitoramento sintético 24 horas nesta etapa.

Em Ajuda e suporte, cada funcionário abre e acompanha os próprios chamados; administradores da loja veem todos os chamados da própria empresa. Categorias: erro, dúvida, sugestão e reclamação. Prioridades: normal/urgente. O suporte responde no painel e altera a situação para aberto, em andamento, aguardando cliente ou resolvido. Nova mensagem do cliente reabre um chamado resolvido. As mensagens são texto, sem anexos nesta etapa.

As tabelas support_tickets, support_messages, business_presence e support_email_outbox não são acessíveis diretamente pelo navegador. Todas as consultas passam pela sessão validada e pelo vínculo com a empresa. Inclusões são idempotentes e respostas do suporte verificam a versão para evitar sobrescrever alterações concorrentes. O histórico do chamado é preservado.

Por escolha do proprietário, o e-mail será configurado posteriormente. Os avisos são registrados em support_email_outbox com status awaiting_configuration. Nenhum e-mail é enviado nem marcado como enviado nesta etapa. O Gmail conectado no chat não fornece credencial de envio permanente ao backend. O painel sinaliza essa pendência; os chamados funcionam normalmente dentro do sistema.

Verificações focadas: checks/support.mjs para isolamento, identidade e manutenção; fluxo SQL com chamado, resposta, reabertura, idempotência, fila e presença verificado no PostgreSQL sob ROLLBACK, sem deixar registros de teste. A suíte completa de vendas não foi repetida.


### Publicação independente do suporte

A nova Edge Function support-access atende apenas o painel, os chamados e a presença, utilizando a sessão existente e verificando usuário/sessão revogada no Supabase Auth. O endpoint auth-access de login/ERP permaneceu byte a byte idêntico à publicação anterior. A criação de uma sessão de manutenção com edição habilitada ocorre no novo serviço após verificar o administrador da plataforma; o ERP já reconhece esse registro protegido.

Não houve substituição da função de vendas. Os arquivos backend/index.js, backend/platform.js e backend/erp não foram modificados nesta atualização. A conferência em checks/support-service.mjs verifica o novo serviço isoladamente.


## Visão geral do proprietário no celular

A tela inicial agora prioriza indicadores em cartões responsivos, com Hoje (padrão), Semana desde segunda-feira, Mês atual e período personalizado de até 367 dias. Mostra vendas após descontos/estornos, despesas operacionais pagas, resultado estimado e quantidade de vendas/ticket médio. Um clique nos indicadores abre Relatórios com o mesmo período.

Mesas ocupadas, comandas abertas, saldo ainda a receber, entregas pendentes e caixa são a posição atual da operação, independentemente do período financeiro selecionado. Dinheiro esperado na gaveta aparece separado de faturamento e resultado. O saldo de comandas usa o agregado completo do financeiro; contagens de comandas/entregas respeitam a lista de até 150 e sinalizam possível parcialidade ao atingir o limite.

Avisos: contas a pagar vencidas e a vencer em sete dias, recebíveis vencidos, custos não informados nas vendas, despesas sem categoria, estornos, diferença no último fechamento do período e estoque abaixo do mínimo quando o modo completo está ativo. Avisos de contas respeitam as primeiras 300 por vencimento, com indicação do limite. O resultado fica como Dados incompletos quando faltarem custos históricos ou classificação de despesas.

Atualização automática a cada minuto, com a aba visível, além do botão Atualizar e nova consulta ao retornar após um minuto. A tela mostra o horário e sinaliza erros parciais; consulta indisponível não vira zero. Respostas atrasadas não substituem um período escolhido posteriormente. Controles do formulário de datas não são interrompidos pela atualização automática.

Esta atualização usa apenas consultas de leitura já autorizadas. Não altera banco, permissões, login, PDV ou rotinas de pagamento. Relatórios completos e os demais módulos continuam acessíveis. Comparações com períodos anteriores e resumos adicionais não foram acrescentados nesta primeira prioridade.

Conferência focada: node checks/overview.mjs (datas em São Paulo, limites, valores distintos de caixa/vendas, recebimentos parciais, custos incompletos, falha parcial e concorrência entre consultas). Sem suíte completa de vendas nem dados de teste no banco.


## Base compartilhada de alimentação e varejo

STATUS: publicação autorizada explicitamente pelo proprietário. O novo commerce-access está publicado; LOGIN_CONFIG.commerceEnabled=true direciona as consultas comerciais para ele. Login e suporte continuam em seus serviços existentes. A publicação anterior havia sido bloqueada pela revisão automática; a autorização foi obtida antes desta ativação.

Recursos incluídos:
- Código de barras opcional e único por loja, com zeros iniciais preservados; busca por nome/código/código de barras e leitura por leitor HID que envia Enter.
- Unidade de venda/apresentação opcionais: unidade, pacote, lata, garrafa, frasco, pote e par. Quantidades inteiras de itens vendáveis. Uma caixa com 12 latas deve entrar como 12 unidades; não existe conversão automática nem venda fracionada por peso nesta atualização.
- Controle por produto: sem estoque, pronto por unidade ou ingredientes. Prontos usam composição interna de 1:1 compatível com o mecanismo de estoque existente. A venda e o consumo são atômicos; confirmação repetida não duplica o lançamento. Estoque de ingredientes exige composição configurada para começar a baixar.
- Estoque de produtos com saldo, mínimo, saldo inicial opcional e entradas/saídas/contagem com motivo. Entradas manuais não geram financeiro. Compras no modo completo podem receber mercadorias na quantidade de unidades. Estornos/cancelamentos não repõem automaticamente mercadorias: é necessário conferir a devolução física e registrar entrada/ajuste.
- Clientes opcionais: nome suficiente, contatos e CPF/CNPJ opcionais; cliente pode ser inativado e seu histórico preservado. Cliente é escolhido pelo caixa sem impedir a venda sem identificação. O nome é preservado no momento da venda.
- Desconto na venda direta com motivo e permissão; desconto em comandas preservado. Troco é calculado sobre o valor líquido.
- Configurações permite alimentação/varejo por estabelecimento. Alimentação mantém mesas/comandas/garçons e venda direta. Varejo utiliza venda direta, espera, histórico, clientes e mercadorias. A mudança exige finalizar e entregar as comandas pendentes; garçons precisam de um perfil apropriado para operar varejo.

A estrutura adicional já foi aplicada de modo compatível nos schemas privados: campos de produto, cliente, modalidade e gatilhos de integridade. Estabelecimentos existentes continuam em alimentação. Nenhum produto, cliente fictício, preço, saldo ou venda de produção foi criado/reescrito; os testes SQL usaram ROLLBACK. A marca de preparação e os campos vazios permanecem no banco. auth-access, support-access e suas fontes originais não foram modificados.

Validação preparada: checks/commerce.mjs exercita produto com 12 unidades, código único/opcional, cliente opcional, desconto, caixa, baixa sem duplicação, falta de estoque sem pagamento, comanda, modalidade e compatibilidade com o manipulador anterior. Seu SQL foi executado no PostgreSQL sob ROLLBACK, inclusive falha de estoque e gatilhos contra frações e mudança com comandas. checks/commerce-access.mjs verifica a sessão e o isolamento do serviço. A inicialização HTTP do serviço e os bloqueios sem autenticação foram conferidos. A verificação visual pela interface com a conta do proprietário e os testes físicos de leitor/impressora permanecem dependentes do ambiente do estabelecimento. Não houve repetição de toda a suíte de ERP.

Continuam pendentes de outras atualizações: identificação personalizada da empresa por nome/CNPJ, gerenciamento/exclusão dos estabelecimentos de teste, importação Excel/CSV/PDF/JPG/PNG e configuração de e-mail dos chamados. Trocas/devoluções específicas de varejo também precisam de um fluxo próprio. Fiscal, delivery e integração WhatsApp continuam fora do escopo combinado.

## Atualização de gestão, importação e pós-venda — 14/11/2026

- Plataforma / Gerenciar: editar nome e identificação de acesso, desativar/reativar e retirar cadastros de teste sem movimentações nem chamados. Retirada lógica e recuperável: preserva Auth, arquivos, schema e auditoria; bloqueia usuários e encerra suporte. Não elimina histórico financeiro.
- Minha conta: administrador da loja personaliza identificação (nome simples ou CNPJ). O código original permanece válido. Identificação é endereço de acesso, não substitui usuário/senha.
- Produtos / Importar produtos: Excel, CSV, PDF com texto e OCR local de PDF digitalizado/JPG/PNG. Prévia editável, seleção das colunas, escolha da correspondência, confirmação explícita e registro por linha para repetição sem duplicar. Bibliotecas carregadas sob demanda; não utiliza API de IA paga. Até 12 MB, 500 linhas e 10 páginas PDF por leitura. OCR exige revisão humana; múltiplos preços ficam pendentes. Não importa automaticamente fotos recortadas, custos ou estoque inicial.
- Trocas e devoluções: permissão payments.refund, caixa aberto, venda encerrada, quantidades disponíveis e motivo. Valores líquidos históricos incluem descontos. Compensação de troca separada de dinheiro real, diferenças pela forma original ou recebimento confirmado. Permite retorno físico de mercadorias com estoque por unidade; ingredientes não são repostos automaticamente. Mantém documentos originais e trilha de auditoria. Não executa Pix/estorno na adquirente: operador confirma operações externas.
- Configurações / Adicionar ou testar leitor: USB HID como teclado, teste de leitura, preferência local e foco no campo de barras do PDV. Não instala drivers nem enumera USB. Validação do equipamento físico permanece a cargo do estabelecimento.
- E-mail de suporte continua sem envio/configuração, conforme orientação do proprietário, para a última etapa.

Verificação focada: checks/commerce-v2.mjs, checks/import-model.mjs, checks/management.mjs e controles de acesso. As transações geradas foram executadas no PostgreSQL com ROLLBACK, sem deixar produtos ou vendas de teste. Não houve teste visual em navegador nem de impressora/leitor físicos neste lote.

## Demonstração pública — 14/11/2026

Entrada em /demo/ pelo botão abaixo do login. Sabor da Vila é uma empresa inteiramente fictícia com dez produtos/fotos, quinze mesas, dois atendimentos em aberto, trinta dias relativos à data atual de vendas, descontos, custos conhecidos, despesas, contas, fornecedor, compra em rascunho e estoque com ficha técnica. Os relatórios usam o mesmo motor comercial, sem números de lucro fabricados na tela.

A demonstração roda SQLite em memória no navegador com sql.js 1.13.0 e reaproveita as telas em web/system. Não carrega o bootstrap, configuração ou SDK Supabase de produção; não lê sessões do cliente, não cria contas públicas e não consulta o banco remoto. Pedidos e uploads temporários ficam na memória da aba. Atualizar/reiniciar restaura o exemplo; outras abas/visitantes têm dados separados. Seleção de proprietário/caixa/garçom é apenas simulação local. Help explica o recurso e não envia chamados/e-mails. Todos os cupons levam a indicação de demonstração. Fotos do acervo Unsplash, com origem em web/demo/assets/sources.json. Bibliotecas SQLite são baixadas do CDN jsDelivr, sem serviço pago de IA.

Gerar os arquivos espelhados: node tools/build-demo.mjs (requer as migrations originais no checkout ERP indicado no script). Conferência focada: checks/demo.mjs usa o motor WASM real em memória; verifica catálogo, fotos, mesas, custos/lucro, venda/troco, perfil e isolamento. QA visual em navegador não esteve disponível neste ambiente.
