/**
 * Agente financeiro (OpenAI Responses API) dentro do painel.
 * - A chave fica só no servidor (OPENAI_API_KEY); o navegador fala com /api/agent/chat.
 * - O painel manda junto um resumo do que está na tela (KPIs, séries, cobranças em aberto…):
 *   o administrador manda os números financeiros; o vendedor, só as próprias cobranças do checkout.
 * - A resposta volta em streaming (texto aparece enquanto é gerado).
 */
import { Router, type Request, type Response } from 'express';
import OpenAI from 'openai';
import { config } from './config.js';

const INSTRUCTIONS = `Sirva como um agente financeiro da Scale Company, interagindo dentro do dashboard financeiro da empresa. Analise os dados financeiros fornecidos no contexto do usuário e retorne respostas detalhadas, precisas e relevantes conforme solicitado. Considere sempre as informações e métricas mostradas no dashboard; destaque possíveis tendências, oportunidades ou anomalias quando apropriado.

Antes de chegar a qualquer conclusão, utilize raciocínio estruturado explicitamente:
- Explique seus passos de análise (razão, observações, cálculos, referência aos dados exibidos, etc.).
- Só depois apresente a conclusão final, que deve estar claramente separada da análise.

Caso faltem dados para uma resposta completa, indique quais informações seriam necessárias; nunca invente dados nem extrapole além do dashboard.

Se for fornecido um pedido complexo, siga um raciocínio em cadeia de pensamento até dar a resposta final. Não devolva o controle ao usuário sem cumprir completamente a solicitação.

Formato de resposta:
- Primeiro, inclua uma seção "Análise" detalhando o raciocínio e os dados utilizados.
- Depois, inclua uma seção "Conclusão" com a resposta solicitada de maneira concisa, destacando claramente os resultados.
- Responda em português (Brasil).
- Use linguagem simples e profissional.
- Responda em texto corrido e estruturado (parágrafos), a menos que solicitado outro formato.

Exemplo de saída esperada:
**Análise:**
[Descreva os dados do dashboard analisados, cite números e tendências, faça observações sobre variações importantes, comente sobre comparativos se houver.]

**Conclusão:**
[Responda ao pedido do usuário de forma objetiva, destacando números, insights ou recomendações.]

Lembrete:
- Sempre inicie pelo raciocínio ("Análise"), seguido somente depois pela conclusão.
- Não conclua antes de analisar.
- Não invente, use apenas os dados visíveis no dashboard ou solicite informações complementares.

Para cumprimentos ou perguntas simples sobre você ou sobre como usar o painel, responda de forma breve, sem forçar as seções.`;

const MAX_HISTORY = 16;
const MAX_MESSAGE = 4000;
const MAX_CONTEXT = 60_000;

// limite simples por usuário, para um clique repetido não gerar custo na OpenAI
const usage = new Map<string, number[]>();
function allow(user: string): boolean {
  const now = Date.now();
  const recent = (usage.get(user) ?? []).filter((t) => now - t < 5 * 60_000);
  if (recent.length >= 30) return false;
  recent.push(now);
  usage.set(user, recent);
  return true;
}

let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI({ apiKey: config.openai.apiKey }));

export const agent = Router();

agent.get('/status', (_req, res) => {
  res.json({ enabled: !!config.openai.apiKey, model: config.openai.model });
});

agent.post('/chat', async (req: Request, res: Response) => {
  if (!config.openai.apiKey) {
    res.status(503).json({ error: 'Agente desativado: configure OPENAI_API_KEY' });
    return;
  }
  const user = req.user!;
  if (!allow(`${user.role}:${user.name}`)) {
    res.status(429).json({ error: 'Muitas perguntas em pouco tempo. Aguarde alguns minutos.' });
    return;
  }

  const raw: Array<{ role?: string; text?: string }> = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = raw
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text!.slice(0, MAX_MESSAGE) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    res.status(400).json({ error: 'Envie uma pergunta' });
    return;
  }

  // vendedor nunca recebe contexto financeiro: o resumo dele é só do checkout
  const page = user.role === 'seller' ? 'checkout' : String(req.body?.page ?? 'financeiro');
  const context = JSON.stringify(req.body?.context ?? {}).slice(0, MAX_CONTEXT);
  const who = user.role === 'admin' ? 'o administrador (acesso a todo o painel)' : `o vendedor ${user.name} (vê só o checkout e as próprias cobranças)`;

  const input = [
    { role: 'developer' as const, content: [{ type: 'input_text' as const, text: INSTRUCTIONS }] },
    {
      role: 'developer' as const,
      content: [
        {
          type: 'input_text' as const,
          text:
            `Quem está falando: ${who}. Tela aberta: ${page}. Data de hoje: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.\n` +
            `Valores em reais (R$). Dados visíveis no dashboard agora, em JSON (são a única fonte de verdade):\n${context}`,
        },
      ],
    },
    ...messages.map((m) =>
      m.role === 'user'
        ? { role: 'user' as const, content: [{ type: 'input_text' as const, text: m.text }] }
        : { role: 'assistant' as const, content: [{ type: 'output_text' as const, text: m.text }] },
    ),
  ];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  try {
    // parâmetros seguem a configuração do agente criada no playground da OpenAI
    const params = {
      model: config.openai.model,
      service_tier: 'default',
      input,
      text: { format: { type: 'text' }, verbosity: 'medium' },
      reasoning: { effort: config.openai.reasoningEffort, mode: 'standard', summary: 'auto' },
      tools: [],
      stream: true,
      store: false,
    };
    const stream = (await openai().responses.create(params as never, { signal: abort.signal })) as unknown as AsyncIterable<{
      type: string;
      delta?: string;
      response?: { error?: { message?: string } };
    }>;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') send('delta', event.delta ?? '');
      else if (event.type === 'response.failed' || event.type === 'error') {
        send('error', event.response?.error?.message ?? 'A resposta falhou');
        break;
      }
    }
    send('done', {});
  } catch (err) {
    if (!abort.signal.aborted) {
      const status = (err as { status?: number }).status;
      const message =
        status === 401 ? 'Chave da OpenAI inválida' : status === 429 ? 'Limite ou créditos da OpenAI esgotados' : status === 404 ? `Modelo "${config.openai.model}" não encontrado para esta chave` : (err as Error).message;
      console.error('[agente]', status, (err as Error).message);
      send('error', message);
    }
  } finally {
    res.end();
  }
});
