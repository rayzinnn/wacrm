# T12 — plano de integração do worker Evolution

## Objetivo e limites

Este documento planeja a adaptação de dispatch inbound para um worker local que
consome somente eventos de mensagem Evolution já aplicados. Não implementa nem
executa engines, não chama rede, não envia mensagem e não altera schema. O
worker deverá usar roots por evento/definição e steps idempotentes, sem delegar
envio a código Meta.

Contrato normativo: [schema-contract.md](schema-contract.md), seção “Recuperação
e unicidade de dispatch”. O mapa abaixo foi conferido contra as migrations,
engines e senders atuais. Os passos são recortes futuros executáveis em ordem;
cada recorte deve ganhar sua própria migration/testes quando indicado.

## Raízes e ciclo inbound

`apply_evolution_event` em
`supabase/migrations/20261116181109_evolution_apply_inbound_text.sql` já aplica
a mensagem inbound e insere roots candidatas na mesma transação para cada
automação ativa, flow ativo e AI config elegível da conta. As raízes usam
`(event_id, automation_id)`, `(event_id, flow_id)` ou `(event_id, ai_config_id)`
com índices únicos parciais. Não é necessário re-descobrir definições no worker
para produzir raízes. As condições específicas de entrada continuam sendo
decididas pelo engine e candidatos incompatíveis devem terminar `skipped`.

O processamento inbound atual está em
`src/lib/whatsapp/evolution/message-worker.ts`, chamado por
`src/app/api/whatsapp/evolution/events/cron/route.ts`. Ele apenas reivindica
eventos, chama `apply_evolution_event` e fecha a tentativa do evento; não
reivindica nem executa roots. A ordem do futuro runtime é portanto: concluir o
apply da mensagem, reivindicar roots pendentes/vencidas e só então iniciar cada
engine. Não misturar falha de engine com estado de ingestão da mensagem.

Schema T12 já presente:

- `evolution_event_dispatches`, criada por
  `supabase/migrations/20261116180118_evolution_event_dispatch_roots.sql`:
  root estável, engine/definition, tenant, event/contact/conversation, IDs de
  log/run, slot AI, estado, tentativas, lease/token, erro e resultado.
- `claim_evolution_dispatches` em
  `supabase/migrations/20261116185619_t12_claim_evolution_dispatches.sql`:
  lote com `SKIP LOCKED`, limites e lease do contrato, tentativas até cinco e
  token novo.
- `claim_evolution_automation_dispatches` em
  `supabase/migrations/20261116213012_t12_claim_evolution_automation_dispatches.sql`:
  variante aplicada no banco local que reserva/exaure somente roots de
  automação. Fluxos e IA ficam intactos até terem worker próprio.
- `evolution_dispatch_steps` e vínculo único inverso em `automation_logs`, em
  `supabase/migrations/20261116190454_t12_dispatch_steps_schema.sql`:
  chave única `(dispatch_id, action_key)`, request id parcial único, send
  attempt, estados e RLS/grants de serviço.
- `claim_evolution_dispatch_step` e
  `complete_evolution_dispatch_step`, em
  `supabase/migrations/20261116192433_t12_dispatch_step_rpcs.sql`: claim e
  conclusão fenced pelos tokens de root e step; tentativas expiradas e
  referências de send são consideradas. Um attempt `pending` ou `unknown` não
  autoriza outro POST.
- `complete_evolution_dispatch`, em
  `supabase/migrations/20261116195927_t12_complete_evolution_dispatch.sql`:
  valida lineage/token/lease e recusa conclusão terminal com steps
  `pending`/`processing`. O contrato implementado aceita apenas `p_result IS
  NULL`; não criar formato JSON de resultado até alteração explícita do
  contrato.
- `start_evolution_event_dispatch`, em
  `supabase/migrations/20261116201732_t12_start_evolution_event_dispatch.sql`:
  cria/reutiliza log de automação ou run de flow com vínculo à root; foi aplicado
  no banco local e testado com rollback e concorrência. Ainda não há worker.
- `apply_evolution_automation_effect`, ampliada nas migrations
  `20261116203606_t12_apply_evolution_automation_effect.sql`,
  `20261116210937_t12_apply_evolution_create_deal_effect.sql` e
  `20261116212357_t12_apply_evolution_assign_conversation_effect.sql` e
  `20261116213942_t12_apply_evolution_wait_effect.sql` e
  `20261116215135_t12_apply_evolution_wait_for_reply_effect.sql`:
  cobre tag, campo, negócio, atribuição a agente específico, espera temporizada
  e estacionamento de `wait_for_reply` interativo com efeito e checkpoint
  atômicos. Foi aplicada somente no banco local. A retomada da resposta, a
  cadeia `tag_added`, a retomada de esperas e a execução do motor continuam
  ausentes. `interactive: false` impede ativar o caminho interativo.
