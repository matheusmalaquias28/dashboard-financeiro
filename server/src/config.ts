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
  auth: { user: str('DASHBOARD_USER'), password: str('DASHBOARD_PASSWORD') },
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
  },

  inter: {
    clientId: str('INTER_CLIENT_ID'),
    clientSecret: str('INTER_CLIENT_SECRET'),
    certPath: str('INTER_CERT_PATH', './certs/inter.crt'),
    keyPath: str('INTER_KEY_PATH', './certs/inter.key'),
    account: str('INTER_ACCOUNT'),
    baseUrl: 'https://cdpj.partners.bancointer.com.br',
  },

  sicoob: { clientId: str('SICOOB_CLIENT_ID') },
  cresol: { apiKey: str('CRESOL_API_KEY') },
};
