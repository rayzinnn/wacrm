# Status WACRM

Escopo vigente: CRM em localhost com Evolution API local, conforme instrução do usuário em 15/11/2026. O adendo `docs/superpowers/plans/2026-11-15-evolution-local.md` prevalece sobre referências UAZAPI nos planos originais, que continuam preservados.

Raiz: `/Users/raymozer/Desktop/Projetos/WACRM`.
Branch: `feat/uazapi-only` (nome original de T01; provedor vigente é Evolution).
Base upstream: `c81299d1488aac02fa584f68d97c2524c1e7a661`.
Backup dos planos: `/tmp/wacrm-t01a-backup.Igl0X9`.

| Recorte | Estado | Evidência e próximo passo |
| --- | --- | --- |
| T01.a/b | Concluído | `evidence/T01.md`; sem colisões, hashes preservados, remotes configurados; commit `75311ba`. |
| Infra.e | Verificação concluída | 6bcfce7; busca de log na imagem local não confirmou a substring da fonte; nenhuma alteração de Compose/container. evidence/T03.logs.md. |
| Infra.d | Concluído | 85f9b1c; hostagent VZ residual recuperado usando a instância existente, nove containers e dados preservados. |
| Infra.a | Concluído | `evidence/Infra.a.md`; ferramentas userland, engine ARM64 e hello-world verificados. |
| T02.a | Concluído | `evidence/T02.a.md`; npm 10.9.9 ci exit 0, lockfile intacto, env 0600 ignorado; commit `6ffae7f`. |
| T02.c — checks | Concluído | `evidence/T02.c-checks.md`; lint 0 com 40 warnings, typecheck 0, 158 arquivos/1.695 testes, build 0 sem Meta; commit `f8ceb06`. |
| Infra.b / T02.b | Concluído | `evidence/Infra.b.md`; 57 migrations verificadas no banco local, Auth HTTP 200, credenciais locais configuradas sem alterar chave de criptografia; commit `9b69cfb`. |
| T02.c — smoke UI | Concluído | `evidence/T02.c-smoke.md`; login/logout real, inbox e isolamento dos registros B nas telas A; commit `2c856a2`. T02 concluído para o baseline local. |
| T02.d — signup | Concluído | Commit `84245f0`; redirecionamento com sessão imediata corrigido. Segundo cadastro entrou diretamente no painel; typecheck e lint afetado passaram. |
| T03.a | Levantamento concluído | `evolution-contract-research.md` e revisão do coordenador em `evolution-contract-review.md`; versão 2.3.7. Não equivale a servidor homologado. |
| Infra.c / T03.b1 | Concluído | `evidence/Infra.c.md`; Evolution 2.3.7, Postgres e Redis fixados por digest ARM64, instância Baileys criada, estado close e auth negativa observados; commit `66674c5`. |
| T03.b2 — QR | Concluído | `evidence/T03.b2.md`; HTTP 200 com PNG/data URL observado, estado close→connecting, nenhum pareamento/envio; commit `025f0fd`. |
| T03.b/c — restante | Parcial | Callback e retry em T03.c1; operador confirmou pareamento e status real conectado. Texto observado em T03.e1; status de entrega e mídia permanecem pendentes. |
| T04.a | Concluído | `transport-map.md`, `evidence/T04.a.md`; 69 caminhos classificados; commit `061ae29`. Revisão: rota Meta antiga 410 e callback Evolution separado. |
| T04.b | Revisão documental concluída | `evidence/T04.b-review.md`; sete achados reconciliados em `9823e63`. RPCs futuras ainda exigem implementação e testes de banco. |
| T04.c | Concluído | `evidence/T04.c.md`; 69 caminhos, zero sem classificação; milestone de sessão aprovado separadamente. |
| T05.a1 | Concluído | `evidence/T05.a1.md`; cliente de estado/QR e origem segura, 32 testes e typecheck; commit `a0b984b`. Texto/mídia ainda não implementados. |
| T06.a1 | Concluído | `evidence/T06.a1.md`; migration real `20261116040603_whatsapp_connections.sql`, isolamento SQL aprovado; commit `ac5ec8f`. |
| T06.b1 | Concluído | `evidence/T06.b1.md`; 17 testes e typecheck, store revisado; commit `b9f3fb9`. |
| T07.a/b | Concluídos | Config `d5911bc` (25 testes), connect/status `ab5bcd8` (31 testes), typecheck; HTTP real e DTOs verificados pelo coordenador. |
| T07.c | Concluído no milestone | Painel `a00a554`; i18n10/10, lint/typecheck; configuração e QR/descarte local em `evidence/T07.manual.md`; pareamento posteriormente confirmado pelo operador e status conectado. |
| T13.a1 | Concluído | `9c4fab2`; endpoints Meta antigos410, guard das rotas novas preservado; 28 testes e typecheck, HTTP real verificado. |
| T13.a2a | Concluído | `f961388`; mutações de templates autenticadas422 sem Graph ou remoção de histórico; 16 testes e typecheck. |
| T03.c1 | Concluído neste recorte | `ae435e2`; callback real autenticado e retry byte-idêntico503→200 em 5.044 ms, probe removida. Horário do provedor não é UTC confiável; usar recebimento do servidor. |
| T05.a2 | Concluído no cliente | `14c4423`; 37 testes, callback fixo e somente CONNECTION_UPDATE. Configuração da principal aguarda receptor durável. |
| T05.b1 | Concluído para conexão | `e9f4c44`; 13 testes; chave estável no replay e occurredAt do receptor. Mensagens/status ainda não normalizados. |
| T06.a2 | Concluído | `1a3bb91`; tabela evolution_events, isolamento SQL e deduplicação por conexão verificados, 59 migrations neste marco. RPCs/dispatch ainda pendentes. |
| T08.a/b | Concluídos | Auth e4d1ccf (9 testes), enqueue 8b47826 (8 testes); sem segredo/payload bruto no evento. |
| T08.c | Concluído para conexão | 478ad63; 14 testes e replay HTTP real com cinco requisições concorrentes/uma linha; evidence/T08.manual.md. |
| T07.b2 / callback principal | Concluído | 2d7f9b5; 26 testes; configuração verificada na Evolution e callback real durável em evidence/T08.activation.md. Sem pareamento. |
| T13.a2b | Concluído | 8133675; reação e broadcast/resume autenticam e retornam 422/no-store sem I/O de negócio/transporte; 9 testes. |
| T06.guard | Concluído | 23faf20; conta com conexão bloqueada ao aceitar convite, conta vazia aceita; testes TS e SQL rollback conferidos. 60 migrations neste marco. |
| T09.c1/c2/c3 | Concluídos para conexão | SQL4401eb8, worker e8fb11f +408 d458c79, cron71af28c; evidência T09.manual.md: token velho40001, recuperação na terceira tentativa, fixture removida. Executor local por minuto ativo. |
| T07.d | Concluído | 6f7f9ef e4d03e40; health/overview/chip usam DTO Evolution, falha de leitura mostra desconhecido. Dashboard verificado no portal. |
| T13.a2c | Concluído | 75dc961; launch/status broadcast V1 retornam422 após autenticação/scopes, sem I/O de negócio. |
| T06.a3 | Concluído | 2b40adf; tabela de tentativas + guarda de convite, SQL rollback e 6 testes da cobertura de convite. 62 migrations; RPC/transporte ainda pendentes. |
| T03.d1 | Concluído documental | 9df1cc9; contrato texto/eventos em fonte fixada; observação posterior em T03.e1. |
| T03 — contrato de mídia | Concluído documental | 87a57a7; código Evolution 2.3.7 fixado inspecionado para imagem/documento/áudio/vídeo, auth, limites e lacunas. Sem envio/download de mídia; capabilities permanecem vazias. Plano T11 em 987abd3. |
| T06.a4 | Concluído | 1b28fd6; namespace por conexão e guard server-side contra vínculo entre contas, SQL e testes focados verificados. |
| T03.e1 | Observação parcial aprovada | 3136e31; único POST201 e callback send.message com mesmo ID; inbound textual do JID verificado, sem marcador de reply; messages.update ausente. Fixtures mínimas revisadas. Não habilita envio no CRM. |
| T05.b2 | Concluído no normalizador | 3c48459; texto inbound individual normalizado com fixture sanitizada, 71 testes focados, lint e typecheck. Ingresso de mensagens ainda não ativado. |
| T06.c1 | Concluído no banco local | ba62823; reserva/conclusão de envio e correção de ordem de locks, SQL rollback-only e concorrência verificados. RPCs não enviam mensagem. |
| T06.c2 | Concluído no cliente | 3140bc8; `sendText` com aceite remoto validado e erro ambíguo sem retry, 71 testes focados, lint e typecheck. Não integrado ao CRM. |
| T08 — fila de texto | Concluído no receptor | d7558bc; webhook autenticado grava somente eventos textuais normalizados, com ACK após persistência e replay deduplicado. Assinatura real MESSAGES_UPSERT continua desativada. |
| T09 — claim por tipo | Concluído no banco local | 2489c05; worker de conexão não reivindica nem terminaliza eventos de mensagem. Migration aplicada e teste SQL rollback-only passou. |
| T10.a | Concluído no adapter | acbd0cc; reserva antes do POST, replay sem novo envio e resultado incerto sem retry, quatro testes mockados e typecheck. Core/rotas/UI ainda pendentes. |
| SIS — plano visual | Concluído no planejamento | ac91167; 23 páginas, 12 subáreas de configurações e fases F1–F8 em `sis-integration-plan.md`. |
| T09 — roots de dispatch | Concluído no schema local | 2801761; raízes únicas por evento/engine/definição, RLS/grants e teste SQL rollback-only. Aplicação transacional e execução ainda pendentes. |
| T09 — aplicação inbound textual | Concluído no banco local | a6d1a53; mensagem, preview/unread, raízes de dispatch e evento são concluídos na mesma transação. SQL rollback-only e corrida em duas sessões passaram; worker de mensagem e assinatura real ainda pendentes. |
| T09 — claim de mensagem | Concluído no banco local | 89edd3d; RPC separada reivindica só eventos textuais, limita lease/tentativas e não interfere no worker de conexão. SQL rollback-only e corrida 6+6 passaram. |
| T09 — worker inbound textual | Concluído no código/local vazio | ed28d60; cron autenticado roda lotes de conexão e mensagem, 21 testes focados e typecheck. Smoke da claim local vazia passou; ativação posterior registrada abaixo. |
| T09 — ativação inbound local | Concluído | 2dff24b; assinatura MESSAGES_UPSERT ativa, ACK/worker/replay sintético provaram uma mensagem e unread=1 sem duplicação; cleanup exato. Oito eventos agregados posteriores estavam done, zero falhas/pendentes, sem leitura de conteúdo. |
| T03 — diagnóstico de logging | Concluído | d87eb42; imagem Evolution original compilada chama `console.log` com o objeto de mensagem antes de emitir `messages.upsert`; motivou a correção local abaixo. |
| T03 — logging corrigido localmente | Concluído na imagem local | 9ad496b; overlay determinístico remove somente o log bruto dos JS/MJS compilados, preserva as emissões e API HTTP 200/instância aberta. Assinatura real ainda desativada até o worker inbound. |
| SIS F1 | Concluído | 421bfa1; tema SIS opt-in, Manrope local, claro/escuro e mobile verificados. Tema padrão legado preservado. F2 shell em execução. |
| SIS F2.a — shell | Concluído | 2ea3386; rail 232/72, topbar, drawer móvel, navegação/atalhos e foco verificados em 1440/1024/768/320. Famílias de telas em execução. |
| SIS F2.b — overlays | Concluído no código | 4dc54fa; diálogos, painéis, menus e popovers acima do rail móvel, com limite de altura/scroll. Lint, typecheck e teste existente passaram; QA visual de overlay pendente para F8 por instabilidade do portal. |
| SIS F3 — Contatos | Concluído no recorte visual | 5e057cf; lista, filtros, ficha e formulários adaptados ao SIS; 70 testes focados, typecheck e lista vazia em SIS claro/escuro. A aparência dos overlays e ficha com dados aguardam F8. |
| SIS F3 — Dashboard | Concluído no recorte visual | f986821; hierarquia, KPIs e estados de carregamento/erro adaptados, lint e typecheck inicial passaram. QA visual com dados reais e 320 px limitado pela instabilidade local; revisar em F8. |
| SIS F3 — Pipelines | Concluído no recorte visual | 6a852d8; board, cartões, formulário, métricas e etapas adaptados ao SIS, QA em 1440/1024/768/320 claro/escuro. Seis testes focados/lint passaram; typecheck final esbarrou no arquivo gerado `.next/dev/types/validator.ts`, repetir em F8. |
| SIS F4 — Inbox | Concluído no recorte visual | 13c5dd3; lista, conversa e contexto em painéis responsivos, guardas/reconciliação preservados. Sete testes focados passaram; QA visual de thread populada e typecheck global aguardam F8. Janela legada de 24h fica para integração T10. |
| SIS F5 — Configurações | Concluído no recorte visual | ff146b1; rail desktop, seletor móvel e doze deep links preservados, incluindo templates indisponível; 5 testes focados, typecheck e QA em 1440/1024/768/320. IA registrada no pacote separado abaixo. |
| SIS F5 — IA | Concluído no recorte visual | 487e857; Playground, configuração, conhecimento e uso adaptados; status visível localizado e atualização após salvar/remover. Testes IA/i18n e lint passaram; QA completo e typecheck final aguardam F8 serializado. |
| SIS F6 — Automações | Concluído no recorte visual | 0a21096; biblioteca, editor e logs adaptados, 56 testes focados e typecheck. Estado vazio e editor em SIS claro/escuro verificados; logs com execução e foco completo aguardam F8. |
| SIS F6 — Fluxos | Concluído no recorte visual | 0cce7d7; biblioteca, criação e editor adaptados ao SIS, 18 testes focados e lint sem erros. Biblioteca vazia e diálogo observados em 1440 px; editor com dados, teclado, mobile e tema escuro aguardam F8. |
| SIS F6 — Notificações | Concluído no recorte visual | 095609a; feed/estado vazio adaptados, 7 testes focados, lint/typecheck. SIS claro vazio observado; modo escuro, mobile e feed populado aguardam F8 após falha do portal. |
| SIS F7 — Auth/convite | Concluído no recorte visual | be8e1bf; login, cadastro, recuperação, reset e convite usam frame SIS responsivo. Teste de callback, lint e QA de formulários em breakpoints passaram; sessão/email/convite válido e typecheck global aguardam F8. |
| SIS F7 — aviso de envio em massa indisponível | Concluído no recorte visual | 9b8f800; aviso adaptado ao SIS e filhos de broadcast seguem desmontados com capability desligada. QA visual autenticado aguarda F8. |
| T10 — core e rotas de texto | Concluído no recorte | ef2090d; texto usa adapter Evolution com chave idempotente, replay sem segundo POST, 44 testes e typecheck. Composer e clientes públicos ainda precisam enviar a chave; capability segue desligada. |
| T10 — consulta de operação | Concluído | c9f69e7; GET autenticado e isolado por conta/conversa, nove testes e typecheck. Nenhum conteúdo ou credencial exposto. |
| T10 — Inbox de texto | Concluído no código | 846126b; chave idempotente salva antes do POST, estado incerto consulta somente GET e não reenvia; 27 testes focados e typecheck. Capability ativada no recorte abaixo; envio real pela UI não foi feito. |
| T10 — MCP de texto | Concluído no cliente | 9711dde; `send_message` aceita só texto e exige chave idempotente estável do chamador, sem retry automático; três testes mockados e typecheck do pacote passaram. Nenhuma mensagem real enviada. |
| T10 — liberação de texto | Concluído no core/rotas | 54bd4e5; `text:true`, resolver API v1 usa conexão Evolution/conta e usuário auditável, reply recusado antes de criar conversa; 158 testes focados. Inbox integrada em 2ed6e08; typecheck/QA final serializados. |
| T10 — Inbox sem janela Meta para texto | Concluído no recorte | 2ed6e08; composer e ação de texto independem das 24h, preservando guards de permissão, capability e operação pendente; oito testes focados e lint sem erros. QA no navegador/typecheck final aguardam F8. |
| T12 — claim de execução | Concluído no banco local | b86aac3; roots de automação/flow/IA têm reserva concorrente com lease/token, SQL rollback-only e corrida 6+6. Ledger de passos adicionado no recorte seguinte; conclusão e execução dos motores ainda pendentes. |
| T12 — ledger de passos | Concluído no banco local | f808363; tabela de passos e vínculo único com logs de automação, RLS/constraints e teste SQL rollback-only. Claim/conclusão de passos e motores ainda pendentes. |
| T12 — reserva/conclusão de passos | Concluído no banco local | daa598f; RPCs com lease/token, chave estável, isolamento por conta e bloqueio de reenvio após reserva; teste SQL rollback-only e corrida de duas sessões passaram. Execução dos motores ainda pendente. |
| T11a — leitura protegida de mídia | Concluído no módulo isolado | 2e1aba4; resolver com origem controlada, limites, MIME/assinatura e erros sanitizados; 21 testes mockados e lint passaram. Sem rede real, Storage, UI ou capability de mídia; DNS/egress e integração continuam pendentes. |
| T13.ui1 | Concluído | e4432c6; navegação e deep links bloqueados, 10 testes i18n/lint/typecheck e portal verificados. |
| T14 — checks do marco | Concluídos neste recorte | evidence/T14.local-milestone.md: 174 arquivos/1.856 testes, lint 0 com 37 warnings, typecheck 0, build 0. Não conclui T14 da migração inteira. |
| T05/T06 restantes, T08–T14 | Pendentes | Eventos, tentativas, envio, mídia, motores e retirada completa do runtime Meta. Sem credenciais Meta configuradas. |
| T15–T16 | Fora desta execução | Sem staging, produção, publicação ou piloto externo nesta solicitação. |

