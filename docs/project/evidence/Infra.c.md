# Evidência Infra.c / T03.b1 — Evolution local

**Data:** 2026-11-15, America/Sao_Paulo
**Escopo:** bootstrap do serviço e homologação de criação/estado somente; T03 permanece parcial.
**Commit T04.a anterior:** 061ae296d4930c5da9e4db98724a91e9f70e90f2.

## Arquitetura fixada

Runtime local Colima/Docker no host Apple Silicon ARM64. Perfil observado: 3 vCPU e 4 GiB; host descrito na evidência Infra.a com 8 GiB. Compose infra/evolution/compose.yaml contém somente Evolution API 2.3.7, PostgreSQL 15 e Redis 7.4, com rede/volumes próprios:

- API: evoapicloud/evolution-api:v2.3.7, digest ARM64 sha256:0e5d84f45b390e1d659500c9a98bfa2a53be28a341fbc0864966b77485f2a0c5.
- PostgreSQL: postgres:15.20-alpine3.23, digest ARM64 sha256:fe048400ca7a5d68f1595ce9c3dc8ef879b40b0398ffd117255c3599210d98f7.
- Redis: redis:7.4.12-alpine3.22, digest ARM64 sha256:52d1ea8a654b10f06af3ecda4e9dbcd035c7868b5c49ee7975de917f81de13db.
- Volumes fixos: wacrm-evolution_instances, wacrm-evolution_postgres e wacrm-evolution_redis; rede wacrm-evolution.
- Só a API publica porta 127.0.0.1:8080. Postgres e Redis não têm host port. Observado em docker inspect: API 127.0.0.1:8080->8080/tcp; DB 5432/tcp e Redis 6379/tcp sem endereço host.
- Limites de memória: API 768 MiB, PostgreSQL 512 MiB, Redis 160 MiB; total máximo configurado 1440 MiB. CPU configurada 1.50 + 1.00 + 0.25 = 2.75 vCPU. Compatível com VM 4 GiB/3 vCPU; docker stats pós-boot mostrou uso baixo (API ~162 MiB, DB ~49 MiB, Redis ~9 MiB).
- Banco/cache separados da stack Supabase iniciada por Quartzo. Nenhuma alteração em supabase/config.toml.

Digests ARM64 consultados no registry oficial com docker manifest inspect --verbose e imagem da API conferida também no Docker Hub. O Compose pinou os manifests ARM64 por digest, não usa latest.

## Segredos e logging

Gerei AUTHENTICATION_API_KEY (administrativa), POSTGRES_PASSWORD e INSTANCE_TOKEN diretamente em infra/evolution/.env; arquivo local é modo 0600 e ignorado pelo padrão .env* do Git. O diretório infra/evolution/private também é ignorado localmente em .git/info/exclude. Nenhum segredo aparece neste documento, fixtures, argumento de processo, saída ou commit.

A chave administrativa só é injetada no container Evolution para bootstrap. Não foi adicionada ao .env.local do CRM; verificação de nome da variável deu falso. INSTANCE_TOKEN fica no .env local e não é injetado no container; foi usado somente pelo cliente local para GET de estado.

Variáveis aplicadas: TELEMETRY_ENABLED=false, integrações opcionais desligadas, LOG_LEVEL=WARN,ERROR e LOG_BAILEYS=fatal. O container final não tem curl apesar de o estágio builder tê-lo; após observação do healthcheck falhando com “curl: not found”, troquei o probe no Compose para Node fetch. Depois disso Evolution, PostgreSQL e Redis aparecem healthy. O nível LOG exclui a chamada logger.log que renderiza QR no terminal; não houve solicitação de QR.

## Homologação observada

- GET público http://127.0.0.1:8080/ retornou HTTP 200, status 200 e version 2.3.7. O objeto público continha clientName, documentation, manager, message, status, version e whatsappWebVersion; zero campos cujo nome contenha token/apikey/hash/secret.
- 57 linhas em evolution_api."_prisma_migrations"; todas com finished_at preenchido e rolled_back_at nulo (consulta agregada retornou 57|t|t).
- GET /instance/fetchInstances antes da criação, autenticado por chave administrativa, retornou lista vazia; arquivo bruto está privado.
- POST /instance/create com instanceName=wacrm-local, integration minúsculo no campo do request ("integration":"WHATSAPP-BAILEYS"), qrcode=false e token restrito da instância retornou HTTP 201. Resposta/runtime confirmou integration=WHATSAPP-BAILEYS e status=close. A resposta contém hash igual ao token fornecido; valor foi removido da fixture sanitizada e preservado somente no arquivo bruto privado.
- GET /instance/connectionState/wacrm-local autenticado com token restrito retornou HTTP 200 e state=close antes e depois da correção do healthcheck/recriação da API.
- GET /instance/fetchInstances com chave incorreta retornou HTTP 401.
- A fixture de criação não contém campo qrcode quando qrcode=false. Não houve chamada a /instance/connect, fetch de QR, login humano, logout, delete ou rota de envio.

Respostas HTTP brutas ficam apenas em infra/evolution/private/*.json, modo 0600, ignoradas pelo Git. Fixtures commitáveis são infra/evolution/fixtures/instance-create.observed.json, instance-state.observed.json e auth-failure.observed.json; hash, token e autenticação foram substituídos/omitidos. Varredura automática contra os três segredos locais passou.

## Comandos de operação

Terminal novo:

source /Users/raymozer/.local/share/wacrm-infra-a/env.sh

Validar/subir a stack (Compose lê .env local para interpolação, sem imprimir seu conteúdo):

docker compose --env-file infra/evolution/.env -f infra/evolution/compose.yaml config --quiet
docker compose --env-file infra/evolution/.env -f infra/evolution/compose.yaml up -d
docker compose --env-file infra/evolution/.env -f infra/evolution/compose.yaml ps

Ver root público/readiness, sem credencial:

curl -fsS http://127.0.0.1:8080/

Parar sem apagar dados:

docker compose --env-file infra/evolution/.env -f infra/evolution/compose.yaml stop

Para GET autenticado de estado, usar helper local que lê INSTANCE_TOKEN diretamente de infra/evolution/.env e envia apikey em memória; não colocar token em argv, shell history ou curl command line. Respostas de diagnóstico devem ser salvas no diretório privado.

## Estado parcial e pendências

Esta evidência cobre apenas bootstrap e criação/estado sem QR. Não fecha o contrato Evolution todo. Continuam pendentes conexão/QR, pareamento humano, webhook/autenticação e envelope de eventos observados, retry runtime, envio texto/mídia, erros de rate limit, payloads pós-conexão e comportamento após recuperação de sessão. Não foi enviada mensagem; a criação com QR desabilitado deixou a instância em close.

## Fontes oficiais e locais

- Release Evolution 2.3.7: https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7
- Fonte Evolution tag/commit: https://github.com/evolution-foundation/evolution-api/tree/2.3.7
- DockerHub Evolution tags/architectures: https://hub.docker.com/r/evoapicloud/evolution-api/tags
- DockerHub PostgreSQL 15.20 Alpine: https://hub.docker.com/_/postgres/tags?name=15.20-alpine3.23
- DockerHub Redis 7.4.12 Alpine: https://hub.docker.com/_/redis/tags?name=7.4.12-alpine3.22
- Revisão técnica local: docs/project/evolution-contract-review.md
- Código fonte clonado em /tmp/wacrm-evolution-api-2.3.7.nSYLZU, HEAD cd800f2976e1e5b682fbf86a01ee4d85ae61f370.
