# Contrato de schema e RPCs para Evolution

Status: contrato documental de T04.b, revisto em T04.b2. A sequência local tem 57 migrations, confirmado em catálogo somente leitura. `docker`/`psql` não estavam no `PATH` padrão inicial; foram acessados por `source /Users/raymozer/.local/share/wacrm-infra-a/env.sh`. Os tipos e índices históricos citados abaixo foram conferidos no catálogo local e nas migrations relevantes. T06 deve criar a migration com `supabase migration new evolution_delivery_contract`; usar o nome timestampado que o CLI retornar e registrar esse nome. Não reservar número nem prefixo manual.

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

Uma conexão ativa por conta, com colunas e constraints propostas: `id uuid not null default gen_random_uuid()`; `account_id uuid not null references accounts(id) on delete cascade`; `created_by uuid not null references auth.users(id) on delete restrict`; `provider text not null default 'evolution'`; `base_url text not null`; `instance_name text not null`; `token_encrypted text not null`; `webhook_secret_encrypted text not null`; `state text not null default 'disconnected'`; `state_checked_at timestamptz null`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`. Constraints nomeadas: `whatsapp_connections_pkey PRIMARY KEY(id)`, `whatsapp_connections_account_id_key UNIQUE(account_id)`, `whatsapp_connections_provider_check CHECK(provider='evolution')`, `whatsapp_connections_state_check CHECK(state IN ('disconnected','connecting','connected','unknown'))`, `whatsapp_connections_base_url_instance_name_key UNIQUE(base_url,instance_name)`. `created_by` é autor/auditoria e não critério de tenancy.

`instance_name` é o nome estável de instância usado nas rotas Evolution. No contrato cliente `EvolutionCredentials.instanceId` conserva o campo semântico da interface comum, mas seu valor é esse **nome**, não um UUID remoto. A UI deve rotulá-lo “Nome da instância”. `token_encrypted` guarda o token restrito da instância. `webhook_secret_encrypted` guarda outro segredo aleatório, independente e rotacionável, enviado no header `x-wacrm-webhook-secret`; não reutilizar token da instância nem valor do campo `apikey` do corpo Evolution. Ambos usam criptografia do servidor e nunca são retornados/logados. `created_by` fornece um autor real para ingestão sem usuário interativo.

`base_url` é validada antes de persistir contra a origem local exata provisionada ou HTTPS explicitamente autorizado. `payload.instance` só correlaciona o nome depois da autenticação via `x-wacrm-connection` e comparação em tempo constante do segredo. Não confiar em `server_url`, `destination`, `apikey` nem extensões `extra` do envelope.

### `evolution_events`

`id uuid not null default gen_random_uuid()`, `connection_id uuid not null references whatsapp_connections(id) on delete cascade`, `event_key text not null`, `normalized_event jsonb not null`, `state text not null default 'pending'`, `attempts integer not null default 0`, `lease_until timestamptz null`, `lease_token uuid null`, `next_attempt_at timestamptz not null default now()`, `processed_at timestamptz null`, `last_error_code text null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `media_state text not null default 'not_required'`, `media_storage_path text null`, `media_type text null`. Constraints: `evolution_events_pkey PRIMARY KEY(id)`, `evolution_events_connection_event_key UNIQUE(connection_id,event_key)`, `evolution_events_state_check CHECK(state IN ('pending','processing','done','failed'))`, `evolution_events_attempts_check CHECK(attempts BETWEEN 0 AND 5)`, `evolution_events_media_state_check CHECK(media_state IN ('not_required','pending','stored','failed'))`, `evolution_events_media_path_check CHECK((media_state='stored') = (media_storage_path IS NOT NULL))`. Index `evolution_events_claim_idx` on `(next_attempt_at,created_at,id) WHERE state IN ('pending','processing')`. `lease_token` é um UUID novo a cada claim, nunca reutilizado.

`normalized_event` contém somente um valor de C2 (`message`, `status` ou `connection`) fixado por fixtures/contrato T03. Não criar um envelope Evolution próprio nem persistir o payload externo bruto, token, `apikey`, `server_url` ou `destination`. `event_key` é determinístico por conexão; mensagem usa ID remoto estável e status sem ID usa a regra C2 `(externalMessageId,status)`. `fromMe`/`sentByApi` preservam a distinção entre mensagem de cliente, eco do aparelho e eco de envio da API.

### `messages` e statuses antecipados

