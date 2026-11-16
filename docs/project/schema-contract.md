# Contrato de schema e RPCs para Evolution

Status: contrato documental de T04.b. As migrations foram inspecionadas no repositório; este desenho ainda **não foi aplicado nem verificado em banco**. Migration alvo proposta para implementação: `060_evolution_delivery_contract.sql` (nome provisório; T06 fixa o nome real após revisão).

## Base observada no código e migrations

O schema acumulado observado termina em `059_dashboard_overview.sql` (a sequência disponível tem lacunas em 050 e 056). O tenant é `accounts.id`; `profiles.account_id` e `profiles.account_role` representam a associação e permissão do usuário. Registros operacionais usam `account_id` para escopo e `user_id`/`sender_id` para autoria/auditoria. Migrations 017, 047 e 055 endurecem identidade e associação de membros; a chave service role não substitui validação de escopo nas operações.

- `whatsapp_config` é configuração histórica Meta, única por `account_id`; não é conexão Evolution nem deve receber credenciais Evolution.
- `contacts` tem unicidade por telefone normalizado dentro da conta e identidade `wa_user_id` por conta quando presente. Uma identidade Evolution sem correspondência comprovada não autoriza inventar telefone/contato.
- `conversations` tem unicidade `(account_id, contact_id)`. `messages.id` é UUID interno; `messages.message_id` é ID externo. A migration 037 protege repetição por `(conversation_id, message_id)`. O estado permitido de mensagem permanece `sending/sent/delivered/read/failed`.
- `bump_conversation_on_inbound(conversation_id, last_message_text)` é o caminho atômico existente para preview e unread. Deve ser chamado somente quando um `INSERT` de mensagem inbound realmente inserir uma linha. Replay não altera unread nem preview.
- `pending_message_statuses` (054) guarda status adiantado com unicidade `(account_id, wamid, status)`. `message-status.ts` aplica apenas transições monotônicas e guarda status sem mensagem correspondente; `059` também mantém tempos inbound/reply por trigger.
- `automation_pending_executions` (006, 045, 051) é fila de waits com `user_id`, `account_id`, `claimed_at`, estados de execução e prazo; não tem chave de idempotência do evento/ação. `automation_logs` é histórico de execução, não ledger único.
- `flow_runs` (010, 036, 052) mantém estado e sequência de transição; há no máximo um run ativo por conta/contato. `flow_run_events` audita eventos, mas a checagem de resposta por `payload->>meta_message_id` é consulta prévia, sem unique constraint contra corrida.
- `claim_ai_reply_slot` (044, 053) limita contador por conversa, mas não identifica o inbound que consumiu a vaga; `ai_usage_log` é histórico, não dedupe de dispatch.

As tabelas Evolution abaixo são **propostas**. Não são alegações sobre o estado do banco local. Manter RLS habilitada, sem policies para `anon`/`authenticated`, revogar grants diretos desses papéis; tabelas e RPCs internas ficam disponíveis apenas ao backend com `service_role`.

## Tabelas e constraints propostas

### `whatsapp_connections`

Uma conexão ativa por conta, com `id uuid primary key`, `account_id uuid not null references accounts(id) unique`, `created_by uuid not null references auth.users(id)`, `provider text not null check (provider = 'evolution')`, `base_url text not null`, `instance_name text not null`, `token_encrypted text not null`, `webhook_secret_encrypted text not null`, estado/checagem, timestamps e constraint `unique (base_url, instance_name)`.

`instance_name` é o nome estável de instância usado nas rotas Evolution. No contrato cliente `EvolutionCredentials.instanceId` conserva o campo semântico da interface comum, mas seu valor é esse **nome**, não um UUID remoto. A UI deve rotulá-lo “Nome da instância”. `token_encrypted` guarda o token restrito da instância. `webhook_secret_encrypted` guarda outro segredo aleatório, independente e rotacionável, enviado no header `x-wacrm-webhook-secret`; não reutilizar token da instância nem valor do campo `apikey` do corpo Evolution. Ambos usam criptografia do servidor e nunca são retornados/logados. `created_by` fornece um autor real para ingestão sem usuário interativo.

`base_url` é validada antes de persistir contra a origem local exata provisionada ou HTTPS explicitamente autorizado. `payload.instance` só correlaciona o nome depois da autenticação via `x-wacrm-connection` e comparação em tempo constante do segredo. Não confiar em `server_url`, `destination`, `apikey` nem extensões `extra` do envelope.

### `evolution_events`

