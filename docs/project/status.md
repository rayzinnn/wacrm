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
| Infra.b / T02.b | Concluído | `evidence/Infra.b.md`; 57 migrations verificadas no banco local, Auth HTTP 200, credenciais locais configuradas sem alterar chave de criptografia; commit `9b69cfb`. |
| T02.c — smoke UI | Concluído | `evidence/T02.c-smoke.md`; login/logout real, inbox e isolamento dos registros B nas telas A; commit `2c856a2`. T02 concluído para o baseline local. |
| T02.d — signup | Concluído | Commit `84245f0`; redirecionamento com sessão imediata corrigido. Segundo cadastro entrou diretamente no painel; typecheck e lint afetado passaram. |
| T03.a | Levantamento concluído | `evolution-contract-research.md` e revisão do coordenador em `evolution-contract-review.md`; versão 2.3.7. Não equivale a servidor homologado. |
| Infra.c / T03.b1 | Concluído | `evidence/Infra.c.md`; Evolution 2.3.7, Postgres e Redis fixados por digest ARM64, instância Baileys criada, estado close e auth negativa observados; commit `66674c5`. |
| T03.b2 — QR | Concluído | `evidence/T03.b2.md`; HTTP 200 com PNG/data URL observado, estado close→connecting, nenhum pareamento/envio; commit `025f0fd`. |
| T03.b/c — restante | Pendente | Validar callback, envio e mídia; fechar contrato/fixtures antes dos consumidores. Distinguir exemplos sintéticos de respostas observadas. |
| T04.a | Concluído | `transport-map.md`, `evidence/T04.a.md`; 69 caminhos classificados; commit `061ae29`. Revisão: rota Meta antiga 410 e callback Evolution separado. |
| T04.b | Revisão documental concluída | `evidence/T04.b-review.md`; sete achados reconciliados em `9823e63`. RPCs futuras ainda exigem implementação e testes de banco. |
| T04.c | Concluído | `evidence/T04.c.md`; 69 caminhos, zero sem classificação; milestone de sessão aprovado separadamente. |
| T05.a1 | Concluído | `evidence/T05.a1.md`; cliente de estado/QR e origem segura, 32 testes e typecheck; commit `a0b984b`. Texto/mídia ainda não implementados. |
| T06.a1 | Concluído | `evidence/T06.a1.md`; migration real `20261116040603_whatsapp_connections.sql`, isolamento SQL aprovado; commit `ac5ec8f`. |
| T06.b1 | Concluído | `evidence/T06.b1.md`; 17 testes e typecheck, store revisado; commit `b9f3fb9`. |
| T07.a/b | Em andamento | Quartzo substitui config GET/POST; Âmbar implementa connect/status e erros sanitizados. |
| T07.c | Pendente | Painel Evolution e QR em memória após rotas/store verificadas. |
| T13.a1 | Em andamento | Cedro retira apenas os antigos endpoints Meta de ingresso/registro com HTTP 410; novo receptor permanece separado. |
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

Próxima ação exata: revisar store e rotas do milestone de sessão, implementar o painel e verificar salvamento/QR pela UI. Depois validar pareamento e os contratos restantes de webhook/texto. Integração de mensagens e retirada completa do runtime Meta ainda não foram implementadas; não declarar o objetivo inteiro concluído.
