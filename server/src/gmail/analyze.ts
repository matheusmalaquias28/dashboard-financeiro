/**
 * Análise dos e-mails: filtro barato (palavras-chave) → sinais técnicos de golpe → IA (OpenAI) com
 * saída estruturada. Só os e-mails com cara de financeiro vão para a IA, para não gastar à toa.
 */
import OpenAI from 'openai';
import { config } from '../config.js';
import type { readMessage } from './google.js';

type Parsed = ReturnType<typeof readMessage>;

export type Category = 'cobranca' | 'recebimento' | 'nota_fiscal' | 'outro';

export interface Analysis {
  category: Category;
  summary: string;
  amount: number | null;
  dueDate: string | null;
  counterpart: string | null;
  method: 'boleto' | 'pix' | 'cartao' | 'transferencia' | 'outro' | 'nenhuma';
  paymentId: string | null;
  suspicious: boolean;
  risk: 'baixo' | 'medio' | 'alto';
  reasons: string[];
  confidence: number;
}

// ---------------------------------------------------------------- filtro

const FINANCE = /\b(boleto|fatura|cobran[cç]a|pagamento|pagar|pago|pix|vencimento|vence|venc\.|nota fiscal|nf-?e|nfs-?e|recibo|comprovante|transfer[eê]ncia|ted|doc|dep[oó]sito|recebid[oa]|recebimento|cr[eé]dito|d[eé]bito|parcela|mensalidade|assinatura|invoice|payment|paid|receipt|billing|due|r\$\s?\d)/i;

export function looksFinancial(p: Parsed, snippet: string): boolean {
  const hay = `${p.subject}\n${snippet}\n${p.attachments.join(' ')}\n${p.text.slice(0, 4000)}`;
  return FINANCE.test(hay);
}

// ---------------------------------------------------------------- sinais técnicos de golpe

const FREE_MAIL = /@(gmail|hotmail|outlook|live|yahoo|bol|uol|terra|icloud|proton(mail)?)\.(com|com\.br)/i;
const BRANDS = /(banco|bradesco|ita[uú]|santander|caixa|nubank|inter|sicoob|cresol|asaas|infinitepay|mercado ?pago|pagseguro|receita federal|serasa|correios|detran|prefeitura|google|microsoft|meta|facebook|instagram|vivo|claro|tim|enel|sabesp|copel|cemig)/i;

const domainOf = (addr: string) => /@([^>\s]+)/.exec(addr)?.[1]?.toLowerCase() ?? '';

export function signals(p: Parsed): string[] {
  const out: string[] = [];
  const auth = p.authResults.toLowerCase();
  if (/dmarc=fail/.test(auth)) out.push('DMARC falhou: o remetente pode estar se passando por outro domínio');
  if (/spf=(fail|softfail)/.test(auth)) out.push('SPF falhou: o servidor que enviou não é autorizado pelo domínio');
  if (/dkim=fail/.test(auth)) out.push('Assinatura DKIM inválida');
  const fromDomain = domainOf(p.from);
  const display = p.from.replace(/<[^>]+>/, '').trim();
  if (BRANDS.test(display) && FREE_MAIL.test(p.from)) out.push(`Nome de empresa conhecida enviado de e-mail gratuito (${fromDomain})`);
  const replyDomain = domainOf(p.replyTo);
  if (replyDomain && fromDomain && replyDomain !== fromDomain) out.push(`Responder-para (${replyDomain}) diferente do remetente (${fromDomain})`);
  const linkDomains = [...new Set(p.links.map((l) => { try { return new URL(l).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean))];
  const shorteners = linkDomains.filter((d) => /^(bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.co|rb\.gy|encurtador\.com\.br|shorturl\.at)$/.test(d));
  if (shorteners.length) out.push(`Links encurtados (${shorteners.join(', ')})`);
  if (/\.(exe|scr|js|vbs|bat|cmd|msi|jar|zip|rar|7z|html?)$/i.test(p.attachments.join(' '))) out.push(`Anexo de tipo arriscado (${p.attachments.join(', ')})`);
  if (/(urgente|imediatamente|bloquead|suspens|última chance|evite (o )?protesto|regularize (já|agora))/i.test(`${p.subject} ${p.text.slice(0, 3000)}`)) out.push('Linguagem de urgência ou ameaça');
  return out;
}

// ---------------------------------------------------------------- IA

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: ['cobranca', 'recebimento', 'nota_fiscal', 'outro'] },
    summary: { type: 'string', description: 'Uma frase em português: quem, o quê, quanto, quando.' },
    amount: { type: ['number', 'null'], description: 'Valor principal em reais, sem símbolo.' },
    dueDate: { type: ['string', 'null'], description: 'Vencimento (cobrança) ou data do pagamento (recebimento), AAAA-MM-DD.' },
    counterpart: { type: ['string', 'null'], description: 'Empresa/pessoa que cobra (cobrança) ou que pagou (recebimento).' },
    method: { type: 'string', enum: ['boleto', 'pix', 'cartao', 'transferencia', 'outro', 'nenhuma'] },
    paymentId: { type: ['string', 'null'], description: 'Linha digitável do boleto, chave Pix ou identificador do pagamento, se aparecer.' },
    suspicious: { type: 'boolean' },
    risk: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
    reasons: { type: 'array', items: { type: 'string' }, description: 'Motivos objetivos da suspeita (vazio se não houver).' },
    confidence: { type: 'number', description: 'Confiança da classificação, de 0 a 1.' },
  },
  required: ['category', 'summary', 'amount', 'dueDate', 'counterpart', 'method', 'paymentId', 'suspicious', 'risk', 'reasons', 'confidence'],
} as const;

