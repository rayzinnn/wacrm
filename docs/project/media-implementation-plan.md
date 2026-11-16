# Plano de implementação T11 — mídia Evolution

## Decisão e estado

Este plano usa o contrato [Evolution media T03](evolution-media-contract.md), o fluxo atual `messages.upsert` e a implementação T09 já presente. O objetivo é uma mídia inbound durável e privada e, depois de comprovada por tipo, o envio outbound pelo mesmo transporte Evolution.

**Hoje todos os tipos de mídia ficam desativados:** `getEvolutionCapabilities().media` é `[]`. O contrato T03 inspecionou o código 2.3.7, mas não comprovou recebimento, download ou envio ponta a ponta. Imagem, documento, áudio e vídeo só podem sair de `[]` individualmente depois de fixture sintética representativa, validação do resultado do downloader e teste de isolamento/storage. O estado atual ignora mensagens não textuais no normalizador. T11 deve tornar a indisponibilidade explícita no worker/API (`unsupported_media_kind`), sem procurar URL externa nem baixar bytes. Texto continua no fluxo T09.

## Código e persistência atuais

- `src/lib/whatsapp/evolution/events.ts` normaliza `connection.update` e somente mensagens textuais `conversation`; mensagem não textual hoje é ignorada. O evento de mensagem fixa `mediaRef: null`.
- `event-queue.ts` persiste apenas o evento normalizado. `webhook/route.ts` autentica, normaliza e confirma após enqueue; não deve baixar mídia no caminho de ACK.
- `message-worker.ts` reivindica eventos message e chama `apply_evolution_event(id, lease_token)`. O RPC atual só aceita texto. A função SQL também cria contatos/conversas/mensagens e raízes de dispatch transacionalmente; não é o lugar para chamar engines.
- A tabela `evolution_events` já tem `media_state`, `media_storage_path` e `media_type`, com constraint entre `stored` e o path. O RPC atual não usa esses campos para mídia. `messages` já comporta `content_type`, `content_text`, `media_url`, `message_id`, `provider_connection_id` e `media_type`; não há atualmente coluna de path de mídia.
- O bucket existente `chat-media` é **público** e é usado pelo composer/links que o provedor precisa buscar. A migration 043 restringe leituras autenticadas por conta, mas isso não torna o bucket privado: buckets públicos continuam legíveis sem autenticação.
- `src/app/api/whatsapp/media/[mediaId]/route.ts` é hoje um proxy Meta: lê configuração Meta, busca URL de mídia externa e baixa bytes a cada consulta. Para referências Evolution, T11 deve substituí-lo por leitura privada autenticada e nunca fazer fallback para Meta.

## Referência inbound e normalização

O webhook persiste somente uma referência sem URL, token ou bytes. Proposta de forma interna, versionada e validada em runtime:

```ts
type EvolutionMediaRef = {
  version: 1
  key: { remoteJid: string; id: string; fromMe: false }
}
```

Para uma mensagem inbound direta, `remoteJid` deve passar pelo formato JID aceito pelo contrato e `id` deve ser não vazio e limitado em comprimento. Rejeitar grupos, `fromMe`, eventos de saída/API echo e wrappers/tipos que não tenham fixture. Não usar número, URL, nome de instância ou host fornecido no corpo para escolher credenciais ou destino HTTP. A conexão autenticada do evento fornece `connection_id`; o worker carrega a instância e credenciais persistidas no servidor.

O resolver reconstrói a requisição da API Evolution usando a chave, não uma URL recebida:

```json
{
  "message": { "key": { "remoteJid": "…@s.whatsapp.net", "id": "…", "fromMe": false } },
  "convertToMp4": false
}
```

Faz `POST /chat/getBase64FromMediaMessage/{instance}` com `apikey` no header. O nome da instância vem de `whatsapp_connections`; `instance` e origin nunca vêm do evento. O contrato informa que Evolution tenta localizar a mensagem por essa chave e que isso depende da persistência de mensagens da instância. Se o lookup não encontrar mídia, o tipo é indisponível para aquela configuração até comprovação. Não habilitar `convertToMp4`: o código 2.3.7 o aplica a áudio, apesar do nome/documentação divergente.

