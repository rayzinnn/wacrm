# Status WACRM

Escopo vigente: CRM em localhost com Evolution API local, conforme instrução do usuário em 15/11/2026. O adendo `docs/superpowers/plans/2026-11-15-evolution-local.md` prevalece sobre referências UAZAPI nos planos originais, que continuam preservados.

Raiz: `/Users/raymozer/Desktop/Projetos/WACRM`.
Branch: `feat/uazapi-only` (nome original de T01; provedor vigente é Evolution).
Base upstream: `c81299d1488aac02fa584f68d97c2524c1e7a661`.
Backup dos planos: `/tmp/wacrm-t01a-backup.Igl0X9`.

| Recorte | Estado | Evidência e próximo passo |
| --- | --- | --- |
| T01.a/b | Concluído | `evidence/T01.md`; sem colisões, hashes preservados, remotes configurados; commit `75311ba`. |
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
| T03.b/c — restante | Parcial | Callback de conexão e retry observados em T03.c1. Pareamento, envio e mídia permanecem pendentes; distinguir fixtures observadas de exemplos sintéticos. |
| T04.a | Concluído | `transport-map.md`, `evidence/T04.a.md`; 69 caminhos classificados; commit `061ae29`. Revisão: rota Meta antiga 410 e callback Evolution separado. |
| T04.b | Revisão documental concluída | `evidence/T04.b-review.md`; sete achados reconciliados em `9823e63`. RPCs futuras ainda exigem implementação e testes de banco. |
| T04.c | Concluído | `evidence/T04.c.md`; 69 caminhos, zero sem classificação; milestone de sessão aprovado separadamente. |
| T05.a1 | Concluído | `evidence/T05.a1.md`; cliente de estado/QR e origem segura, 32 testes e typecheck; commit `a0b984b`. Texto/mídia ainda não implementados. |
| T06.a1 | Concluído | `evidence/T06.a1.md`; migration real `20261116040603_whatsapp_connections.sql`, isolamento SQL aprovado; commit `ac5ec8f`. |
| T06.b1 | Concluído | `evidence/T06.b1.md`; 17 testes e typecheck, store revisado; commit `b9f3fb9`. |
| T07.a/b | Concluídos | Config `d5911bc` (25 testes), connect/status `ab5bcd8` (31 testes), typecheck; HTTP real e DTOs verificados pelo coordenador. |
| T07.c | Concluído no milestone | Painel `a00a554`; i18n10/10, lint/typecheck; configuração e QR/descarte local verificados em `evidence/T07.manual.md`. Pareamento ainda pendente. |
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
| T03.d1 | Concluído documental | 9df1cc9; contrato texto/eventos em fonte fixada. Não equivale a resposta observada nem habilita envio. |
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
- Nenhuma sessão WhatsApp vinculada ou mensagem enviada até este registro. QR e teste real dependem do operador.

## Retomada em 16/11/2026

O usuário solicitou retomada após os agentes atingirem o limite de uso. Os mesmos três agentes LUNA foram reutilizados no Maestri, preservando as alterações parciais. Verificação fresca: nove containers ativos (oito com healthcheck saudável e REST ativo), CRM HTTP 307 para login, Evolution HTTP 200. Serviços e dados locais foram preservados.

Próxima ação exata: fechar persistência de tentativas e bloqueios de UI; obter pareamento/número de homologação para observar contratos de mensagens e avançar transporte de texto. Pareamento e número autorizado de homologação foram solicitados ao usuário; continuar o trabalho independente enquanto aguarda. Integração de mensagens e retirada completa do runtime Meta ainda não foram implementadas; não declarar o objetivo inteiro concluído.