Schema real de `messages` conforme 001/009/010/033/035/037/039/042: `id uuid not null primary key default gen_random_uuid()`, `conversation_id uuid not null references conversations(id) on delete cascade`, `sender_type text not null check ('customer','agent','bot')`, `sender_id uuid null`, `content_type text not null default 'text' check ('text','image','document','audio','video','location','template','interactive')`, `content_text text null`, `media_url text null`, `template_name text null`, `message_id text null`, `status text not null default 'sent' check ('sending','sent','delivered','read','failed')`, `created_at timestamptz null default now()`, `reply_to_message_id uuid null references messages(id) on delete set null`, `interactive_reply_id text null`, `ai_generated boolean not null default false`, `interactive_payload jsonb null`, `media_type text null`, `error_code integer null`, `error_title text null`, `error_details text null`. **Não existe `messages.account_id`**; escopo vem de `conversations.account_id`.

Adicionar `provider_connection_id uuid null references whatsapp_connections(id)`. A migration 037 criou `idx_messages_conversation_message_id` UNIQUE `(conversation_id,message_id)`, que continuará colidindo se um ID Evolution coincidir com ID legado da mesma conversa. Remover esse índice e substituí-lo por dois índices parciais nomeados: `idx_messages_legacy_conversation_message_id` UNIQUE `(conversation_id,message_id) WHERE provider_connection_id IS NULL AND message_id IS NOT NULL`; `idx_messages_provider_connection_message_id` UNIQUE `(provider_connection_id,message_id) WHERE provider_connection_id IS NOT NULL AND message_id IS NOT NULL`. Assim, históricos Meta/anteriores permanecem no namespace legado, IDs Evolution no namespace de conexão.

`pending_message_statuses` real (054): `id uuid primary key default gen_random_uuid()`, `account_id uuid not null references accounts(id) on delete cascade`, `wamid text not null`, `status text not null`, `error_code integer null`, `error_title text null`, `error_details text null`, `status_at timestamptz null`, `created_at timestamptz not null default now()`, constraint `pending_message_statuses_account_wamid_status_key UNIQUE(account_id,wamid,status)`. Adicionar `provider_connection_id uuid null references whatsapp_connections(id)`. Remover a constraint UNIQUE ampla e substituir por: `pending_message_statuses_legacy_key` UNIQUE `(account_id,wamid,status) WHERE provider_connection_id IS NULL`; `pending_message_statuses_provider_key` UNIQUE `(account_id,provider_connection_id,wamid,status) WHERE provider_connection_id IS NOT NULL`. Isso preserva dedupe legado e separa colisões de IDs por conexão. Status Evolution aceitos ficam no domínio C2 (`sent/delivered/read/failed`), sem alterar coluna histórica `status text` nem supor `wamid` Meta.

Estados continuam monotônicos conforme `message-status.ts`; callback antigo jamais regride `read` para `sent` ou `delivered`. Os campos acima refletem migrations existentes; apenas `provider_connection_id` e os índices substitutos são adições propostas.

