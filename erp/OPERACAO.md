# Lanches Progresso — situação da versão

## Disponível no ambiente privado do proprietário

- Catálogo único com códigos fixos, fotos opcionais, preços, adicionais, opções e favoritos.
- Comandas de balcão e mesas, impressão de cozinha/conferência e encaminhamento ao PDV sem redigitação.
- Caixa com abertura, sangria, suprimento, despesa, recebimentos divididos, troco, desconto autorizado, estorno e fechamento por forma.
- Financeiro integrado, contas a pagar/receber, categorias, repetição semanal/mensal após baixa e conferência manual com extrato.
- Relatórios de vendas, produtos, participação de atendentes, custos registrados na venda e resultado estimado, com aviso de dados incompletos.
- Estoque opcional por insumo (g/ml/un), entrada/perda/contagem, mínimo, compras e fornecedores.
- Receber compra atualiza estoque/custo médio e gera uma conta a pagar uma única vez.
- Custo do produto direto ou por ficha técnica; estoque pode ser habilitado por produto. Consumo ocorre ao lançar o pedido.
- Modo essencial oculta módulos avançados sem exigir seus cadastros para vender.

## Limites operacionais importantes

- Esta publicação usa a identidade e o banco integrados ao Sites. Acesso de produção restrito ao proprietário autorizado.
- Cadastro de equipe é preparatório: não cria senha nem permite entrada independente de garçons/caixas. A migração de autenticação para uma hospedagem externa ainda é necessária.
- O projeto Supabase gratuito existe, mas ainda não é a origem dos dados desta publicação. Não trocar o frontend para ele sem migração e validação.
- Cardápio digital nesta hospedagem é prévia privada; não anunciar QR público funcional.
- Atualização de comandas usa consulta periódica de 5 segundos; não é WebSocket nem garantia de operação offline.
- Impressão oferece prévia em 58/80 mm e página separada para abrir em nova aba caso o ambiente incorporado bloqueie o diálogo; instalação e seleção da impressora ocorrem no sistema operacional/navegador. Teste físico pendente.
- Estorno/cancelamento financeiro não devolve ingredientes automaticamente. Conferir produção real e registrar ajuste justificado se necessário.
- Baixa de estoque abrange a receita-base cadastrada. Adicionais têm preço/custo mas não composição própria de estoque nesta versão.
- Resultado é estimativa operacional, com custos históricos e despesas pagas. Não é demonstração contábil/fiscal. Compras de mercadorias não são somadas novamente ao custo das vendas.
- Produtos/atendentes apresentam valores após desconto e antes de estorno. Devoluções afetam o movimento e resultado na data do estorno.
- Taxas/antecipação/recebíveis de adquirentes não têm integração automática. Conciliação é manual.
- Delivery, NFC-e, integrações WhatsApp, emissão fiscal e impressão silenciosa não fazem parte desta entrega.

## Verificação

Testes usam SQLite isolado e DOM simulado; não criam movimentações fictícias no estabelecimento. Cobrem preços históricos, permissões, pagamentos, troco, estornos, fechamento, compras idempotentes, custo médio, consumo atômico, falta de estoque e relatórios com dados incompletos. A validação com vários celulares e impressora física deve ocorrer antes do uso comercial pela equipe.

## Correção após gravação de 13/11/2026

PDV com rolagem separada de catálogo/comanda e ações limitadas à altura da tela. Seleção de pedidos protegida contra respostas atrasadas; atualização preserva itens não lançados. Reenvio de itens já gravados reconhecido antes de validar versão, sem duplicação. Comanda que sai do filtro limpa o detalhe. Impressão passa a mostrar prévia e alternativa em nova aba, sem afirmar sucesso da impressora. Teste físico ainda pendente.

## Fluxo do computador único do caixa

O operador consulta e imprime em Pedidos e comandas, e usa Fechar conta no PDV para abrir a mesma conta e acrescentar itens, inclusive observação Para levar. O endpoint de impressão exige orders.print, que não pode ser concedido ao garçom. Perfil/login de funcionários continua pendente de migração de autenticação.

Confirmação de pagamento integral com finish_if_paid encerra a venda na mesma transação do último recebimento. Pagamentos parciais mantêm a conta aberta. O PDV libera a tela e mantém um aviso do troco e atalho para reimprimir o cupom. Entrega é acompanhada nas comandas, sem botão no PDV. Comandas quitadas com entrega pendente ficam em filtro específico.

Colocar conta em espera grava a situação na própria comanda, sem copiar itens nem gerar nova venda. Novos itens do PDV são lançados antes de colocar em espera. Retomar conserva número, produtos, preços históricos e pagamentos. Os rascunhos ainda não lançados continuam separados na mesma janela de espera.

A indicação de pedido novo/novos itens usa reconhecimento local neste navegador do operador, atualizado pela consulta periódica de 5 segundos. Não significa impressão física confirmada.

## Venda direta no balcão

O botão Venda direta · receber agora permite receber integralmente por dinheiro, Pix, crédito ou débito sem lançar comanda manualmente. Produtos, custos, estoque opcional e recebimento são registrados na mesma transação. Nenhuma impressão de cozinha é disparada. Ao concluir, o PDV fica livre, com troco e cupom disponíveis. O histórico financeiro continua preservado.

Os pedidos normais permanecem com a comanda completa: lanche, refrigerante e demais produtos juntos. Não há classificação por preparo nem separação dos itens na impressão.

## Perfis configuráveis

Três modelos foram cadastrados: Administrador/proprietário, Caixa/responsável pela operação e Garçom/atendimento. Equipe e permissões permite alterar nome e comandos dos perfis, editar usuários e definir exceções individuais (seguir perfil / permitir / bloquear), além de inativar cadastros. O perfil do caixa inclui abertura/fechamento, movimentações, despesas, impressão, vendas, descontos e estornos com os controles de motivo já existentes. Gestão de acessos, configuração global, financeiro gerencial e relatórios permanecem do proprietário. Custos do produto ficam separados do cadastro comercial.

O garçom pode receber permissões adicionais de atendimento e cadastro, mas impressão, recebimentos, fechamento financeiro, custos e administração continuam bloqueados para esse perfil. Alterações simultâneas são recusadas por versão, e os eventos são auditados. Funcionário inativo não tem permissões efetivas.

Os modelos e cadastros estão prontos no banco e no editor. O login individual real continua pendente da migração de autenticação; não foram criados funcionários fictícios, senhas ou contas externas.

Referência de pesquisa: documentação oficial Consumer sobre permissões e perfis de colaboradores (consultada em 13/11/2026): https://ajuda.programaconsumer.com.br/como-definir-as-permissoes-de-meus-funcionarios-e-colaboradores-no-sistema/ e https://ajuda.programaconsumer.com.br/para-que-serve-cada-permissao-de-usuario-do-consumer/ . Os padrões adotados foram adaptados ao fluxo de computador único definido pelo proprietário.

## Primeiro acesso externo do administrador da plataforma

Configurações oferece um formulário de uso único para o proprietário já autenticado definir sua própria senha no Supabase Auth, sem coletá-la no chat. O servidor privado encaminha a solicitação ao serviço externo com uma credencial de configuração mantida apenas no runtime, expirada em sete dias se não utilizada. A autenticação nativa do Sites permanece intacta. O formulário não cria um login paralelo para a publicação Sites: provisiona o administrador da plataforma externa.

O painel externo de suporte nesta etapa administra somente os acessos por estabelecimento. A migração dos dados comerciais do ERP e o suporte sobre PDV/financeiro ainda não foram concluídos.
