# WACRM — mapa de transporte (T04.a)

**Escopo:** inventário de emissores/leitores WhatsApp no código integrado ao commit 6ffae7f814aabeddc4a2efb6a9f805e3abb87368. Somente T04.a; não fecha schema, RPC, dispatch, constraints ou migration (T04.b).

**Classes:** **adaptar** = usa Evolution/Core; **bloquear** = capacidade Meta sem suporte no primeiro corte, negar também na rota/engine; **histórico/teste** = manter intenção de teste/documento, trocar expectativas Meta em T14; **remover** = código/config sem consumidores após desconectar imports em T13 (não remover migrations/histórico de banco).

**Tarefas Evolution:** T07 conexão/QR; T08 webhook durável; T09 inbound/estados; T10 texto/API pública; T11 mídia; T12 automations/flows/IA; T13 bloqueio Meta/UI/config; T14 verificação sem transporte Meta.

## Conferência do inventário inicial

O ponto inicial disponibilizado continha 325 ocorrências em 69 arquivos no clone temporário da referência. Reexecutei a busca exata do cartão na raiz integrada:

rg -n 'meta-api|graph\.facebook\.com|META_APP|whatsapp_config' src messages .github .env.local.example

Resultado atual: **187 linhas de ocorrência em 69 arquivos**. Os conjuntos normalizados têm 65 arquivos em comum. Quatro caminhos inicialmente achados não casam mais os termos exatos mas são dependências transitivas e seguem mapeados: src/lib/automations/engine.ts, src/lib/automations/engine.test.ts, src/lib/flows/dispatch.test.ts e src/lib/flows/run-integrity.test.ts. Os quatro arquivos atuais que completam o conjunto são os catálogos messages/en.json, messages/es.json, messages/ko.json e messages/pt.json. Fiz busca estendida também por sendTextMessage, sendMediaMessage, sendTemplateMessage, loadAccountMetaCredentials, engineSend e rotas chamadoras.

Os logs temporários sanitizados estão em /tmp/wacrm-t04-direct-search.txt e /tmp/wacrm-t04-code-review.txt. A busca não basta para dependências sem string Meta; imports/chamadas dos engines, cron e MCP foram conferidos diretamente.

## Cadeias de chamadas

| Cadeia | Classificação/efeito | Dono |
|---|---|---|
| Inbox/message thread → /api/whatsapp/send → lib/whatsapp/send-message → meta-api | Adaptar ao Core Evolution e manter persistência/autorização | T10/T11/T13 |
| API v1/messages → send-message → meta-api | Adaptar ao mesmo Core, tentativa estável T04.b | T10 |
| MCP write → API v1/messages | Adaptar ao Core; manter opt-in/permissões | T10/T13 |
| Automations cron/engine → automations/meta-send → meta-api | Adaptar texto/mídia e replay; bloquear ações antigas incompatíveis | T12/T13 |
| Flows cron/engine → flows/meta-send → meta-api | Adaptar texto/mídia; bloquear template/interativo não verificado | T12/T13 |
| Auto-reply → typing Meta + send-message | Adaptar texto e remover typing não comprovado; manter handoff | T12/T13 |
| Webhook Meta/HMAC → evento/status interno | Adaptar ao callback Evolution e autenticação suportada; persistência depende de T04.b | T08/T09 |
| media inbound → mirror/download Graph → Storage | Adaptar ao recurso Evolution observado e manter Storage privado | T09/T11 |
| broadcast/template → API/cron/MCP/core Meta | Bloquear em backend, API pública, cron e MCP | T13 |
| config/health/register Meta → Supabase/UI | DTO e estado Evolution em T07; rotas exclusivamente Meta bloqueadas | T07/T13 |
| reaction/interativo → rota/builder Meta | Bloquear até contrato e capacidade Evolution explícitos | T12/T13 |
| webhooks de saída do CRM (/api/v1/webhooks, lib/webhooks) | Manter: são callbacks do próprio CRM, não callback Evolution | T09/T13 |

