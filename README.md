# Dashboard Financeiro · Scale Company

Painel comercial e financeiro que junta recebimentos, saídas, saldos e projeções do **Asaas**, da **InfinitePay** e das contas **Inter**, **Sicoob** e **Cresol**, com atualização em tempo real.

- **Backend:** Node.js + Express (`server/`). Guarda as chaves de API, consulta cada fonte, recebe webhooks e avisa o navegador em tempo real.
- **Frontend:** React + Vite + Tailwind + Recharts (`web/`). Filtros, gráficos, tema claro/escuro e layout responsivo.

## Como rodar

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run dev
```

Abra http://localhost:5173. Enquanto não houver credenciais, Asaas e InfinitePay mostram **dados de demonstração**, sinalizados com uma faixa amarela e um selo "demo".

Produção (um único processo serve a API e o painel):

```bash
npm run build
```

```bash
npm start
```

## Métricas

| No painel | Como é calculado |
|---|---|
| **Recebimentos do mês** | Entradas pagas (`received` + `confirmed`) com data de pagamento no mês. No mês corrente, compara com o mês anterior até o mesmo dia. |
| **A receber no mês** | Cobranças em aberto (a vencer + vencidas) com vencimento no mês. |
| **Saldo no Asaas** | `GET /finance/balance`. Saldos de outros bancos aparecem abaixo quando conectados. |
| **InfinitePay hoje (ao vivo)** | Vendas aprovadas recebidas por webhook. Aparecem sozinhas no painel: na hora em servidor próprio, em até 10 s na Vercel. |
| **Projeção do próximo mês** | Cobranças já emitidas + mensalidades de assinaturas ativas ainda não geradas + cartão confirmado a creditar (**garantido**) + média de 3 meses da InfinitePay (**estimado**). |
| **Dias de saída** | Calendário do mês com a intensidade das saídas por dia. Mostra os lançamentos do dia e o dia da semana com mais saídas. O seletor inclui ou exclui transferências entre contas da empresa. |
| **Despesas** | Saídas reais (taxas, contas pagas, Pix enviados). Transferências entre contas da própria empresa (ex.: saque Asaas → Inter) ficam fora para não contar a mesma movimentação duas vezes. |
| **Inadimplência** | Todas as cobranças vencidas e não pagas dos últimos 12 meses. |

Filtros (mês, fonte, forma de pagamento) valem para tudo na página. Cada gráfico tem visão em tabela, e as movimentações podem ser exportadas em CSV.

## Integrações

O status de cada uma aparece no painel **Integrações**, no fim da página, com o passo a passo do que falta.

### Asaas: pagamento recorrente ✅ acesso liberado
1. Asaas > Integrações > Chaves de API > gerar chave.
2. No `.env`: `ASAAS_API_KEY=$aact_...` (e `ASAAS_ENV=sandbox` se for chave de teste).
3. Tempo real (opcional): Asaas > Integrações > Webhooks, URL `https://core.scalecompany.com.br/webhooks/asaas`, um token próprio que também vai em `ASAAS_WEBHOOK_TOKEN`, eventos `PAYMENT_*`.

Endpoints usados: `/finance/balance`, `/payments`, `/subscriptions`, `/financialTransactions`, `/customers`.

### InfinitePay: cartão de crédito · `$scalecompany_`
A InfinitePay **não tem API pública de extrato nem de saldo**. A integração usa o webhook do checkout:
1. Publique o servidor em uma URL HTTPS pública.
2. Ao criar links de pagamento (`POST https://api.checkout.infinitepay.io/links`, `handle: "scalecompany_"`), envie `webhook_url: https://core.scalecompany.com.br/webhooks/infinitepay`.
3. Cada venda aprovada é **confirmada em `/payment_check`** antes de entrar no painel (o webhook não tem assinatura), gravada no banco (Supabase) e enviada ao painel.
4. Opcional: `INFINITEPAY_WEBHOOK_SECRET` muda a URL para `/webhooks/infinitepay/<segredo>`.

⚠️ Vendas na **maquininha** não passam pelo webhook do checkout. Para elas, é preciso solicitar à InfinitePay/CloudWalk acesso à API de parceiros.

