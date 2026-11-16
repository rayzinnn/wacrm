# WACRM — plano de implementação por tarefas

> **Para agentes:** REQUIRED SUB-SKILL: usar `superpowers:executing-plans`, uma tarefa por vez. `superpowers:subagent-driven-development` é alternativa quando autorizada. As caixas representam ações verificáveis, não estimativas.

**Goal:** conectar o CRM existente à UAZAPI por QR, enviar/receber sem Meta e publicar um piloto recuperável.

**Architecture:** Next.js/Supabase existentes, cliente UAZAPI no servidor, caixa de eventos durável no Postgres, tentativas de envio identificadas e UI integrada aos módulos atuais.

**Tech Stack:** a do commit `c81299d1488aac02fa584f68d97c2524c1e7a661`; Node `>=22.12.0`, npm `10.9.9`, Vitest.

**Spec:** [contexto, decisões e aceites A01–A12](2026-11-15-crm-whatsapp.md). Ler esse documento antes de executar qualquer tarefa. Os contratos abaixo são propostas técnicas desta revisão; T03/T04 devem confirmá-los antes de implementação dependente.

## Restrições globais e foco de revisão

Valem todas as restrições da especificação, especialmente: somente API não oficial; nenhum token/QR em log ou resposta de leitura; uma conexão inicial; sem destruição de dados; conta derivada da autenticação; sem contratação implícita. Testar os cinco riscos da especificação: duplicação/ordenação, envio incerto, acesso cruzado, loops e caminhos Meta residuais.

**Estado inicial:** T01–T16 não iniciadas. Este arquivo é um plano, não registro de produto implementado.

## Como executar os cartões

- Caminhos são relativos à raiz do produto após T01. Antes de T01, a raiz tem apenas `docs/`.
- Cada cartão lista dependências; lê-las e verificar suas evidências antes de editar.
- Nos cartões de código, seguir cada etapa RED → implementação → GREEN. Uma falha de import inexistente é esperada no início; erro de ambiente não substitui o RED de comportamento após criar o esqueleto.
- `npm test -- caminho/do/arquivo.test.ts` usa o script `vitest run` confirmado; substitua somente pelo caminho literal listado no cartão. Resultado esperado: arquivo executado, testes indicados presentes, zero falhas. Não aceitar “nenhum teste encontrado”.
- Salvar evidência sanitizada em `docs/project/evidence/Txx.md` e atualizar `docs/project/status.md`. Nome do teste + entrada + asserção + comando + resultado bastam; não colar logs extensos.
- Ao concluir código, `git diff --check`, testes indicados e commit local com os arquivos explícitos da tarefa. Se não houver mudança rastreável, não fabricar commit. Não usar `git add .`.
- Assinaturas existentes que o cartão manda preservar devem ser lidas no SHA do produto; assinaturas novas estão fixadas abaixo. Divergência exige corrigir o plano antes de editar consumidores.

### Recortes obrigatórios para uma sessão LUNA

Os cartões são unidades de entrega/revisão. Para LUNA, o coordenador distribui os recortes abaixo em ordem; não entrega um cartão grande inteiro e espera que o agente descubra como dividi-lo. Cada recorte recebe os contratos comuns, o cartão completo e a evidência do anterior. Encerrar a sessão após a verificação indicada no recorte; a tarefa pai só termina quando todos passam.

| Cartão | Recortes de execução, em ordem |
| --- | --- |
| T01 | a: inventário/backup/clone temporário; b: integrar sem colisão, conferir hashes e registrar baseline. |
| T02 | a: runtime/npm/env; b: banco e histórico; c: checks e smoke local. |
| T03 | a: versão/OpenAPI/identidade; b: fixtures e matriz; c: webhook/ACK/autenticação e revisão do contrato. |
| T04 | a: emissores/leitores; b: schema/RPC/dispatch; c: cobertura de cada referência por tarefa. |
| T05 | a: tipos/cliente e client.test; b: normalizador e events.test. |
| T06 | a: migration e teste SQL; b: store/teste; c: aplicar em dev e verificar isolamento. |
| T07 | a: config route/teste; b: connect/status/testes; c: UI/traduções e smoke. |
| T08 | a: autenticação/teste; b: fila/teste; c: receptor/teste e replay em dev. |
| T09 | a: persistência inbound transacional; b: estados/eco; c: worker/cron/lease e restart. |
| T10 | a: reserva/tentativas/teste; b: core de texto/teste; c: rotas/operações; d: composer/timeout. |
| T11 | a: download/Storage privado; b: saída e limites; c: inbound/rotas e isolamento. |
| T12 | a: dispatch durável/replay; b: automações; c: flows; d: IA/handoff e teste de crash. |
| T13 | a: bloqueios nas rotas/cron; b: leitores/controles/UI; c: env/CI/docs e mapa final. |
| T14 | a: teste de rede e inventário; b: suíte/banco; c: revisão A01–A11 e SHA verificado. |
| T15 | a: host/banco/deploy/scheduler; b: QR/webhook/texto; c: mídia/falhas/restart e evidências. |
| T16 | a: backup/restore; b: rollback/produção; c: piloto e backlog. |

Cada recorte de código inclui seus testes antes da implementação e sua verificação após. Se depender de um símbolo do recorte seguinte, escrever o teste para a interface acordada e registrar o bloqueio; não antecipar a implementação do vizinho. T03.c, T04.b, T06.c, T10.d e T16.a exigem revisão do coordenador antes de liberar o próximo cartão.

## Contratos comuns que viajam com cada tarefa

### C1. Credenciais e estado

Novo arquivo `src/lib/whatsapp/uazapi/types.ts`:

```ts
export type SessionState = 'disconnected' | 'connecting' | 'connected' | 'unknown';
export type MediaKind = 'image' | 'document' | 'audio' | 'video';
export interface UazapiCredentials {
  baseUrl: string;
  instanceId: string;
  token: string;
}
export interface SessionSnapshot {
  state: SessionState;
  qr: { dataUrl: string; expiresAt: string } | null;
  checkedAt: string;
}
export interface ProviderAcceptance { externalMessageId: string }
export interface ProviderText {
  recipient: string; text: string; requestId: string;
}
export interface ProviderMedia {
  recipient: string; kind: MediaKind; url: string;
  caption?: string; filename?: string; requestId: string;
}
```

`recipient` é identidade canônica comprovada em T03. Não remover `+`, sufixos JID ou dígito brasileiro em funções genéricas: converter somente na borda UAZAPI segundo a fixture. Uma identidade sem telefone resolvível não pode ser convertida por adivinhação; guardar diagnóstico sanitizado sem criar contato errado.

