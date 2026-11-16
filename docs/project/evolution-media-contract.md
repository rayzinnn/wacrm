# Contrato de mídia Evolution API 2.3.7

## Escopo e confiança

Este contrato descreve o que o checkout fixado `cd800f2976e1e5b682fbf86a01ee4d85ae61f370` aceita e transforma. É inspeção de código, não garantia de entrega pelo WhatsApp. Nenhuma mídia foi enviada ou baixada nesta pesquisa. Capacidades que dependem do Baileys, de limites do WhatsApp ou de conteúdo real permanecem **não comprovadas**.

| Tipo | Envio encontrado no código | Download pelo endpoint | Lacunas relevantes |
| --- | --- | --- | --- |
| Imagem | `sendMedia` com `mediatype: image`; URL/Base64/arquivo multipart. Imagem é decodificada e convertida para JPEG via Sharp. | O downloader genérico inclui `imageMessage`. | Sem limite de bytes/MIME no schema; conversão, imagem grande e MIME final não foram exercitados. O `fileName` pode levar o MIME a ser inferido/reescrito pela extensão. |
| Documento | `sendMedia` com `mediatype: document`; URL/Base64/arquivo multipart; nome necessário para Base64. | O downloader genérico inclui `documentMessage`. | MIME não tem allowlist; nome derivado de URL sem padrão compatível pode falhar; tamanho e formatos aceitos pelo WhatsApp/Baileys não foram comprovados. |
| Áudio | `sendMedia` genérico, ou `sendWhatsAppAudio` dedicado. O dedicado converte por padrão para OGG/Opus e envia como PTT; `encoding:false` pula a conversão, mas ainda marca PTT e declara OGG/Opus. | O downloader genérico inclui `audioMessage`. `convertToMp4` no código converte áudio para MP4, apesar do nome/parâmetro e da documentação pública sugerirem vídeo. | Sem limite de bytes/tempo MIME; conversão depende de FFmpeg e, conforme caminho/configuração, do conversor configurado. Sem prova de compatibilidade/limites de codecs. |
| Vídeo | `sendMedia` com `mediatype: video`; URL/Base64/arquivo multipart. O código define `gifPlayback:false`. PTV tem rota separada. | O downloader genérico inclui `videoMessage` e o tipo PTV mapeia para vídeo. | Não há limite de bytes/duração/resolução no schema inspecionado. `convertToMp4` não converte vídeo neste método. Não foi verificada entrega nem transcodificação. |

“Inclui” significa que a implementação percorre o tipo no código. Não é validação de envio/download ponta a ponta.

## Autenticação, rotas e formatos

- Rotas relativas à raiz da API e ao nome da instância:
  - `POST /message/sendMedia/{instance}` — HTTP 201. JSON com `number`, `mediatype`, `media` (URL ou Base64), e opcionais `mimetype`, `fileName`, `caption`, `delay`, `quoted` e menções; ou multipart com campo `file` e os campos de texto do DTO.
  - `POST /message/sendWhatsAppAudio/{instance}` — HTTP 201. JSON com `number`, `audio` (URL ou Base64) e opção `encoding`; ou multipart com campo `file`.
  - `POST /chat/getBase64FromMediaMessage/{instance}` — HTTP 201. Corpo `{ "message": { ...WebMessageInfo... }, "convertToMp4": false }`. O código também aceita uma referência com `message.key` e busca a mensagem persistida.
- As três rotas passam por guardas de instância existente, instância conectada e `apikey`. A chave global configurada ou o token daquela instância são aceitos no header `apikey`; Bearer não aparece como mecanismo deste guard.
- `sendMedia` aceita somente os quatro valores do enum (`image`, `document`, `video`, `audio`). O schema exige `number` e `mediatype`, mas não impõe formato de MIME, tamanho ou limite de comprimento de `media`.
- O multipart usa Multer `memoryStorage()` sem `limits` configurados na rota. O parser global limita JSON e URL-encoded a 136 MiB; isso **não** é um limite de arquivo seguro nem um limite WhatsApp. Um corpo maior que o parser permitir pode falhar antes do controller.
- O envio retorna o objeto de mensagem preparado pelo serviço. A referência pública de mensagem é `key.id`, acompanhada de `key.remoteJid` e `key.fromMe`; não há ID de mídia separado estabelecido neste fluxo. Para resolver mídia persistida, o endpoint de download usa `message.key` (incluindo `key.id`). A disponibilidade dessa busca depende da persistência local de mensagens.
- Download retorna metadados `mediaType`, `fileName`, `caption`, `size`, `mimetype` e `base64`. A rota chama o método sem `getBuffer`, portanto o campo interno `buffer` fica `null` na resposta JSON normal. A resposta pode ser grande porque contém Base64.

