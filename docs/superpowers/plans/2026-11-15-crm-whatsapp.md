# WACRM — plano de projeto e contexto para execução

> **Para agentes:** usar `superpowers:executing-plans`, executando uma tarefa por vez de [2026-11-15-wacrm-execucao.md](2026-11-15-wacrm-execucao.md). Marcar caixas somente com evidência. Subagentes são opcionais quando autorizados; este plano não depende deles.

**Objetivo:** adaptar o WACRM open source para um CRM comercial de WhatsApp conectado por QR exclusivamente a uma API não oficial, começando com uma equipe e um número.

**Arquitetura:** preservar contatos, inbox, negócios, funis, autenticação e permissões do WACRM. Substituir o transporte Meta por um cliente UAZAPI no servidor e converter seus eventos para o modelo interno do CRM. Reutilizar Supabase para persistência, sem reconstruir o CRM nem criar uma plataforma genérica de provedores.

**Stack verificada na referência:** Next.js `16.3.8`, React `19.2.4`, TypeScript, Tailwind CSS 4, Supabase/Postgres/Auth/Storage; Node `>=22.12.0`, npm `10.9.9`, Vitest. Preservar o lockfile.

**Especificação:** contexto, escopo, restrições e aceites deste documento constituem a especificação. O guia de execução define tarefas e contratos propostos para implementá-la.

**Revisão:** 15/11/2026. Estado: planejamento; nenhuma implementação, contratação, criação de infraestrutura ou implantação realizada nesta revisão.

## 1. Contexto independente do histórico do chat