## Matriz de arquivos encontrados e adjacências

Todos os caminhos do scan de 69 arquivos estão incluídos abaixo; adjacências sem ocorrência direta foram incluídas quando formam chamadas transitivas, UI ou API exigidas pelo cartão. “Teste” é classificado como histórico/teste e não deve deixar import operacional Meta.

### Server, eventos, mensagens, cron

| Caminho | Classe e tarefa |
|---|---|
| src/app/api/whatsapp/config/route.ts | Adaptar conexões/config Evolution sem retornar segredo — T07/T13 |
| src/app/api/whatsapp/config/route.test.ts | Histórico/teste; reescrever permissões e segredo — T07/T14 |
| src/app/api/whatsapp/config/verify-registration/route.ts | Bloquear Cloud API, sem carregar cliente — T13 |
| src/app/api/whatsapp/health/route.ts | Adaptar para health de instância Evolution — T07/T13 |
| src/app/api/whatsapp/health/route.test.ts | Histórico/teste; substituir métricas Meta — T07/T14 |
| src/app/api/whatsapp/webhook/route.ts | Adaptar callback Evolution e autenticação confirmada — T08/T09 |
| src/app/api/whatsapp/webhook/route.test.ts | Histórico/teste; envelope/signature não presumidos — T08/T14 |
| src/app/api/whatsapp/send/route.ts, src/app/api/v1/messages/route.ts | Adaptar ao core e tentativa única — T10 |
| src/app/api/whatsapp/send/route.test.ts, src/app/api/v1/messages/route.test.ts | Histórico/teste; cobrir Core Evolution/sem Meta — T10/T14 |
| src/app/api/whatsapp/media/[mediaId]/route.ts | Adaptar; remover download Graph e manter objeto privado — T11 |
| src/app/api/whatsapp/media/[mediaId]/route.test.ts | Histórico/teste; manter isolamento/storage — T11/T14 |
| src/app/api/whatsapp/react/route.ts | Bloquear reaction Meta também por chamada direta — T13 |
| src/app/api/whatsapp/broadcast/route.ts, src/app/api/whatsapp/broadcast/[id]/resume/route.ts | Bloquear campaign e retomada Meta — T13 |
| src/app/api/v1/broadcasts/route.ts, src/app/api/v1/broadcasts/[id]/route.ts | Bloquear execução/status que sugira envio suportado — T13 |
| src/app/api/whatsapp/templates/[id]/route.ts, templates/submit/route.ts, templates/sync/route.ts | Bloquear CRUD, submit e sync Graph — T13 |
| src/app/api/whatsapp/templates/[id]/route.test.ts, templates/submit/route.test.ts, templates/sync/route.test.ts | Histórico/teste; provar bloqueio, sem apagar cobertura útil — T13/T14 |
| src/app/api/automations/cron/route.ts | Adaptar/gatear; não executar engine legado — T12/T13 |
| src/app/api/flows/cron/route.ts | Adaptar/gatear; bloquear action incompatível — T12/T13 |
| src/app/api/flows/cron/route.test.ts | Histórico/teste; replay e action bloqueada — T12/T14 |
| src/app/api/v1/conversations/[id]/messages/route.ts | Adaptar/revisar leitor de DTO, status e mídia — T09/T13 |
| src/lib/api/v1/contacts.ts | Adaptar; trocar whatsapp_config/phone_number_id por conexão/identidade interna — T09/T10 |
| src/app/api/v1/contacts/route.ts, src/app/api/v1/contacts/[id]/route.ts | Revisar leitores de dados/contact ownership; manter scoping e remover dependência de configuração Meta indireta — T09/T13 |

### Core, motores, identidade, mídia e evento

