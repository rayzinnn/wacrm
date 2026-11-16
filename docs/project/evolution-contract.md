# Contrato Evolution local — estado parcial

**Status: parcial (Infra.c/T03.e1).** Confirmado no serviço local Evolution API 2.3.7, ARM64. Bootstrap, callback de conexão e um envio controlado de texto foram observados. ACK durável do fluxo de mensagens no Postgres do CRM e resposta explícita do contato continuam pendentes.

## Build local fixado

- Evolution API 2.3.7 / commit-fonte cd800f2976e1e5b682fbf86a01ee4d85ae61f370 / imagem evoapicloud/evolution-api:v2.3.7@sha256:0e5d84f45b390e1d659500c9a98bfa2a53be28a341fbc0864966b77485f2a0c5.
- PostgreSQL 15.20 Alpine 3.23 @ sha256:fe048400ca7a5d68f1595ce9c3dc8ef879b40b0398ffd117255c3599210d98f7.
- Redis 7.4.12 Alpine 3.22 @ sha256:52d1ea8a654b10f06af3ecda4e9dbcd035c7868b5c49ee7975de917f81de13db.
- Referências Compose em infra/evolution/compose.yaml. API exposta no loopback 127.0.0.1:8080; DB/cache sem portas host. Persistência própria para sessões, Postgres e Redis.
- Ambiente local contém chave administrativa e credenciais locais, permissão 0600; seus valores não pertencem ao CRM, ao Git ou a fixtures.

## Operações observadas

### Root público

GET / retornou HTTP 200, version 2.3.7, sem autenticação. Campos observados: status, message, version, clientName, manager, documentation e whatsappWebVersion. Inspeção de nomes de campos não encontrou token, apikey, hash ou secret. Resposta bruta somente no diretório ignorado privado.

### Criar Baileys sem conectar

Request observado:
POST /instance/create
JSON: instanceName=wacrm-local, integration=WHATSAPP-BAILEYS, qrcode=false, token=<restrito e redigido>

Retorno: HTTP 201; instance.instanceName=wacrm-local; instance.integration=WHATSAPP-BAILEYS; instance.status=close; hash existe e representa a credencial fornecida, mas é segredo. Na serialização da resposta com qrcode=false não veio propriedade qrcode. A fixture de criação substitui request.token e response.hash por marcador redigido e mascara instanceId.

A evidência valida que integration minúsculo é lido pelo runtime apesar da propriedade Integration maiúscula declarada no schema da tag. Os arquivos brutos ficam em infra/evolution/private e não devem ser copiados para logs/tickets.

### Estado com credencial restrita

GET /instance/connectionState/wacrm-local, header apikey com o token restrito daquela instância, retornou HTTP 200:
instance.instanceName=wacrm-local
instance.state=close

A chamada não usou chave administrativa. O estado close permanece depois da recriação da API para ajustar healthcheck.

### Erro de autenticação

GET /instance/fetchInstances com chave intencionalmente inválida retornou HTTP 401 Unauthorized. A chave enviada não é preservada na fixture nem no relatório.

## Persistência/readiness observados

- 57 migrations Prisma na tabela evolution_api."_prisma_migrations"; todas finalizadas e nenhuma revertida.
- Healthcheck Compose final passou em API/Postgres/Redis. A primeira versão usava curl, ausente na imagem final; foi substituída por Node fetch, incluído em Node 24.
- Limites: API 768 MiB/1.5 CPU; Postgres 512 MiB/1 CPU; Redis 160 MiB/0.25 CPU (total 1440 MiB e 2.75 CPU). Dados observados pós-boot: API ~162 MiB, Postgres ~49 MiB e Redis ~9 MiB.
- Telemetria e integrações opcionais estão desativadas; LOG_LEVEL=WARN,ERROR; LOG_BAILEYS=fatal. Assim logger LOG e WEBHOOKS não são habilitados; o bootstrap não consultou QR nem conectou WhatsApp.
- O API admin key está no container Evolution porque a API o usa para auth global, mas não está em .env.local do CRM. INSTANCE_TOKEN não é injetado no container; permanece somente no env local e no uso pelo helper local. Respostas brutas continuam privadas.