Uma aplicação de inbound faz, na mesma transação: resolver/criar contato somente com identidade normalizada comprovada; resolver/criar a conversa no escopo `account_id`; inserir mensagem com autor auditável `whatsapp_connections.created_by`; aplicar status pendente compatível; atualizar preview/unread e horários por funções/trigger existentes; criar raízes candidatas de dispatch para definições ativas somente se o evento for mensagem nova de cliente (`fromMe=false`, `sentByApi=false`); e marcar evento `done`. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` decide se houve mensagem nova. Sem linha retornada, não chamar `bump_conversation_on_inbound` nem inserir dispatch de inbound. `apply_evolution_event` insere raízes candidatas para automações ativas, flows ativos e AI ativa na mesma transação; cada engine verifica a condição de entrada e marca candidatos sem match como `skipped`. Mensagem ecoada da API reconcilia tentativa/ID sem contar como inbound. Evento de conexão/status não cria raízes de mensagem. Evento de conexão agenda consulta de estado; snapshot sem ordenação comprovada não substitui estado mais novo.

**Mídia:** 023/039 comprovam que `chat-media` atual é público e que o mirror Meta best-effort pode manter URL proxy efêmera. Esse caminho não satisfaz mídia privada Evolution. Proposta T06: bucket `evolution-media` com `storage.buckets.public=false` e sem policy pública; caminho de objeto determinístico `account-<account_id>/events/<event_id>/media` (nome fixo, sem filename variável) e handler autenticado que confirma usuário, conta e conversa antes de ler. Antes de aplicar um evento de mídia, o processor baixa os bytes Evolution e faz upload idempotente nesse caminho; depois chama `complete_evolution_event_media(p_event_id uuid, p_lease_token uuid, p_media_storage_path text, p_media_type text) RETURNS public.evolution_events`, que grava path/MIME apenas se claim ainda vigente. Se processo cair após upload antes de gravar, a retomada verifica/reusa o objeto no mesmo path. `apply_evolution_event` recusa finalizar mídia sem `media_state='stored'` e caminho persistido; falha transitória deixa o evento elegível com backoff. Falha definitiva fica explícita em `failed`; nunca cria mensagem terminal dependente somente de URL temporária do provedor. `messages.media_url` passa a ser a route privada do app associada ao event ID; `media_type` usa o MIME do objeto durável. Até cópia privada e fixtures serem homologadas, `getEvolutionCapabilities().media` permanece vazia e mídia outbound é bloqueada. Nenhum conteúdo é lido/escrito no bucket atual `chat-media` por esse fluxo.

### `evolution_send_attempts`

Campos: `id uuid not null default gen_random_uuid()`, `account_id uuid not null references accounts(id) on delete cascade`, `connection_id uuid not null references whatsapp_connections(id) on delete cascade`, `request_id text not null`, `request_hash text not null`, `conversation_id uuid not null references conversations(id) on delete cascade`, `message_row_id uuid null references messages(id) on delete set null`, `external_message_id text null`, `outcome text not null default 'pending'`, `error_code text null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Constraints: `evolution_send_attempts_pkey PRIMARY KEY(id)`, `evolution_send_attempts_account_request_key UNIQUE(account_id,request_id)`, `evolution_send_attempts_outcome_check CHECK(outcome IN ('pending','accepted','rejected','unknown'))`. Índice operacional `evolution_send_attempts_connection_created_idx(connection_id,created_at DESC)`. O hash cobre destinatário, tipo e conteúdo; mesma chave com hash diferente é conflito. Nenhum cliente recebe corpo/segredo por consultas de status.

Reserva valida dentro da transação que conexão e conversa pertencem à conta derivada da conexão, e que o audit user é membro válido dessa conta; não aceita `account_id` arbitrário como autoridade. Cria linha de mensagem `sending`/tentativa antes da chamada remota. Timeout ou reserva `pending` abandonada por mais de 120 s tornam-se `unknown`, sem reenvio automático. Falha definitiva pode virar `rejected`/mensagem `failed`; só aceite comprovado permite `accepted`/`sent`; `delivered` e `read` vêm de status remoto comprovado. Erro externo em texto fica em `evolution_send_attempts.error_code text`; não copiar para `messages.error_code integer` nem preencher `error_title/details` com formato não Meta. O estado incerto exige reconciliação ou intervenção, nunca retry cego.

## Assinaturas SQL finais propostas

Todas as funções são `SECURITY INVOKER`, com `search_path = pg_catalog, public, pg_temp` fixado e objetos qualificados, sem bypass de RLS para compensar grants. Conceder `EXECUTE` somente a `service_role`: `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. RLS ativa e sem policy de cliente nas tabelas internas. Em cada RPC, validação explícita de vínculo entre event, connection, account, conversation, contact e autor continua obrigatória, mesmo com service role.

```sql
public.claim_evolution_events(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
) RETURNS SETOF public.evolution_events

public.apply_evolution_event(
  p_event_id uuid,
  p_lease_token uuid
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
  p_sender_type text,
  p_sender_id uuid,
  p_message jsonb            -- shape estrito documentado abaixo
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

public.fail_evolution_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retryable boolean
) RETURNS public.evolution_events