- `automation_pending_executions.evolution_dispatch_step_id`, FK e UNIQUE em
  `supabase/migrations/20261116213140_t12_automation_pending_dispatch_step_link.sql`:
  schema aplicado no banco local e testado com rollback. O cron legado já
  ignora linhas vinculadas ao Evolution. Ainda faltam a retomada idempotente e
  a associação de uma resposta Evolution à espera interativa.
- `src/lib/automations/evolution-step-executor.ts`: módulo isolado que reserva
  e aplica um passo local elegível com as RPCs fenced. Ainda não é chamado por
  worker; não executa condição, envio nem cadeia derivada.
- `src/lib/automations/evolution-dispatch-preparer.ts`: módulo isolado que
  confere a root reservada, o evento aplicado, a conta e a elegibilidade antes
  de iniciar o log. Conclui candidatos inelegíveis como `skipped` sem criar log
  parcial. Ainda falta o worker de lote e a origem confiável da flag de primeira
  mensagem.
- `src/lib/automations/evolution-condition-executor.ts`: módulo isolado que
  persiste a decisão `yes/no` em um step e lê o resultado no replay; texto vem
  do evento inbound aplicado e consulta de etiqueta valida a conta. Ainda não
  percorre filhos nem é chamado por worker.
- `src/lib/automations/evolution-send-message-executor.ts`: módulo isolado para
  `send_message` com chave de reserva derivada do ledger e transporte Evolution.
  Quando a claim do passo não autoriza execução, não chama o adapter. Ainda
  falta distinguir em SQL uma lease ativa de outro worker de uma lease nova de
  recuperação após queda; o módulo não está ligado ao worker.
- `evolution_send_attempts` e RPCs de reserva/conclusão do transporte já
  existem em `supabase/migrations/20261116160955_t06_a3_evolution_send_attempts.sql`
  e `supabase/migrations/20261116170118_evolution_send_text_rpcs.sql` (com
  correção de ordem de locks em
  `supabase/migrations/20261116172204_evolution_send_rpc_lock_order.sql`).

## Engines legados e classificação de ações

### Automations

Engine: `src/lib/automations/engine.ts`; modelos/configs em `src/types/`;
sender legado em `src/lib/automations/meta-send.ts`; waits/replies no mesmo
engine e fila `automation_pending_executions`. Hoje o engine percorre passos
sequenciais, escreve resultados em `automation_logs`, agenda `wait`, estaciona
`wait_for_reply` e pode disparar automações derivadas após tag.

| Ação | Classe | Caminho Evolution planejado |
|---|---|---|
| `condition` | Não transporte | Avaliar em worker; checkpoint `action_key` derivada do UUID do step. Sem efeito remoto. |
| `add_tag`, `remove_tag` | Não transporte | Aplicar via RPC transacional com step; preservar tenant e política de cadeia de `tag_added`. |
| `update_contact_field` | Não transporte | RPC transacional para colunas permitidas e `custom:<id>` validado no tenant. |
| `create_deal` | Não transporte | RPC transacional; account/user derivados da root, validar pipeline/stage na conta. |
| `assign_conversation`, `close_conversation` | Não transporte | Efeito local com checkpoint atômico; assignment valida membro. `close_conversation` ainda não está na lista contratada de operações RPC e exige decisão/extensão antes de execução. |
| `wait`, `wait_for_reply` | Wait/reply | Persistir fila e marcar step na mesma transação. A linha existente em `automation_pending_executions` precisa de vínculo único por `evolution_dispatch_step_id`; reply deve referenciar evento Evolution e avançar só uma vez. |
| `send_message` | Texto | Único tipo de envio de automação candidato ao Evolution text core, sempre com reserva `evolution-step:<ledger-step-id>` antes do transporte. |
| `send_buttons`, `send_list` | Interativo bloqueado | Não executar nem converter em texto. Capacidades Evolution têm `interactive: false`. |
| `send_template` | Template bloqueado | Não executar; `templates: false`, e dependência de template Meta não tem mapeamento Evolution. |
| `send_webhook` | Não transporte externo | Fora do escopo e não torna o step seguro por idempotência. Adiar até política de destino, replay e efeitos externos. Não chamar URL do cliente no worker deste recorte. |