Novo `client.ts` exporta `getSession(credentials): Promise<SessionSnapshot>`, `connectSession(credentials): Promise<SessionSnapshot>`, `sendText(credentials, input: ProviderText): Promise<ProviderAcceptance>`, `sendMedia(credentials, input: ProviderMedia): Promise<ProviderAcceptance>` e `configureWebhook(credentials, callbackUrl: string): Promise<void>`. Todos os parâmetros `credentials` têm tipo `UazapiCredentials`.

`UazapiError` contém `code`, `httpStatus`, `retryable`, `ambiguous`. Timeout de mutação tem `ambiguous=true`. Uma aceitação remota não significa entrega ao destinatário. Sem ID válido na resposta de envio, não retornar sucesso.

Novas configurações de operação, servidor apenas: `UAZAPI_ALLOWED_ORIGINS` (origens HTTPS exatas permitidas, sem wildcard), `UAZAPI_EVENTS_CRON_SECRET` (segredo do processador). Timeout proposto do cliente: 15 segundos; sem retry automático de mutações. QR expira pelo valor real do provedor. Se ele não expõe expiração, T03 deve fixar política conservadora de descarte local e registrar que não é validade remota garantida.

### C2. Evento normalizado

Novo `events.ts` exporta `normalizeWebhook(payload: unknown): NormalizedEvent[]`; o parser depende das fixtures T03, não de um envelope inventado.

```ts
export type NormalizedEvent =
  | { kind: 'message'; eventKey: string; externalMessageId: string;
      peer: string; occurredAt: string; fromMe: boolean; sentByApi: boolean;
      contentType: 'text' | 'image' | 'document' | 'audio' | 'video';
      text: string | null; mediaRef: string | null }
  | { kind: 'status'; eventKey: string; externalMessageId: string;
      status: 'sent' | 'delivered' | 'read' | 'failed'; occurredAt: string }
  | { kind: 'connection'; eventKey: string; occurredAt: string };
```

T03 fixa a correlação exata de cada evento e timestamp (unidade/fuso). `eventKey` é determinístico e deduplicado por conexão. Eventos de estado podem usar `(externalMessageId,status)` quando o provedor não oferece event ID. Mensagens usam ID remoto estável, não hash do texto. Eventos fora do escopo são ignorados explicitamente. `connection` agenda consulta de estado real, evitando aplicar snapshots antigos sem ordem comparável.

Somente mensagem nova com `fromMe=false` e `sentByApi=false` gera gatilho de inbound. Eco do celular pode ser registrado como saída, mas nunca como cliente. Eco da API reconcilia ID/tentativa, sem duplicar a mensagem local. Não excluir indiscriminadamente callbacks que carreguem os estados necessários: T03 comprova a combinação de filtros.

As fixtures de eventos têm formato `{payload, expected}`: payload observado/sanitizado e array NormalizedEvent esperado, aprovado em T03 antes do parser. Fixtures HTTP têm `{request, response, expected}`, com valores sintéticos e schema preservado. Não gerar o esperado chamando a própria função em teste. Exemplo literal para `events.test.ts`, após T03 produzir os arquivos:

```ts
import { expect, it } from 'vitest';
import inbound from './fixtures/message-inbound.json';
import echo from './fixtures/message-api-echo.json';
import { normalizeWebhook } from './events';

it('normalizes an observed inbound without inventing identity', () => {
  expect(normalizeWebhook(inbound.payload)).toEqual(inbound.expected);
  expect(inbound.expected[0]).toMatchObject({
    kind: 'message', fromMe: false, sentByApi: false,
  });
});

it('keeps the API echo distinct from inbound and stable on replay', () => {
  const result = normalizeWebhook(echo.payload);
  expect(result).toEqual(echo.expected);
  expect(result[0]).toMatchObject({kind: 'message', fromMe: true, sentByApi: true});
  expect(normalizeWebhook(structuredClone(echo.payload))).toEqual(result);
});
```

Os nomes e asserções dos demais testes seguem o mesmo padrão: nomear comportamento/condição e verificar valores fixados pelo contrato, incluindo contagens exatas de linhas e chamadas remotas nos cenários de duplicação. Fixtures não substituem testes de concorrência no banco nem validação real em staging.

### C3. Persistência proposta

T04 verifica o schema acumulado; T06 gera o nome real da migration. **Os nomes abaixo são os contratos propostos, não tabelas já existentes.**

- `whatsapp_connections`: `id uuid` PK, `account_id uuid` FK accounts UNIQUE, `created_by uuid` FK auth.users, `provider text` CHECK `uazapi`, `base_url text`, `instance_id text`, `token_encrypted text`, `state text` com estados C1, `state_checked_at timestamptz`, `created_at/updated_at timestamptz`. UNIQUE `(base_url,instance_id)` impede a mesma instância em contas diferentes. Token sempre criptografado com helper existente. Trocar token da mesma instância atualiza a linha; trocar identidade da instância exige novo procedimento, fora do primeiro corte.
- `whatsapp_events`: `id uuid` PK, `connection_id uuid` FK, `event_key text`, `event_json jsonb` **normalizado e sem token**, `state text` em `pending/processing/done/failed`, `attempts integer DEFAULT 0`, `lease_until/next_attempt_at/processed_at timestamptz` nullable, `last_error_code text` nullable, `created_at timestamptz`. UNIQUE `(connection_id,event_key)`.
- `whatsapp_send_attempts`: `id uuid` PK, `account_id uuid` FK, `connection_id uuid` FK, `request_id text`, `request_hash text`, `conversation_id uuid` FK, `message_row_id uuid` FK messages nullable, `external_message_id text` nullable, `outcome text` em `pending/accepted/rejected/unknown`, `error_code text` nullable, `created_at/updated_at timestamptz`. UNIQUE `(account_id,request_id)`. Hash cobre alvo, tipo e conteúdo; mesma chave com corpo diferente é conflito.
- `messages`: acrescentar `provider_connection_id uuid` nullable FK; índice UNIQUE `(provider_connection_id,message_id)` quando ambos não nulos. **`messages.id` é UUID interno; `messages.message_id` é ID externo.** Não trocar essas semânticas. Isolamento de messages continua pela conversa/conta existente.
- RLS habilitada nas três tabelas novas; revogar acesso direto de `anon/authenticated` e não criar política de leitura de segredos. Backend acessa com service role somente depois de validar papel/conta ou autenticar webhook/cron. Conservar RLS das mensagens/contatos. Testar DB real, não somente mocks.
- Deduplicação e efeitos de persistência (mensagem, preview, não lidas) usam transação/RPC. RPCs internas com execução revogada de PUBLIC/anon/authenticated e liberada apenas ao papel de servidor; preferir SECURITY INVOKER. Não adicionar SECURITY DEFINER para contornar permissão.