public.complete_evolution_event_media(
  p_event_id uuid,
  p_lease_token uuid,
  p_media_storage_path text,
  p_media_type text
) RETURNS public.evolution_events
```

`reserve_evolution_send.p_message` é objeto JSON de chaves fechadas e validação estrita. Obrigatória e não nula: `content_type text` (coluna `messages.content_type`; default interno `text`, aceita só capacidade homologada). Opcionais que aceitam `null`: `content_text text`, `media_url text` (somente route privada do CRM, nunca URL efêmera Evolution), `media_type text` (MIME), `template_name text` (deve ser `null` enquanto template estiver bloqueado), `reply_to_message_id uuid`, `interactive_reply_id text`, `interactive_payload jsonb`; `ai_generated boolean` é opcional, não nula quando fornecida, com default `false`. Todas são colunas reais conforme migrations 001/009/010/033/035/039. Rejeitar chaves extras e valores incompatíveis. Não aceitar `id`, `conversation_id`, `sender_type`, `sender_id`, `message_id`, `status`, `created_at`, `error_code`, `error_title`, `error_details` no JSON; estes campos são controlados pela assinatura, defaults reais ou RPC de conclusão. `p_sender_type text` e `p_sender_id uuid` são obrigatórios na validação da RPC: tipo apenas `agent` ou `bot`, e ID de usuário existente em `profiles` na conta. A coluna `messages.sender_id` é nullable e sem FK no schema real; a RPC exige autor válido. Envio inbound usa `apply_evolution_event` e `whatsapp_connections.created_by`. Reserva grava `message_id=NULL`, `status='sending'`, `created_at=now()`.

Semântica transacional:

1. `claim_evolution_events` limita `p_limit` a 1..10 e `p_lease_seconds` a 1..60, seleciona `pending` vencido ou `processing` cuja lease expirou com `FOR UPDATE SKIP LOCKED`; cada aquisição incrementa `attempts`, define `lease_until` e escreve `lease_token=gen_random_uuid()`. Reclaim após crash conta como nova tentativa e fica elegível imediatamente após lease expirar (o tempo da lease já é o atraso). Com `attempts=5`, lease expirada vira `failed`, não é retornada. Falha transitória explícita em `fail_evolution_event` agenda backoff 5/15/60/300 s para tentativas 1..4; quinta falha fica `failed`. Falha permanente fica `failed` imediatamente. Erros guardam apenas código sanitizado.
2. `apply_evolution_event` bloqueia a linha e exige simultaneamente `state='processing'`, token igual e `lease_until > clock_timestamp()`; mismatch/expiração falha sem tocar domínio. Toda mutação de domínio, criação das raízes candidatas de dispatch e transição `done` ficam na transação. Raízes com conflito usam as chaves únicas por evento/engine/definição e reutilizam ID existente. Repetição terminal retorna `duplicate`; falha/rollback não deixa mensagem/unread parcial. `fail_evolution_event` usa a mesma checagem de fencing. A renovação de lease, se necessária, exige o token corrente e gera token novo; token antigo nunca volta a ser válido.
3. `reserve_evolution_send` insere tentativa e linha local na mesma transação. `evolution_send_attempts_account_request_key` serializa concorrência; conflito com o mesmo hash devolve a tentativa existente sem autorizar novo POST, e hash divergente retorna erro de conflito. `should_send=true` apenas para o criador inicial da reserva.
4. `complete_evolution_send` bloqueia tentativa, aceita apenas transições válidas e idempotentes, associa ID externo e avança mensagem sem rebaixar status. Timeout/mutação ambígua vira `unknown`; jamais converte `unknown` em permissão para repetir envio. A aceitação remota seguida de crash antes desta RPC fica pendente/incerta até reconciliação; não há promessa impossível de exactly-once no transporte.

## Recuperação e unicidade de dispatch

Usar duas tabelas concretas, limitadas a processamento de eventos Evolution: root por evento/engine/definição e checkpoint por ação. Nenhuma chave textual livre substitui a definição real.

`evolution_event_dispatches` (root e ID estável da execução): `id uuid not null default gen_random_uuid()`; `event_id uuid not null references evolution_events(id) on delete cascade`; `account_id uuid not null references accounts(id) on delete cascade`; `engine text not null`; `automation_id uuid null references automations(id) on delete cascade`; `flow_id uuid null references flows(id) on delete cascade`; `ai_config_id uuid null references ai_configs(id) on delete cascade`; `user_id uuid not null references auth.users(id)` (autor auditável copiado da definição); `contact_id uuid null references contacts(id) on delete set null`; `conversation_id uuid null references conversations(id) on delete set null`; `automation_log_id uuid null references automation_logs(id) on delete set null`; `flow_run_id uuid null references flow_runs(id) on delete set null`; `ai_slot_claimed boolean not null default false`; `state text not null default 'pending'`; `attempts integer not null default 0`; `lease_until timestamptz null`; `lease_token uuid null`; `next_attempt_at timestamptz not null default now()`; `last_error_code text null`; `result jsonb null`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`.