O contrato atual de `apply_evolution_automation_effect` cobre `add_tag`,
`remove_tag`, `update_contact_field`, `create_deal`, `assign_conversation`,
`wait` e `wait_for_reply`. Não cobre `condition` (avaliação pura),
`close_conversation` ou `send_webhook`; decidir extensão explícita antes desses
dois efeitos locais/remotos. Condições de entrada/keyword e elegibilidade devem
terminar `skipped` quando não combinarem, sem criar efeito colateral.

### Flows

Engine: `src/lib/flows/engine.ts`; tipos em `src/lib/flows/types.ts`; sender Meta
em `src/lib/flows/meta-send.ts`; fallback em `src/lib/flows/fallback.ts`;
timeout em `src/lib/flows/timeout.ts`. O grafo atual processa `start`,
`send_message`, `send_media`, `collect_input`, `condition`, `set_tag`,
`send_buttons`, `send_list`, `handoff` e `end`; `http_fetch` existe no check de
schema, mas o caminho corrente pode não o executar. Respostas e auditoria usam
`flow_runs` e `flow_run_events`. O engine antigo deduplica por
`meta_message_id`/update otimista e índice de run ativo, que não substituem o
fencing/event checkpoint do novo contrato.

| Ação/node | Classe | Caminho Evolution planejado |
|---|---|---|
| `start`, `condition`, `end` | Não transporte | Executar como transição local; gravar evento e `transition_seq` junto à atualização do run. |
| `set_tag` | Não transporte | Operação local idempotente com checkpoint de transição. |
| `send_message`, `collect_input` | Texto | Prompt textual elegível ao core Evolution; persistir attempt de envio antes e checkpoint de flow em transação separada após aceitação conhecida. Prompt de `collect_input` suspende no estado correto até reply. |
| `send_buttons`, `send_list` | Interativo bloqueado | Nodes e resposta interativa bloqueados; não substituir por texto simples. `interactive: false`. |
| `send_media` | Transporte bloqueado | `media: []`; aguardar recorte de mídia e contrato de entrega próprios. |
| `handoff` | Handoff | Aplicar atribuição/estado local em transação com step; usar RPC de handoff/transition quando disponível. |
| `http_fetch` | Ação externa bloqueada | Não chamar nem inferir payload; política e replay não fazem parte do transporte Evolution. |
| `fallback` e timeout | Não transporte/handoff | Usar semântica de `fallback.ts` e `timeout.ts` somente após transições fenced implementadas; reply duplicada precisa resultar em não avanço. |

O schema base já contém `flow_runs`, `flow_run_events`, `transition_seq` em
`flow_runs` (migration `052_flow_run_integrity.sql`) e índices de run ativo.
As alterações de schema T12 para `flow_run_events.evolution_event_id`,
`flow_run_events.transition_seq` e os índices parciais
`flow_run_events_reply_event_key` e
`flow_run_events_evolution_transition_key` descritos em
`schema-contract.md` foram aplicadas no banco local e testadas com rollback.
A RPC de transição também foi aplicada no banco local e testada; o worker de
Flow e os nós ainda não foram ligados a ela.

### AI e handoff

AI antiga: `src/lib/ai/auto-reply.ts`, configuração em
`src/lib/ai/config.ts`, contexto/retrieval em `src/lib/ai/context.ts`,
`src/lib/ai/knowledge.ts`, chamada provider em `src/lib/ai/generate.ts`, uso em
`src/lib/ai/usage.ts`, resumo em `src/lib/ai/handoff.ts`. Atualmente gates incluem
autoresponder determinístico, dono humano, opt-out, limite por conversa,
resposta inbound mais nova e rate limit; usa `claim_ai_reply_slot` e sender Meta.
O log de uso/provider é efeito externo potencialmente cobrável e não é
checkpoint do dispatch.

- `ai` root só executa com slot de resposta adquirido uma única vez por root;
  `claim_ai_reply_slot_for_dispatch` foi aplicada no banco local e testada com
  replay, limite, lease e isolamento por conta. O worker de IA ainda não a chama.
- `reply` é a chave de step. Gerar resposta chama provider e pode cobrar mesmo
  se o processo cair antes de persistir resultado. Não há garantia de
  idempotência do provider nem armazenamento durável do texto gerado. Antes de
  habilitar IA, decidir política de recuperação para geração interrompida e
  retenção do resultado; não assumir repetição segura ou criar payload.
- Enviar texto gerado pode usar somente o Evolution text core e a reserva de
  request id do step; confirmar geração antes de reservar envio. Timeout
  ambíguo na entrega deixa attempt/step `unknown` e não deve gerar novo POST.