## Fixtures observadas sanitizadas

- infra/evolution/fixtures/instance-create.observed.json
- infra/evolution/fixtures/instance-state.observed.json
- infra/evolution/fixtures/auth-failure.observed.json

As fixtures vieram de chamadas HTTP locais reais neste boot. Removem credenciais e hash; não devem ser usadas como evidência de QR, conexão, webhook ou envio.

## QR — observação local T03.b2 (parcial)

- Uma chamada GET `/instance/connect/wacrm-local` com a credencial restrita da instância retornou HTTP 200 na primeira tentativa. O corpo observado tinha os campos de topo `pairingCode` (null), `code` (string), `base64` (string) e `count` (number; valor 1). Os conteúdos de `code` e `base64` são material QR e permanecem somente no arquivo bruto privado, ignorado pelo Git e modo 0600; não devem ser copiados para logs, terminal, tickets ou fixtures.
- Estado consultado imediatamente antes: `close`; após a chamada: `connecting` (ambas HTTP 200). Nenhum aparelho foi pareado e nenhuma mensagem foi enviada. Não houve segunda chamada de geração porque a primeira retornou QR.
- Logger do container conferido em runtime: `LOG_LEVEL=WARN,ERROR`, `LOG_BAILEYS=fatal`; nenhuma variável `LOG`, `WEBHOOKS`, `DEBUG` ou `VERBOSE` estava definida. A configuração deixa fora a saída `LOG` usada para QR no terminal.
- Fixture sanitizada: `infra/evolution/fixtures/instance-connect.observed.sanitized.json`, junto com `infra/evolution/fixtures/qr-synthetic-placeholder.png`. Mantém somente tipos observados e o contador, substitui conteúdos sensíveis, e aponta para um PNG sintético marcado “SYNTHETIC PLACEHOLDER / NOT A QR CODE”; a imagem não é saída do Evolution.
- Política local para implementação futura: tratar QR como dado efêmero e descartar do estado/memória/UI local após no máximo 20 segundos, inclusive ao substituir por um QR novo ou sair do fluxo. Esse é um limite conservador do WACRM, ainda não implementado. A API Evolution não forneceu TTL remoto; não inferimos expiração no servidor.
- Resposta bruta, estado posterior e estado anterior estão em `infra/evolution/private/`, ignorado e modo 0600; nunca são fixtures compartilháveis.

## Webhook de conexão — observação local T03.c1