Constraints nomeadas: `evolution_event_dispatches_pkey PRIMARY KEY(id)`; FKs com nomes `evolution_event_dispatches_event_fkey`, `_account_fkey`, `_automation_fkey`, `_flow_fkey`, `_ai_config_fkey`, `_user_fkey`, `_contact_fkey`, `_conversation_fkey`, `_automation_log_fkey`, `_flow_run_fkey`; `evolution_event_dispatches_engine_check CHECK(engine IN ('automation','flow','ai'))`; `evolution_event_dispatches_definition_matches_engine CHECK` exige exatamente um definition ID não nulo que corresponda ao engine; `evolution_event_dispatches_state_check CHECK(state IN ('pending','processing','done','skipped','failed','unknown'))`; `evolution_event_dispatches_attempts_check CHECK(attempts BETWEEN 0 AND 5)`.

Named constraint `evolution_event_dispatches_definition_matches_engine` is `CHECK ((engine='automation' AND automation_id IS NOT NULL AND flow_id IS NULL AND ai_config_id IS NULL) OR (engine='flow' AND automation_id IS NULL AND flow_id IS NOT NULL AND ai_config_id IS NULL) OR (engine='ai' AND automation_id IS NULL AND flow_id IS NULL AND ai_config_id IS NOT NULL))`. Three partial unique indexes are the root keys: `evolution_dispatch_automation_event_key UNIQUE(event_id, automation_id) WHERE engine='automation'`; `evolution_dispatch_flow_event_key UNIQUE(event_id, flow_id) WHERE engine='flow'`; `evolution_dispatch_ai_event_key UNIQUE(event_id, ai_config_id) WHERE engine='ai'`. `id` itself is the stable execution ID generated only by the successful insert. `apply_evolution_event` inserts roots from `automations` (`is_active=true`), `flows` (`status='active'`) and `ai_configs` (`is_active=true AND auto_reply_enabled=true`) for the event's account. Engines evaluate keyword/entry/inbound eligibility and terminally skip nonmatches. There is no `source_key` abstraction or synthetic Evolution event.

`apply_evolution_event` cria raízes candidatas para definições ativas na mesma transação que insere uma mensagem inbound nova e marca o evento `done`. Cada chave é `(event_id,engine,definition id)`. O UUID root é gerado uma vez e persiste como ID de execução antes de qualquer ação. Candidato sem match da condição de automação/flow, ou AI inelegível, termina como `skipped`, não é apagado. Replay conflita no índice único parcial e reutiliza o root existente; não gera outro UUID.

`start_evolution_event_dispatch(p_dispatch_id uuid, p_lease_token uuid) RETURNS TABLE(dispatch_id uuid, automation_log_id uuid, flow_run_id uuid, state text)` roda antes da primeira ação, na mesma transação que cria/vincula o registro de execução do motor. Bloqueia root e valida token/lease atuais; account e audit user são derivados do root/definição. Para automação, insere/vincula exatamente um `automation_logs` por root e grava seu ID (adicionar coluna `automation_logs.evolution_dispatch_id uuid null references evolution_event_dispatches(id) on delete set null` e constraint `automation_logs_evolution_dispatch_id_key UNIQUE(evolution_dispatch_id)`). `automation_logs.status` aceita somente `success/partial/failed`; estado inicial `partial` é atualizado com o resultado terminal. Para flow, cria `flow_runs` no mesmo tx em start novo ou vincula o run ativo em resposta; respeita `idx_one_active_run_per_contact` e resolve/reusa a linha vencedora. `ai_config_id` usa o próprio root como execução. Rechamada devolve os mesmos IDs, sem corrida select/insert.

`evolution_dispatch_steps`: `id uuid not null default gen_random_uuid()`, `dispatch_id uuid not null references evolution_event_dispatches(id) on delete cascade`, `action_key text not null`, `state text not null default 'pending'`, `attempts integer not null default 0`, `lease_until timestamptz null`, `lease_token uuid null`, `next_attempt_at timestamptz not null default now()`, `request_id text null`, `send_attempt_id uuid null references evolution_send_attempts(id) on delete set null`, `result jsonb null`, `last_error_code text null`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Named constraints: `evolution_dispatch_steps_pkey PRIMARY KEY(id)`, `evolution_dispatch_steps_dispatch_fkey`, `evolution_dispatch_steps_state_check CHECK(state IN ('pending','processing','done','skipped','failed','unknown'))`, `evolution_dispatch_steps_attempts_check CHECK(attempts BETWEEN 0 AND 5)`, `evolution_dispatch_steps_dispatch_action_key UNIQUE(dispatch_id,action_key)`. Partial unique index `evolution_dispatch_steps_request_id_key UNIQUE(request_id) WHERE request_id IS NOT NULL`. `action_key` is derived concretely: automation step UUID; flow `<transition_seq>:<node_key>` (so a graph loop is a new action); AI uses literal `reply`. Database-only effect and step completion must commit together. External send reserves request ID `evolution-step:<step_uuid>` before transport. Reclaim of an expired send step reads `send_attempt_id`; pending/unknown attempt cannot authorize another POST.

