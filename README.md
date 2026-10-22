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
3. Cada venda aprovada é **confirmada em `/payment_check`** antes de entrar no painel (o webhook não tem assinatura), gravada (Upstash Redis na Vercel, `server/data/infinitepay.json` em servidor próprio) e enviada ao painel.
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

## Acesso

O painel abre com uma **tela de login só com senha**, definida em `DASHBOARD_PASSWORD`. É uma proteção básica inicial:

- a sessão dura 30 dias, num cookie `HttpOnly` assinado com a própria senha; **trocar a senha desconecta todo mundo**;
- toda a API (`/api/*`) exige a sessão; os webhooks continuam abertos, cada um com sua própria validação;
- sem `DASHBOARD_PASSWORD` o painel fica aberto (use só no desenvolvimento).

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
2. Em **Storage / Marketplace**, adicione **Upstash Redis** ao projeto. As variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` são criadas sozinhas. Sem isso, as vendas da InfinitePay recebidas por webhook se perdem, porque a Vercel não tem disco e roda várias instâncias.
3. Em **Settings > Environment Variables**, cadastre:

```
PUBLIC_URL=https://core.scalecompany.com.br
DASHBOARD_PASSWORD=...
DEMO_MODE=false
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
  auth.ts               login só com senha (cookie assinado)
  store.ts              vendas por webhook: Upstash Redis ou arquivo local
  connectors/           um arquivo por fonte (asaas, infinitepay, inter, pending, demo)
  routes/webhooks.ts    webhooks Asaas e InfinitePay
web/src/
  lib/metrics.ts        todos os cálculos (KPIs, projeção, séries)
  components/           cards, gráficos, calendário, tabelas
```

Para adicionar um banco, crie `server/src/connectors/<banco>.ts` devolvendo `SourceData` (status + transações normalizadas) e registre-o em `connectors/index.ts`. O painel passa a exibi-lo automaticamente.
"# dashboard-financeiro" 