Worker: lote de até 10 eventos, claim atômico com lease de 60s; 5 tentativas para falhas transitórias de processamento, esperas `5/15/60/300` segundos, depois `failed`. Cron roda a cada minuto. Eventos autenticados só recebem ACK após insert durável. Retry de **processamento de evento** nunca autoriza retry cego de **envio remoto**. A plataforma deve suportar essa duração; T15 mede antes de habilitar.

### C4. API da aplicação e permissões

Manter a convenção de erro das rotas existentes (`toErrorResponse`/envelope v1); não criar resposta inconsistente. Campos novos abaixo usam o estilo camelCase nas rotas de configuração; mapear snake_case da API v1 existente explicitamente.

| Rota | Contrato proposto |
| --- | --- |
| `GET /api/whatsapp/config` | Membro autenticado: `{configured, provider:'uazapi', state, checkedAt, capabilities}`; admin recebe também baseUrl/instanceId. Nunca token ou linha bruta. |
| `POST /api/whatsapp/config` | Owner/admin: `{baseUrl,instanceId,token}`; validar origem permitida e instância, criptografar e salvar; retornar DTO seguro. Não aceitar accountId do body. |
| `POST /api/whatsapp/uazapi/connect` | Owner/admin; carrega credenciais pela conta; retorna SessionSnapshot, `Cache-Control: no-store`. |
| `GET /api/whatsapp/uazapi/status` | Owner/admin; SessionSnapshot, `no-store`. Membros operacionais recebem estado sem QR pelo GET config. |
| `POST /api/whatsapp/uazapi/webhook` | Público, autenticado pelo mecanismo comprovado em T03; normaliza/enfileira, sem confiar em owner/instanceName como autorização. |
| `GET /api/whatsapp/uazapi/events/cron` | Bearer `UAZAPI_EVENTS_CRON_SECRET`; processa lote limitado, retorna contagens sem conteúdo. |
| `GET /api/whatsapp/operations/[requestId]` | Membro autorizado da mesma conta/conversa; estado de tentativa, IDs e erro sanitizado; nunca credenciais. |

Não reutilizar validação HMAC Meta para UAZAPI. T03 define mecanismo real e teste negativo. A documentação consultada descreve credencial no envelope em alguns eventos; isso não autoriza logar ou devolver esse campo.

### C5. Envio e capacidades

Preservar o nome `sendMessageToConversation(db: SupabaseClient, accountId: string, params: SendMessageParams): Promise<SendMessageResult>` e os campos existentes de resultado `messageId` e `whatsappMessageId`. Acrescentar `requestId: string` ao contrato interno de parâmetros/resultado e atualizar todos os chamadores em T10/T12. Preservar regras de auditoria, conta, remetente, handoff e pausa de fluxos.

- Inbox gera UUID por clique lógico e reutiliza ao consultar resultado; bloqueia duplo clique durante envio.
- Rotas de envio aceitam `Idempotency-Key`; se ausente geram UUID, devolvem `request_id` e documentam que o cliente deve fornecê-la para proteger retries entre requisições. Mesma chave/corpo retorna tentativa existente; corpo diferente retorna HTTP 409.
- Tentativa é reservada antes da chamada remota. Outro processo que encontra `pending` não envia novamente. `pending` abandonado por mais de 120s vira `unknown`, sem retry de mutação. Falha de banco/crash depois de o provedor aceitar também não autoriza novo envio: reconciliar pelo ID/metadado comprovado em T03; sem correlação suficiente, manter incerto e exigir conferência operacional.
- HTTP 504 + código `delivery_unknown` para timeout ambíguo; inclui request_id e orientação de consulta. Não marcar delivered/read/failed sem evidência.
- Enquanto incerto, a linha local pode continuar `sending`, mas a UI consulta tentativa e exibe “Envio não confirmado. Verifique antes de tentar novamente.” Não criar status fora do CHECK existente em messages.
- `accepted` permite `sent`; `delivered/read` só por evento comprovado. Falha definitiva permite `failed`. Reusar progressão monotônica e estados pendentes existentes quando compatíveis, sem presumir que `wamid` precisa começar por um prefixo Meta.
- Mensagens disparadas por motores usam request_id estável derivado de execução + ação + destinatário; não gerar UUID novo em cada retomada.
- `capabilities.ts` exporta `getUazapiCapabilities(): {text:true, media:MediaKind[], templates:false, broadcasts:false, reactions:false, interactive:false, typing:false}`. A lista de media vem da matriz aprovada T03 e é versionada no código, não fornecida livremente pelo browser.

## T01 — Preparar o workspace sem perder documentação

**Dependências:** nenhuma. **Entrega:** produto fixado + documentação preservada, sem instalar/implantar ainda.
**Arquivos:** preservar `docs/superpowers/plans/*.md`; criar `docs/project/status.md`, `docs/project/baseline.md`.
**Interfaces:** produz raiz Git do produto e SHA para T02–T04.

- [ ] Conferir `pwd`, arquivos ocultos e `git status`. Se já houver Git/produto, verificar origem e não executar a receita de integração abaixo novamente.
- [ ] Copiar os documentos atuais para backup fora do workspace, registrar caminho em status e comparar depois por SHA-256. Usar pasta temporária criada por `mktemp -d`, não uma pasta preexistente compartilhada.
- [ ] Consultar acesso GitHub disponível e identificar proprietário real do fork. Se ainda indefinido, usar clone de leitura de `https://github.com/ArnasDon/wacrm.git` em pasta temporária e registrar bloqueio de publicação; não inventar remote próprio.
- [ ] No clone temporário, buscar/verificar `c81299d1488aac02fa584f68d97c2524c1e7a661` e criar branch `feat/uazapi-only` a partir dele. Não assumir que HEAD remoto é igual.
- [ ] Comparar os caminhos do clone com os arquivos já existentes no workspace. Copiar/integrar o clone, incluindo `.git`, somente se não houver colisão; preservar `docs/`. Se houver colisão, manter as duas versões e revisar o diff, sem sobrescrever automaticamente. Não usar `clone ... .` aqui.
- [ ] Configurar `upstream` para ArnasDon/wacrm e `origin` para fork confirmado quando disponível. Conferir remotes e branch sem imprimir URLs contendo credenciais.
- [ ] Ler `AGENTS.md`, `CLAUDE.md`, README, LICENSE e `package.json`. Registrar SHA completo, branch e presença de `package-lock.json` em baseline.
- [ ] Verificar `git rev-parse HEAD`, `git branch --show-current`, `git status --short`; comparar hashes dos planos com backup. Esperado: SHA fixado, branch correta e documentos preservados. Registrar T01 e fazer commit local dos documentos se adequado.

## T02 — Obter baseline local e banco de desenvolvimento