Additional exact RPCs:

```sql
public.start_evolution_event_dispatch(
  p_dispatch_id uuid, p_lease_token uuid
) RETURNS TABLE(dispatch_id uuid, automation_log_id uuid,
                flow_run_id uuid, state text)

public.claim_evolution_dispatches(
  p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 60
) RETURNS SETOF public.evolution_event_dispatches

public.claim_evolution_dispatch_step(
  p_dispatch_id uuid, p_dispatch_lease_token uuid,
  p_action_key text, p_lease_seconds integer DEFAULT 60
) RETURNS TABLE(step_id uuid, state text,
                lease_token uuid, request_id text,
                send_attempt_id uuid, should_execute boolean)

public.complete_evolution_dispatch_step(
  p_step_id uuid, p_dispatch_lease_token uuid,
  p_lease_token uuid, p_state text,
  p_request_id text DEFAULT NULL, p_send_attempt_id uuid DEFAULT NULL,
  p_result jsonb DEFAULT NULL, p_error_code text DEFAULT NULL
) RETURNS public.evolution_dispatch_steps

public.complete_evolution_dispatch(
  p_dispatch_id uuid, p_lease_token uuid, p_state text,
  p_result jsonb DEFAULT NULL, p_error_code text DEFAULT NULL
) RETURNS public.evolution_event_dispatches

public.claim_ai_reply_slot_for_dispatch(
  p_dispatch_id uuid, p_dispatch_lease_token uuid,
  p_max_replies integer
) RETURNS boolean

public.apply_evolution_automation_effect(
  p_dispatch_id uuid, p_dispatch_lease_token uuid,
  p_step_id uuid, p_step_lease_token uuid,
  p_operation text, p_payload jsonb
) RETURNS TABLE(step_id uuid, state text, result jsonb)

public.complete_evolution_flow_transition(
  p_dispatch_id uuid, p_dispatch_lease_token uuid,
  p_step_id uuid, p_step_lease_token uuid,
  p_flow_run_id uuid, p_event_id uuid,
  p_expected_transition_seq integer,
  p_event_type text, p_node_key text, p_payload jsonb,
  p_next_node_key text, p_next_status text, p_end_reason text
) RETURNS TABLE(applied boolean, transition_seq integer, status text)

public.complete_evolution_ai_handoff(
  p_dispatch_id uuid, p_dispatch_lease_token uuid,
  p_step_id uuid, p_step_lease_token uuid,
  p_summary text, p_handoff_agent_id uuid
) RETURNS TABLE(step_id uuid, state text)
```

Claims de event, root e step usam `FOR UPDATE SKIP LOCKED` quando em lote; cada claim aumenta contador (máximo cinco) e cria `gen_random_uuid()` novo em `lease_token`. Toda função de aplicação/conclusão verifica sob lock token correspondente e lease vigente (`lease_until > clock_timestamp()`); token velho falha sem mutação. Expiração reclaims imediatamente após o lease e conta como tentativa; tentativa cinco expirada passa a `failed`. Falha transitória explícita usa os backoffs 5/15/60/300 s; tentativa cinco e erro permanente são terminais. `complete_evolution_dispatch_step` recebe e valida ambos `p_dispatch_lease_token` e `p_lease_token` contra root e step; assim, um worker antigo não conclui nem o step depois que outra execução adquire nova root lease. `complete_evolution_dispatch` requer token da raiz e só aceita terminal quando não restarem steps pendentes/em execução.

`claim_ai_reply_slot_for_dispatch` bloqueia a raiz; se `ai_slot_claimed=true`, retorna true sem incrementar novamente. Se false, faz o mesmo update atômico de cap/eligibilidade hoje feito por `claim_ai_reply_slot(conversation_id,max_replies)` e grava `ai_slot_claimed=true` na mesma transação. Replay do mesmo evento/root não consome nova vaga. `flow_run_events` recebe `evolution_event_id uuid null references evolution_events(id) on delete set null` e `transition_seq integer null`. Os índices parciais nomeados são `flow_run_events_reply_event_key UNIQUE(flow_run_id,evolution_event_id) WHERE event_type='reply_received' AND evolution_event_id IS NOT NULL` e `flow_run_events_evolution_transition_key UNIQUE(flow_run_id,evolution_event_id,event_type,transition_seq) WHERE evolution_event_id IS NOT NULL AND transition_seq IS NOT NULL`. `reply_received` é inserido/validado antes de avançar run, e a repetição não avança nem cria AI root/slot adicional. `transition_seq` permanece o checkpoint do run.