- Uma instância temporária `wacrm-probe-*` foi criada pelo roteiro local com Baileys e `qrcode=false`; não foi pareada. Somente `CONNECTION_UPDATE` foi habilitado, com `byEvents=false`, `base64=false`, URL temporária por `host.lima.internal` e cabeçalhos próprios de correlação e segredo. O receptor ficou vinculado a `127.0.0.1` no host; o container Evolution alcançou seu healthcheck HTTP 204.
- `GET /webhook/find/:instanceName` confirmou a configuração da probe. O callback real chegou como `event=connection.update`; envelope observado continha `event`, `instance`, `data`, `date_time`, `destination`, `server_url` e `apikey`. `data` continha `instance` (string), `state` (string) e `statusReason` (number). Valores de `apikey` e URLs foram redigidos/substituídos na fixture.
- O `date_time` do envelope foi `2026-11-16T01:55:08.581Z`, enquanto o receptor registrou a primeira chegada em `2026-11-16T04:55:08.512Z`. A fonte fixada `cd800f2976e1e5b682fbf86a01ee4d85ae61f370` em `src/api/services/channel.service.ts` calcula `new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString()` antes de emitir `dateTime`; o container reportou `America/Sao_Paulo` e offset `180` minutos. Isso confirma que o `date_time` observado é hora de parede local serializada com sufixo `Z`, três horas atrás do relógio UTC do receptor; não é timestamp UTC confiável. Para normalizar eventos de conexão, usar `receivedAt` atribuído pelo servidor receptor como horário confiável e manter `date_time` apenas como dado de origem/diagnóstico.
- O receptor rejeitou segredo incorreto e ID de conexão incorreto com HTTP 401, e instância divergente com HTTP 409. No callback real, a primeira tentativa recebeu HTTP 503; após 5.044 ms, o provedor repetiu os mesmos 353 bytes e recebeu HTTP 200. A igualdade foi verificada diretamente nos bytes em memória; os dois registros também tiveram SHA-256 igual. Não houve outro payload entre essas tentativas.
- A chamada de connect da probe retornou HTTP 200; os bytes de resposta, que poderiam incluir material QR, foram descartados sem leitura/registro. Estado observado antes: `close`; depois: `connecting`. Nenhum aparelho foi pareado e nenhuma mensagem foi enviada.
- Cleanup da probe: webhook desabilitado (HTTP 201), instância exata removida (HTTP 200), ausência confirmada no inventário. `wacrm-local` permaneceu `connecting` antes/depois; serviços locais mantiveram status/health/restart-count do snapshot.
- Bruto do primeiro callback fica somente em `infra/evolution/private/T03.c1-*/callback-first-attempt.json`, diretório 0700 e arquivo 0600, ignorado pelo Git. Fixture sanitizada: `infra/evolution/fixtures/connection-update.observed.sanitized.json`; roteiro: `infra/evolution/verify-callback.py`.
- Limite: isso verifica o formato do callback e o retry HTTP do Evolution 2.3.7. O HTTP 200 foi respondido pelo receptor de teste; não houve ingestão/ACK transacional ou persistência no Postgres do CRM. Não demonstra entrega de outros eventos, webhook de mensagem, mídia, recuperação após reinício nem funcionamento com dispositivo pareado.

### Normalização `CONNECTION_UPDATE` — T05.b1

- Interface: `export type NormalizedEvent = { kind: "connection"; eventKey: string; occurredAt: string }` e `normalizeWebhook(payload: unknown, receivedAt: string): NormalizedEvent[]`.
- `receivedAt` é o timestamp ISO UTC canônico criado pelo receptor; nunca é lido do payload. Para `connection.update`, valida-se o envelope e `data` observados: instância de topo não vazia, `data.instance` não vazia e idêntica, `data.state` string e `date_time` string não vazia. Entrada/horário inválidos lançam `NormalizationError` genérico, sem incluir conteúdo recebido.
- Só `connection.update` é normalizado neste recorte. Eventos desconhecidos retornam `[]`; isso não habilita suporte a mensagens. A saída usa `occurredAt=receivedAt`.
- A identidade é `sha256:` + SHA-256 de JSON com campos e ordem fixos `{event, instance, state, providerTime: date_time}`. Ela não inclui `receivedAt`, `apikey`, `destination` ou `server_url`; portanto replay do callback mantém a mesma `eventKey`. O `date_time` do provedor contribui somente para identidade e nunca é convertido/corrigido como relógio. Usar o `receivedAt` do receptor como horário normalizado de conexão conforme a fonte/runtime observados em T03.c1.
- Evidência e testes literais: `docs/project/evidence/T05.b1.md` e `src/lib/whatsapp/evolution/events.test.ts`, usando `infra/evolution/fixtures/connection-update.observed.sanitized.json`.

## Callback principal integrado — T08

Após a validação de T08.a/b/c, a rota connect configura o webhook com a credencial restrita e o segredo independente do registro. A verificação real do coordenador confirmou a configuração por GET /webhook/find e um callback da principal persistido em evolution_events, somente com kind/eventKey/occurredAt. Evidências: evidence/T08.manual.md e evidence/T08.activation.md. O receptor só retorna 200 para evento conhecido após await da escrita; erro de banco retorna 503 (caso testado com double). Somente CONNECTION_UPDATE está habilitado. O descarte local de QR em 20 s já foi implementado e verificado no painel em T07.manual; isso não é TTL remoto.

O callback da principal está ativo. Seu processamento de conexão foi integrado; o fluxo de mensagens não está habilitado no CRM. T03.e1 observou a sessão `open` antes e depois de um envio local único, sem habilitar capability ou alterar consumidores.