`id uuid primary key`, `connection_id uuid not null references whatsapp_connections(id) on delete cascade`, `event_key text not null`, `normalized_event jsonb not null`, `state text not null check (state in ('pending','processing','done','failed'))`, `attempts integer not null default 0`, `lease_until timestamptz`, `next_attempt_at timestamptz not null default now()`, `processed_at timestamptz`, `last_error_code text`, timestamps; `unique (connection_id, event_key)` e índice de claim em `(next_attempt_at, created_at)` para estados processáveis.

`normalized_event` contém somente um valor de C2 (`message`, `status` ou `connection`) fixado por fixtures/contrato T03. Não criar um envelope Evolution próprio nem persistir o payload externo bruto, token, `apikey`, `server_url` ou `destination`. `event_key` é determinístico por conexão; mensagem usa ID remoto estável e status sem ID usa a regra C2 `(externalMessageId,status)`. `fromMe`/`sentByApi` preservam a distinção entre mensagem de cliente, eco do aparelho e eco de envio da API.

### `messages` e statuses antecipados

Adicionar `provider_connection_id uuid references whatsapp_connections(id)` nullable para compatibilidade/histórico. Criar índice único parcial `(provider_connection_id, message_id)` quando ambos forem não nulos, além da dedupe existente `(conversation_id,message_id)`. `id` continua UUID interno e `message_id` continua ID externo. Para `pending_message_statuses`, adicionar `provider_connection_id` nullable e dedupe por `(account_id, provider_connection_id, wamid, status)` para impedir colisão de IDs entre provedores no histórico; só status do provider/conexão correta pode ser aplicado. Estados continuam monotônicos conforme `message-status.ts`; callback antigo jamais regride `read` para `sent` ou `delivered`.

Uma aplicação de inbound faz, na mesma transação: resolver/criar contato somente com identidade normalizada comprovada; resolver/criar a conversa no escopo `account_id`; inserir mensagem com autor auditável `whatsapp_connections.created_by`; aplicar status pendente compatível; atualizar preview/unread e horários por funções/trigger existentes; criar dispatches somente se o evento for mensagem nova de cliente (`fromMe=false`, `sentByApi=false`); e marcar evento `done`. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` decide se houve mensagem nova. Sem linha retornada, não chamar `bump_conversation_on_inbound` nem inserir dispatch de inbound. Mensagem ecoada da API reconcilia tentativa/ID sem contar como inbound. Evento de conexão agenda consulta de estado; snapshot sem ordenação comprovada não substitui estado mais novo.

### `evolution_send_attempts`

Campos: `id uuid primary key`, `account_id uuid not null references accounts(id)`, `connection_id uuid not null references whatsapp_connections(id)`, `request_id text not null`, `request_hash text not null`, `conversation_id uuid not null references conversations(id)`, `message_row_id uuid references messages(id)`, `external_message_id text`, `outcome text not null check (outcome in ('pending','accepted','rejected','unknown'))`, `error_code text`, timestamps; `unique (account_id, request_id)`. Índices adicionais escopam conexão e busca operacional. O hash cobre destinatário, tipo e conteúdo; mesma chave com hash diferente é conflito. Nenhum cliente recebe corpo/segredo por consultas de status.

Reserva valida dentro da transação que conexão e conversa pertencem à conta derivada da conexão, e que o audit user é membro válido dessa conta; não aceita `account_id` arbitrário como autoridade. Cria linha de mensagem `sending`/tentativa antes da chamada remota. Timeout ou reserva `pending` abandonada por mais de 120 s tornam-se `unknown`, sem reenvio automático. Falha definitiva pode virar `rejected`/mensagem `failed`; só aceite comprovado permite `accepted`/`sent`; `delivered` e `read` vêm de status remoto comprovado. O estado incerto exige reconciliação ou intervenção, nunca retry cego.

## Assinaturas SQL finais propostas

Todas as funções são `SECURITY INVOKER`, com `search_path = public, pg_temp` fixado (ou nomes sempre qualificados), sem bypass de RLS para compensar grants. Conceder `EXECUTE` somente a `service_role`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. RLS ativa e sem policy de cliente nas tabelas internas. Em cada RPC, validação explícita de vínculo entre event, connection, account, conversation, contact e autor continua obrigatória, mesmo com service role.

```sql
public.claim_evolution_events(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
) RETURNS SETOF public.evolution_events

public.apply_evolution_event(
  p_event_id uuid
) RETURNS TABLE (
  outcome text,             -- applied | duplicate | ignored | retry | failed
  message_row_id uuid,
  retry_at timestamptz
)

