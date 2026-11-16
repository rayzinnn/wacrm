# Revisão do coordenador do levantamento Evolution 2.3.7

Fonte conferida: clone `/tmp/wacrm-evolution-api-2.3.7.nSYLZU`, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`.

O relatório T03.a está correto sobre endpoints/header e a divergência Integration/integration. Há, porém, mais contrato disponível no código que não foi lido pelo levantamento inicial:

- `src/api/integrations/event/webhook/webhook.controller.ts`, método `emit`: constrói envelope com `event`, `instance`, `data`, `destination`, `date_time`, `sender`, `server_url`, `apikey`. O último é segredo e deve ser descartado antes de persistência/log. `extra` pode adicionar campos; não confiar neles para autenticação.
- Mesmo arquivo, `retryWebhookRequest`: usa POST Axios e espera resposta; erros HTTP 400/401/403/404/422 não são repetidos. Defaults em `src/config/env.config.ts`: timeout 30000ms, até 10 tentativas, intervalo inicial5s, exponencial até300s com jitter0.2. 503 é transitório. Confirmar no runtime com callback controlado sem dados reais, mas isso já é contrato de implementação versionado, não ausência completa de evidência.
- A API também suporta JWT de webhook por `headers.jwt_key` (gera Authorization Bearer HS256 com validade600s), mas um header estático secreto por instância é suficiente para este laboratório. Não implementar HMAC de corpo que o servidor não envia.
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` linha406 gera QR no terminal por `logger.log`; `src/config/logger.config.ts` controla a saída por LOG_LEVEL. Provisionamento precisa excluir LOG e WEBHOOKS: usar níveis mínimos WARN,ERROR, sem DEBUG/VERBOSE; configurar LOG_BAILEYS ao mínimo suportado. Não pedir QR antes dessa configuração.

Decisões propostas para o contrato do CRM, a fechar antes de T05/T06:

1. Rotas Evolution usam nome da instância. `EvolutionCredentials.instanceId` representa esse nome estável, sem fingir que é o UUID remoto. A UI deve dizer Nome da instância.
2. O CRM usa token restrito da instância, sem chave administrativa global no runtime. Criação da instância é parte do bootstrap local e lê segredo administrativo fora do CRM.
3. Webhook usa headers `x-wacrm-connection` (UUID da conexão CRM) e `x-wacrm-webhook-secret` (segredo aleatório separado). Receiver valida UUID, carrega conexão server-only, compara em tempo constante e correlaciona `payload.instance`. Não confia em server_url/destination/apikey do corpo. Requer `webhook_secret_encrypted` no schema; registrar antes de T06.
4. `configureWebhook(credentials, callbackUrl, webhookSecret, connectionId)` configura esses headers com byEvents=false e eventos mínimos que preservem mensagens e estados. Formalizar a assinatura exata no adendo técnico; não deixar consumidores inventarem argumentos.
5. Allowlist local aceita somente origem exata provisionada (`http://127.0.0.1:8080` se essa for a porta confirmada), além de HTTPS explicitamente permitido. Redirect bloqueado. Callback local é configuração do operador, não parâmetro arbitrário do navegador.
6. Serviço não expõe TTL remoto de QR comprovado. Usar descarte local conservador documentado, sem alegar que é validade remota.
7. Fixtures derivadas de código/schema devem ser identificadas como sintéticas com fonte/commit, separadas de respostas observadas. Conexão e mensagens reais só são aceitas depois de vinculação do operador e teste consentido.