## Envio controlado de texto e eventos — T03.e1

- Com estado `open` consultado por token restrito, uma única consulta `whatsappNumbers` confirmou o destinatário direto informado pelo operador e seu JID individual. Foi feito um único `POST /message/sendText/:instanceName` com o texto de teste acordado; HTTP 201 retornou `key.id`, JID correspondente, `fromMe=true`, `messageType=conversation`, status `PENDING` e `messageTimestamp` numérico em segundos UNIX.
- O callback `send.message` chegou primeiro e seu `key.id` correspondeu ao da resposta. Aproximadamente 2,1 s depois, `messages.upsert` trouxe outro ID, `fromMe=false`, com `key.remoteJid` exatamente igual ao JID validado, `messageType=conversation`, status `DELIVERY_ACK` e conteúdo não vazio redigido. Seu `messageTimestamp` (segundos UNIX) é posterior ao início do POST e fica a 891 ms de `receivedAt`; registro como inbound do peer validado, sem classificá-lo como reply do teste ou correlacioná-lo ao envio pelo ID.
- Não chegou `messages.update` nem texto inbound `WACRM-TESTE` na janela de cinco minutos. Seis itens de callbacks continham `@lid` sem correspondência inequívoca com o JID da consulta; não foram associados ao destinatário nem armazenados. Nenhuma fixture foi criada para eventos ausentes.
- Um proxy temporário em loopback recebeu somente eventos do JID testado, autenticou com os dois headers independentes existentes, limitou corpos a 4 MiB e fez fsync dos callbacks-alvo antes de responder 200. `CONNECTION_UPDATE` foi encaminhado à URL original do CRM; a verificação desta tarefa não afirma nova persistência de conexão. A configuração original foi restaurada e confirmada por `GET /webhook/find`; estado final permaneceu `open`.
- Fixtures: `infra/evolution/fixtures/text-send.observed.sanitized.json`, `message-send.observed.sanitized.json` e `message-upsert.observed.sanitized.json`. Mantêm o domínio observado `@s.whatsapp.net` com peer placeholder e a projeção mínima de contrato; removem integralmente `contextInfo`/`messageContextInfo`, incluindo `messageSecret` e metadados/hashes de device. Logo, não servem para validar esses metadados criptográficos. Número e IDs reais, headers, URLs, nomes e texto inbound foram redigidos/removidos. Corpos brutos, journal e backup exato do webhook permanecem privados em arquivos 0600 ignorados pelo Git.
- HTTP 201 e `send.message` não provam entrega. O status `PENDING` da resposta não foi promovido a `sent`; o `DELIVERY_ACK` do upsert pertence a um ID diferente. Não houve retry, outra mensagem, mídia, logout, delete, connect, QR ou mudança de capability/CRM/banco/normalizador.

## Ainda pendente

- Recuperação da sessão pareada após reinício e ciclo de reconexão; T03.e1 observou `open` antes e depois da janela, mas não testou reinício.
- Outros eventos/webhook: `send.message` e `messages.upsert` foram observados para o teste; `messages.update`, mídia, replay/retry de mensagens e demais eventos continuam pendentes.
- Mensagens: um envio de texto foi observado em T03.e1; reply esperado e ACK durável da mensagem no CRM seguem pendentes. Mídia não foi observada.
- Na instância principal, logout/delete não foram chamados. O connect e a remoção limitados às probes temporárias estão descritos acima; estado `connecting` não comprova conexão WhatsApp concluída.
- O schema interno do CRM e correspondência provider-connection seguem para tarefa própria; este documento não fecha RPCs nem migrations do CRM.

## Fontes

- Tag/Release: https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7
- Fonte versionada: https://github.com/evolution-foundation/evolution-api/tree/2.3.7
- Registro oficial imagem Evolution: https://hub.docker.com/r/evoapicloud/evolution-api/tags
- Registro oficial postgres: https://hub.docker.com/_/postgres/tags?name=15.20-alpine3.23
- Registro oficial redis: https://hub.docker.com/_/redis/tags?name=7.4.12-alpine3.22
