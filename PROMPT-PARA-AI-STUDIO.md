Analise este projeto existente, sem reconstruí-lo do zero.

1. Leia README.md e exportacao-supabase/RESTAURACAO.md.
2. Execute `npm run dev` para abrir a demonstração local, que funciona sem banco remoto. Não acrescente Gemini ou outra API de IA: o ERP não depende delas para vender ou gerar relatórios.
3. Preserve as telas aprovadas, fotos, favoritos, produtos opcionais por código de barras, mesas numeradas, venda direta, comanda inteira para cozinha, espera, permissões, estoque e financeiro. O garçom lança pedidos; o caixa imprime e recebe. Abrir o cupom automaticamente após finalizar a venda; área de venda/pagamento tem 43% da largura do PDV no desktop.
4. Separe os dados de cada estabelecimento. Não permita cadastro público de proprietários. Somente o administrador da plataforma cria o primeiro acesso, e o proprietário cria sua equipe.
5. Entenda que exportacao-supabase/dados/snapshot.json é um conjunto real exportado; os produtos e vendas da demonstração são fictícios. Não importe nem gere dados em produção automaticamente.
6. O projeto atual utiliza Supabase. Não troque para Firebase por iniciativa própria. Se eu solicitar Firebase, apresente o plano e adapte também transações, permissões, autenticação e armazenamento; importar os arquivos não faz essa migração.
7. Se eu solicitar instalação local, o servidor/banco devem funcionar no computador do caixa com celulares pela rede local; painel remoto do proprietário será somente consulta. Esse modo ainda não está implementado. Não alegue operação offline apenas por instalar um atalho/PWA.
8. Preserve a configuração de prévia isolada. Não carregue referencias/config-producao-publica.js nem conecte ao projeto em uso. Use um ambiente de teste separado para qualquer backend novo.
9. Não execute migrations, exclusões, publicações ou restaurações no sistema atual. Proponha o plano antes de operações que afetem clientes.
10. Não crie usuários fictícios no banco real, não exponha dados reais em páginas públicas e não peça senhas/chaves administrativas no código. E-mail de suporte deve ficar para a última etapa.

Primeiro, abra a demonstração, confira a estrutura e explique quais adaptações de ambiente são necessárias para continuar trabalhando neste projeto.