## Operação e decisões

- Ferramentas locais: `source "$HOME/.local/share/wacrm-infra-a/env.sh"`. Perfil Colima `wacrm`; não apagar VM/volumes para parar serviços.
- Host de 8 GiB: VM ajustada a 4 GiB/3 vCPU. Excluir serviços Supabase opcionais e monitorar memória/disco.
- Supabase do CRM e banco Evolution são locais e separados. Nenhum projeto Supabase remoto foi alterado. Sem push ou deploy.
- `.env.local` permanece ignorada e fora dos commits. Não imprimir tokens, chaves, QR ou respostas brutas sensíveis.
- Ruling T01: preservar o blank-at-EOF histórico dos planos para manter seus hashes; exceção documentada no check de whitespace.
- Sessão WhatsApp vinculada pelo operador. T03.e1 fez uma única mensagem autorizada; não repetir essa prova. Aceite HTTP não comprova entrega; envio pelo CRM e persistência de mensagens ainda estão em implementação.

## Retomada em 16/11/2026

O usuário solicitou retomada após os agentes atingirem o limite de uso. Os mesmos três agentes LUNA foram reutilizados no Maestri, preservando as alterações parciais. Verificação fresca: nove containers ativos (oito com healthcheck saudável e REST ativo), CRM HTTP 307 para login, Evolution HTTP 200. Serviços e dados locais foram preservados.

Próxima ação exata: integrar mídia privada e dispatch dos motores, concluir retirada do runtime Meta e verificar localhost em execução serializada. O usuário confirmou pareamento; T03.e1 observa uma única mensagem autorizada, que não deve ser repetida. Motores ainda não foram implementados; não declarar o objetivo inteiro concluído. Na união visual com o SIS, tema, shell, overlays, Dashboard, Contatos, Pipelines, Configurações/IA, Automações, Notificações, Auth, Inbox e Fluxos estão registrados; F8 e QA dos estados com dados seguem em execução.