Para que checkpoint e efeito de banco não fiquem em RPCs separados: `apply_evolution_automation_effect` só aceita operações concretas `add_tag`/`remove_tag` (`{contact_id uuid, tag_id uuid}`), `update_contact_field` (`{contact_id uuid, field text, value jsonb}`; built-in `name/email/company` ou `custom:<custom_field_id>`), `create_deal` (`{contact_id uuid, pipeline_id uuid, stage_id uuid, title text, value numeric(12,2), currency text, status text}`), `assign_conversation` (`{conversation_id uuid, assigned_agent_id uuid null}`) e `wait`/`wait_for_reply` (campos de `automation_pending_executions`: `automation_id uuid`, `account_id uuid`, `user_id uuid`, `contact_id uuid null`, `log_id uuid null`, `parent_step_id uuid null`, `branch text null`, `next_step_position integer`, `context jsonb`, `run_at timestamptz`, `status text`, `parked_step_id uuid null`; acrescentar `evolution_dispatch_step_id uuid null references evolution_dispatch_steps(id) on delete set null`). Para tag/contact/deal/assignment, RPC valida tenant e FK IDs contra root e aplica mutação + step `done` na mesma transação. Em `create_deal`, `user_id`/`account_id` são derivados do root, não payload; `title`, `value`, `currency`, `status` correspondem às colunas reais (001/017/021). Constraints `automation_pending_executions_evolution_dispatch_step_key UNIQUE(evolution_dispatch_step_id)` e `automation_logs_evolution_dispatch_id_key UNIQUE(evolution_dispatch_id)` impedem duplicar wait/log após retry. Para `wait`/`wait_for_reply`, a função insere ou devolve a linha existente por essa constraint, sem avançar execução antes de persistir a fila. Mensagens não passam por esse RPC: sempre usam `reserve_evolution_send` e `complete_evolution_send`.

`complete_evolution_flow_transition` valida tokens, `flow_run_id`, `event_id`, account e `transition_seq` esperado; insere `flow_run_events` com `evolution_event_id` e avança `flow_runs.current_node_key/status/transition_seq` na mesma transação. Os índices parciais `flow_run_events_reply_event_key` e `flow_run_events_evolution_transition_key` acima tornam o replay de resposta `applied=false` e deduplicam checkpoints de cada transition sem impedir múltiplos nodes no mesmo evento. `p_event_type` valida contra valores reais da migration 010 (`started/node_entered/message_sent/reply_received/fallback_fired/handoff/timeout/error/completed`); `p_next_status` valida contra status final de 052 (`active/completed/handed_off/timed_out/paused_by_agent/cancelled/failed`); `p_next_node_key text null`, `p_end_reason text null`, `p_payload jsonb` persistem estado final (a RPC rejeita payload nulo e aplica `{}` quando ausente). `complete_evolution_ai_handoff` valida root/step lease, grava `conversations.ai_autoreply_disabled`/`ai_handoff_summary` e opcionalmente assignee válido, e conclui o step na mesma transação. A resposta AI usa a reserva Evolution send idempotente. Todos esses RPCs são `SECURITY INVOKER`, com `search_path = pg_catalog, public, pg_temp`, grants apenas service_role e validação de escopo interna.

O root único impede nova execução para o mesmo evento/definição; o step único impede repetir a mesma ação; envio remoto usa a reserva C5 e não retry cego. Após possível aceite remoto seguido de crash, tentativa fica `unknown` e step/root não reenviam. Só reconciliar por eco Evolution quando a correlação observada for suficiente, senão intervenção operacional. Os logs de automação e eventos de flow continuam auditoria e mantêm `user_id`; não viram fonte de unicidade por consulta JSON.

## Arquivos de adaptação e incompatibilidades

Arquivos de produto previstos para os recortes de implementação posteriores (esta tarefa não os altera):