### Banco Inter ⏳ acesso e comunicação
Conector implementado conforme a documentação oficial (mTLS + OAuth, `/banking/v2/saldo` e `/banking/v2/extrato`), **ainda não testado com credenciais reais**.
1. Internet Banking PJ > Soluções para sua empresa > Nova integração, com o escopo "Consultar extrato e saldo".
2. Baixe o certificado e salve em `certs/inter.crt` e `certs/inter.key` (a pasta `certs/` está no `.gitignore`). Na Vercel, que não tem pasta de arquivos, use `INTER_CERT_BASE64` e `INTER_KEY_BASE64` com o conteúdo dos arquivos em base64.
3. Preencha `INTER_CLIENT_ID` e `INTER_CLIENT_SECRET`.

### Sicoob ⏳ verificar documentação e solicitar acesso
Portal do desenvolvedor: developers.sicoob.com.br. É preciso cadastrar a aplicação, solicitar as APIs de Conta Corrente e enviar o certificado e-CNPJ A1. O conector atual (`server/src/connectors/pending.ts`) só mostra o checklist; a implementação segue o modelo de `inter.ts`.

### Cresol ⏳ solicitar dados de API ao gerente
Peça ao gerente a documentação e as credenciais de saldo e extrato. Mesmo modelo de implementação.

## Acesso (Supabase Auth + RLS)

O login é com **e-mail e senha do Supabase Auth**. O painel não tem cadastro: as contas são criadas só no Supabase.

Como o Supabase Auth deste projeto é **compartilhado com outra aplicação**, ter conta não basta: só entra quem estiver em `dashboard_financeiro.members` como membro ativo.

| Papel | O que vê |
|---|---|
| `admin` | Painel financeiro, checkout completo (todas as cobranças, taxas e catálogo) e colaboradores |
| `seller` | Só o checkout e as cobranças que ele mesmo gerou |

Para dar acesso a alguém:

1. Supabase > **Authentication > Users > Add user**: e-mail e senha, marcando **Auto Confirm User**.
2. Supabase > **SQL Editor**, trocando e-mail, nome e papel:

```sql
insert into dashboard_financeiro.members (user_id, email, name, role)
select id, email, 'Nome da Pessoa', 'admin' from auth.users where email = 'pessoa@scalecompany.com.br'
on conflict (user_id) do update set name = excluded.name, role = excluded.role, active = true;
```

Para tirar o acesso: `update dashboard_financeiro.members set active = false where email = '...';` (a pessoa sai em até 1 minuto). Para trocar a senha, use a mesma tela de usuários do Supabase.

Como funciona:

- a sessão fica em cookies `HttpOnly` (o navegador não tem acesso aos tokens) e é renovada sozinha; dura até 30 dias sem uso;
- as telas consultam o banco **com o token de quem está logado**, e o **RLS** do Postgres aplica as regras acima (vendedor só enxerga as próprias cobranças; dados financeiros e de colaboradores só para administradores). Usuários da outra aplicação não enxergam nenhuma linha;
- o servidor usa a chave `service_role` só para o que não tem usuário: webhooks (Asaas, InfinitePay, colaboradores) e cache;
- sem Supabase configurado (só em desenvolvimento) o painel abre como administrador.

## Checkout InfinitePay

Tela **Checkout** (`#/checkout`): o vendedor gera um link de pagamento da InfinitePay ($scalecompany_) e manda para o cliente.

1. **Cliente:** nome (obrigatório), e-mail e WhatsApp.
2. **Produtos:** do catálogo (preço sugerido, pode ser ajustado; o desconto/acréscimo fica registrado) ou item avulso.
3. **Taxa do cartão:** *empresa absorve* ou *cliente paga a taxa*. No segundo caso entra no link o item "Taxa de processamento do cartão", calculado para a empresa receber o valor cheio se o cliente pagar em até N parcelas.
4. **Resumo e simulador:** valor do link, taxa estimada e quanto a empresa recebe no Pix e em 1x…12x.
5. **Gerar link:** copiar ou enviar direto no WhatsApp. Quando a InfinitePay confirma o pagamento (webhook), a cobrança vira **Paga** com forma, parcelas, taxa real e líquido, e a venda entra no painel financeiro com o nome do cliente e do vendedor.