- `handoff` deve pausar resposta automática, criar resumo determinístico e
  opcionalmente atribuir agente. A RPC contratada
  `complete_evolution_ai_handoff` está ausente; até existir, não adaptar por
  writes independentes.

## Sender Meta bloqueado e núcleo de texto Evolution

`src/lib/automations/meta-send.ts` e `src/lib/flows/meta-send.ts` agora falham
fechados para os envios antigos. `src/lib/ai/auto-reply.ts` também falha antes de
geração ou envio. Esses bloqueios permanecem até os motores ganharem transporte
Evolution e checkpoints; não são implementação das respostas automáticas.

Core de texto: `src/lib/whatsapp/evolution/send-adapter.ts` +
`src/lib/whatsapp/evolution/client.ts`, com acesso às credenciais da conexão via
store/config Evolution. O adapter valida input, calcula hash de texto, reserva
`request_id` via `reserve_evolution_send`, só chama transporte quando a reserva
recém-criada autoriza, e persiste resultado com `complete_evolution_send`.
`src/lib/whatsapp/evolution/capabilities.ts` habilita `text: true`, mas mantém
`media: []`, `templates: false`, `interactive: false`, `typing: false`. O worker
de dispatch deve passar identidade e request ID internos; não reaproveitar o
Meta `wamid` como idempotency key.

## Recortes executáveis em ordem

1. **Integração do ciclo de roots (sem ação externa).** Criar worker local
   separado do apply inbound e rota cron protegida semelhante à existente;
   reivindicar roots com `claim_evolution_automation_dispatches`, chamar
   `start_evolution_event_dispatch` e fechar candidatas não elegíveis como
   `skipped`. Persistir `automation_logs` uma vez. **Estado:** RPC de início e
   claim exclusivo de automações aplicados/testados no banco local; faltam
   worker de lote; a preparação/elegibilidade de uma root foi implementada
   isoladamente. O claim genérico não deve ser usado pelo worker de
   automação. Testes SQL de início, concorrência e isolamento de engines já
   passaram.
2. **Primitivas locais de automação.** Implementar/usar
   `apply_evolution_automation_effect` para tags, contato, deal, assignment e
   waits; worker avalia `condition` sem I/O e termina step com RPC fenced.
   **Estado:** RPC de tag/campo/negócio/atribuição específica e wait temporizado
   aplicada e testada no banco local; vínculo/UNIQUE da fila também aplicado.
   O módulo de um passo local está testado, mas isolado.
   **Lacunas:** execução do worker, `tag_added`, resposta a `wait_for_reply`, retomada da
   fila e contexto acumulado dos passos anteriores. **Teste:** rollback-only de
   tenant/FKs/allowed fields, replay da
   mesma wait e corrida de step/efeito. Excluir `close_conversation` até extensão
   aprovada; `send_webhook` permanece bloqueado.
3. **Texto de automação.** Para apenas `send_message`, derivar chave do UUID
   real do passo, claim step, reservar `evolution-step:<ledger-step-id>`, chamar
   adapter Evolution uma vez, persistir attempt id e conclusão fenced. Tratar
   `accepted`, `rejected`, `pending`/`unknown` sem POST repetido. **Teste:**
   mocks do adapter sem rede, SQL de reserva/replay e crash após reserva e após
   resposta do transporte.
4. **Flow local e replies.** Implementar roots/run start e transições com
   `complete_evolution_flow_transition`, primeiro para `start`, `condition`,
   `set_tag` e `end`; só então receber `reply_received` com evento Evolution
   deduplicado. A RPC de transição e as colunas/índices T12 de
   `flow_run_events` já foram aplicados no banco local; falta o worker/nós.
   **Teste:** mesmo evento repetido, sequência
   esperada/stale, duas replies concorrentes, mudança terminal e lineage da
   conta. Não aceitar flows em andamento até testar a transição atômica.
5. **Texto Flow e coleta de entrada.** Portar `send_message` e prompt de
   `collect_input` pela mesma reserva Evolution e teste de crash; checkpoint do
   prompt e estado suspenso devem ser coerentes com resultado do envio. Sem
   reusar `flows/meta-send.ts`. **Teste:** adapter mockado e RPCs locais; nenhum
   endpoint real.
6. **Handoff Flow/AI.** Ligar efeitos de handoff às transições/root/step fenced.
   **Lacunas:** `complete_evolution_ai_handoff` ausente; validar agente na
   account e replay de handoff sem reatribuição indevida. Teste concorrente e
   rollback-only.