O usuário quer um CRM de WhatsApp baseado em projeto open source, evoluindo para um fluxo semelhante ao Kommo. A referência inicial é o [vídeo da Thalena](https://www.youtube.com/watch?v=DiLh9xk670w), cuja transcrição foi fornecida no chat anterior. O repositório indicado pelo próprio usuário é [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm). **DeskcommCRM e WAHA apareceram num rascunho anterior e não são a base deste projeto.**

Uma correção explícita do usuário rege todo o trabalho: **não usar a API da Meta; usar uma API não oficial**. O vídeo mantém os dois canais em paralelo; neste projeto não haverá esse funcionamento nem fallback para Meta.

UAZAPI é a candidata registrada no plano anterior/contexto do tutorial. Contratação, modalidade e versão do servidor ainda não estão confirmadas. T03 valida esse contrato; não substituir por outra API por conta própria. O usuário quer delegar a implementação: decisões técnicas rotineiras cabem ao executor. Conta proprietária, serviço pago, domínio, credenciais e número precisam de informação real. Nunca inventar acesso ou marcar dependência externa como resolvida.

“Semelhante ao Kommo” indica direção de produto, não paridade de funcionalidades. O primeiro corte será aceito pelo fluxo comercial e testes abaixo. Melhorias adicionais dependem do piloto.

## 2. Estado real e referência reproduzível

- `/Users/raymozer/Desktop/Projetos/WACRM` contém documentação em `docs/`; ainda não contém o produto nem repositório Git. **A pasta não está vazia.**
- Esta revisão leu `/tmp/wacrm-reference` no SHA `c81299d1488aac02fa584f68d97c2524c1e7a661`. A pasta temporária não é dependência para futuros executores.
- T01 busca esse commit e registra SHA completo. Não trocar por `main` móvel sem revisar o diff e atualizar o plano.
- Há 57 arquivos de migrations na referência. Quantidade não equivale à última versão; prefixos não precisam ser contíguos. Não executar “as primeiras 23” do vídeo nem inventar o próximo número.
- O produto declara MIT; preservar LICENSE/avisos e conferir no commit usado.
- O README anuncia inbox, contatos, tags/campos, funis/negócios, automações, fluxos, IA, dashboard e equipe. Isso é inventário declarado, não prova de funcionamento na nossa instalação.
- `AGENTS.md` exige consultar os guias da versão instalada em `node_modules/next/dist/docs/` antes de alterar código Next.js.
- Scripts confirmados: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Instalação: `npm ci`.
- O catálogo pt-BR usa **`pt`**, em `messages/pt.json`, e `NEXT_PUBLIC_APP_LOCALE=pt`. Não criar catálogo `pt-BR` paralelo.

Fontes: [produto e README](https://github.com/ArnasDon/wacrm), [commit de referência](https://github.com/ArnasDon/wacrm/tree/c81299d1488aac02fa584f68d97c2524c1e7a661).

## 3. Considerações da revisão

| Problema do plano anterior | Correção |
| --- | --- |
| Fases amplas, como “implementar cliente” | Tarefas com ID, arquivos, dependências, entradas/saídas, verificações e aceite. |
| Clone numa pasta que já contém `docs/` | Preparação preserva documentos e verifica colisões. |
| Decisões de API misturadas com execução | T03 produz contrato versionado antes do transporte. |
| Troca concentrada na inbox | Inventário inclui automações, fluxos, IA, mídia, saúde, API pública e cron. |
| SQL “reversível/idempotente” sem estratégia | Migration registrada uma vez; reversão operacional por código compatível e backup testado. Não presumir que SQL upstream pode ser repetido. |
| Ocultar controles poderia parecer suficiente | Rotas, motores e cron também bloqueiam capacidades indisponíveis. |
| Timeout de envio pouco especificado | Persistir resultado incerto e impedir retry automático. |
| QR conectado usado como prova ampla | Conexão, recebimento e envio têm provas independentes. |
| Evolução Kommo sem limite verificável | Aceite objetivo do primeiro corte e backlog posterior. |

**Veredito:** o documento anterior era um bom roteiro geral, mas insuficiente como instrução autônoma para LUNA. O guia agora fixa ordem e contratos internos propostos. Sem servidor/versão UAZAPI e exemplos de payload, ainda não é possível prometer um adaptador correto. T03 resolve essa dependência e impede suposições silenciosas.

## 4. Escopo e decisões

### Primeiro corte

1. Uma instalação para operação própria, uma equipe e uma conexão UAZAPI por conta operacional. Preservar isolamento entre contas; testar contas A/B mesmo sem vender um SaaS.
2. Owner/admin configura; atendente autorizado envia; viewer consulta. Nenhum recebe tokens nas respostas da aplicação.
3. Conexão/reconexão por QR, estado real, expiração e desconexão.
4. Conversas individuais: texto recebido, resposta pela inbox e pela API pública existente, persistência e estados comprovados.
5. Texto é o primeiro incremento. Imagem, documento, áudio e vídeo entram antes do aceite final quando comprovados na matriz T03; cada tipo exige teste próprio. Ausência de suporte fica documentada e a ação é bloqueada, sem simular envio.
6. Preservar contatos, deduplicação, atribuição, negócios, funis, notas, papéis e atualização da inbox. Preservar pausa/handoff existente quando o humano intervém.
7. Adaptar texto/mídia suportada nos motores existentes. Templates aprovados Meta, broadcasts, reações, interativos e indicadores exclusivos Meta ficam indisponíveis neste corte; ações antigas incompatíveis falham explicitamente no servidor.
8. Staging HTTPS, regressão, piloto pequeno, backup e recuperação testados antes de clientes reais.

### Fora deste corte

Múltiplos números, outros provedores, grupos, importação completa de histórico do WhatsApp, campanhas em massa, paridade total com Kommo, produto SaaS e novas funções de IA. IA existente pode permanecer se passar na regressão; não contratar modelos nem habilitar autorresposta por padrão só para demonstrar a integração.

### Propostas técnicas desta revisão

São escolhas do revisor para reduzir ambiguidade, não requisitos expressos pelo usuário:

- Instância previamente criada no provedor; o CRM conecta essa instância. Criação administrativa pelo CRM fica adiada, evitando `admintoken` no runtime.
- Credenciais novas em `whatsapp_connections`, lida somente pelo backend. Manter tabelas/histórico Meta sem uso operacional; não reutilizar `phone_number_id` como ID UAZAPI.
- Cliente concreto UAZAPI com contrato pequeno, sem registry de provedores ou fallback.
- Eventos em caixa durável no Postgres, com processador autenticado periódico na hospedagem. Confirmar persistência antes do ACK; não depender de Promise solta após resposta HTTP. Validar esse comportamento com o servidor contratado em T03/T15.
- Envios com chave estável de operação e tentativa registrada; resultado incerto bloqueia retry automático.
- Hospedagem aberta. Usar acesso já disponível quando compatível; Hostinger é referência do vídeo, não contratação ou escolha fechada.

## 5. Restrições globais

- Somente UAZAPI no runtime WhatsApp final. Não configurar credenciais Meta nem chamar Graph API. Código histórico, testes e migrations podem citar Meta; a proibição é de dependência operacional.
- Número dedicado de teste; permanece o risco operacional da API não oficial já registrado no plano original. Não prometer ausência de restrições da conta nem criar disparos não solicitados.
- `.env.local` ignorado pelo Git; produção no gerenciador de segredos. Não registrar payload bruto, token, QR, autorização ou conteúdo de cliente.
- `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` e credenciais UAZAPI somente no servidor. Preservar a chave de criptografia entre deploys; rotação exige tratar dados existentes.
- Admin digita o token e o envia por HTTPS ao backend; nunca devolvê-lo em GET, colocá-lo no bundle ou persistir no navegador. QR também não deve ser cacheado/logado.
- Supabase dev/staging separados de produção. Manter confirmação de e-mail em produção e isolamento por conta. Não enfraquecer RLS para resolver erro de setup.
- Migrations históricas imutáveis. Gerar novas com CLI instalada e registrar nomes reais. Rollback não significa apagar mensagens novas.
- Não usar clone direto numa pasta não vazia, limpeza ampla, `git reset --hard`, reset de banco remoto ou sobrescrita dos arquivos do usuário.
- Webhook requer URL HTTPS pública. QR conectado em localhost não comprova inbound.
- Registrar versão da CLI Supabase e consultar `--help`/alvo antes de comandos mutáveis. Não copiar flags de outra versão do tutorial.
- Conector disponível não comprova acesso: registrar IDs não secretos e resultado real.
- Esta revisão altera documentos; não inicia implementação nem contrata serviços.

## 6. Arquivos existentes a conferir

Caminhos relativos à raiz do produto após T01, verificados no SHA de referência. Se divergirem, corrigir o mapa antes da tarefa dependente.

| Área | Arquivos |
| --- | --- |
| Envio | `src/lib/whatsapp/send-message.ts`, `src/app/api/whatsapp/send/route.ts`, `src/app/api/v1/messages/route.ts` |
| Identidade/conversa | `src/lib/whatsapp/resolve-conversation.ts`, `src/lib/whatsapp/wa-identity.ts`, `src/lib/api/v1/contacts.ts` |
| Recebimento/status | `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/message-status.ts`, `src/lib/whatsapp/message-status-sync.ts`, `src/lib/whatsapp/webhook-body.ts` |
| Configuração | `src/app/api/whatsapp/config/route.ts`, `src/app/api/whatsapp/health/route.ts`, `src/components/settings/whatsapp-config.tsx` |
| Inbox/resumo | `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/message-composer.tsx`, `src/components/settings/settings-overview.tsx`, `src/components/dashboard/whatsapp-health-chip.tsx` |
| Outros emissores | `src/lib/automations/meta-send.ts`, `src/lib/flows/meta-send.ts`, `src/lib/automations/engine.ts`, `src/lib/flows/engine.ts`, `src/lib/ai/auto-reply.ts` |
| Mídia | `src/lib/whatsapp/mirror-inbound-media.ts`, `src/app/api/whatsapp/media/[mediaId]/route.ts`, `src/lib/storage/upload-media.ts` |
| Meta | `src/lib/whatsapp/meta-api.ts`, `src/lib/whatsapp/broadcast-core.ts`, rotas de templates/broadcast/config/verify-registration/react e chamadores |
| Permissões/tradução | `src/lib/auth/account.ts`, `src/lib/auth/roles.ts`, `messages/{en,pt,es,ko}.json`, `src/i18n/messages.test.ts` |
| Banco/CI | `supabase/migrations/`, `src/types/index.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.env.local.example` |

T04 gera o inventário completo, incluindo chamadas diretas sem import do cliente Meta.

## 7. Ordem e entregas

| Etapa | Tarefas detalhadas | Entrega que libera a seguinte |
| --- | --- | --- |
| Preparação | T01–T02 | Código fixado, ambiente funcional e baseline. |
| Contrato/inventário | T03–T04 | API comprovada, fixtures sanitizadas e mapa de consumidores/schema. |
| Fundamentos | T05–T06 | Contrato interno, armazenamento seguro e migrations verificadas. |
| Conexão | T07 | Configuração/estado/QR sem expor segredo. |
| Recebimento | T08–T09 | Eventos duráveis e deduplicados; conversa correta. |
| Envio | T10–T11 | Texto/mídia, erros e timeouts sem duplicar. |
| Produto | T12–T13 | Motores adaptados e Meta bloqueada em UI/API/cron. |
| Regressão | T14 | Testes/build/isolamento/ausência de tráfego Meta comprovados. |
| Staging/piloto | T15–T16 | HTTPS real, recuperação e piloto registrados. |
| Evolução | Backlog após T16 | Problemas observados convertidos em novos planos. |

T03 pode aguardar provedor enquanto T04 avança. Nenhuma tarefa de transporte T05+ começa com contrato pendente. Sem T02, não atribuir falha preexistente à mudança. Sem T15, não declarar inbound real pronto. Sem restauração testada, não liberar dados reais em T16.

## 8. Protocolo para LUNA e retomada

1. Ler este documento inteiro na primeira sessão. Depois, reler contexto, restrições, contratos comuns do guia e a tarefa atribuída. O chat anterior não é dependência.
2. Receber **uma tarefa por vez**, nunca “faça a Fase 3”. Se exceder um ciclo curto de edição/verificação, dividir em `Txx.a`, `Txx.b`, mantendo interfaces e aceites.
3. Conferir branch, SHA, arquivos modificados e migrations aplicadas. Caixa marcada sem evidência não libera dependência.
4. Código: teste de comportamento → observar falha pertinente → implementar → observar sucesso. Setup/documentação usam verificações diretas, sem testes artificiais.
5. Se faltar endpoint, campo, assinatura, fixture, acesso ou segredo, registrar a lacuna exata. Não escolher formato por semelhança com WAHA/Evolution/Meta.
6. Não alterar contrato comum durante uma tarefa. Se necessário, atualizar contrato, listar consumidores e revisar antes de prosseguir.
7. Após duas tentativas da mesma correção sem progresso, mudar a abordagem e devolver diagnóstico sanitizado ao coordenador. Continuar só trabalho independente.
8. Encerrar com diff, verificações observadas, limitações e próxima ação. Marcar conclusão somente com aceite satisfeito; registrar `bloqueada` quando depender de acesso externo.
9. Commit local por entrega verificada, após T01. Stage somente arquivos da tarefa; push/merge/deploy não são consequência implícita de tarefa de código.

T01 cria `docs/project/status.md`, atualizado sem segredos:

```text
Tarefa: Txx / subtarefa
Estado: não iniciada | em andamento | bloqueada | concluída
Branch e SHA:
Dependências conferidas:
Arquivos alterados:
Verificação: comando, resultado, data, evidência
Decisão ou impedimento:
Próxima ação exata:
```

Prompt para sessão nova:

```text
Projeto: WACRM comercial; somente UAZAPI por QR, sem runtime Meta.
Leia docs/superpowers/plans/2026-11-15-crm-whatsapp.md,
os contratos comuns de docs/superpowers/plans/2026-11-15-wacrm-execucao.md
e docs/project/status.md. Execute somente Txx do guia detalhado.
Confira os artefatos das dependências indicadas na tarefa.
Siga AGENTS.md e superpowers:executing-plans. Não invente API ou acesso.
Entregue diff, verificação observada e status; não avance à próxima tarefa.
```

## 9. Aceites e foco de revisão

| ID | Prova obrigatória | Tarefa |
| --- | --- | --- |
| A01 | Owner/admin conecta por QR; agent/viewer não alteram configuração. Expiração permite reconexão. | T07, T15 |
| A02 | Inbound cria/reutiliza contato/conversa corretos; evento repetido/concorrente não duplica mensagem/não lidas. | T08–T09 |
| A03 | Resposta pela inbox/API pública chega ao segundo celular e permanece após recarregar; estados só avançam com evidência. | T10, T15 |
| A04 | Cada mídia disponível tem envio, recebimento, persistência e acesso testados. Indisponíveis são bloqueadas. | T03, T11 |
| A05 | Timeout após aceite remoto permanece incerto, sem retry silencioso; mesma chave não repete envio. | T10 |
| A06 | Status anterior à mensagem ou `read` anterior a `delivered` não se perde nem regride. | T09 |
| A07 | Conta B não acessa credenciais, QR, mensagens ou mídia de A, inclusive por ID forjado/API direta. | T06–T07, T11, T14 |
| A08 | Eco da API/celular não dispara autorresposta; automação suportada dispara uma vez por inbound novo. | T09, T12 |
| A09 | Rotas, cron e ações salvas incompatíveis não chamam Graph API. | T12–T14 |
| A10 | Lint/typecheck/suíte/build passam sem credenciais Meta; falhas preexistentes têm tratamento registrado. | T02, T14 |
| A11 | HTTPS real, reinício/replay não perdem evento confirmado nem duplicam envio. | T08–T10, T15 |
| A12 | Backup restaurado em destino descartável, rollback ensaiado e piloto de atribuição/funil/permissões aprovado. | T16 |

Cinco riscos prioritários: duplicação/ordenação (A02/A06/A11), timeout ambíguo (A05), acesso cruzado (A07), loops (A08), caminhos Meta residuais (A09). Todos têm tarefa e prova; “testar edge cases” não é critério.

## 10. Dependências externas abertas

| Entrada | Resolução | Bloqueia |
| --- | --- | --- |
| Dono do fork/GitHub | Consultar acesso existente e registrar repo próprio/branch. | Push/CI/merge; não leitura da referência. |
| Servidor/versão/plano/token UAZAPI | Validar serviço disponível e produzir T03; não contratar automaticamente. | Transporte T05+. |
| Supabase dev/staging/prod | Confirmar IDs e isolamento; segredo fora dos docs. | Testes reais de banco/publicação. |
| Número dedicado/segundo celular | Confirmar disponibilidade e operador para QR. | T15 bidirecional. |
| Hosting/domínio/HTTPS/scheduler | Confirmar acesso e compatibilidade em T15. | Webhook real/processador periódico. |

Falta de informação bloqueia só a dependência correspondente. Esta tabela não solicita credenciais no chat.

## 11. Backlog comercial após o piloto

T16 cria `docs/project/commercial-backlog.md`: problema observado, usuário afetado, reprodução, recurso upstream existente, ajuste mínimo e aceite. Ordem sugerida:

1. Etapas, responsável, origem, valor e motivo de perda adequados à equipe.
2. Follow-ups, lembretes e conversas sem resposta, primeiro conferindo o que já existe.
3. Relatórios por vendedor, origem e conversão com dados do piloto.
4. Exportação/retenção de dados e rotinas de recuperação/operação.
5. Múltiplos números e automações adicionais após estabilidade do canal inicial.

Não mandar LUNA “ficar igual ao Kommo”. Cada item escolhido vira especificação e plano próprios.

## 12. Auto-revisão

- Contexto/correção do usuário estão neste arquivo; contratos técnicos propostos estão separados de fatos observados.
- SHA/scripts/caminhos conferidos na referência; contrato remoto ainda exige T03.
- A01–A12 apontam para tarefas do guia. Roteiro do vídeo abaixo é histórico, não sequência concorrente de execução.
- Revisão documental não equivale a testes do produto: a aplicação não foi instalada nem testada nesta tarefa.
- Quando solicitada a execução, começar em T01. Não é necessário escolher subagentes para usar o plano.

## 13. Referência histórica do tutorial

## Passo a passo do vídeo, conferido com a transcrição fornecida

O vídeo assume que o CRM já foi clonado/configurado no tutorial anterior. Ele acrescenta UAZAPI por QR e mantém a Meta oficial em paralelo. Nosso objetivo diverge nesse ponto: usar somente o provedor não oficial e retirar a dependência da Meta. O restante do processo — analisar, planejar, implementar, testar e publicar — continua sendo referência. [Vídeo](https://www.youtube.com/watch?v=DiLh9xk670w)

### 1. Preparar o código e o ambiente local — 0:00 a 9:56

1. Fazer fork do repositório no GitHub; ter Node.js e ferramentas básicas instaladas.
2. Clonar o fork na pasta do projeto, abrir a pasta interna correta no VS Code e executar `npm install` de dentro dela.
3. Copiar `.env.local.example` para `.env.local` e preencher as credenciais do Supabase.
4. Executar as migrations SQL do repositório no Supabase, em ordem. A gravação mostra 23 arquivos naquela versão; a cópia inspecionada do repositório tinha 57 migrations no commit `c81299d` (30/10/2026). Usar a cadeia/método do commit de trabalho e um banco de desenvolvimento novo.
5. Gerar e configurar `ENCRYPTION_KEY` conforme os comandos/documentação do repositório.
6. Iniciar `npm run dev`, abrir `localhost:3000` e confirmar login/inbox.
7. A gravação desativa a confirmação de e-mail do Supabase para facilitar o cadastro. Isso deve ser tratado apenas como passo de laboratório, nunca como configuração de produção.

### 2. Planejar a nova integração antes de editar código — 9:56 a 20:58

8. Abrir o projeto com Claude Code ou Codex e usar um fluxo de planejamento antes da implementação.
9. Anexar a documentação da API escolhida. O vídeo traz documentação de criar instância, consultar estado e enviar texto/mídia.
10. Pedir análise do mecanismo Meta existente e plano para substituir o transporte WhatsApp por UAZAPI, preservando inbox e CRM.
11. Resolver decisões com o assistente: provedor/hospedagem da UAZAPI, armazenamento seguro de tokens, webhook público, uma instância inicial e compatibilidade das automações.
12. O vídeo considera dois canais fixos em paralelo; para este projeto, manter apenas o canal UAZAPI. Adiar múltiplas instâncias para uma fase posterior.
13. Revisar o plano gerado e as alterações SQL; executar as migrations no Supabase de desenvolvimento conforme solicitado.

### 3. Implementar, testar e retomar trabalho interrompido — 20:58 a 27:59

14. Executar as tarefas do plano em branch separada, com validação/revisão por tarefa. No vídeo foram 13 tarefas; essa quantidade é exemplo, não requisito.
15. Se a sessão de trabalho encerrar, retomar pelo histórico, verificar o estado e continuar da última tarefa incompleta.
16. Rodar os testes locais previstos pelo repositório e revisar o código antes de considerar a mudança pronta.
17. Em localhost, conectar URL/token da instância, gerar QR code, vincular o número de teste e conferir estado da sessão.
18. Testar entrada e saída separadamente. O vídeo constata que receber mensagem não funcionou em localhost porque o webhook precisava de URL pública; não interpretar o QR conectado como prova de inbound funcional.

### 4. Integrar a branch e publicar staging/produção — 28:00 a 35:33

19. Depois dos testes, revisar/mesclar a branch para a branch de deploy e enviar as alterações ao fork próprio.
20. Criar aplicação Node.js na hospedagem. O vídeo usa Hostinger; o README atual a recomenda e também lista alternativas Node.js como Vercel, Railway e VPS.
21. Configurar o repositório conectado e variáveis de ambiente no painel da hospedagem. Manter Supabase, chave de criptografia e credenciais/URL do servidor UAZAPI; não configurar credenciais Meta.
22. Fazer deploy controlado com domínio/HTTPS, acompanhar o build e confirmar login e navegação.

### 5. Validar WhatsApp em produção — 35:34 a 39:10

23. Na configuração WhatsApp publicada, preencher URL e token da instância e conectar o canal não oficial.
24. Vincular o QR code com o número de teste, quando solicitado.
25. Testar mensagem recebida no celular e a resposta enviada pela inbox; verificar persistência e exibição no CRM nos dois sentidos.
26. Confirmar que nenhuma ação do CRM chama a Meta e que mensagens/estados passam exclusivamente pela UAZAPI.
27. Registrar limitações: broadcast e templates atuais são orientados à Meta; decidir se serão removidos/desativados ou reimplementados com recursos suportados pela UAZAPI. Não deixar controles que aparentem funcionar sem suporte.