## URL, MIME, limites, erros e timeout

- Para imagem por URL, Evolution baixa a URL via Axios como arraybuffer, depois converte com Sharp para JPEG. Para os outros tipos, repassa URL ao preparador de mídia do Baileys. Não há allowlist de domínio, bloqueio de rede privada ou validação de esquema/origem visível no caminho de envio inspecionado.
- Não há `timeout` explícito nesses `axios.get`, no download Baileys, no fallback, nem na conversão FFmpeg desses fluxos. A política efetiva de redirects fica nos defaults das dependências e **não foi verificada** nesta análise. Não assumir limites de redirects, timeout ou proteção contra SSRF.
- `mimetype` é opcional no schema. Imagem é inicialmente marcada JPEG; em seguida o MIME pode ser derivado novamente do `fileName`. Nos demais tipos, usa MIME informado, inferência por extensão ou, em alguns caminhos URL, o `Content-Type` remoto. Extensão pode prevalecer sobre o MIME declarado. Não há allowlist MIME no contrato de entrada.
- Não foi comprovado limite máximo por tipo, quantidade, resolução, duração, política de aceitação do WhatsApp, nem tamanho máximo aceito pelo Baileys. O valor 136 MiB citado acima pertence ao parser JSON/urlencoded, não à plataforma de mídia.
- Erros de fonte inválida e documento Base64 sem `fileName` viram HTTP 400. Erros dentro do preparo de envio podem virar 500; erros do método de download são convertidos para HTTP 400. A aplicação tem envelope global de erro. Mensagens de dependência podem carregar detalhe interno e não foram exercitadas aqui.
- Download faz uma espera fixa de cinco segundos e uma tentativa alternativa após falha de `downloadMediaMessage`; não foi encontrado deadline global. A alternativa constrói URL `https://mmg.whatsapp.net` a partir de `directPath`. O modo de leitura não confirmou status/resposta do provedor nem URLs expiradas.
- Recomendação para implementação futura (não implementada aqui): baixar mídia por serviço controlado, allowlist HTTPS, validação de DNS/IP e redirects, timeout explícito, limite de bytes durante streaming, MIME por conteúdo, armazenamento privado com URL curta e expirada. Não colocar token Evolution em URL de mídia.

## Evidência no código fixado

Checkout limpo: [Evolution API `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`](https://github.com/EvolutionAPI/evolution-api/tree/cd800f2976e1e5b682fbf86a01ee4d85ae61f370). Referências primárias:

- [Rotas de envio, multipart e status 201](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/sendMessage.router.ts#L20-L100), [montagem `/message` e `/chat`](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/index.router.ts#L217-L220), [guard `apikey`](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/guards/auth.guard.ts#L10-L50).
- [Schema e controller de envio](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/validate/message.schema.ts#L95-L122), [controller `sendMedia` e `sendWhatsAppAudio`](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/controllers/sendMessage.controller.ts#L42-L75), [preparo de imagem/documento/vídeo](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L2746-L2890).
- [Conversão/envio de áudio](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L3206-L3247), [rota e downloader](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/routes/chat.router.ts#L111-L122), [implementação de download e retorno](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts#L3837-L3978).
- [Limite do parser global](https://github.com/EvolutionAPI/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/main.ts#L47-L64).

Documentação pública oficial usada como referência secundária: [OpenAPI v2 publicado pelo projeto Evolution](https://github.com/evolution-foundation/docs-evolution/blob/main/openapi/openapi-v2.json), [send media](https://github.com/evolution-foundation/docs-evolution/blob/main/v2/api-reference/message-controller/send-media.mdx), [send audio](https://github.com/evolution-foundation/docs-evolution/blob/main/v2/api-reference/message-controller/send-audio.mdx) e [get base64 de mídia](https://github.com/evolution-foundation/docs-evolution/blob/main/v2/api-reference/chat-controller/get-base64.mdx). O OpenAPI consultado identifica versão 2.1.1, anterior ao código 2.3.7 fixado. Também diverge da implementação: documenta resposta de download como 200/sem corpo, enquanto o handler 2.3.7 retorna 201 com JSON; descreve `convertToMp4` para vídeo, enquanto o código aplica conversão quando o tipo é áudio. Em caso de divergência, prevalece o código fixado para este contrato.

## Não comprovado / fora do escopo

Não foram feitos POSTs de envio ou download, leitura de mensagens, leitura de blobs, teste com arquivo sintético ou real, teste de MIME/redirect/timeout, nem alteração da instância ou webhook. Assim, aceitação do WhatsApp, IDs efetivamente retornados em runtime, formato de erro de cada falha, limites do provedor/Baileys e resultado de download permanecem **indisponíveis** até ensaios seguros posteriores com mídia sintética.