7. **AI reply por último.** Implementar slot root, gates reavaliados no worker,
   geração e persistência/recovery explicitamente decididas, e envio texto pelo
   mesmo adapter. **Lacunas:** `claim_ai_reply_slot_for_dispatch` ausente e
   política de crash/custo do provider não resolvida. **Teste:** slot uma vez
   por root, cap concorrente, provider stub, inbound mais novo e crash em cada
   fronteira. Não ativar produção com política de geração ambígua.
8. **Operações bloqueadas em recortes próprios.** Templates, interativos,
   mídia, typing e `http_fetch`/webhook não integram os passos acima. Cada
   capacidade exige contrato próprio, gating explícito e testes de que fica
   desabilitada no worker Evolution até estar implementada.

## Recuperação de crash

- Crash antes do `start`: reclaim root fenced e tentativa limitada; não criar
  segundo log/run. Requer start RPC idempotente.
- Crash após efeito local: a mutação e `complete_evolution_dispatch_step` têm
  de estar na mesma transação/RPC. Nunca reexecutar efeito se a transação já
  confirmou.
- Crash antes de reservar envio: step pode ser reclaimado se ainda não há
  attempt associado. Após reserva `pending`, crash ou resposta incerta não
  autoriza novo POST; step/root ficam para reconciliação operacional como
  `unknown` conforme resultado disponível.
- Aceite remoto seguido de falha na persistência local: consultar apenas
  attempt/correlação disponível; sem confirmação suficiente, não reenviar.
- Crash após persistência do envio e antes da transição do engine: reabrir pelo
  `request_id`/attempt e completar checkpoint sem chamar transporte de novo.
- Root só termina depois de todos os steps terminais; `complete_evolution_dispatch`
  rejeita steps `pending`/`processing`. `result` continua `NULL` até mudança
  explícita do contrato.
- Logs `automation_logs`, `flow_run_events` e `ai_usage_log` são auditoria ou
  medição; não substituem as chaves de unicidade de root/step/send.

## Lacunas consolidadas

Ausentes no estado atual das migrations, embora descritos em
`schema-contract.md`: retomada de `wait_for_reply`,
`claim_ai_reply_slot_for_dispatch` e `complete_evolution_ai_handoff`.
`complete_evolution_flow_transition` foi aplicada no banco local, mas ainda não
é chamada por worker. O estacionamento de `wait_for_reply`, as
colunas/índices Evolution de `flow_run_events` e o vínculo único da fila ao
step foram aplicados no banco local. Confirmar cada item restante por migration/teste antes
de qualquer worker integrar o caminho correspondente. `condition` e
`close_conversation` também precisam de definição de execução; não inferir
operação SQL de `p_payload`. O contrato atual de root completion não aceita
JSON de resultado. Nenhum payload de provider ou mensagem foi definido aqui.

## Arquivos de referência

- Roots/apply/claims: `supabase/migrations/20261116180118_evolution_event_dispatch_roots.sql`, `20261116181109_evolution_apply_inbound_text.sql`, `20261116185619_t12_claim_evolution_dispatches.sql`.
- Steps: `supabase/migrations/20261116190454_t12_dispatch_steps_schema.sql`, `20261116192433_t12_dispatch_step_rpcs.sql`, `20261116195927_t12_complete_evolution_dispatch.sql`.
- Transporte e capabilities: `src/lib/whatsapp/evolution/send-adapter.ts`, `src/lib/whatsapp/evolution/client.ts`, `src/lib/whatsapp/evolution/capabilities.ts`, `supabase/migrations/20261116160955_t06_a3_evolution_send_attempts.sql`, `supabase/migrations/20261116170118_evolution_send_text_rpcs.sql`, `supabase/migrations/20261116172204_evolution_send_rpc_lock_order.sql`.
- Workers/cron inbound: `src/lib/whatsapp/evolution/message-worker.ts`, `src/app/api/whatsapp/evolution/events/cron/route.ts`.
- Engines/senders: `src/lib/automations/engine.ts`, `src/lib/automations/meta-send.ts`, `src/lib/flows/engine.ts`, `src/lib/flows/meta-send.ts`, `src/lib/flows/fallback.ts`, `src/lib/flows/timeout.ts`, `src/lib/ai/auto-reply.ts`, `src/lib/ai/handoff.ts`, `src/lib/ai/generate.ts`.
- Legacy schemas: `supabase/migrations/006_automations.sql`, `010_flows.sql`, `045_automation_wait_for_reply.sql`, `052_flow_run_integrity.sql`, `053_ai_reply_integrity.sql`.