O formato exato do webhook para cada mensagem de mídia ainda precisa de fixtures sintéticas sanitizadas. Não inferir que todo `messageType` de Baileys mapeia diretamente para `image|document|audio|video`; validar wrappers e os campos de chave contra a fonte 2.3.7 e só normalizar o que as fixtures sustentarem. `mediaRef` não carrega `base64`, `directPath`, URL de CDN, bytes, token nem payload original. MIME, tamanho e filename finais vêm da resposta do downloader, depois de validação; não confiar em metadata não comprovada do webhook.

## Menor sequência de implementação

### 1. Resolver Evolution isolado e testável

Adicionar `src/lib/whatsapp/evolution/media.ts` e `media.test.ts`, sem conectar ainda ao webhook/worker. Implementar `resolveMedia(credentials, mediaRef)` usando a origem permitida já validada por `assertAllowedEvolutionOrigin`, credenciais de `whatsapp_connections` fornecidas somente no servidor, rota fixa e `apikey` em header. Nunca aceitar host, URL, path, nome da instância ou token vindos de argumento não confiável.

- Usar `fetch` com deadline curto e explícito, `AbortController` e `redirect: 'manual'`; falhar em qualquer 3xx, status não 2xx, JSON malformado ou shape inesperado. Não repetir automaticamente o POST de download.
- Ler o corpo com limite durante o streaming (não chamar `response.json()` em corpo ilimitado). Aplicar teto ao JSON/Base64 que considere o overhead de codificação e recusar `Content-Length` maior quando disponível. Decodificar Base64 estritamente/canonicamente, limitar o buffer binário a `16 * 1024 * 1024` bytes e validar que tamanho reportado, Base64 e bytes concordam quando o provedor fornece os campos.
- Exigir tipo esperado e MIME permitido com consistência entre `mediaType`, `mimetype`, extensão e assinatura dos bytes. Rejeitar MIME ausente/desconhecido, mismatch, conteúdo ativo como HTML/SVG e arquivo vazio. Sanitizar filename com `sanitizeFilename`; se não houver nome utilizável, gerar nome a partir do tipo e timestamp, nunca do path enviado pelo cliente.
- SSRF: somente origem exata já persistida e allowlisted; HTTPS em ambiente operado. Rejeitar username/password, query/path na origem e redirect. Resolver e fixar o destino de rede ou usar política de egress que impeça DNS rebinding e IP loopback/privado/link-local/reservado; exceção só para endpoint local literal previamente configurado em desenvolvimento. O fato de uma URL passar por allowlist textual, isoladamente, não é barreira suficiente contra SSRF.
- Retornar bytes e metadados validados, sem logar chave, URL completa, Base64, resposta ou erro bruto: `{ bytes, mimeType, filename, contentType, sha256 }`.

Teto de 16 MiB é limite inicial da aplicação, reaproveitado de `MEDIA_MAX_BYTES`; não declara limite do WhatsApp/Evolution. Qualquer aumento é outra decisão com evidência de memória, proxy, Storage e tipo.

### 2. Integrar normalizador e fila sem baixar no webhook

Estender `NormalizedMessageEvent`/`normalizeWebhook` e seus testes para mídia. Evento continua sem bytes, mas tem `contentType` reconhecido e `mediaRef` versionado acima. Uma repetição do mesmo `(connection_id, event_key)` mantém dedupe. Adicionar fixtures sintéticas para cada envelope/tipo realmente comprovado e para wrappers, eco/fromMe, grupos, ausência de chave, tipo desconhecido e mensagem sem mídia.

`event-queue.ts` enfileira apenas os campos normalizados, com `media_state='pending'` para tipo suportado. Para tipo atualmente desativado, enfileira referência mínima sem texto/caption ou dados de mídia, para o worker persistir falha permanente `unsupported_media_kind`; não marcar como mensagem aplicada e não disparar dispatch. O webhook continua ACK 200 após persistir o evento. Falha de persistência continua 503; nunca responde sucesso antes do enqueue.

### 3. Bucket privado e estágio idempotente