- `src/lib/whatsapp/uazapi/{types,client,events,capabilities}.ts` e testes/fixtures equivalentes: renomear para `src/lib/whatsapp/evolution/{types,client,events,capabilities}.ts`; substituir `UazapiCredentials`/origem/config por `EvolutionCredentials`; `instanceId` significa nome da instância. `configureWebhook` recebe `(credentials, callbackUrl, webhookSecret, connectionId)` e configura headers autenticadores; não enviar segredo no corpo, persistir envelope externo ou inventar HMAC.
- `src/lib/whatsapp/send-message.ts`, `src/lib/whatsapp/resolve-conversation.ts`, `src/lib/whatsapp/conversation-scope.ts`, `src/lib/whatsapp/message-status.ts`, `src/lib/whatsapp/message-status-sync.ts`, `src/lib/whatsapp/wa-identity.ts`: trocar dependência de Meta/config pela conexão, manter `account_id` como tenant e autor real separado; adicionar conexão externa à dedupe/status e reconciliar IDs Evolution que não têm prefixo Meta. A identidade/phone resolver atual reflete telefone/BSUID Meta e não pode adivinhar JID/LID Evolution.
- `src/app/api/whatsapp/webhook/route.ts` e seus testes: rota Meta antiga fica separada e retorna HTTP 410 conforme T13; não montar Evolution nela nem reaproveitar validação Meta. Novo receiver em `src/app/api/whatsapp/evolution/webhook/route.ts` e respectivos testes autentica pelos headers aprovados, normaliza C2 e persiste inbox/RPC. Mensagens/status Meta históricos não são prova do schema Evolution.
- `src/app/api/whatsapp/evolution/media/[eventId]/route.ts` (novo): ler object path privado apenas depois de autenticar o usuário e confirmar associação em `profiles`, escopo da conversa e conta do evento; a rota Evolution do webhook nunca serve blob de mídia.
- `src/lib/automations/engine.ts`, `src/lib/automations/meta-send.ts`, `src/app/api/automations/engine/route.ts`, `src/app/api/automations/cron/route.ts`, `src/lib/contacts/tag-events.ts`: motores chamam emissores Meta e guardam waits sem chave de evento/ação; propagar dispatch id estável, audit user e ledger.
- `src/lib/flows/engine.ts`, `src/lib/flows/meta-send.ts`, `src/lib/flows/timeout.ts`, `src/app/api/flows/cron/route.ts`, `src/app/api/flows/[id]/runs/route.ts`: emissores Meta, `meta_message_id` e consulta de duplicidade sem índice único precisam virar ID Evolution + ledger transacional.
- `src/lib/ai/auto-reply.ts`, `src/lib/ai/admin-client.ts`, `src/lib/whatsapp/meta-api.ts`: engine usa `loadAccountMetaCredentials`, `engineSendText`, typing indicator e claim por contador; trocar transporte, remover typing sem capacidade comprovada, ancorar reply e uso de slot no dispatch.
- T06 cria a migration com `supabase migration new evolution_delivery_contract`; o CLI gera nome timestampado, que deve ser registrado e usado. Não criar/reservar `060_...` manualmente. Nenhuma migration foi criada nesta tarefa. `src/types/database.ts` não existe neste checkout; se tipos gerados forem introduzidos em T06, registrar o caminho real então.

Incompatibilidades que T05/T06 devem respeitar: o plano original denomina tabelas/RPCs/configuração e paths `uazapi`; provider check `uazapi` e nome de conexão não se aplicam. Usar `evolution_connections` não é necessário: decisão aqui é manter tabela genérica `whatsapp_connections` para preservar domínio existente, com provider `evolution`, e nomear fila/tentativas especificamente `evolution_*`. O plano descreve `event_json`; contrato aqui restringe conteúdo a `normalized_event`. O envelope Evolution contém `apikey` e campos que o plano UAZAPI não definia; o segredo autenticador é header separado e `instance` do corpo é só correlação. Timeout/ack/QR não reutilizam suposições UAZAPI: obedecer revisão Evolution e fixtures T03. `messages` mantém o modelo interno/externo existente; nunca renomear `messages.id` como ID remoto nem assumir prefixo `wamid`.

## Limites de verificação

Leitura documental das migrations acumuladas e helpers executada. Catálogo local consultado em modo somente leitura via `env.sh`: confirmou 57 migrations, tipos/nullability das tabelas legadas citadas e índices legados que serão substituídos. Nenhum banco foi modificado. RLS/grants, constraints e RPCs Evolution propostas, concorrência, recuperação após crash, bucket/ACL privados e testes de integração ainda não foram verificados em PostgreSQL. Este documento é contrato para revisão e geração de migration em T06, não afirmação de schema Evolution aplicado. A aprovação técnica do coordenador continua necessária antes do próximo cartão.
