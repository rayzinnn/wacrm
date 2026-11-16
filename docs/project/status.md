# Status WACRM

Escopo vigente: CRM em localhost com Evolution API local, conforme instrução do usuário em 15/11/2026. O adendo `docs/superpowers/plans/2026-11-15-evolution-local.md` prevalece sobre referências UAZAPI nos planos originais, que continuam preservados.

Raiz: `/Users/raymozer/Desktop/Projetos/WACRM`.
Branch: `feat/uazapi-only` (nome original de T01; provedor vigente é Evolution).
Base upstream: `c81299d1488aac02fa584f68d97c2524c1e7a661`.
Backup dos planos: `/tmp/wacrm-t01a-backup.Igl0X9`.

| Recorte | Estado | Evidência e próximo passo |
| --- | --- | --- |
| T01.a/b | Concluído | `evidence/T01.md`; sem colisões, hashes preservados, remotes configurados; commit `75311ba`. |
| Infra.a | Concluído | `evidence/Infra.a.md`; ferramentas userland, engine ARM64 e hello-world verificados. |
| T02.a | Concluído | `evidence/T02.a.md`; npm 10.9.9 ci exit 0, lockfile intacto, env 0600 ignorado; commit `6ffae7f`. |
| T02.c — checks | Concluído | `evidence/T02.c-checks.md`; lint 0 com 40 warnings, typecheck 0, 158 arquivos/1.695 testes, build 0 sem Meta; commit `f8ceb06`. |
| Infra.b / T02.b | Em andamento | Quartzo prepara Supabase local e cadeia de 57 migrations; credenciais reais ainda devem ser verificadas. |
| T02.c — smoke UI | Não iniciado | Aguardar banco funcional; testar login, inbox, contatos e funil. T02 pai ainda não concluído. |
| T03.a | Levantamento concluído | `evolution-contract-research.md` e revisão do coordenador em `evolution-contract-review.md`; versão 2.3.7. Não equivale a servidor homologado. |
| Infra.c / T03.b1 | Em andamento | Âmbar prepara Compose Evolution/Postgres/Redis próprios e valida criação/estado, sem QR ou envio. |
| T03.b/c | Pendente | Validar callback/QR e fechar contrato/fixtures antes de T05. Distinguir exemplos sintéticos de respostas observadas. |
| T04.a | Concluído | `transport-map.md`, `evidence/T04.a.md`; 69 caminhos classificados; commit `061ae29`. Revisão: rota Meta antiga 410 e callback Evolution separado. |
| T04.b | Em andamento | Cedro fecha schema/RPC/dispatch no código acumulado; revisão do coordenador necessária. |
| T04.c | Pendente | Conferir cobertura final contra schema/contrato Evolution. |
| T05–T14 | Não iniciados | Dependências ainda abertas. O transporte do produto permanece upstream Meta, sem credenciais Meta configuradas. |
| T15–T16 | Fora desta execução | Sem staging, produção, publicação ou piloto externo nesta solicitação. |

## Operação e decisões

- Ferramentas locais: `source "$HOME/.local/share/wacrm-infra-a/env.sh"`. Perfil Colima `wacrm`; não apagar VM/volumes para parar serviços.
- Host de 8 GiB: VM ajustada a 4 GiB/3 vCPU. Excluir serviços Supabase opcionais e monitorar memória/disco.
- Supabase do CRM e banco Evolution são locais e separados. Nenhum projeto Supabase remoto foi alterado. Sem push ou deploy.
- `.env.local` permanece ignorada e fora dos commits. Não imprimir tokens, chaves, QR ou respostas brutas sensíveis.
- Ruling T01: preservar o blank-at-EOF histórico dos planos para manter seus hashes; exceção documentada no check de whitespace.
- Nenhuma sessão WhatsApp vinculada ou mensagem enviada até este registro. QR e teste real dependem do operador.

Próxima ação exata: verificar Supabase e suas 57 migrations; confirmar criação/estado Evolution; revisar o schema proposto; testar autenticação e páginas locais. Não liberar T05 com contrato pendente nem declarar CRM completo pelos checks do baseline.