| Caminho | Classe e tarefa |
|---|---|
| src/lib/whatsapp/meta-api.ts | Remover após eliminar todos os imports de runtime — T13 |
| src/lib/whatsapp/meta-api*.test.ts (health, media, recipient, resumable, raiz, typing) | Histórico/teste; mover assertions para capacidade/Core Evolution — T07/T10/T11/T14 |
| src/lib/whatsapp/send-message.ts, send-message.test.ts | Adaptar core; teste preserva handoff e segurança — T10/T14 |
| src/lib/whatsapp/resolve-conversation.ts, resolve-conversation.test.ts | Adaptar configuração; manter tenancy/dedupe — T09/T10/T14 |
| src/lib/whatsapp/wa-identity.ts | Adaptar sem confundir phone_number_id Meta e instance/owner Evolution — T09 |
| src/lib/whatsapp/message-status.ts, message-status.test.ts | Adaptar somente estados confirmados; não regridar — T09/T14 |
| src/lib/whatsapp/message-status-sync.ts, message-status-sync.test.ts | Adaptar para fila/evento durável, retirar polling Graph — T09/T14 |
| src/lib/whatsapp/webhook-body.ts, webhook-body.test.ts | Adaptar após payload Evolution observado; casos Graph ficam históricos — T08/T09/T14 |
| src/lib/whatsapp/webhook-signature.ts, webhook-signature.test.ts | Remover HMAC Meta do receptor Evolution; não alegar HMAC sem suporte — T08/T13/T14 |
| src/lib/whatsapp/verify-token.ts, verify-token.test.ts | Bloquear/remover verificação callback Meta; substituir só por auth comprovada — T08/T13/T14 |
| src/lib/whatsapp/mirror-inbound-media.ts, mirror-inbound-media.test.ts | Adaptar download e persistência privada — T09/T11/T14 |
| src/lib/storage/upload-media.ts | Adaptar/revisar reuso do Storage privado — T11 |
| src/lib/whatsapp/encryption.ts, encryption.test.ts | Manter criptografia genérica para segredo Evolution, revisar escopo — T07/T13 |
| src/lib/automations/meta-send.ts, meta-send.test.ts | Wrapper deve delegar ao Core Evolution; limpar nome quando possível; bloquear template — T12/T13/T14 |
| src/lib/automations/engine.ts, engine.test.ts | Dependência transitiva sem match literal; requestId/replay e eco — T12/T14 |
| src/lib/flows/meta-send.ts, engine.ts, engine.test.ts | Adaptar texto/mídia; bloquear interativo/template não contratados — T12/T13/T14 |
| src/lib/flows/dispatch.test.ts, run-integrity.test.ts | Dependência transitiva dos efeitos/replay; manter e adaptar testes — T12/T14 |
| src/lib/flows/types.ts, validate.ts | Remover limites de Meta do validator; bloquear action sem capability — T12/T13 |
| src/lib/ai/auto-reply.ts, auto-reply.test.ts | Adaptar texto; retirar typing Meta; manter policy/handoff — T12/T14 |
| src/lib/interactive.ts, src/components/interactive/interactive-builder.tsx | Bloquear até capacidade/contrato Evolution aprovado; não reaproveitar schema Meta — T12/T13 |
| src/lib/whatsapp/meta-error-explain.ts | Remover explicação Graph; erro Evolution sanitizado substitui — T13 |
| src/lib/whatsapp/meta-error-explain.test.ts | Histórico/teste; não manter asserts de resposta Graph no fluxo local — T13/T14 |
| src/lib/whatsapp/registration.test.ts, waba-pairing.ts, waba-pairing.test.ts | Histórico/remove: registro e WABA não integram QR Baileys — T13/T14 |
| src/lib/whatsapp/template-header-handle.ts, template-header-handle.test.ts | Remover resumable header upload Meta e teste operacional — T13/T14 |
| src/lib/whatsapp/template-body.ts | Bloquear builder de payload Meta — T13 |
| src/lib/whatsapp/template-lifecycle.test.ts | Histórico/teste de aprovação Meta — T13/T14 |
| src/lib/whatsapp/template-webhook.ts, template-webhook.test.ts | Separar atualização de aprovação Meta do webhook de mensagens — T08/T13/T14 |
| src/lib/whatsapp/interactive.ts | Bloquear; imports de INTERACTIVE_LIMITS não devem manter meta-api carregável — T12/T13 |