public.reserve_evolution_send(
  p_connection_id uuid,
  p_request_id text,
  p_request_hash text,
  p_conversation_id uuid,
  p_audit_user_id uuid,
  p_message jsonb            -- conteúdo já validado; sem credenciais
) RETURNS TABLE (
  attempt_id uuid,
  message_row_id uuid,
  outcome text,              -- pending | accepted | rejected | unknown
  should_send boolean        -- true somente no insert vencedor novo
)

public.complete_evolution_send(
  p_attempt_id uuid,
  p_outcome text,             -- accepted | rejected | unknown
  p_external_message_id text DEFAULT NULL,
  p_error_code text DEFAULT NULL
) RETURNS TABLE (
  attempt_id uuid,
  outcome text,
  message_row_id uuid
)
```

Semântica transacional:

1. `claim_evolution_events` seleciona até `least(greatest(p_limit,1),10)` eventos vencidos/recuperáveis com `FOR UPDATE SKIP LOCKED`, incrementa tentativas e concede lease limitado (máximo 60 s). Uma lease válida impede segundo worker. Vencido o lease, evento transitório é elegível após backoff 5/15/60/300 s; após cinco tentativas fica `failed`. Erros permanentes vão direto a `failed`. O RPC retorna somente as linhas adquiridas.
2. `apply_evolution_event` bloqueia a linha e exige claim/lease do worker. Toda mutação de domínio descrita acima, os dispatches criados e a transição terminal `done` acontecem numa única transação. Repetição terminal retorna `duplicate` sem efeitos. Erro transitório registra código sanitizado e `next_attempt_at`; uma transação abortada não deixa mensagem/unread parcial. Repetição de status segue a tabela de status antecipado e transições monotônicas existentes.
3. `reserve_evolution_send` insere tentativa e linha local na mesma transação. O índice `unique(account_id,request_id)` serializa concorrência; conflito com o mesmo hash devolve a tentativa existente sem autorizar novo POST, e hash divergente retorna erro de conflito. `should_send=true` apenas para o criador inicial da reserva.
4. `complete_evolution_send` bloqueia tentativa, aceita apenas transições válidas e idempotentes, associa ID externo e avança mensagem sem rebaixar status. Timeout/mutação ambígua vira `unknown`; jamais converte `unknown` em permissão para repetir envio. A aceitação remota seguida de crash antes desta RPC fica pendente/incerta até reconciliação; não há promessa impossível de exactly-once no transporte.

## Recuperação e unicidade de dispatch

Adicionar tabela concreta `evolution_dispatches` na migration proposta, em vez de deixar a persistência a critério de T12. Colunas: `id uuid primary key`, `account_id uuid not null references accounts(id)`, `event_id uuid references evolution_events(id)`, `source_key text not null`, `engine text not null check (engine in ('automation','flow','ai'))`, `execution_key text not null` (automation log/run/conversation estável), `action_key text not null` (step id/node key/`ai_reply`), `user_id uuid not null references auth.users(id)` para audit, `contact_id uuid`, `conversation_id uuid`, `state text not null check (state in ('pending','processing','done','skipped','failed','unknown'))`, `attempts integer not null default 0`, `lease_until`, `next_attempt_at`, `send_attempt_id uuid references evolution_send_attempts(id)`, `result jsonb`, `last_error_code text`, timestamps. Chave: `unique(account_id, source_key, engine, execution_key, action_key)`. Para inbound, `event_id` referencia a caixa e `source_key = 'evolution-event:' || event_id`; outros gatilhos usam ID estável da origem já persistida (por exemplo tag event ou registro de wait) sem fabricar um envelope Evolution. Para resume de wait, `execution_key` inclui ID da execução pendente e `source_key` inclui a event key da resposta.

Definir também `claim_evolution_dispatches(p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60) RETURNS SETOF public.evolution_dispatches` e `complete_evolution_dispatch(p_dispatch_id uuid, p_state text, p_result jsonb DEFAULT NULL, p_error_code text DEFAULT NULL) RETURNS public.evolution_dispatches`. São RPCs de serviço-only, com `SKIP LOCKED`, lease e backoff iguais à fila de eventos. A criação de dispatches usa `ON CONFLICT` na chave acima. Retomada relê o ledger e prossegue da ação pendente; ações somente de banco e seu `done` ficam na mesma transação/RPC. Ações externas chamam `reserve_evolution_send` com `request_id = 'dispatch:' || dispatch.id`; a unicidade de envio impede repetição. Se cair depois da aceitação remota, o send attempt vira/permanece `unknown` e o dispatch não reenvia. Se cair antes de chamar o transporte mas depois da reserva, também não é possível provar que não enviou; reconciliação manual/por eco com correlação comprovada é necessária.

O ledger fecha a corrida para duplicate webhook nos motores e identifica o ponto de retomada após crash. Para waits automáticos existentes, a retomada deve reclamar condicionalmente o registro e associar o dispatch/resposta pela chave do evento, não apenas mudar `awaiting_reply` para `running`. `flow_run_events` permanece trilha de auditoria e `transition_seq` permanece concorrência do run; nenhuma dessas estruturas substitui a unique key do ledger. `claim_ai_reply_slot` segue como limite de produto, ligado ao dispatch inbound para não consumir slot duas vezes.

## Arquivos de adaptação e incompatibilidades

Arquivos de produto previstos para os recortes de implementação posteriores (esta tarefa não os altera):

- `src/lib/whatsapp/uazapi/{types,client,events,capabilities}.ts` e testes/fixtures equivalentes: renomear para `src/lib/whatsapp/evolution/{types,client,events,capabilities}.ts`; substituir `UazapiCredentials`/origem/config por `EvolutionCredentials`; `instanceId` significa nome da instância. `configureWebhook` recebe `(credentials, callbackUrl, webhookSecret, connectionId)` e configura headers autenticadores; não enviar segredo no corpo, persistir envelope externo ou inventar HMAC.
- `src/lib/whatsapp/send-message.ts`, `src/lib/whatsapp/resolve-conversation.ts`, `src/lib/whatsapp/conversation-scope.ts`, `src/lib/whatsapp/message-status.ts`, `src/lib/whatsapp/message-status-sync.ts`, `src/lib/whatsapp/wa-identity.ts`: trocar dependência de Meta/config pela conexão, manter `account_id` como tenant e autor real separado; adicionar conexão externa à dedupe/status e reconciliar IDs Evolution que não têm prefixo Meta. A identidade/phone resolver atual reflete telefone/BSUID Meta e não pode adivinhar JID/LID Evolution.
- `src/app/api/whatsapp/webhook/route.ts` e testes: Meta envelope/assinatura e endpoints não são callback Evolution; adaptar para autenticação header + normalizador C2, insert durável e RPC. Mensagens/status Meta históricos não são prova do schema Evolution.
- `src/lib/automations/engine.ts`, `src/lib/automations/meta-send.ts`, `src/app/api/automations/engine/route.ts`, `src/app/api/automations/cron/route.ts`, `src/lib/contacts/tag-events.ts`: motores chamam emissores Meta e guardam waits sem chave de evento/ação; propagar dispatch id estável, audit user e ledger.
- `src/lib/flows/engine.ts`, `src/lib/flows/meta-send.ts`, `src/lib/flows/timeout.ts`, `src/app/api/flows/cron/route.ts`, `src/app/api/flows/[id]/runs/route.ts`: emissores Meta, `meta_message_id` e consulta de duplicidade sem índice único precisam virar ID Evolution + ledger transacional.
- `src/lib/ai/auto-reply.ts`, `src/lib/ai/admin-client.ts`, `src/lib/whatsapp/meta-api.ts`: engine usa `loadAccountMetaCredentials`, `engineSendText`, typing indicator e claim por contador; trocar transporte, remover typing sem capacidade comprovada, ancorar reply e uso de slot no dispatch.
- `supabase/migrations/060_evolution_delivery_contract.sql` (nome provisório) para tabelas, índices, funções e grants acima; `src/types/database.ts` se tipos forem gerados/maintidos manualmente. Nenhuma migration foi criada nesta tarefa.

Incompatibilidades que T05/T06 devem respeitar: o plano original denomina tabelas/RPCs/configuração e paths `uazapi`; provider check `uazapi` e nome de conexão não se aplicam. Usar `evolution_connections` não é necessário: decisão aqui é manter tabela genérica `whatsapp_connections` para preservar domínio existente, com provider `evolution`, e nomear fila/tentativas especificamente `evolution_*`. O plano descreve `event_json`; contrato aqui restringe conteúdo a `normalized_event`. O envelope Evolution contém `apikey` e campos que o plano UAZAPI não definia; o segredo autenticador é header separado e `instance` do corpo é só correlação. Timeout/ack/QR não reutilizam suposições UAZAPI: obedecer revisão Evolution e fixtures T03. `messages` mantém o modelo interno/externo existente; nunca renomear `messages.id` como ID remoto nem assumir prefixo `wamid`.

## Limites de verificação

Leitura documental das migrations acumuladas e helpers executada; não houve banco local disponível para aplicar migrations, inspecionar catálogo, testar RLS/grants, chamar RPCs, simular concorrência ou validar o ledger. O schema e as assinaturas acima são contratos para revisão e implementação T06, não confirmação de execução PostgreSQL. A aprovação técnica do coordenador continua necessária antes de T05/T06.
