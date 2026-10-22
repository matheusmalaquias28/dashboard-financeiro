const env = process.env;

const str = (key: string, fallback = '') => (env[key] ?? fallback).trim();
const bool = (key: string, fallback: boolean) => {
  const v = env[key]?.trim().toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
};

export const config = {
  // API_PORT tem prioridade: plataformas de hospedagem (e ferramentas de preview) definem PORT por conta própria
  port: Number(str('API_PORT') || str('PORT', '3001')),
  publicUrl: str('PUBLIC_URL', 'http://localhost:3001').replace(/\/$/, ''),
  demoMode: bool('DEMO_MODE', true),

  asaas: {
    apiKey: str('ASAAS_API_KEY'),
    baseUrl: str('ASAAS_ENV', 'production') === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3',
    webhookToken: str('ASAAS_WEBHOOK_TOKEN'),
  },

  infinitepay: {
    handle: str('INFINITEPAY_HANDLE', 'scalecompany_').replace(/^\$/, ''),
    verifyWebhook: bool('INFINITEPAY_VERIFY_WEBHOOK', true),
    webhookSecret: str('INFINITEPAY_WEBHOOK_SECRET'),
    apiUrl: 'https://api.checkout.infinitepay.io',
    /** Token opcional (Bearer), só se a conta exigir autenticação para gerar links */
    apiToken: str('INFINITEPAY_API_TOKEN') || str('INFINITEPAY_API_KEY'),
    /** true = gera links falsos e permite simular o pagamento (testes, sem tocar na conta real) */
    checkoutMock: bool('INFINITEPAY_CHECKOUT_MOCK', false),
  },

  inter: {
    clientId: str('INTER_CLIENT_ID'),
    clientSecret: str('INTER_CLIENT_SECRET'),
    certPath: str('INTER_CERT_PATH', './certs/inter.crt'),
    keyPath: str('INTER_KEY_PATH', './certs/inter.key'),
    certBase64: str('INTER_CERT_BASE64'),
    keyBase64: str('INTER_KEY_BASE64'),
    account: str('INTER_ACCOUNT'),
    baseUrl: 'https://cdpj.partners.bancointer.com.br',
  },

  /** Banco de dados (Supabase). Aceita também os nomes NEXT_PUBLIC_* de outro projeto que use o mesmo Supabase */
  supabase: {
    url: (str('SUPABASE_URL') || str('NEXT_PUBLIC_SUPABASE_URL')).replace(/\/$/, ''),
    serviceKey: str('SUPABASE_SERVICE_ROLE_KEY'),
    /** chave pública: login (Supabase Auth) e consultas em nome do usuário, sujeitas ao RLS */
    anonKey: str('SUPABASE_ANON_KEY') || str('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    schema: str('SUPABASE_SCHEMA', 'dashboard_financeiro'),
  },
  /** Na Vercel não há conexão longa entre instâncias: o painel consulta /api/live periodicamente */
  liveMode: process.env.VERCEL ? ('poll' as const) : ('sse' as const),

  openai: {
    apiKey: str('OPENAI_API_KEY'),
    model: str('OPENAI_MODEL', 'gpt-6-luna'),
    reasoningEffort: str('OPENAI_REASONING_EFFORT', 'medium'),
  },

  /** Webhook de colaboradores (outra plataforma): o segredo vai na URL /webhooks/colaboradores/<segredo> */
  collaborators: { webhookSecret: str('COLLABORATORS_WEBHOOK_SECRET') },

  /** Agente de e-mails: OAuth do Google (Gmail) e chave que criptografa o token guardado no banco */
  gmail: {
    clientId: str('GOOGLE_CLIENT_ID'),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
    tokenKey: str('GMAIL_TOKEN_KEY'),
  },
  /** segredo das tarefas agendadas (Vercel Cron envia "Authorization: Bearer <CRON_SECRET>") */
  cronSecret: str('CRON_SECRET'),

  sicoob: { clientId: str('SICOOB_CLIENT_ID') },
  cresol: { apiKey: str('CRESOL_API_KEY') },
};
