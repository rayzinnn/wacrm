# WACRM — execução local com Evolution API

> Decisão do usuário em 15/11/2026: ainda não há serviço UAZAPI; foi autorizada a substituição por Evolution API executada localmente. Este adendo prevalece sobre as referências a UAZAPI nos dois planos originais para a execução atual. Os planos originais e seus backups são preservados.

**Objetivo:** executar o WACRM em `http://localhost:3000`, com autenticação, inbox, contatos e funis persistentes e integração por QR à Evolution API local, sem transporte Meta e sem publicação.

**Arquitetura:** preservar Next.js/React e Supabase do commit `c81299d1488aac02fa584f68d97c2524c1e7a661`. Usar Supabase local para o CRM e Evolution local com seu próprio banco/cache. Uma instância Baileys por conta operacional. O contrato concreto será fixado por versão e comprovado antes dos consumidores; não adaptar payloads UAZAPI por suposição.

## Decisões e limites

- Provedor: Evolution API local, autorizado pelo usuário; nenhum provedor adicional ou fallback Meta.
- Banco: Supabase local, decisão técnica do coordenador para preservar os projetos remotos existentes e manter esta execução local.
- Runtime de containers: preferir ferramentas userland suportadas no macOS, com serviços e volumes próprios do WACRM. Não alterar os bancos de outros projetos.
- Serviços expostos apenas em loopback. Callback da Evolution para o CRM usa caminho de rede local alcançável pelos containers, autenticado e sem túnel público.
- Segredos gerados diretamente em arquivos locais ignorados, com permissões restritas; nunca incluídos em relatório, resposta ou commit. QR e tokens não são logados.
- Operador ainda precisa vincular o WhatsApp pelo QR; a sessão não pode ser considerada conectada por inferência.
- T15/T16 (staging, produção e piloto externo) ficam fora desta solicitação. Testes reais de WhatsApp dependem de vinculação e destinatário definido, sem envios não solicitados.
- Nenhum push, merge ou deploy. Commits locais por entrega verificada.

## Correspondência com o plano original

T01/T02 mantêm a preparação e baseline. T03 passa a fechar o contrato da versão Evolution instalada, incluindo criação local da instância, QR/estado, credencial de instância, webhook e mídia. T04 mantém o inventário completo e o desenho transacional. T05–T14 mantêm os mesmos aceites de deduplicação, isolamento, idempotência, estados incertos, mídia privada, motores e bloqueio Meta.

Nomes de arquivos, rotas e identificadores específicos do novo provedor usarão `evolution`, sem conservar nomes `uazapi` que induzam erro. Os contratos comuns de credenciais/estado/eventos/operações mantêm a semântica; o contrato exato Evolution e a correspondência SQL precisam ser revisados e registrados antes de T05/T06. O allowlist local deverá aceitar somente a origem exata da Evolution provisionada pelo operador, inclusive HTTP de loopback para este laboratório; não liberar HTTP arbitrário nem origens definidas pelo callback.

## Sequência delegada

1. T01.a/b: backup, clone fixado, integração sem colisão, remotes e evidências.
2. Infra.a: runtime de containers local verificado com operação simples.
3. T02.a: npm fixado, instalação por lockfile, configuração local sem Meta real.
4. Infra.b / T02.b: Supabase e dependências Evolution locais em volumes separados; migrations completas somente no banco local novo.
5. T02.c: lint, typecheck, testes, build e login/inbox/contatos/funil locais.
6. T03.a–c: versão/contrato Evolution, instância e fixtures sanitizadas; rever permissões e callback local.
7. T04.a–c: consumidores, schema/RPC/dispatch e cobertura de referências; revisão do coordenador.
8. T05–T14 nos recortes originais adaptados ao contrato Evolution. Nenhuma dependência pendente é marcada como satisfeita.
9. Revisão independente LUNA do diff e verificação do fluxo local. Manter serviços necessários acessíveis e documentar comandos de iniciar/parar.

## Evidências de conclusão

Registrar comandos e resultados em `docs/project/evidence/`, status real em `docs/project/status.md` e instruções em `docs/project/setup.md`. A tela de login isolada não comprova CRM funcional; QR isolado não comprova troca de mensagens. Registrar separadamente o que passou, o que depende do operador e o que está fora desta execução.

## Ruling de execução — 16/11/2026

O bootstrap comprovou criação, autenticação restrita e estado da instância; T03.b2 observa a geração real do QR. O restante de T03 depende de vinculação e de mensagens de homologação. Para permitir que o operador vincule o aparelho pela própria interface, executar primeiro os recortes de sessão abaixo, usando somente seus contratos comprovados. Isso divide dependências por interface; não conclui T03, T05 ou T06 inteiros nem reduz os aceites finais de mensagens.

