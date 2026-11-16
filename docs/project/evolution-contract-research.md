# WACRM T03.a — levantamento Evolution API local

**Status:** levantamento de contrato por código-fonte oficial; sem instalação, serviço local, conexão de WhatsApp ou payload observado.
**Data da pesquisa:** 2026-11-15
**Substituição de escopo:** UAZAPI foi encerrada por instrução do usuário. Não há instância UAZAPI contratada. A infraestrutura Evolution está sendo preparada por Quartzo.

## Recomendação

Fixar a Evolution API **2.3.7**, tag oficial 2.3.7, commit cd800f2976e1e5b682fbf86a01ee4d85ae61f370, imagem evoapicloud/evolution-api:v2.3.7. É uma release estável publicada (não RC); o registro oficial de imagens lista a tag para linux/amd64 e linux/arm64. Para reprodutibilidade, Quartzo deve registrar também o digest retornado no pull efetivo e manter a tag versionada no Compose, sem latest. O digest e a imagem não foram baixados/inspecionados nesta pesquisa.

A imagem oficial desta tag é construída sobre **Node 24 Alpine**. O Compose versionado na mesma tag define **PostgreSQL 15** e **Redis** (latest no upstream). Para ambiente WACRM, recomendar PostgreSQL 15 fixado em patch/digest; Redis como cache do runtime, também fixado em versão/digest pela Infra. Configurar DATABASE_PROVIDER=postgresql, DATABASE_CONNECTION_URI apontando para o serviço Postgres pelo nome DNS da rede Compose, CACHE_REDIS_ENABLED=true, CACHE_REDIS_URI apontando para Redis pelo nome de serviço, SERVER_PORT=8080 e AUTHENTICATION_API_KEY com segredo forte gerado localmente, fora do relatório e do repositório. Publicar a API apenas em 127.0.0.1:8080 durante a preparação local. O arquivo upstream usa volume persistente em /evolution/instances e volumes de dados para Postgres e Redis; manter persistência dos três.

A release não declara campo engines em package.json; a versão efetivamente comprovada para a imagem oficial é Node 24 pelo Dockerfile da tag. PostgreSQL 15 é confirmado pelo Compose. Redis aparece no Compose e a configuração Redis está habilitada no .env.example; portanto, incluir Redis no desenho local mesmo que o backend exponha cache local alternativo. O template também salva dados de instâncias/mensagens no banco por padrão; Quartzo deve decidir os DATABASE_SAVE_DATA_* para o objetivo do WACRM antes do boot.

## Contrato básico confirmado na tag

Todas as rotas abaixo estão na raiz (SERVER_URL, sem prefixo adicional) e recebem apikey: <chave> no header. O guard da tag também aceita token da instância em rotas com :instanceName; para WACRM, usar a chave global em chamadas administrativas/de criação e guardar o hash devolvido, sem gravá-lo em log. As rotas são protegidas por validação de existência e estado da instância, além do guard da chave.

### Criar instância Baileys

POST /instance/create, JSON. O DTO tipa instanceName, integration, qrcode, number, token e configuração webhook. Para Baileys, o valor de integração no enum de runtime é WHATSAPP-BAILEYS. instanceName é obrigatório e não vazio pelo schema. qrcode é booleano; true faz o controller iniciar conexão e aguardar 5 segundos antes de incluir o QR no retorno. O controller cria um identificador e chave/hash, persiste a instância, registra eventos e responde com objeto contendo instance (nome, id, integração e status), hash, webhook, settings e qrcode quando criado/solicitado.

**Divergência do contrato que exige homologação:** InstanceDto tipa integration minúsculo, o schema de instance/create declara opcionalmente a propriedade Integration maiúscula e o controller/runtime lê integration minúsculo. JSON Schema não fecha propriedades adicionais, então minúsculo pode chegar ao runtime sem validação de enum; mandar só Integration maiúsculo não seleciona o driver no controller. Recomendação: depois do boot, validar a criação com o campo integration: "WHATSAPP-BAILEYS" e confirmar a resposta real. Não produzir fixture antes dessa verificação.

### QR e estado de conexão

