/**
 * Bancos cujo acesso à API ainda está sendo solicitado. Aparecem no painel de integrações
 * com o checklist do que falta; quando o acesso sair, basta implementar `load` no mesmo
 * formato de inter.ts (saldo + extrato normalizados para Transaction).
 */
import type { Connector, SourceData, SourceId } from '../types.js';

function pendingConnector(id: SourceId, name: string, role: string, nextSteps: string[]): Connector {
  return {
    id,
    async load(): Promise<SourceData> {
      return {
        status: { id, name, role, state: 'pending_access', message: 'Aguardando acesso à API', balance: null, balanceUpdatedAt: null, realtime: false, nextSteps },
        transactions: [],
        subscriptions: [],
      };
    },
  };
}

export const sicoob = pendingConnector('sicoob', 'Sicoob', 'Conta PJ', [
  'Criar conta no Portal do Desenvolvedor: developers.sicoob.com.br',
  'Cadastrar aplicação e solicitar as APIs "Conta Corrente" (saldo e extrato)',
  'Enviar o certificado digital ICP-Brasil (e-CNPJ A1) para a autenticação mTLS',
  'Receber client_id e preencher SICOOB_CLIENT_ID no .env',
]);

export const cresol = pendingConnector('cresol', 'Cresol', 'Conta PJ', [
  'Solicitar ao gerente a documentação e credenciais da API (saldo e extrato)',
  'Confirmar formato de autenticação (OAuth / certificado) e ambiente de testes',
  'Preencher CRESOL_API_KEY no .env',
]);