Criar em migration um bucket novo `evolution-media`, separado de `chat-media`: `public=false`, limite de arquivo 16 MiB e allowlist MIME exata dos tipos habilitados. Não mudar a visibilidade ou as policies do `chat-media` (outbound legado/compatibilidade). Em bucket privado, não criar leitura pública nem policy ampla para `anon`/`authenticated`; uploads/reads/deletes da aplicação usam `service_role` somente no servidor. Supabase documenta que bucket privado é o padrão e que service keys bypassam RLS, portanto a autorização manual da rota é obrigatória ([buckets](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [controle de acesso](https://supabase.com/docs/guides/storage/security/access-control)).

Após baixar e validar, upload em caminho determinístico e interno, por exemplo `account-<uuid>/evolution/<event-uuid>/payload.<ext>`. `account_id` vem da conexão no banco; o path não incorpora JID, telefone, texto nem nome recebido. Use o `event.id` UUID como idempotency scope. O objeto não é endereçado por URL pública. Em conflito/replay, verificar tamanho/hash e reutilizar o objeto idêntico; não aceitar silenciosamente bytes diferentes no mesmo path.

O Storage e Postgres não participam da mesma transação. Tratar como saga recuperável: objeto determinístico primeiro; depois RPC SQL com lease token grava `media_state='stored'`, `media_storage_path`, MIME e nome sanitizado. Se o processo cair depois do upload, a retomada com a mesma chave verifica/reaproveita o objeto; não faz outro download se estado/storage validado já estiverem staged. Objetos de eventos definitivamente falhos sem mensagem associada podem ser recolhidos por rotina separada com retenção e regra segura, nunca por limpeza geral.

### 4. Transação final e lease

Migration complementar deve revisar/estender `apply_evolution_event(id, lease_token)` sem mudar sua fronteira de atomicidade: sob lock e lease válido, validar que o evento continua `processing`; validar `mediaRef`, estado `stored`, path pertencente à conta e tipo/campos permitidos; em uma transação criar/resolver contato/conversa, inserir uma única mensagem com `message_id` e `provider_connection_id`, `content_type` e caption, `media_type` MIME e `media_url` interno, atualizar unread/preview e marcar evento `done`. A constraint `(provider_connection_id, message_id)` continua chave de dedupe. Replays retornam duplicate sem novo unread/linha. Tipo inválido ou disabled termina `failed` permanente sem mensagem e sem dispatch.

O path privado reside em `evolution_events.media_storage_path` já existente. A mensagem usa `media_url='/api/whatsapp/media/<event-uuid>'` para a UI atual, e o parâmetro é só um identificador interno; o handler verifica também a associação à mensagem na mesma conta. O event row guarda filename normalizado; se o campo atual for insuficiente, adicionar coluna nullable na migration, não esconder metadata em URL.

O objeto não pode ser apagado junto com falha transitória do RPC. Se `apply_evolution_event` falhar temporariamente, `fail_evolution_event` reprograma o evento mantendo staged media; próxima claim reutiliza objeto e tenta só a transação. `applied`/`duplicate` são concluídos, erro permanente marca failed, erro transitório usa backoff existente, lease stale não pode completar nem modificar evento. Os leases atuais têm 60 segundos no máximo: impor timeout total abaixo do lease ou adicionar heartbeat/fenced-renew RPC antes de trabalhos longos. Qualquer gravação Storage usa path determinístico e a gravação de estado SQL valida `event_id + lease_token + state + lease_until`.

Dispatch roots podem ser criados pela transação, conforme RPC corrente, mas T11 não roda automação, flow ou IA. Nenhuma engine pode ser chamada no caminho de download/upload; testes afirmam que só há raiz durável, se aplicável, sem execução.

### 5. Route de mídia autenticada e resposta

Adaptar `GET /api/whatsapp/media/[mediaId]` para referências privadas Evolution; a rota não chama Evolution/Meta nem retorna URL assinada. Exigir sessão verificada (`auth.getUser()`), perfil/associação da conta e rate limit. Depois, consultar sob `service_role` somente o evento `done`, `media_state='stored'`, path presente, cuja conexão pertence à conta atual e cuja mensagem persistida aponta para aquele event UUID. Acesso inexistente, outro tenant, estado pendente ou ID forjado recebe resposta indistinguível 404. Não aceitar caminho de bucket, URL, connection id ou media ref arbitrário como `mediaId`.

Buscar o objeto privado apenas depois da autorização. Responder com bytes e `Content-Type` validado, `Content-Length`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` e `Content-Disposition` seguro (attachment para documento; inline só para MIME raster/audio explicitamente habilitado). Nunca retornar `base64`, bucket path, URL Evolution, apikey, erros brutos ou signed URL ao browser. Aplicar limite/rate limit também ao download repetido. Vídeo fica desativado enquanto Range/206 e streaming compatível com o player atual não forem implementados e testados.

O browser continua recebendo `media_url` interno e a UI usa a rota autenticada existente para imagem/áudio/documento. A visualização de vídeo só é habilitada depois de comprovar Range ou mudar o player para download completo dentro do teto. Para documento, o response filename deve ser sanitizado e a UI não deve substituir a disposição segura por URL externa.

### 6. Envio outbound (mantido desativado até prova)

Não reutilizar URL pública de `chat-media` como URL que Evolution buscará. Quando um tipo tiver prova suficiente, upload do composer entra por rota autenticada para `evolution-media` e retorna referência local curta, nunca URL pública/signed URL. A rota de envio valida conta, conversa, tamanho, MIME/assinatura, conexão e capability no servidor; lê bytes do Storage privado e chama apenas `POST /message/sendMedia/{instance}` com Base64 e `apikey` no header, para evitar entregar URL de storage ao provedor.

Reservar tentativa de envio com `request_id` estável antes do POST, reaproveitando a estrutura/idempotência de T10. Fazer uma única mutação sem retry automático; timeout após início resulta `unknown`/ambiguous e bloqueia reenvio automático. Só resposta 201 bem formada com `key.id` válido é aceite remota; isso não é prova de entrega. Persistir mensagem local e `externalMessageId` pela RPC/attempt existente sem duplicar. Não guardar chave em erro/log/resposta. Se o fluxo exigir MIME ou formato não provado pela matriz T03, rejeitar `unsupported_media_kind` antes do fetch.

## Tipos e gates de ativação

| Tipo | Estado inicial inbound | Gate para habilitar inbound | Estado inicial outbound | Gate para habilitar outbound |
| --- | --- | --- | --- | --- |
| Imagem | Desativado | Fixture sintética de `messages.upsert`, chave de lookup, MIME/bytes verificados, limite, replay e leitura A/B/anon da rota privada. | Desativado | Teste com mock de multipart/base64, ID `key.id`, MIME/limite e reserva/replay/timeout sem duplicar. |
| Documento | Desativado | Gate inbound + filename seguro, MIME real suportado e `Content-Disposition`; fixture não contém documento pessoal. | Desativado | Gate outbound + nome/MIME final e resposta/ID validados. |
| Áudio | Desativado | Gate inbound + MIME/codec/bytes; sem conversão `convertToMp4`; player e download autenticado validados. | Desativado | Gate outbound; não assumir equivalência `sendMedia` vs `sendWhatsAppAudio`/PTT; validar encoding e resposta. |
| Vídeo | Desativado | Gate inbound + limite e suporte Range/206 no player ou UX explícita de download completo. | Desativado | Gate outbound + limite de duração/resolução/codec documentado e resposta idempotente. |

Ausência de fixture/response realista ou formato não verificável mantém `media: []`. Não usar capacidades inferidas do suporte genérico do Baileys como gate.

## Arquivos e testes do recorte

Arquivos de referência a modificar/adicionar conforme a sequência:

- `src/lib/whatsapp/evolution/{events.ts,events.test.ts,event-queue.ts,event-queue.test.ts,media.ts,media.test.ts,message-worker.ts,message-worker.test.ts,capabilities.ts}`.
- `src/app/api/whatsapp/evolution/webhook/{route.ts,route.test.ts}` e `src/app/api/whatsapp/media/[mediaId]/{route.ts,route.test.ts}`.
- `src/lib/storage/upload-media.ts` ou helper privado server-only novo; evitar mudar sem necessidade o upload público outbound existente.
- Uma migration T11 para bucket privado/policies necessárias, campos de nome/hash se necessários e RPCs fenced de estágio/renew; atualizar `src/types/index.ts` gerado/manual conforme regra do repo.
- UI/composer/media renderer só depois de route/proxy autenticados e capability do tipo; nenhuma ação deve depender só de esconder botão.

Testes focados (antes de ativar qualquer capability):

1. Normalizador: fixtures sintéticas sanitizadas por tipo e wrapper; fromMe/echo/grupo/tipo estranho não produz inbound processável; ref contém só JID/ID/fromMe, nunca URL/bytes.
2. Resolver com `fetch` mock: header apikey, URL construída apenas de origin/instance persistidos, key no corpo; allowlist, DNS/egress, redirect, timeout, status, JSON, Base64, cap de bytes, MIME/magic e filename inválidos rejeitados; nenhum erro contém segredo/payload.
3. Worker/RPC: falha antes do upload não cria objeto/mensagem; crash após upload retoma mesmo path; crash após stage só chama apply; replay não duplica contato/conversa/mensagem/unread; falha transitória retoma; permanente termina failed; lease stale não completa; dispatch engine não executa.
4. Storage/route em ambiente descartável: bucket privado nega anon e Data API direta; user autenticado A lê só mensagem A; B e anon recebem 404; eventId aleatório/forjado e evento pendente falham; headers e filename são seguros; resposta não expõe path/API origin.
5. Saída: mock verifica que nada é enviado antes da reserva, request contém somente uma mídia sob limite, uma chamada em timeout, resposta sem ID não é aceita, `unknown` não dispara repetição, e envio de tipo disabled falha antes do fetch.

Só depois dos testes mock/SQL e da evidência por tipo, executar smoke em instância/local storage com arquivo 100% sintético e destino consentido, separado de qualquer dado pessoal. Nenhuma automação/flow/IA é executada para o smoke T11. Atualizar capabilities apenas para o tipo que concluiu todos os gates.

## Primeiro recorte independente para LUNA

**T11a — resolver de download Evolution puro, com testes de fetch mockado**, em `src/lib/whatsapp/evolution/media.ts` e `media.test.ts`. Entrada: credenciais já resolvidas do servidor + `EvolutionMediaRef` `{version,key}`; saída: bytes limitados e metadata validada. Não conecta ao webhook/worker, não toca Storage/SQL/UI, não ativa `MESSAGES_UPSERT` nem qualquer capability, e não faz chamadas reais. Inclui auth header, rota fixa, redirect/SSRF, timeout, Base64, MIME, nome e erro sanitizado. É independente e produz uma interface segura que T11b pode integrar ao worker após a forma do webhook estar coberta por fixtures. Se o checkout de referências exigir mudança para construir `mediaRef`, essa adaptação fica no recorte T11b, não deve ser escondida dentro do resolver.

## Referências atuais

- Código WACRM: `src/lib/whatsapp/evolution/{client.ts,events.ts,event-queue.ts,message-worker.ts,capabilities.ts,store.ts}`; `src/app/api/whatsapp/evolution/{webhook/route.ts,events/cron/route.ts}`.
- Persistência: `supabase/migrations/20261116045917_evolution_events.sql` (fila, leases e colunas media); `supabase/migrations/20261116181109_evolution_apply_inbound_text.sql` (aplicação atual somente textual); migrations de send attempt e message namespace; `supabase/migrations/039_inbound_media_mirror.sql`, `023_chat_media.sql`, `043_storage_scoped_select.sql` (modelo histórico Meta/público, não copiar para novo bucket).
- UI/Storage: `src/app/api/whatsapp/media/[mediaId]/route.ts`, `src/lib/whatsapp/mirror-inbound-media.ts`, `src/lib/storage/upload-media.ts`, `src/components/inbox/message-media.tsx`.
- Contrato e plano de produto: `docs/project/evolution-media-contract.md`; `docs/superpowers/plans/2026-11-15-crm-whatsapp.md`; `docs/superpowers/plans/2026-11-15-wacrm-execucao.md`, tarefa T11.
- Supabase: [criação e limites de bucket](https://supabase.com/docs/guides/storage/buckets/creating-buckets) e [controle de acesso/RLS](https://supabase.com/docs/guides/storage/security/access-control). Bucket privado não substitui autorização da rota; `service_role` ignora RLS e deve ficar só no servidor.