**Dependências:** T01. **Entrega:** autenticação/inbox locais e relatório de baseline.
**Arquivos:** `.env.local` não versionado; atualizar `docs/project/baseline.md`, criar `docs/project/setup.md`.
**Interfaces:** produz comandos reais de migrations e resultados originais para T06/T14.

- [ ] Conferir `node --version` e `npm --version` contra os valores da especificação; ajustar runtime sem atualizar dependências do produto.
- [ ] Executar `npm ci`; esperado exit 0 e lockfile sem alteração. Falha de registry/engine é setup, não motivo para mudar versões aleatoriamente.
- [ ] Ler `.env.local.example`, documentação Supabase indicada pelo README e os guias locais Next relevantes. Criar `.env.local` somente se ausente; se existe, validar nomes sem imprimir valores. Usar `NEXT_PUBLIC_APP_LOCALE=pt`.
- [ ] Gerar ENCRYPTION_KEY diretamente no arquivo/gerenciador local, sem saída de terminal capturada. Não substituir chave existente. `git check-ignore .env.local` deve confirmar proteção.
- [ ] Identificar projeto Supabase dev vazio e separado. Registrar project ref não secreto e confirmar URL do alvo. Conferir CLI com `supabase --version` e `supabase --help`; consultar ajuda dos subcomandos usados.
- [ ] Inventariar migrations ordenadas e aplicar a cadeia completa pelo método suportado no commit/CLI. Registrar comandos **reais** e histórico aplicado em setup. Não reexecutar SQL histórico para “garantir”, não usar reset remoto. Esta etapa pode precisar de acesso externo e deve ficar bloqueada até obtê-lo.
- [ ] Executar separadamente `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Registrar exit code e falhas preexistentes. Build de baseline pode usar placeholders locais exigidos pelo código original, sem credencial Meta real; removê-los da configuração final em T13.
- [ ] Executar `npm run dev`, abrir `http://localhost:3000`, cadastrar usuário de teste, confirmar e-mail/login e abrir inbox/contatos/funil. Registrar URLs/telas e resultado sem dados pessoais. Parar processo quando encerrar.
- [ ] Liberar T02 apenas com ambiente funcional. Falha preexistente sem solução vira tarefa de correção específica antes de transportar o produto; não marcar todos os testes verdes por inferência.

## T03 — Fechar contrato do servidor UAZAPI

**Dependências:** T01; pode avançar sem T02. **Entrega:** contrato remoto e fixtures sanitizadas suficientes para os testes.
**Arquivos novos:** `docs/project/uazapi-contract.md`, `docs/project/uazapi-capabilities.md`, `src/lib/whatsapp/uazapi/fixtures/*.json`.
**Interfaces:** produz schemas HTTP exatos, identidade, autenticação e fixtures consumidos por T05/T07–T11. Sem este resultado, essas tarefas não começam.

