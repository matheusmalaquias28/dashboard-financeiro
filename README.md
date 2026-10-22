# Dashboard Financeiro · Scale Company

Painel comercial e financeiro que junta recebimentos, saídas, saldos e projeções do **Asaas**, da **InfinitePay** e das contas **Inter**, **Sicoob** e **Cresol**, com atualização em tempo real.

- **Backend:** Node.js + Express (`server/`). Guarda as chaves de API, consulta cada fonte, recebe webhooks e envia eventos ao navegador (SSE).
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
| **InfinitePay hoje (ao vivo)** | Vendas aprovadas recebidas por webhook, empurradas ao navegador na hora (SSE). |
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
3. Cada venda aprovada é **confirmada em `/payment_check`** antes de entrar no painel (o webhook não tem assinatura), gravada em `server/data/infinitepay.json` e enviada ao navegador na hora.
4. Opcional: `INFINITEPAY_WEBHOOK_SECRET` muda a URL para `/webhooks/infinitepay/<segredo>`.

⚠️ Vendas na **maquininha** não passam pelo webhook do checkout. Para elas, é preciso solicitar à InfinitePay/CloudWalk acesso à API de parceiros.

### Banco Inter ⏳ acesso e comunicação
Conector implementado conforme a documentação oficial (mTLS + OAuth, `/banking/v2/saldo` e `/banking/v2/extrato`), **ainda não testado com credenciais reais**.
1. Internet Banking PJ > Soluções para sua empresa > Nova integração, com o escopo "Consultar extrato e saldo".
2. Baixe o certificado e salve em `certs/inter.crt` e `certs/inter.key` (a pasta `certs/` está no `.gitignore`).
3. Preencha `INTER_CLIENT_ID` e `INTER_CLIENT_SECRET`.

### Sicoob ⏳ verificar documentação e solicitar acesso
Portal do desenvolvedor: developers.sicoob.com.br. É preciso cadastrar a aplicação, solicitar as APIs de Conta Corrente e enviar o certificado e-CNPJ A1. O conector atual (`server/src/connectors/pending.ts`) só mostra o checklist; a implementação segue o modelo de `inter.ts`.

### Cresol ⏳ solicitar dados de API ao gerente
Peça ao gerente a documentação e as credenciais de saldo e extrato. Mesmo modelo de implementação.

## Hospedagem

Produção: **https://core.scalecompany.com.br**

| O quê | URL |
|---|---|
| Painel | `https://core.scalecompany.com.br` |
| Webhook Asaas | `https://core.scalecompany.com.br/webhooks/asaas` |
| Webhook InfinitePay | `https://core.scalecompany.com.br/webhooks/infinitepay` (ou `/webhooks/infinitepay/<INFINITEPAY_WEBHOOK_SECRET>`) |

Variáveis no servidor de produção (além das credenciais de cada banco):

```
PUBLIC_URL=https://core.scalecompany.com.br
DASHBOARD_USER=...
DASHBOARD_PASSWORD=...
DEMO_MODE=false
```

- `DEMO_MODE=false` garante que nenhum número de demonstração apareça em produção: uma fonte sem credencial fica como "aguardando acesso".
- **Sempre** defina `DASHBOARD_USER`/`DASHBOARD_PASSWORD`. Sem eles, o painel com dados financeiros fica aberto.
- DNS: crie um registro `CNAME` (ou `A`) de `core` em `scalecompany.com.br` apontando para a hospedagem. O certificado HTTPS é obrigatório para os webhooks e costuma ser emitido automaticamente (Render, Railway, Fly.io; numa VPS, Caddy ou Nginx + Certbot).
- O processo é um só (`npm run build` e depois `npm start`) e escuta em `PORT`, que as plataformas definem sozinhas.
- Se houver Nginx na frente, desative o buffer em `/api/stream` (`proxy_buffering off;`) para o tempo real funcionar.

Para testar webhooks localmente, use `cloudflared tunnel` ou `ngrok`.

`server/data/infinitepay.json` é a única persistência local. Se a hospedagem tiver disco efêmero, monte um volume nessa pasta (ou troque `JsonStore` por um banco).

## Estrutura

```
server/src/
  index.ts              rotas da API, autenticação, SSE, arquivos do frontend
  connectors/           um arquivo por fonte (asaas, infinitepay, inter, pending, demo)
  routes/webhooks.ts    webhooks Asaas e InfinitePay
web/src/
  lib/metrics.ts        todos os cálculos (KPIs, projeção, séries)
  components/           cards, gráficos, calendário, tabelas
```

Para adicionar um banco, crie `server/src/connectors/<banco>.ts` devolvendo `SourceData` (status + transações normalizadas) e registre-o em `connectors/index.ts`. O painel passa a exibi-lo automaticamente.
"# dashboard-financeiro" 
