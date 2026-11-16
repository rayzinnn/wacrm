# Contrato Evolution local — estado parcial

**Status: parcial (Infra.c/T03.b1).** Confirmado no serviço local Evolution API 2.3.7, ARM64, no bootstrap de criação/estado sem conexão. Este documento não declara webhook, QR, envio ou demais capacidades prontos.

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

## Ainda pendente

- Pareamento humano e ciclo de conexão persistente; a observação apenas moveu o estado para `connecting`.
- Eventos/webhook: nenhuma chamada de callback; envelope, autenticação e retries não foram testados no runtime deste Compose.
- Mensagens: nenhum envio; nenhum identificador/response de texto ou mídia observado.
- Logout e delete não foram chamados. A única chamada a connect está descrita acima; estado `connecting` não comprova conexão WhatsApp concluída.
- O schema interno do CRM e correspondência provider-connection seguem para tarefa própria; este documento não fecha RPCs nem migrations do CRM.

## Fontes

- Tag/Release: https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7
- Fonte versionada: https://github.com/evolution-foundation/evolution-api/tree/2.3.7
- Registro oficial imagem Evolution: https://hub.docker.com/r/evoapicloud/evolution-api/tags
- Registro oficial postgres: https://hub.docker.com/_/postgres/tags?name=15.20-alpine3.23
- Registro oficial redis: https://hub.docker.com/_/redis/tags?name=7.4.12-alpine3.22