1. **T05.a1 — cliente de sessão:** tipos C1 com nome Evolution, `getSession(credentials)` e `connectSession(credentials)`, erros sanitizados e allowlist, testes com fixtures observadas de estado/QR/auth. Sem implementação especulativa de envio, normalizador ou mídia.
2. **T06.a1/b1 — conexão:** após a revisão T04.b2, migration gerada pela CLI apenas para `whatsapp_connections`, isolamento real e store criptografado. Eventos, tentativas e dispatch terão suas migrations aditivas nos recortes seguintes, sem editar a primeira migration depois de aplicada.
3. **T07.a/b/c — configuração e QR:** implementar DTO seguro, autorização por conta/papel, rotas de sessão e painel com descarte local de QR. Conta deriva da sessão; nenhum token retorna ao navegador em leitura.
4. Retomar os contratos e recortes de webhook, texto, idempotência, estados, mídia, motores e remoção Meta. T08–T14 continuam obrigatórios antes de declarar a migração concluída.

Durante o marco de sessão, as capacidades de envio permanecem desativadas no DTO e no painel. `text:true` do contrato final C5 só será liberado quando T10 estiver implementado e verificado. Nenhuma configuração Meta fictícia será criada para satisfazer os componentes antigos.

Nomes servidor apenas: `EVOLUTION_ALLOWED_ORIGINS`, com a origem local exata `http://127.0.0.1:8080`, e segredos de worker/webhook apenas quando seus recortes os introduzirem. Timeout de cliente de 15 s; redirect bloqueado; sem retry de mutação. QR é descartado localmente após 20 s, sem alegar validade remota. O runtime do CRM usa token restrito de instância; a chave administrativa continua exclusiva do bootstrap Evolution.

Arquivos previstos para este marco: `src/lib/whatsapp/evolution/{types,client,capabilities,store}.ts` e testes, migration gerada em `supabase/migrations/`, teste SQL de conexão em `supabase/tests/`, configuração existente em `src/app/api/whatsapp/config/`, novas rotas `src/app/api/whatsapp/evolution/{connect,status}/`, painel existente `src/components/settings/whatsapp-config.tsx` e catálogos atuais. O nome de cada migration será o retornado pela CLI instalada.

T13.a1 pode avançar em paralelo: retirar os antigos endpoints Meta de webhook e verify-registration com HTTP 410, sem I/O, credenciais ou validação Meta. Essa retirada não depende de envio/motores; preserva a separação do novo receptor Evolution e atende à escolha explícita de usar somente API não oficial. Não concluir T13 inteiro por esse recorte.

## Marco de callback durável e worker de conexão

O callback CONNECTION_UPDATE comprovado em T03.c1 permite implementar T08 e o processamento de conexão antes dos contratos de mensagens. Seu `date_time` usa hora local serializada com Z na versão fixada; `occurredAt` usa o recebimento UTC do CRM. A identidade do evento usa somente campos públicos fixos e mantém o mesmo hash no retry, sem apikey ou URL. O normalizador de mensagens e o processamento de domínio permanecem pendentes.

T08 autentica headers de conexão/segredo, confere instância, aplica cap de 4 MiB e persiste somente projeção normalizada em evolution_events. ACK 200 só depois da escrita; falha de banco retorna 503. Apenas após teste do receptor, a rota connect poderá configurar o callback fixo do servidor antes de solicitar QR. Não habilitar eventos de mensagem nesse marco.

T09.c1 usará claim/fail com as assinaturas já propostas no schema-contract e uma conclusão específica, `complete_evolution_connection_event(p_event_id uuid,p_lease_token uuid,p_state text,p_checked_at timestamptz) RETURNS TABLE(outcome text)`. A conclusão bloqueia evento, verifica kind connection, token e lease vigente; deriva a conexão da FK, aplica estado somente se checked_at não regredir e marca evento done na mesma transação. Replay terminal retorna duplicate. Os estados aceitos são disconnected/connecting/connected/unknown; o worker consulta getSession fora da transação e passa checkedAt do cliente. Esta RPC específica não substitui nem simula apply_evolution_event para mensagens.

Claim: lote até 10, lease até 60 s, SKIP LOCKED, token novo por aquisição, até 5 tentativas, recuperação após expiração e backoff de 5/15/60/300 s. Grants somente service_role, SECURITY INVOKER e search_path fixo. O worker não envia mensagens. A rota de cron terá exceção exata no middleware e autenticação Bearer própria com segredo somente servidor, retornando apenas contagens; um script local acionará por minuto. Testar concorrência, fencing após reclaim, rollback, retries e isolamento antes de declarar esse marco concluído. As migrations são aditivas geradas pela CLI, preservando os dados reais locais.