O administrador também tem **Taxas e catálogo**: as taxas do plano da conta (Pix e crédito 1x…12x) e os produtos com preço. A InfinitePay não informa a tabela de taxas por API, então o painel começa com **taxas de exemplo** e avisa até que sejam revisadas e salvas.

Limites da API da InfinitePay:

- não há como cancelar um link nem consultar links antigos pela API;
- quem escolhe Pix ou cartão, e em quantas parcelas, é o cliente, na página de pagamento;
- o repasse de juros do parcelamento ao cliente é uma configuração da própria conta InfinitePay, não da API.

Para testar sem criar links reais, use `INFINITEPAY_CHECKOUT_MOCK=true`: os links são simulados e o histórico ganha um botão para simular o pagamento.

## Assistente financeiro (IA)

Botão fixo no canto inferior direito de todas as telas. Abre um chat com um agente da OpenAI (`OPENAI_MODEL`, padrão `gpt-6-luna`) que responde **com base no que está na tela**:

- **Painel financeiro:** indicadores do mês e filtros selecionados, saldos, projeção, histórico de 12 meses, composição por fonte e forma, cobranças em aberto, clientes inadimplentes e maiores saídas.
- **Checkout:** taxas, catálogo e as cobranças visíveis. O vendedor só manda as próprias cobranças; o servidor nunca envia dados financeiros a partir da sessão de um vendedor.

A chave fica só no servidor (`/api/agent/chat`), a resposta chega em streaming e cada usuário tem limite de 30 perguntas a cada 5 minutos. As conversas ficam só no navegador (sessão) e as chamadas usam `store: false` (a OpenAI não guarda a conversa no painel dela). Os nomes de clientes e valores do resumo da tela são enviados à OpenAI para a análise.

## Colaboradores (webhook)

Aba **Colaboradores** (só administrador): nome, cargo e remuneração **fixa + variável** de cada colaborador, por competência (mês), enviados por outra plataforma via webhook.

- **Endereço:** `POST https://core.scalecompany.com.br/webhooks/colaboradores/<COLLABORATORS_WEBHOOK_SECRET>` (JSON). O segredo na URL autentica a plataforma; como alternativa, envie para `/webhooks/colaboradores` com `Authorization: Bearer <segredo>`.
- **Formato:** um colaborador, uma lista, ou `{ "competencia": "AAAA-MM", "colaboradores": [...] }`. Campos em português ou inglês: `nome`/`name`, `fixo`/`salario`/`fixed`, `variavel`/`comissao`/`bonus`/`variable`, e opcionais `id`, `cargo`, `setor`, `email`, `ativo`, `competencia` (sem ela, vale o mês atual). Valores como `3500.5` ou `"R$ 3.500,50"`.
- **Resposta:** `200` com quantos foram aceitos e os erros por item; `400` se nenhum item for válido; `500` em falha temporária (a origem pode reenviar). Reenviar a mesma competência substitui os valores.
- Cada envio fica registrado (`webhook_log`) com o conteúdo bruto, e o card **Integração** da aba mostra o último recebimento.

Exemplo:

```json
{
  "competencia": "2026-10",
  "colaboradores": [
    { "id": "123", "nome": "Ana Souza", "cargo": "Vendas", "fixo": 3500.00, "variavel": 1250.50 }
  ]
}
```

## Agente de e-mails (Gmail)

Aba **E-mails** (só administrador). O agente lê a caixa do Gmail conectado e organiza o que é financeiro:

- **primeira leitura dos últimos 90 dias**, em partes (retoma de onde parou), e depois só os e-mails novos;
- um filtro rápido separa o que parece financeiro; só esses vão para a IA (`OPENAI_MODEL`), que classifica em **cobrança**, **recebimento** ou **nota fiscal** e extrai valor, vencimento, empresa, forma de pagamento e linha digitável/chave Pix;
- **cobranças falsas**: a IA cruza o conteúdo com sinais técnicos (SPF/DKIM/DMARC, empresa conhecida enviando de e-mail gratuito, resposta para outro domínio, links encurtados, anexos perigosos, urgência) e com o histórico da mesma empresa (dados de pagamento diferentes, valor fora do padrão). As suspeitas aparecem em destaque com os motivos;
- aplica etiquetas no Gmail: `Dashboard/Cobrança`, `Dashboard/Recebimento`, `Dashboard/Nota fiscal`, `Dashboard/Suspeito`. Nunca apaga nem envia e-mails;
- na aba: cobranças a pagar, vencendo em 7 dias, recebimentos avisados e suspeitas; marcar como pago/conferido/ignorado, confirmar golpe ou "não é golpe" (a marcação entra no histórico que a IA consulta).

Quando lê: ao abrir a aba (se a última leitura tiver mais de 10 min), no botão **Sincronizar agora** e 1x por dia pela Vercel (8h). O plano Hobby da Vercel só permite tarefa agendada diária; no Pro dá para trocar `crons` do `vercel.json` para `*/15 * * * *`. Fora da Vercel o servidor lê a cada 15 min.

Configurar o Google (uma vez):