- [ ] Consultar serviço já disponível antes de pedir informação. Registrar modalidade, versão/build, origem HTTPS, limites e referência OpenAPI. Não registrar token, contratar plano ou provisionar servidor neste cartão.
- [ ] Consultar [início rápido](https://docs.uazapi.com/docs/getting-started), [segurança](https://docs.uazapi.com/docs/authentication), [webhooks](https://docs.uazapi.com/docs/integrations-webhooks) e [API](https://docs.uazapi.com/api), comparando com a versão do servidor. Links são descoberta; o contrato local deve conter o necessário para o executor offline.
- [ ] Para status, connect/QR, texto, cada mídia, configuração de webhook e recuperação de mensagem: registrar método/path, autenticação, request, response, IDs, erro e timeout. Campos de resposta devem vir de schema/observação, nunca do nome de outra API.
- [ ] Validar instância previamente criada e obtenção de QR/status com token de instância. O runtime não usará admintoken. Registrar política de expiração do QR, unidade dos timestamps e formato dos números/identidades.
- [ ] Com ambiente de teste e destino consentido, produzir fixtures `session-connected`, `session-qr`, `send-accepted`, `message-inbound`, `message-from-me`, `message-api-echo`, `message-status`, `connection`, `error-auth`, `error-rate-limit`. Sanitizar números/nomes/tokens mantendo tipos e relações entre IDs. Registrar fonte/data de cada uma.
- [ ] Preencher matriz texto/imagem/documento/áudio/vídeo/status, com sim/não, limites de tamanho/MIME e prova. Para mídia disponível, acrescentar fixture específica inbound/outbound. Sem prova, marcar indisponível e registrar impacto no escopo.
- [ ] Fixar autenticação do webhook com teste positivo/negativo e correlação servidor/instância/conta. Definir dedupe por evento sem pressupor event_id universal. Se o servidor não oferece mecanismo suficiente, bloquear receptor público até resolver com configuração/proxy compatível.
- [ ] Definir ACK/persistência, filtros de eco, retry/reconciliação do servidor e compatibilidade com a caixa durável C3. Confirmar que callbacks de entrega continuam chegando com os filtros escolhidos. Não copiar um exemplo que suprima os estados necessários.
- [ ] Conferir cada campo de C1/C2 contra fixture, listar qualquer ajuste necessário e atualizar contratos/consumidores planejados. Esperado: outro agente implementa o cliente sem abrir documentação externa ou inventar resposta. Registrar pendências externamente bloqueantes, sem chamar T03 de concluída.

## T04 — Inventariar dependências Meta e conferir o schema

**Dependências:** T01; independente de T03. **Entrega:** mapa completo de substituição e desenho de persistência conferido.
**Arquivos novos:** `docs/project/transport-map.md`, `docs/project/schema-contract.md`.
**Interfaces:** produz caminhos reais e migrations relevantes para T06/T10–T14.

- [ ] Executar `rg -n 'meta-api|graph\.facebook\.com|META_APP|whatsapp_config' src messages .github .env.local.example`; salvar resultados sanitizados por área. Procurar também `sendTextMessage`, `loadAccountMetaCredentials`, `engineSend` e imports transitivos.
- [ ] Classificar cada caminho: adaptar, bloquear no servidor, manter somente histórico/teste ou remover. Registrar chamador, efeito e tarefa dona. Incluir inbox, API v1/MCP, cron, automações, fluxos, IA/typing, mídia, saúde, templates/broadcasts e leituras diretas Supabase da UI.
- [ ] Ler schema acumulado de contas/membros, contatos, conversas, messages, pending statuses, config e storage. Confirmar constraints reais, RLS, funções e triggers após todas as migrations; não inferir apenas de `001_initial_schema.sql`.
- [ ] Conferir C3 contra esse schema. Nomear RPCs propostas `claim_uazapi_events`, `apply_uazapi_event`, `reserve_uazapi_send` e `complete_uazapi_send`; registrar assinaturas SQL finais, colunas, constraints e grants em schema-contract. As operações devem ser atômicas e ter escopo por conexão/conta. Fechar aqui a unicidade do dispatch de automações/flows: usar identificadores/constraints existentes ou especificar tabela e migration adicional, incluindo como retomar após crash. T04 não termina com essa escolha pendente.
- [ ] Registrar como aplicar cada evento sem duplicar preview/não lidas, como reaproveitar resolução de contato e estados pendentes e como impedir duplicação de efeitos nos motores. Listar arquivos exatos da adaptação, não “atualizar helpers”.
- [ ] Conferir que todos os caminhos achados têm tarefa T07–T14 dona e nenhum transporte sem classificação. Registrar revisão do mapa/schema; se C3 mudar, atualizar o plano antes de T06.

## T05 — Implementar cliente e normalizador isolados

**Dependências:** T02, T03, T04. **Entrega:** contrato do provedor testado, sem banco/UI.
**Arquivos novos:** `src/lib/whatsapp/uazapi/{types,client,events,capabilities}.ts` e `{client,events}.test.ts`; usar fixtures de T03.
**Interfaces:** consome uazapi-contract; produz C1/C2/C5.

- [ ] RED: criar `client.test.ts` com mock de fetch: status/QR normalizados; texto com ID remoto válido; erro auth; timeout de envio `ambiguous=true` com **uma** chamada; 429 sem retry de mutação; resposta 2xx sem ID não é sucesso; origem fora da allowlist rejeitada antes do fetch; redirect não é seguido.
- [ ] Executar `npm test -- src/lib/whatsapp/uazapi/client.test.ts`; confirmar falhas correspondentes ao contrato ainda ausente.
- [ ] Implementar C1 no cliente. Usar fetch/AbortController nativos, credenciais no header correto T03, URL de origem permitida, timeout 15s, `redirect:'manual'` e erros sanitizados. Nunca usar BaseUrl do callback para chamadas autenticadas. Criar capabilities com valores comprovados.
- [ ] RED: criar `events.test.ts` com fixtures: inbound/fromMe/API echo distintos, grupos ignorados, payload inválido rejeitado, evento desconhecido ignorado, status mapeado, timestamp correto, chave determinística. Executar o arquivo e observar as falhas antes do parser.
- [ ] Implementar `normalizeWebhook(payload: unknown): NormalizedEvent[]` e validação runtime explícita. Não fazer cast de `unknown` e presumir campos existentes.
- [ ] GREEN: executar os dois arquivos de teste e `npm run typecheck`; esperar todos passarem. Commit `feat: add tested UAZAPI client and event normalization`.

## T06 — Persistir conexão, eventos e tentativas com isolamento

**Dependências:** T02–T05. **Entrega:** schema C3 e acesso server-side, incluindo testes de banco real.
**Arquivos novos:** migration com nome gerado, `src/lib/whatsapp/uazapi/store.ts`, `store.test.ts`, `supabase/tests/uazapi-isolation.sql`; atualizar schema-contract com nomes aplicados.
**Interfaces:** store exporta `loadConnection(accountId: string): Promise<StoredConnection|null>` e `saveConnection(accountId: string, actorUserId: string, input: UazapiCredentials): Promise<void>`. StoredConnection contém IDs internos e credenciais decriptadas, somente servidor; nunca DTO da UI. RPCs seguem assinaturas finais T04.

- [ ] RED: testes do store verificam encrypt/decrypt usando helper existente, filtro por conta, ausência de retorno bruto para UI e preservação da identidade da conexão na rotação de token. Executar `npm test -- src/lib/whatsapp/uazapi/store.test.ts`.
- [ ] Criar migration pelo comando suportado da CLI (`supabase migration new --help` antes), registrar nome real e implementar C3/schema-contract. Não editar migrations históricas nem hardcode “058”/“060”.
- [ ] Implementar store somente servidor. A origem recebida só é aceita se constar da allowlist de deploy. Não permitir mudança de identidade da instância numa linha com histórico.
- [ ] Criar teste SQL transacional com duas contas A/B e usuários owner/agent/viewer, mais papel anon. Afirmar: tabelas de segredo/eventos/tentativas inacessíveis diretamente; RPC interna sem EXECUTE público; message de A invisível a B; mesmo external ID em conexões distintas não colide; duplicado na mesma conexão é recusado; mesma instância não pertence a A/B.
- [ ] Aplicar no banco descartável dev e executar SQL com runner/psql identificado em T02. Registrar comando concreto em setup e evidência, sem URL contendo senha. Reaplicar via migration runner não executa migration já registrada; não pedir que SQL bruto inteiro seja idempotente.
- [ ] Conferir advisors/grants/RLS usando ferramenta disponível e resultados das consultas reais. GREEN: teste do store, `npm run typecheck`, SQL sem asserções falhas. Commit `feat: persist isolated UAZAPI connections and delivery state`.

## T07 — Configurar conexão e QR com autorização

**Dependências:** T05–T06. **Entrega:** admin conecta instância; equipe consulta estado seguro.
**Arquivos:** modificar config route e `src/components/settings/whatsapp-config.tsx`; criar `src/app/api/whatsapp/uazapi/{connect,status}/route.ts` e respectivos `route.test.ts`; atualizar catálogos existentes.
**Interfaces:** consome store/client; produz DTOs/rotas C4 para inbox/resumos T13.

- [ ] RED: em config route tests, verificar sem sessão 401; agent/viewer 403 para POST; conta derivada da sessão ignora/rejeita accountId forjado; origem proibida 400; GET sem token/ciphertext; membros recebem somente DTO permitido. Executar `npm test -- src/app/api/whatsapp/config/route.test.ts`.
- [ ] Implementar GET/POST C4 usando `requireRole` existente antes de service role. Substituir configuração Meta; não deixar caminho alternativo que salva token Meta.
- [ ] RED: testes connect/status: admin permitido; B não consulta A; `no-store`; QR expirado não reutilizado; timeout vira estado unknown/erro recuperável, não connected. Rodar arquivos antes da implementação.
- [ ] Implementar connect/status. Não gerar QR falso quando provedor está indisponível. Consultar estado a cada 5s apenas com painel aberto, cancelar no unmount e interromper ao conectar; renovar QR pela política T03.
- [ ] Atualizar tela: origem, instância, campo de token de escrita, estado, conectar/reconectar e QR sensível. Limpar token do estado do formulário após salvar. Estados vazios/erros têm instrução concreta; teclado/foco/labels funcionam.
- [ ] Atualizar `messages/en.json`, `pt.json`, `es.json`, `ko.json` com mesmas chaves; usar locale `pt`. GREEN: testes das rotas, `npm test -- src/i18n/messages.test.ts`, typecheck e verificação manual de QR expirado/reconexão/permissões. Commit `feat: connect UAZAPI sessions securely by QR`.

## T08 — Receber eventos com autenticação e caixa durável

**Dependências:** T03, T05–T07. **Entrega:** receptor rápido e durável, sem efeitos comerciais no request.
**Arquivos novos:** `src/app/api/whatsapp/uazapi/webhook/{route.ts,route.test.ts}`, `src/lib/whatsapp/uazapi/{webhook-auth.ts,webhook-auth.test.ts,queue.ts,queue.test.ts}`.
**Interfaces:** autentica instância pelo contrato T03; normaliza C2; grava eventos C3. `enqueueEvents(connectionId: string, events: NormalizedEvent[]): Promise<{inserted:number,duplicates:number}>`.

- [ ] RED: auth tests: credencial válida resolve conexão única; ausente/incorreta/correlação divergente rejeita; owner/instanceName forjado não autoriza; payload com token nunca é logado. Rodar `webhook-auth.test.ts`.
- [ ] Implementar mecanismo comprovado T03, comparação segura e consulta mínima de configuração. Não inventar assinatura HMAC ausente no provedor.
- [ ] RED: route/queue tests: corpo acima de 4 MiB → 413 usando `readCappedBody`; JSON inválido → 400; auth inválida → 401/403; insert falhou → 503; persistência confirmada → 200; duplicado → 200 sem novo evento; duas requisições concorrentes → uma linha; tipo fora de escopo autenticado → 200 sem efeito.
- [ ] Implementar endpoint, cap, parser e enqueue atômico. Persistir só evento normalizado sem token. Retornar 200 após escrita durável; não baixar mídia/chamar IA/rodar automação no request. Não confirmar uma gravação que falhou.
- [ ] GREEN: rodar os três testes e executar replay real no banco dev: mesmo payload duas vezes e concorrente. Esperado: uma linha, zero mensagem antes do worker, nenhum segredo persistido. Registrar latência para comparar em T15. Commit `feat: ingest authenticated UAZAPI events durably`.

## T09 — Processar inbound e estados sem duplicação

**Dependências:** T08, schema/RPC T06. **Entrega:** mensagem aparece uma vez na inbox e estados não regridem.
**Arquivos novos:** `src/lib/whatsapp/uazapi/{processor.ts,processor.test.ts}`, `src/app/api/whatsapp/uazapi/events/cron/{route.ts,route.test.ts}`; modificar helpers de resolução/status conforme mapa T04.
**Interfaces:** `processEvent(eventId: string): Promise<'done'|'retry'|'failed'>`; processador consome C2/C3. Cron C4 faz claim limitado. Produz mensagens internas e registro de eventos processados para T12.

- [ ] RED: processor tests com DB controlado: inbound novo cria/reutiliza contato/conversa; repetido não altera unread; concorrência não duplica; falha antes do commit pode ser retomada; read depois delivered não regride; status antes da mensagem é reaplicado; fromMe/API echo não aciona inbound.
- [ ] Executar `npm test -- src/lib/whatsapp/uazapi/processor.test.ts` e observar falhas dos comportamentos acima.
- [ ] Implementar persistência transacional/RPC T04. Reusar dedupe e progressão de estado existentes quando compatíveis. Garantir audit user válido, account_id correto e vínculo provider_connection_id. Não criar telefone fictício para LID sem resolução comprovada.
- [ ] Implementar caixa/claim/lease e backoff C3; cron Bearer compara segredo, retorna 401 se ausente/incorreto e somente contagens se válido. Eventos permanentes inválidos ficam failed/ignorados documentados, sem loop infinito.
- [ ] Criar/rodar teste cron: sem segredo não faz claim; até 10 eventos; execução concorrente não pega a mesma lease; worker interrompido recupera evento após lease. Implementar rota antes do GREEN.
- [ ] GREEN: testes processor/cron e status existentes relevantes. No banco dev, encerrar worker após persistência, retomar/repetir e consultar contagem/unread. Esperado: uma mensagem/efeito de persistência; nenhum envio automático habilitado ainda. Commit `feat: process UAZAPI inbound and ordered delivery states`.

## T10 — Enviar texto com tentativa estável e estado incerto

**Dependências:** T05–T09. **Entrega:** texto pela inbox/API v1 com idempotência local e timeout honesto.
**Arquivos:** modificar `send-message.ts`, `send-message.test.ts`, rotas send/v1 messages e testes, resolve-conversation, api/v1/contacts e composer conforme T04; criar `src/lib/whatsapp/uazapi/{send-attempts.ts,send-attempts.test.ts}`, operations route/test.
**Interfaces:** C5; `reserveSend(accountId: string, params: SendMessageParams): Promise<{attemptId:string,shouldSend:boolean}>`. RPC retorna o resultado existente quando shouldSend=false. `request_hash` evita chave reutilizada com outro corpo.

- [ ] RED: send-attempts tests: mesma chave/corpo e concorrência fazem um fetch; chave/corpo diferente 409; timeout após aceite remoto vira unknown; banco falha/crash após aceite não gera reenvio na retomada; pending abandonado não é reenviado; erro auth definitivo rejeita; consulta B não acessa tentativa A.
- [ ] Executar `npm test -- src/lib/whatsapp/uazapi/send-attempts.test.ts`; implementar reserva/complete atômicos conforme C3/C5. Não fazer fetch antes da reserva confirmada.
- [ ] RED: adaptar `send-message.test.ts`: texto usa UAZAPI e persiste ID externo; conta/conversa errada falha antes do fetch; resposta sem ID não vira sucesso; intervenção manual preserva pausa/handoff; nenhum fetch Graph. Rodar teste antes de trocar implementação.
- [ ] Substituir transporte do core preservando assinatura C5, validações e semântica de retorno. Atualizar resolução de configuração/audit user para conexão UAZAPI, sem criar linha Meta fictícia só para satisfazer helper antigo.
- [ ] Atualizar inbox/API v1, Idempotency-Key/request_id e operações C4/C5. Composer mostra pending/unknown e não repete no timeout. GET de operação valida conta/conversa antes de ler tentativa.
- [ ] GREEN: executar testes send-attempts, send-message e rotas send/v1/operations. Verificar local com mock timeout após aceite: uma chamada remota e resultado incerto após refresh. Commit `feat: send UAZAPI text with idempotent delivery tracking`.

## T11 — Integrar mídia comprovada e acesso privado

**Dependências:** T03, T09–T10. **Entrega:** mídia suportada de ponta a ponta; tipos não suportados bloqueados.
**Arquivos:** modificar mirror-inbound-media, media route/test, upload-media e composer conforme mapa; criar `src/lib/whatsapp/uazapi/{media.ts,media.test.ts}`.
**Interfaces:** cliente sendMedia C1; `resolveMedia(credentials: UazapiCredentials, mediaRef: string): Promise<{bytes:Uint8Array,mimeType:string,filename:string|null}>`, cuja chamada HTTP é fixada por T03. Produz referência privada durável para modelo de mídia existente.

- [ ] RED: media tests por tipo da matriz: envio com ID, download autenticado sem expor token, limite/MIME respeitados, URL de origem proibida/redirect bloqueado, download falhou não vira sucesso, retry de persistência não dispara outro envio.
- [ ] Rodar `npm test -- src/lib/whatsapp/uazapi/media.test.ts`; implementar transporte/download conforme contrato real e reutilizar Storage privado do projeto. URLs assinadas ao provedor, quando necessárias, têm escopo/TTL documentados; acesso da equipe exige autenticação.
- [ ] Atualizar inbound para guardar attachment durável antes de marcar evento done ou manter estado de trabalho recuperável. Não guardar só URL efêmera UAZAPI como única cópia. Não usar proxy de mídia Meta.
- [ ] Adaptar core/composer e rotas: tipos indisponíveis falham com `unsupported_capability` antes do fetch; ocultar ação na UI. Testar por API direta além do botão.
- [ ] RED/GREEN do media route: A acessa mídia de A, B/anon não acessam, ID forjado não baixa dado alheio, token não aparece em URL/resposta. Rodar arquivo da rota e media.test; validar cada tipo disponível após refresh/expiração da URL original. Commit `feat: support verified UAZAPI media with private storage`.

## T12 — Adaptar emissores automáticos, retomadas e eco

**Dependências:** T09–T11. **Entrega:** motores suportados usam o mesmo core e não repetem envio ao retomar.
**Arquivos:** `src/lib/automations/{meta-send.ts,engine.ts,meta-send.test.ts,engine.test.ts}`, `src/lib/flows/{meta-send.ts,engine.ts,engine.test.ts}`, `src/lib/ai/auto-reply.ts` e testes; demais caminhos listados em T04.
**Interfaces:** preservar assinaturas públicas dos wrappers existentes; internamente chamar core C5 com requestId determinístico. Nomes legados dos arquivos podem ser mantidos nesta tarefa para reduzir diff, com comentário claro; não deixam transporte Meta ativo.

- [ ] RED: testes dos motores: inbound novo gera ação uma vez; replay não gera execução nova; mesma execução/step retomada não reenvia; timeout unknown suspende aquela ação sem retry cego; eco API/celular não aciona bot; ação template/interactive/broadcast rejeita antes de fetch.
- [ ] Executar testes relevantes dos dois engines e `auto-reply.test.ts`; observar falhas ligadas ao transporte/retomada antes de editar.
- [ ] Integrar gatilhos ao evento durável com identidade estável por evento/execução/step e registro de dispatch, exatamente como fechado em T04. Se o contrato T04 exigir constraint/tabela adicional, aplicar sua migration antes do consumo e testar unicidade no banco. Não decidir o schema durante esta tarefa nem confiar em flag em memória.
- [ ] Fazer wrappers text/media delegarem ao core sem duplicar INSERT de messages. Preservar sender bot/ai_generated, contexto, espera/resposta, cancelamento e handoff existentes. Impedir criação duplicada de execução no replay mesmo após crash entre persistência e disparo.
- [ ] Remover typing Meta do auto-reply e bloquear capacidades false no executor, mesmo em ação previamente salva/cron. Não ligar IA real para testes automatizados; usar mock dos modelos existentes.
- [ ] GREEN: testar replay/crash após execução criada e após provedor aceitar envio; uma execução/step/envio lógico. Rodar testes dos emissores/engines/IA modificados; commit `feat: route CRM automation sends through UAZAPI safely`.

## T13 — Fechar caminhos Meta e integrar estado na interface

**Dependências:** T07, T10–T12. **Entrega:** aplicação utilizável sem variáveis Meta; ações desativadas também no backend.
**Arquivos:** todos os classificados em T04; em especial config antiga/webhook/health/media/react/templates/broadcasts/cron, sidebar, settings-overview, inbox, health-chip, `.env.local.example`, CI, `vitest.config.ts`, catálogos e documentação pública API.
**Interfaces:** getUazapiCapabilities C5 e DTO C4 são fonte única das capacidades/estado. Não permitir UI escolher o provedor.

- [ ] RED: rotas antigas de webhook/config verify-registration retornam 410 sem validação/env Meta; ações Meta-only autenticadas retornam 422 `unsupported_capability`; cron com trabalhos antigos incompatíveis não chama Graph. Incluir rotas da API pública que exponham broadcast.
- [ ] Implementar bloqueio no servidor antes de carregar cliente Meta ou chamar fetch. Arquivar módulos Meta sem dependentes runtime ou removê-los com testes afetados revisados; preservar histórico/migrations. Extrair tipos/constantes ainda compartilhados para arquivo neutro, sem carregar cliente Meta.
- [ ] Atualizar todos os leitores diretos de whatsapp_config na UI/helpers para DTO/conexão novos. Não devolver `token_encrypted` para compatibilidade com componente antigo.
- [ ] Ocultar/desabilitar templates/broadcast/reactions/interactive/typing em navegação, configurações, composer, builders e dashboard; explicar indisponibilidade de forma curta. Links diretos não devem mostrar recurso aparentemente funcional. Adaptar saúde para sessão UAZAPI, sem métricas Meta inventadas.
- [ ] Remover exigência META_APP_SECRET/META_APP_ID do env de runtime/CI final. Em testes históricos estritamente isolados, fixture dummy é permitida, sem encobrir dependência no app. Documentar variáveis novas, worker/cron e alterações de API/idempotência.
- [ ] GREEN: testes das rotas desativadas, i18n, lint, typecheck. Atualizar transport-map com destino final de cada referência. Esperado: zero caminho operacional Meta sem tratamento. Commit `refactor: retire Meta runtime paths and expose UAZAPI capabilities`.

## T14 — Verificar regressão e ausência de tráfego Meta

**Dependências:** T06–T13. **Entrega:** pacote de evidências automatizadas e revisão do diff.
**Arquivos novos:** `src/lib/whatsapp/uazapi/no-meta-runtime.test.ts`, `docs/project/evidence/T14.md`; ajustar testes relevantes sem apagar cobertura para torná-los verdes.
**Interfaces:** consome A01–A11 e transport-map. Não envia mensagens reais.

- [ ] Criar teste com fetch controlado que falha imediatamente para hostname `graph.facebook.com`. Exercitar send inbox/v1, automação, flow, IA mockada, saúde, mídia e caminhos antigos/cron. Afirmar resultados suportados e bloqueios; somente “fetch não chamado” sem exercitar caminho não é prova.
- [ ] Executar `npm test -- src/lib/whatsapp/uazapi/no-meta-runtime.test.ts`. Conferir também imports/chamadas diretas com a busca de T04 e justificar cada referência restante. Teste de rede e busca se complementam.
- [ ] Executar separadamente `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, sem credenciais Meta. Esperado: exit 0 em todos; registrar contagem real de testes. Não repetir suíte sem novo motivo após passar.
- [ ] Executar novamente o SQL de isolamento T06 no banco dev e testes de concorrência/replay/timeout. Confirmar zero segredo no DTO/log/bundle; verificar com valores-sentinela de teste, nunca grep de segredo real.
- [ ] Revisar diff completo contra baseline: migrations/grants, novas dependências, isolamento, estados incertos e todos os aceites. Marcar cada A01–A11 como automatizado/pendente de staging, apontando evidência; QR local não satisfaz A11.
- [ ] Corrigir falhas e repetir só checks afetados, rodando pacote final completo quando houver nova alteração transversal. Registrar SHA verificado e liberar T15 somente com falhas resolvidas e testes esperados presentes.

## T15 — Implantar staging e provar o fluxo HTTPS real

**Dependências:** T14 e acessos externos confirmados. **Entrega:** staging bidirecional com número dedicado; ainda sem dados de clientes.
**Arquivos novos:** `docs/project/staging-runbook.md`, `docs/project/evidence/T15.md`; configuração do host/scheduler versionável quando couber.
**Interfaces:** deployment do SHA T14, URL pública C4, agendamento worker C3.

- [ ] Confirmar hospedagem disponível, domínio, HTTPS, Node e scheduler por minuto. Registrar projeto/URL/SHA, procedimento de build/start e limites; não contratar alternativa por ausência de acesso. Se a plataforma não suporta worker/lease, revisar a escolha antes do deploy.
- [ ] Configurar banco staging separado e variáveis/ENCRYPTION_KEY/allowlist/cron secret pelo gerenciador de segredos. Aplicar migrations pelo procedimento T02/T06 com alvo confirmado; não transportar `.env.local` para Git.
- [ ] Fazer deploy staging do SHA verificado. Verificar login/e-mail, inbox/funil e nenhum requisito Meta no boot. Configurar cron autenticado e provar execução real por contagem de lote, não só pela criação do agendamento.
- [ ] Admin salva conexão e vincula QR com número dedicado. Configurar URL HTTPS webhook usando o backend/credencial de instância e filtros T03. Nunca escrever token no runbook.
- [ ] Enviar de segundo celular um texto único; esperar processamento periódico; localizar uma mensagem/contato/conversa e conferir não lidas. Responder pela inbox e pela API pública com chave estável; confirmar recebimento no segundo celular e persistência após reload.
- [ ] Repetir para cada mídia disponível da matriz; conferir status suportados, QR expirado/token inválido/desconexão, viewer e conta B. Anotar latência medida de ACK e de exibição, limites do scheduler e evidência sem conteúdo pessoal.
- [ ] Reenviar callback/reiniciar worker: nenhum evento confirmado desaparece e nenhum envio lógico duplica. Simular timeout sem induzir spam real; resultado permanece incerto. Conferir destinos de rede/observabilidade para confirmar ausência de tráfego Meta.
- [ ] Registrar A01–A11 reais, SHA/migrations/URL e limitações. Desativar callbacks de testes temporários que ficaram sem consumidor. Só liberar piloto quando o fluxo funcionar nos dois sentidos pela URL pública.

## T16 — Ensaiar recuperação e liberar piloto comercial

**Dependências:** T15, acesso ao ambiente de produção e equipe/número definidos. **Entrega:** piloto recuperável e backlog de evolução.
**Arquivos novos:** `docs/project/production-runbook.md`, `docs/project/recovery-runbook.md`, `docs/project/evidence/T16.md`, `docs/project/commercial-backlog.md`.
**Interfaces:** consome SHA e migrations validados; produz estado final e próximos projetos, sem paridade Kommo implícita.

- [ ] Registrar destino de backup (banco, Storage e configuração recuperável), frequência, retenção, responsável e local seguro da ENCRYPTION_KEY. Backup de SQL sem anexos/chave não comprova recuperação do CRM inteiro.
- [ ] Restaurar backup num destino descartável, verificar login, amostra de conversa/anexo/permissões e decriptação. Manter webhook/cron/envio desligados no restore para não duplicar operação. Registrar tempo e resultado, sem dados no documento.
- [ ] Ensaiar rollback de aplicação para último SHA compatível mantendo migrations aditivas. Definir pausa de envio/worker, preservação de eventos/tentativas e retomada. Não restaurar backup sobre mensagens novas como rollback automático e não voltar a Meta.
- [ ] Confirmar estratégia de merge/branch de deploy no fork próprio e revisar diff/checks antes de integrar. Fazer deploy de produção somente como etapa de execução explicitamente solicitada, com ambiente concreto e recuperação pronta; respeitar instruções/permissões vigentes sem pedir confirmação repetida já concedida.
- [ ] Configurar HTTPS/webhook/cron no destino correto e repetir smoke bidirecional com número de teste. Produção/staging não podem consumir simultaneamente a mesma instância por engano.
- [ ] Convidar equipe pequena; verificar atribuição de conversa, criação/movimentação de negócio, retomada de follow-up existente, papéis e envio suportado por automação. Autorresposta IA permanece desligada até teste específico quando for habilitada.
- [ ] Registrar retenção/acesso/exportação/recuperação e procedimento de desconexão/indisponibilidade do número. Liberar dados reais somente após A12 e aceites anteriores satisfeitos.
- [ ] Criar backlog comercial com evidências do piloto e priorizar um próximo incremento. Atualizar status: URL/SHA/migrations, A01–A12, limitações e ação seguinte. Não declarar “igual ao Kommo”.

## Auto-revisão do guia e limites

- Todos os aceites A01–A12 têm tarefas e cenários atribuídos. Assinaturas propostas C1–C5 são compartilhadas; consumidores não devem renomeá-las localmente.
- Há verificações diretas para setup/docs e RED/GREEN para comportamento. Testes do banco real e staging completam mocks.
- T03/T04 são tarefas de preparação com saídas obrigatórias, não lacunas para LUNA resolver durante implementação. Assinaturas SQL e detalhes externos só podem ser fechados com essas evidências; se mudarem o desenho, atualizar os cartões dependentes.
- T04 deve fechar persistência/unicidade de dispatch antes de liberar T12. A escolha depende do schema real, mas não é delegada silenciosamente ao implementador dos motores.
- Não se promete que qualquer modelo executará sem supervisão. Tarefas de schema, autenticação de webhook, idempotência e recuperação precisam de revisão técnica do coordenador antes de liberar dependências.
- Esta revisão verificou consistência documental e referência de código, não instalou/rodou o produto. Nenhuma caixa de implementação foi marcada.