### UI, v1/MCP, templates/broadcast, config/CI/docs

| Caminho | Classe e tarefa |
|---|---|
| src/app/(dashboard)/inbox/page.tsx | Adaptar leitores/estado para DTO; sem token/ciphertext — T07/T13 |
| src/components/inbox/message-thread.tsx | Adaptar texto/mídia; bloquear reação/template — T10/T11/T13 |
| src/components/inbox/message-composer.tsx | Adaptar ao Core; remover ação não suportada/timeout retry cego — T10/T11/T13 |
| src/components/inbox/message-media.tsx | Adaptar para rota privada, não URL Graph — T11 |
| src/components/inbox/message-reactions.tsx, template-picker.tsx | Bloquear reação/template no UI e rotas — T13 |
| src/components/settings/whatsapp-config.tsx | Adaptar origem Evolution, QR/estado e segredo one-way — T07 |
| src/components/settings/settings-overview.tsx, src/components/dashboard/whatsapp-health-chip.tsx | Adaptar estado; remover métricas Meta inventadas — T07/T13 |
| src/components/settings/template-manager.tsx | Bloquear/hide/deny deep-link — T13 |
| src/components/broadcasts/step1-choose-template.tsx, step2-select-audience.tsx, step3-personalize.tsx, step4-schedule-send.tsx | Bloquear fluxo em UI e endpoints — T13 |
| src/components/dashboard/campaigns-card.tsx | Bloquear/substituir métricas de campanha/templates Meta — T13 |
| messages/en.json, es.json, ko.json, pt.json | Adaptar mesmos IDs de strings para Evolution e recursos bloqueados — T07/T13 |
| mcp-server/src/client.ts, config.ts, index.ts, tools/index.ts | Adaptar registro/roteamento; credenciais não ficam em MCP — T10/T13 |
| mcp-server/src/tools/write.ts | Adaptar escrita para API v1/Core e manter opt-in — T10 |
| mcp-server/src/tools/broadcast.ts | Bloquear e remover ferramenta exposta em discovery — T13 |
| mcp-server/src/tools/read.ts, tools/shared.ts | Manter/revisar helpers e leituras CRM, sem segredo/provider Meta — T09/T13 |
| .env.local.example | Remover META_APP_SECRET/META_APP_ID e knobs de template dry-run; documentar env Evolution — T13 |
| .github/workflows/ci.yml | Adaptar; tirar requisito de segredo dummy Meta — T13/T14 |
| docs/docker.md, docs/whatsapp-connection-troubleshooting.md, docs/multi-waba.md | Atualizar para Evolution ou rotular guias Meta como histórico; não instruir uso local Meta — T13 |
| docs/public-api.md, docs/mcp.md, mcp-server/README.md | Atualizar capabilities e documentar bloqueios API/MCP — T13 |
| src/lib/webhooks/* e src/app/api/v1/webhooks/* | Manter: webhooks de saída do WACRM não são webhooks de entrada do provider — revisar DTO interno em T09/T13 |
| supabase/migrations/* e tabelas históricas Meta | Preservar nesta tarefa; T04.b/T06 decidem persistência nova e compatibilidade |

## Donos por tarefa (adaptação Evolution)

- **T07:** config route/UI, emissão e estado de conexão, QR, health DTO, settings overview, locale.
- **T08:** rota webhook, auth real suportada, cap/parser/queue no contrato T04.b; assinatura HMAC Meta não migra por presunção.
- **T09:** normalização inbound, conversa/identidade, mensagens e estados ordenados, echo, mirror de mídia.
- **T10:** core texto, inbox, rota send, API v1/messages, contacts e MCP write através de um só transporte.
- **T11:** envio/recebimento suportado de mídia, Storage privado, download autenticado, limites e UI.
- **T12:** automations, flows, cron e AI/auto-reply por Core; identidade de replay/dispatch depende de T04.b; bloqueio de ações antigas não suportadas.
- **T13:** remover/bloquear Meta no backend e nas UI/links, rotas de configuração/registro, reactions/templates/broadcast, MCP, env/CI/docs.
- **T14:** busca direta e imports transitivos, testes de “não chamou Graph”, regressão da classificação no mapa; referências em teste/histórico precisam justificativa.

## Pendências/limites

1. O contrato T03 está documentado para Evolution 2.3.7; respostas de boot, QR/status efetivos e payloads de evento permanecem pendentes. Não existem fixtures observadas.
2. T04.b ainda deve decidir account_id ↔ provider connection, unicidade event/dispatch/send attempt e assinaturas SQL/RPC. Este mapa não fecha schema.
3. Reação, template Meta, broadcast em massa, typing e assinatura HMAC de callback continuam bloqueados até haver suporte/contrato justificado.
4. Cron/MCP são entradas de transporte real: devem delegar ao Core e obedecer às mesmas tentativas/limites que inbox/v1.
5. Não houve suite, lint, build, schema/SQL, chamada de API nem boot Evolution.

## Expansão explícita de grupos do scan

Os caminhos abaixo são expansões integrais dos grupos de teste/engine acima; cada um herda classificação e tarefa indicadas:

- Histórico/teste T13/T14: src/lib/whatsapp/broadcast-core.test.ts, src/lib/whatsapp/template-header-handle.test.ts, src/lib/whatsapp/meta-api.media.test.ts, src/lib/whatsapp/meta-api.resumable.test.ts, src/lib/whatsapp/meta-api.typing.test.ts, src/lib/whatsapp/meta-api.test.ts, src/lib/whatsapp/meta-api.recipient.test.ts, src/lib/whatsapp/meta-api.health.test.ts.
- Histórico/teste T08/T13/T14: src/lib/whatsapp/verify-token.test.ts, src/lib/whatsapp/webhook-signature.test.ts, src/lib/whatsapp/template-webhook.test.ts.
- Histórico/teste T09/T10/T14: src/lib/whatsapp/send-message.test.ts, src/lib/whatsapp/resolve-conversation.test.ts.
- Histórico/teste T12/T14: src/lib/automations/meta-send.test.ts, src/lib/automations/engine.test.ts, src/lib/flows/engine.test.ts, src/lib/flows/dispatch.test.ts, src/lib/flows/run-integrity.test.ts, src/lib/ai/auto-reply.test.ts.
- Bloquear/adaptar T12/T13: src/lib/flows/validate.ts, src/lib/flows/engine.ts.
- Remover/histórico T13/T14: src/lib/whatsapp/waba-pairing.ts, src/lib/whatsapp/waba-pairing.test.ts.
- Bloquear T13: src/lib/whatsapp/broadcast-core.ts, src/lib/whatsapp/broadcast-resume.ts, src/app/api/whatsapp/templates/sync/route.ts, src/app/api/whatsapp/templates/sync/route.test.ts, src/app/api/whatsapp/templates/submit/route.ts, src/app/api/whatsapp/templates/submit/route.test.ts.
- Histórico/teste T13/T14: src/lib/whatsapp/template-header-handle.test.ts também cobre os envios de mídia de cabeçalho Meta; não deve ser tratada como prova de mídia Evolution.

**Resultado da verificação:** busca exata atual = 187 ocorrências/69 arquivos; inicial = 325/69. Conjuntos: 65 caminhos em comum, quatro motores/testes transitivos do inicial e quatro locales atuais; todos têm classificação/dono acima. Buscas ampliadas por símbolos de envio, rotas e imports cobrem v1, MCP, cron, automations/flows/IA, UI, mídia, health, templates e broadcasts.