const INSTRUCTIONS = `Você é o agente financeiro da Scale Company (agência de marketing, Brasil) e analisa e-mails da caixa da empresa.
Classifique cada e-mail:
- "cobranca": alguém está cobrando a Scale Company (boleto, fatura, mensalidade de fornecedor/ferramenta, imposto, aviso de vencimento).
- "recebimento": a Scale Company recebeu dinheiro (aviso de Pix/TED recebido, pagamento confirmado de cliente, comprovante enviado por cliente).
- "nota_fiscal": nota fiscal emitida ou recebida, sem cobrança direta.
- "outro": não é financeiro (marketing, newsletter, conversa).
Extraia valor, vencimento/data, contraparte, forma de pagamento e identificador quando estiverem no texto. Nunca invente valores.

Avalie se é uma cobrança FALSA (golpe). Indícios: remetente que não bate com a empresa citada, falhas de SPF/DKIM/DMARC,
e-mail gratuito se passando por empresa, dados de pagamento diferentes dos usados antes pela mesma empresa (veja o histórico),
favorecido pessoa física numa cobrança de empresa, links encurtados ou de domínios estranhos, urgência e ameaça,
cobrança de serviço que a empresa provavelmente não contratou, valores fora do padrão do histórico.
Use os "sinais técnicos" fornecidos. Seja objetivo nos motivos. Se não houver indício, suspicious=false e risk="baixo".`;

let client: OpenAI | null = null;

export async function analyzeWithAI(p: Parsed, techSignals: string[], history: string[]): Promise<Analysis> {
  client ??= new OpenAI({ apiKey: config.openai.apiKey });
  const email = [
    `De: ${p.from}`,
    p.replyTo ? `Responder para: ${p.replyTo}` : '',
    `Para: ${p.to}`,
    `Data: ${p.date}`,
    `Assunto: ${p.subject}`,
    p.attachments.length ? `Anexos: ${p.attachments.join(', ')}` : '',
    `Domínios dos links: ${[...new Set(p.links.map((l) => { try { return new URL(l).hostname; } catch { return ''; } }))].filter(Boolean).slice(0, 15).join(', ') || 'nenhum'}`,
    `Sinais técnicos: ${techSignals.length ? techSignals.join(' | ') : 'nenhum'}`,
    history.length ? `Histórico desta mesma contraparte no painel:\n- ${history.join('\n- ')}` : 'Histórico desta contraparte: nenhum e-mail anterior.',
    '',
    p.text.slice(0, 7000),
  ]
    .filter(Boolean)
    .join('\n');

  const res = await client.responses.create({
    model: config.openai.model,
    instructions: INSTRUCTIONS,
    input: email,
    reasoning: { effort: 'low' },
    text: { format: { type: 'json_schema', name: 'analise_email', schema: SCHEMA, strict: true } },
    store: false,
  } as never);
  const out = JSON.parse((res as unknown as { output_text: string }).output_text) as Analysis;
  // sinais técnicos graves tornam a cobrança suspeita mesmo se a IA não marcar
  if (out.category === 'cobranca' && techSignals.some((s) => /DMARC|e-mail gratuito/.test(s)) && !out.suspicious) {
    out.suspicious = true;
    out.risk = out.risk === 'baixo' ? 'medio' : out.risk;
    out.reasons = [...out.reasons, ...techSignals];
  }
  return out;
}