1. [Google Cloud Console](https://console.cloud.google.com/): crie um projeto e ative a **Gmail API**.
2. **Tela de consentimento OAuth** (Google Auth Platform): público **Externo**, status **Teste**, e adicione o Gmail que será lido em **Usuários de teste**.
3. **Clientes > Criar cliente > Aplicativo da Web**, com os URIs de redirecionamento:
   - `https://core.scalecompany.com.br/api/gmail/callback`
   - `http://localhost:5173/api/gmail/callback` (desenvolvimento)
4. No `.env` (e na Vercel): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_TOKEN_KEY` e `CRON_SECRET`.
5. Rode `supabase/migrations/20261022030000_gmail.sql` no SQL Editor.
6. Na aba **E-mails**, clique em **Conectar conta do Gmail**.

Limite do Gmail pessoal: com o app em modo **Teste**, o Google exige nova conexão **a cada 7 dias**; a aba avisa e mostra o botão **Reconectar**. Tirar esse limite exige publicar o app e passar pela verificação do Google para o escopo de Gmail (processo longo e pago para escopos restritos).

Privacidade: o token do Google fica criptografado no banco (`GMAIL_TOKEN_KEY`); o conteúdo dos e-mails financeiros é enviado à OpenAI para análise (`store: false`).

## Banco de dados (Supabase)

Tudo que o painel precisa guardar fica no Postgres do Supabase, no schema próprio **`dashboard_financeiro`**, separado das tabelas de outros projetos que usam o mesmo Supabase:

| Tabela | O que guarda |
|---|---|
| `checkout_charges` | cobranças geradas no checkout (com vendedor, status e total em colunas próprias para relatórios) |
| `checkout_config` | taxas da conta InfinitePay e catálogo de produtos |
| `infinitepay_sales` | vendas aprovadas recebidas por webhook |
| `cache` | respostas do Asaas guardadas para respeitar a cota (25 mil requisições a cada 12h) |
| `counters` | versão do painel, que muda a cada webhook e renova o cache em todas as instâncias |
| `collaborators` | cadastro atual de cada colaborador (nome, cargo, ativo, fixo/variável mais recentes) |
| `collaborator_pay` | fixo e variável de cada colaborador por competência (histórico) |
| `webhook_log` | registro de cada envio recebido da plataforma de colaboradores |
| `members` | quem pode entrar no painel e com qual papel (admin/seller) |
| `gmail_accounts` | conta do Gmail conectada (token criptografado, só o servidor acessa) |
| `gmail_messages` | e-mails lidos e a análise de cada um (categoria, valores, suspeita, status) |

Para criar (uma vez):

1. Supabase > **SQL Editor** > cole e rode, nesta ordem, os arquivos de `supabase/migrations/` (`20261022000000_dashboard_financeiro.sql`, `20261022010000_colaboradores.sql`, `20261022020000_auth_rls.sql` e `20261022030000_gmail.sql`).
2. Supabase > **Project Settings > Data API > Exposed schemas** > adicione `dashboard_financeiro` > salvar.
3. No `.env` (e na Vercel): `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (ou os nomes `NEXT_PUBLIC_*` do outro projeto).

Segurança: RLS ligado em todas as tabelas. A chave `anon` não enxerga nada; usuários logados só enxergam o que o papel deles em `members` permite (ver **Acesso**); usuários da outra aplicação, que não são membros, não enxergam nenhuma linha. Sem Supabase configurado, o painel usa arquivos em `server/data` (apenas para desenvolvimento).

## Hospedagem na Vercel

Produção: **https://core.scalecompany.com.br**. O `vercel.json` define dois serviços num único projeto:

| Serviço | Pasta | Rotas públicas |
|---|---|---|
| `server` (Express) | `server/` | `/api/*` e `/webhooks/*` |
| `web` (Vite) | `web/` | todo o resto (o painel) |

Não há bindings: nenhum serviço chama outro pelo servidor; o painel chama `/api` pelo navegador, no mesmo domínio.

| O quê | URL |
|---|---|
| Painel | `https://core.scalecompany.com.br` |
| Webhook Asaas | `https://core.scalecompany.com.br/webhooks/asaas` |
| Webhook InfinitePay | `https://core.scalecompany.com.br/webhooks/infinitepay` (ou `/webhooks/infinitepay/<INFINITEPAY_WEBHOOK_SECRET>`) |

Passo a passo:

1. Importe o repositório na Vercel (New Project). Os serviços são detectados pelo `vercel.json`.
2. Prepare o banco no Supabase (seção **Banco de dados** abaixo) e tenha em mãos a URL e a chave `service_role`.
3. Em **Settings > Environment Variables**, cadastre:

```
PUBLIC_URL=https://core.scalecompany.com.br
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
COLLABORATORS_WEBHOOK_SECRET=...
DEMO_MODE=false
OPENAI_API_KEY=...
ASAAS_API_KEY=...
ASAAS_WEBHOOK_TOKEN=...
```

   (e as do Inter quando o acesso sair). **Não** cadastre `API_PORT`.
4. Em **Settings > Domains**, adicione `core.scalecompany.com.br` e crie no DNS de `scalecompany.com.br` o registro `CNAME core → cname.vercel-dns.com` (a Vercel mostra o valor exato). O HTTPS é emitido automaticamente.
5. Cadastre os webhooks do Asaas e da InfinitePay com as URLs acima.

Notas:

- `DEMO_MODE=false` garante que nenhum número de demonstração apareça em produção: uma fonte sem credencial fica como "aguardando acesso".
- Na Vercel o "ao vivo" funciona por consulta a cada 10 s (`/api/live`); num servidor próprio (`npm run build` e `npm start`) ele usa conexão aberta (SSE) e é instantâneo.
- Para testar localmente como na Vercel: `npx vercel dev --local`.

## Estrutura

```
server/src/
  index.ts              rotas da API, login, tempo real, arquivos do frontend
  auth.ts               login com Supabase Auth, sessão em cookies, papéis via members
  checkout.ts           checkout InfinitePay: links, taxas, catálogo, baixa por webhook
  agent.ts              assistente (OpenAI Responses API, streaming)
  collaborators.ts      colaboradores: webhook tolerante e API da aba
  gmail/                agente de e-mails: OAuth Google, leitura, análise com IA, etiquetas
  store.ts              banco (Supabase): vendas, cobranças, configuração, cache e versão
  connectors/           um arquivo por fonte (asaas, infinitepay, inter, pending, demo)
  routes/webhooks.ts    webhooks Asaas e InfinitePay
web/src/
  lib/metrics.ts        todos os cálculos (KPIs, projeção, séries)
  checkout/             tela de checkout: nova cobrança, histórico, taxas e catálogo
  agent/                botão e chat do assistente + resumo da tela enviado a ele
  collaborators/        aba Colaboradores
  emails/               aba E-mails
  components/           cards, gráficos, calendário, tabelas
```

Para adicionar um banco, crie `server/src/connectors/<banco>.ts` devolvendo `SourceData` (status + transações normalizadas) e registre-o em `connectors/index.ts`. O painel passa a exibi-lo automaticamente.
"# dashboard-financeiro" 