- GET /instance/connect/:instanceName tenta/reapresenta a conexão/QR; responde o objeto QR quando a instância está conectando ou após a chamada de conexão, ou objeto de estado. O controller espera 2 s no caminho close antes de retornar o QR.
- GET /instance/connectionState/:instanceName retorna { instance: { instanceName, state } }; o tipo usa estados Baileys (p.ex. open, connecting, close) e o código pode retornar estado indefinido quando ainda não há instância ativa.
- O tipo de QR declarado na tag tem campos opcionais count, pairingCode, base64, code. A tag não declara validade/expiração como campo no DTO. Não assumir que base64 sempre virá, nem converter code em QR sem validar.
- QRCODE_UPDATED e CONNECTION_UPDATE estão na enum de eventos para webhook.

### Envio

- POST /message/sendText/:instanceName, JSON: requer number (string) e text (string); opcionais observados incluem linkPreview, delay, quoted, mentioned. O controller retorna o resultado do serviço Baileys. Contrato confirmado em DTO/schema e controller; o objeto de retorno/identificador final será confirmado localmente após envio de homologação.
- POST /message/sendMedia/:instanceName, JSON ou multipart/form-data com campo file: recebe number, mediatype (image, document, video, audio), media (URL ou base64 quando sem arquivo), mimetype, fileName e caption. Schema exige number e mediatype; controller requer arquivo, URL ou base64; documento em base64 precisa de fileName. Resposta é retorno do serviço Baileys, sem schema de resposta fixado nesses arquivos.
- POST /message/sendWhatsAppAudio/:instanceName, JSON ou multipart file: requer number; fonte de áudio por arquivo, URL ou base64. A codificação padrão é habilitada no controller do serviço e transforma para mensagem de voz; validar comportamento/opções na homologação.

**Barreira operacional:** esses endpoints enviam mensagens reais. Não os chamar para teste sem autorização e destinatário de homologação. Especificar o contrato agora; a validação operacional deve usar ambiente/número controlados e autorização explícita.

### Webhook e autenticação

Configuração por instância: POST /webhook/set/:instanceName, JSON { "webhook": { "enabled": boolean, "url": string, "headers"?: object, "byEvents"?: boolean, "base64"?: boolean, "events"?: string[] } }. O schema exige enabled e url; eventos incluem MESSAGES_UPSERT, MESSAGES_UPDATE, SEND_MESSAGE, CONNECTION_UPDATE, QRCODE_UPDATED, entre outros enumerados pelo código. A configuração pode ser fornecida no corpo de criação via DTO (webhook com url, headers, byEvents, base64 e events).

headers é um objeto de cabeçalhos estáticos enviados ao webhook. Não encontrei na tag contrato de assinatura HMAC, timestamp, mecanismo de assinatura/verificação, política de retry ou envelope JSON completo. Recomendação básica: WACRM recebe o webhook somente por URL interna acessível pela rede Compose; Evolution envia um segredo compartilhado em cabeçalho customizado configurado por instância e o WACRM compara em tempo constante, sem colocar segredo em URL. Isso é recomendação de integração, não recurso de assinatura nativo confirmado. Definir resposta 2xx e idempotência no receptor; retry/ordenação precisam ser observados/documentados após boot. Como Evolution estará em container, localhost no endereço do webhook aponta para o próprio container: a URL precisa usar hostname de serviço na rede Compose (ou configuração explícita de host-gateway, se Quartzo optar por esse desenho).

A autenticação para API é apikey, não Authorization: Bearer. O guard verifica chave global do ambiente ou token da instância no header. Segredos só via ambiente/secret store local e nunca no relatório, logs, requests salvos ou fixtures.

## Confirmado na tag vs. validar após boot

| Tema | Confirmado no código/documento da tag 2.3.7 | A validar após boot local (sem inventar payload observado) |
|---|---|---|
| Release/runtime | package.json 2.3.7; Git tag commit cd800f2; Dockerfile node:24-alpine; Compose Postgres 15, Redis, volume /evolution/instances, porta 127.0.0.1:8080 | Imagem/digest realmente baixado, health/readiness, migrações, versão reportada por / |
| Criar Baileys | POST /instance/create, instanceName, runtime integration=WHATSAPP-BAILEYS, opção qrcode, retorno controller tem instance/hash/webhook/settings/qrcode | Discrepância de caixa Integration vs integration; campos presentes/omitidos e estado imediatamente após criar |
| QR | Campos de tipo opcionais count/pairingCode/base64/code; endpoints connect e connectionState; atraso fixo no controller | Qual campo vem preenchido, formato de base64, atualizações/rotação/expiração e sequência real do estado |
| Texto/mídia | Rotas, obrigatórios e entradas descritos em DTO/JSON Schema; aceitação URL/base64/upload e fileName obrigatório para documento base64 | Formato exato de sucesso/erro e identificador de mensagem que devemos persistir em WACRM; limites/tamanho de mídia |
| Webhook | Schema de configuração, eventos enumerados e cabeçalhos customizados estáticos | Envelope e headers reais, ack/status, retries, ordem, duplicatas, base64 de mídia e reachability dentro da rede |
| Segurança | apikey global ou token de instância no header | Segredo local gerado, isolamento de rede, rotação, não exposição externa e teste do header compartilhado do webhook |

Não foi observado servidor Evolution/WACRM, instância, QR, envio, webhook recebido ou resposta HTTP. Não há payloads observados nem fixtures. Nenhuma instalação, conexão, mensagem ou alteração remota foi executada.

## Pendências recomendadas antes da implementação

1. Quartzo confirmar Compose/arquitetura do host, fixar tags/digests para API, PostgreSQL e Redis, rede e volumes persistentes; manter bind da API em loopback durante a fase local.
2. Confirmar com um boot controlado a divergência de integration e gravar resposta de criação sanitizada como evidência observada, separada deste contrato documental.
3. Com autorização e destino de homologação, testar QR, mudança de estado e envio texto/mídia; registrar envelope/response e política de timeout/idempotência, sem reusar dado pessoal real.
4. Decidir formato interno do WACRM para instanceId, credencial hash, estado, id da mensagem, mídia e normalização de telefone; montar adaptador usando apenas resultados observados onde o contrato oficial está incompleto.
5. Definir receptor interno de webhook com validação do segredo customizado, idempotência, tratamento 2xx, limites de payload e eventos mínimos (MESSAGES_UPSERT, CONNECTION_UPDATE, QRCODE_UPDATED).

## Fontes exatas

A análise de contrato foi feita por clone temporário de leitura do repositório oficial, branch/tag 2.3.7, HEAD cd800f2976e1e5b682fbf86a01ee4d85ae61f370. O clone é temporário em /tmp/wacrm-evolution-api-2.3.7.nSYLZU; não integra o projeto WACRM.

- [Release oficial Evolution API 2.3.7](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7)
- [Imagem oficial evoapicloud/evolution-api — tags/digest/arquiteturas](https://hub.docker.com/r/evoapicloud/evolution-api/tags)
- [Dockerfile na tag 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/Dockerfile)
- [Compose na tag 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/docker-compose.yaml)
- [package.json na tag 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/package.json)
- [DTO de instância](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/dto/instance.dto.ts), [schema de criação](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/validate/instance.schema.ts), [router](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/routes/instance.router.ts), [controller](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/controllers/instance.controller.ts)
- [Tipos Baileys/QR/estados/eventos](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/types/wa.types.ts), [inicialização do driver](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/channel/channel.controller.ts), [rotas raiz](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/routes/index.router.ts)
- [DTO de envio](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/dto/sendMessage.dto.ts), [schema de mensagens](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/validate/message.schema.ts), [router de mensagens](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/routes/sendMessage.router.ts), [controller de mensagens](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/controllers/sendMessage.controller.ts)
- [Guard apikey](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/guards/auth.guard.ts)
- [DTO de eventos](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/event.dto.ts), [schema de webhook](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.schema.ts), [router de webhook](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.router.ts)
- [Guia oficial de instalação Docker v2](https://github.com/evolution-foundation/docs-evolution/blob/main/v2/en/install/docker.mdx) e [Compose oficial da tag 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/docker-compose.yaml)
