# Plano de reconstrução visual WACRM + SIS

Versão 1 — 16/11/2026. Estado: planejamento pronto para execução por fases; nenhuma implementação visual foi feita nesta tarefa. Raiz de execução: `/Users/raymozer/Desktop/Projetos/WACRM`.

## 1. Resultado e limites

Reconstruir a apresentação do CRM com a linguagem **SIS Signal Desk**: mesa comercial silenciosa, Manrope local, hierarquia editorial, superfícies discretas, command rail e Flowline restrita a receita/progresso/continuidade comercial. O WACRM continua sendo a aplicação operacional: rotas Next, autenticação, permissões, contas, dados, paginação, realtime, persistência e contratos permanecem sob responsabilidade de seus componentes e serviços atuais.

Este plano autoriza planejamento de apresentação, não habilita transporte WhatsApp nem importa funcionalidades da extensão SIS. O destino permanece localhost; não envolve publicação, migração de banco, instalação de dependências ou alteração de infraestrutura. A execução de cada fase deve preservar os bloqueios de capabilities vigentes naquele momento.

**Primeiro pacote delegável: F1, seção 7.** Pode começar após reserva dos arquivos pelo coordenador. Não depende da conclusão do transporte de texto porque não altera seus consumidores ou contratos. F4 e o QA operacional dependem das entregas correspondentes de transporte.

## 2. Evidências, precedência e limites da inspeção

### Fontes lidas

Referência SIS, abreviada como `SIS/` neste documento:

`/Users/raymozer/Downloads/16.04.2026 SIS/LAB. SIS/prototype-rebrand`

| Fonte | Uso no plano |
| --- | --- |
| `SIS/DESIGN_SYSTEM.md`, `PROTOTIPO-SIS-CONTEXTO-E-HANDOFF.md` | Direção, objetivos, hierarquia, descrição das telas e limites históricos |
| `SIS/COVERAGE.md`, `QA.md`, `INTERFACE_REVIEW.md` | Cobertura declarada e roteiro de QA; resultados antigos não equivalem à homologação atual |
| `SIS/src/foundations/{tokens,typography,motion,globals}.css` | Valores efetivos de cores, fonte, escala, superfícies e movimento |
| `SIS/src/components/shell/{AppShell.tsx,shell.css}` e `src/app/{PrototypeApp.tsx,routes.ts}` | Geometria e navegação de referência, estados globais e diferença entre documentos e código |
| `SIS/src/screens/overview/OverviewScreen.tsx` e `overview.css` | Composição editorial da visão geral |
| `SIS/src/screens/crm/{CrmScreen,LeadDrawer,InboxScreen,AudioPlayer}.tsx` e `crm.css` | Kanban, lista/tabela/calendário, ficha e master-detail |
| `SIS/src/screens/flows/{MissionsScreen,LeadgenScreen,Wizard}.tsx` e `flows.css` | Assistentes, etapas, revisão, acompanhamento e estados |
| `SIS/src/screens/support/SupportScreens.tsx` e `support.css` | Follow-ups, relatórios, autenticação, popup e foundations |
| `SIS/public/fonts/Manrope-Variable.woff2` | Arquivo local existente; conferir licença/atribuição antes de copiar para distribuição |
| WACRM `src/app/**/page.tsx`, layouts e componentes relacionados abaixo | Inventário das 23 páginas, estados, subáreas e funcionalidades que a nova apresentação deve manter |
| `src/lib/themes.ts`, `src/hooks/use-theme.tsx`, `src/app/globals.css`, `messages/{en,pt,es,ko}.json` | Temas, persistência, Tailwind 4 e localização existentes |
| `docs/project/status.md`, `evidence/T13.ui1.md`, `src/lib/whatsapp/evolution/capabilities.ts` | Bloqueios locais e separação entre código existente e recurso liberado |

Skills consultadas: frontend-design, better-layout, better-typography, better-colors, better-ui, better-accessibility, better-writing; Maestri para coordenação e leitura do portal. Não há `graphify-out` disponível na raiz; inventário obtido diretamente das fontes, sem gerar artefatos de grafo.

Documentação **da versão instalada** lida antes das recomendações técnicas: `node_modules/next/dist/docs/01-app/01-getting-started/{13-fonts,11-css,03-layouts-and-pages,05-server-and-client-components}.md` e referência `01-app/03-api-reference/02-components/font.md`. O projeto declara Next **16.3.8**, React **19.2.4**, Tailwind **4**, Base UI/shadcn, Lucide, Recharts, dnd-kit e XYFlow. Não trocar a stack pela Vite do protótipo.

### Divergências que determinam a execução

1. Os documentos SIS de 15/09 descrevem um protótipo exclusivamente em memória. O código local inspecionado já importa `src/runtime/*`, autenticação de licença, operações, CRM e clientes de inbox. **Não importar runtime, fixtures, autenticação ou roteamento hash do SIS.** Esses arquivos não demonstram compatibilidade com WACRM.
2. O design system escrito descreve dark azulado (`#0E1014`, `#171A20`, acento `#8C98FF`). O `tokens.css` atual e a captura dark de smoke mostram dark neutro (`#0A0A0A`, `#121212`, acento `#EDEDED`). **Decisão desta versão: seguir o código atual para tokens e as capturas válidas mais recentes para composição.** O dark azulado fica registrado como referência histórica, sem misturar suas cores ao dark atual.
3. O WACRM tem duas dimensões independentes: `data-theme` = acento, `data-mode` = claro/escuro. SIS usa `data-theme='dark'`. **Não copiar esse seletor:** adaptá-lo ao contrato existente do WACRM.
4. Na leitura de capabilities desta tarefa: `text=false`, `media=[]`, `templates=false`, `broadcasts=false`, `reactions=false`, `interactive=false`, `typing=false`. São um marco transitório. Os agentes LUNA estão avançando o transporte; reler o arquivo e o status antes de cada fase. Mudança visual não pode trocar flags nem prometer entrega, leitura ou envio ainda não liberados.

### Capturas inspecionadas e confiabilidade

| Captura em `SIS/` | Observação e uso |
| --- | --- |
| `qa-screenshots/overview-1440.png` | Contém página do navegador com `ERR_CONNECTION_REFUSED`. **Descartar como baseline visual.** |
| `qa-screenshots/overview-320.png` | Visão geral antiga com fixtures e conteúdo cortado à direita. Referência de hierarquia, não prova de reflow aprovado. |
| `qa-screenshots/crm-320.png` | Toolbar antiga com corte horizontal. Não reproduzir esse defeito. |
| `qa-extension-smoke/overview-1440.png` | Shell claro e estado vazio válidos; usar para superfícies, rail e vazio, não para posição de gráficos com dados. |
| `qa-extension-smoke/overview-1440-dark.png` | Shell e visão geral dark válidos, dados zerados e blocos editoriais; fonte para dark neutro. |
| `qa-extension-smoke/crm-320.png` | Toolbar em duas colunas e quatro vistas, estado sem leads; referência móvel mais recente. |
| `qa-extension-smoke/{missions,leadgen}-320.png` | Wizard estreito, stepper parcialmente visível e captura com baixo contraste aparente. Consultar CSS e recapturar o estado estável; não aprovar contraste por essas imagens. |
| `qa-extension-smoke/popup-460.png` | Referência válida de progresso/controles compactos; não implica criar popup de extensão no CRM. |

WACRM observado em modo leitura no portal `WACRM Local`: `/inbox`, viewport CSS 1440×1001, modo escuro/violeta, três painéis, estado sem conversas e aviso de conexão. Essa observação visual não diagnostica a sessão WhatsApp nem valida status do provedor. As outras páginas foram inventariadas pelo código; **não foram homologadas ao vivo nesta tarefa**. Não houve envio, alteração de dados ou navegação de teste.

## 3. Contrato visual de destino

### Tokens e compatibilidade

Introduzir um tema opt-in `sis` no catálogo existente. Preservar IDs `violet`, `emerald`, `cobalt`, `amber`, `rose`, chaves `wacrm.theme`/`wacrm.mode`, preferências salvas e sincronização entre abas. F1 mantém defaults atuais; o novo padrão para instalações sem preferência só passa a `sis` em F8, após QA. Modo padrão escuro continua disponível. A identidade e as telas usam o nome WACRM até decisão explícita de marca; não substituir nome do produto pelo logo/letra S da extensão.

| Papel SIS | Claro atual | Escuro atual | Destino WACRM |
| --- | --- | --- | --- |
| Canvas | `#F4F6F8` | `#0A0A0A` | `--background` |
| Superfície | `#FFFFFF` | `#121212` | `--card`, `--sidebar`, `--popover` e foregrounds correspondentes |
| Elevada | `#FFFFFF` | `#181818` | Superfície de overlay/elevada; separar de canvas |
| Muted | `#EDF0F3` | `#1F1F1F` | `--muted`, `--secondary`, `--card-2` conforme papel |
| Hover | `#E7EAF0` | `#292929` | `--accent` para hover neutro; não confundir com a ação primária |
| Texto principal | `#111318` | `#F5F5F5` | `--foreground`, foregrounds de card/sidebar/popover |
| Texto secundário | `#5E6673` | `#B8B8B8` | `--muted-foreground` |
| Texto terciário original | `#7B8491` | `#8F8F8F` | Token específico; restrição de contraste abaixo |
| Borda sutil / forte | `#DDE2E8` / `#C7CDD5` | `#292929` / `#3B3B3B` | `--border` e token de borda forte; controle requer distinção suficiente |
| Ação primária / hover | `#3B4DE8` / `#2F3FC8` | `#EDEDED` / `#FFFFFF` | `--primary`, `--primary-hover` |
| Sobre ação primária | `#FFFFFF` | `#111111` | `--primary-foreground`; nunca branco sobre branco no dark |
| Seleção suave | `#EEF0FF` | `#242424` | `--primary-soft`, `--primary-soft-2` conforme origem |
| Foco | `#1D4ED8` | `#D9D9D9` | `--ring`, `--sidebar-ring` |
| Sucesso / fundo | `#18794E` / `#E9F7EF` | `#69D49E` / `#13271D` | Papel semântico, sempre com texto/ícone |
| Atenção / fundo | `#8A5A00` / `#FFF5D6` | `#E5BD69` / `#2B2415` | Papel semântico, sempre com texto/ícone |
| Perigo / fundo | `#B4233A` / `#FDECEF` | `#FF8585` / `#321B1B` | Texto/estado de erro; ação destrutiva tem par próprio |
| Perigo preenchido | `#A91F37` | `#A91F37` | `--destructive`; texto `#FFFFFF`, hover SIS `#8F1A2F` claro / `#C02A45` escuro |

Não colapsar os quatro níveis atuais `status-good/warning/serious/critical` em três sem avaliar consumidores. Manter sua semântica e reservar `serious` como atenção elevada com nome/ícone distintos. Tokens de gráficos e de tipos de nó também mantêm distinção e legenda. Cores de etapas de pipeline são dados configuráveis, não acento global.

**Correção necessária de acessibilidade:** cálculo estático WCAG pelos hex declarados encontrou `#7B8491`/branco = **3,78:1** e sobre canvas claro = **3,49:1**; não serve para texto normal essencial. Usar secundário `#5E6673` nesses rótulos (5,79:1 sobre branco) ou um token acessível medido. Borda dark `#292929` sobre `#121212` = **1,29:1**: pode separar superfícies decorativamente, mas não deve ser o único sinal de controle/foco. São cálculos de tokens, não medição do resultado renderizado. A alegação histórica de contraste do protótipo não aprova esses usos.

### Tipografia, geometria e movimento

- **Manrope Variable 200–800**, local via `next/font/local`; faixa de uso UI 400–650, números tabulares para valores, contagens e duração. Uma família é uma decisão expressa do SIS; não acrescentar serif/display para cumprir uma preferência genérica de design.
- Base de referência SIS 15px/1,55 em interface densa; input móvel 16px; microtexto mínimo planejado 12px. Título de página 32–44px com clamp, peso 650, line-height 1,05; seções 20px/1,2; subtítulos 15px/1,3. Mensagem longa precisa de line-height confortável. Valor heroico deve quebrar/encolher sem cortar moeda.
- Escala espacial de 4px: 8–12px dentro de grupos, 24–48px entre blocos. Raios explícitos **8/12/16/20px**; o cálculo atual de raios shadcn não corresponde exatamente ao SIS e precisa de mapeamento delimitado ao tema.
- Rail 232px expandido / 72px compacto; topbar de referência 76px desktop / 64px estreito; conteúdo até 1680px e padding fluido 24–48px desktop, 16px móvel. São referências a testar com os nove destinos atuais, não desculpa para cortar navegação.
- Fonte CSS do SIS compacta rail abaixo de 80rem e usa drawer abaixo de 48rem. Validar com conteúdo real e rótulos localizados; conservar o contrato mobile do WACRM até a troca completa em F2.
- Inbox, Kanban e canvas têm scroll interno e `min-width:0`/`min-height:0`; página não pode ter overflow horizontal em 320px. Não aplicar largura máxima editorial ao workspace de conversa ou editor.
- Movimento SIS: 90ms feedback, 120ms hover/press, 240ms expansão/troca, 280ms painel; curva `cubic-bezier(0.2,0,0,1)`. Interações repetidas de chat ficam instantâneas ou até 120ms. Press 0,96 opcional, sem deslocar conteúdo; respeitar redução de movimento.
- Uma ação primária preenchida por contexto. Lucide continua sendo a biblioteca de ícones do WACRM; adaptar peso óptico, sem copiar o componente de ícones da extensão. Flowline tem significado comercial, nunca decoração em todos os cards.

## 4. Inventário fiel: todas as páginas WACRM

Legenda: **direta** = composição equivalente; **parcial** = aproveitar padrão com domínio diferente; **nova** = projetar apresentação coerente para função já existente; **adiada** = código existe, mas a capability atual impede a experiência operacional.

Todos os caminhos de dashboard abaixo estão em `src/app/(dashboard)/`; autenticação em `src/app/(auth)/`. Estados comuns obrigatórios: carregando, vazio inicial, vazio por filtro, erro recuperável, sucesso, ação em andamento, sem permissão e indisponibilidade por capability, quando aplicáveis.

| # | Rota / arquivo | Referência SIS e reconstrução | Comportamento a preservar / limite |
| --- | --- | --- | --- |
| 01 | `/` — `src/app/page.tsx` | Sem tela; manter redirect | Redireciona a `/dashboard`; não criar landing |
| 02 | `/login` — `login/page.tsx` | Parcial: `AuthScreen`; painel de identidade e formulário limpo | Email/senha, erro de link, convite via `?invite=`, links, loading e navegação completa pós-login; não trocar por licença SIS |
| 03 | `/signup` — `signup/page.tsx` | Nova extensão da autenticação SIS | Nome, email, senha/confirmação, aceite de convite, sucesso e sessão imediata conforme runtime; não simplificar estados |
| 04 | `/forgot-password` — `forgot-password/page.tsx` | Nova extensão da autenticação SIS | Solicitação de recuperação e confirmação de email; não prometer envio antes do retorno real |
| 05 | `/reset-password` — `reset-password/page.tsx` | Nova extensão da autenticação SIS | Checking, link inválido, senha/confirmação, salvando, sucesso e redirecionamento |
| 06 | `/join/[token]` — `src/app/join/[token]/page.tsx` | Nova ficha de convite no mesmo painel de autenticação | Peek/redeem, convidado autenticado ou não, conta conflitante, convite inválido/expirado e sair/tentar novamente; manter guardas de vínculo |
| 07 | `/dashboard` — `dashboard/page.tsx` | Direta de estrutura: `OverviewScreen`; hierarquia editorial, KPI principal, série e blocos secundários | Preservar períodos **1/7/30/90**, `?range=`, fila/atenção, equipe/presença, atividade e checklist. SIS mostra Ano: não acrescentar período sem contrato. Usar `dealsWonValue` como valor de negócios ganhos, não afirmar faturamento contábil. Série atual tem mensagens/conversas/dealsWon, não receita diária; não inventar curva monetária |
| 08 | `/inbox` — `inbox/page.tsx` | Parcial: `InboxScreen` + `LeadDrawer`; lista → conversa → contexto de contato | Manter `?c=`, `?filter=`, lista, histórico/paginação, realtime/reconexão, busca, atribuição/status, composer, estados de envio, mídias, quote/reactions/IA conforme capability. Protótipo visual não substitui chat real |
| 09 | `/notifications` — `notifications/page.tsx` | Nova central de atividade usando listas de relatórios/atividade SIS | Marcar lida/todas, conta, estados, tempo relativo e abertura de conversa via `?c=`; badges não podem depender só de cor |
| 10 | `/contacts` — `contacts/page.tsx` | Parcial: tabela/lista do `CrmScreen` e ficha `LeadDrawer` | Busca/paginação no servidor, filtros por tags, seleção e lote, criar/editar/excluir/importar e campos customizados; contato não vira negócio nem perfil Instagram |
| 11 | `/pipelines` — `pipelines/page.tsx` | Direta do Kanban SIS; cards de **negócios** e cabeçalho por etapa | Seleção/múltiplos pipelines, criação/seed, estágios, ordem, drag-and-drop, criação/edição de negócio, valor/moeda e analytics. SIS organiza leads; não mudar a entidade do board. Lista/tabela/calendário adicionais ficam fora desta reconstrução inicial |
| 12 | `/broadcasts` — `broadcasts/page.tsx` | Parcial/adiada: listagem de Missões/Follow-ups | Lista, status e polling existem; layout atual intercepta a rota e mostra indisponível. Estilizar o aviso enquanto flag=false; não renderizar children nem reexibir menu |
| 13 | `/broadcasts/new` — `broadcasts/new/page.tsx` | Parcial/adiada: wizard `MissionsScreen` | Manter **quatro etapas**: template, público, personalização, agendar/enviar. Não copiar cinco etapas, multicanal, ritmo ou áudio da SIS. Dependente de liberação funcional separada |
| 14 | `/broadcasts/[id]` — `broadcasts/[id]/page.tsx` | Parcial/adiada: `ReportDetailScreen` | Destinatários/status/filtro, funil, exclusão, retomada de falhas/pendências e proteção de entrega em andamento. Nenhum botão pode contornar layout/guardas atuais |
| 15 | `/automations` — `automations/page.tsx` | Parcial: biblioteca de Follow-ups e templates SIS | Listar, templates de automação, ativar/desativar, duplicar, excluir, editar e logs; não chamar toda automação de follow-up |
| 16 | `/automations/new` — `automations/new/page.tsx` | Nova: editor linear inspirado no ritmo do wizard SIS | Gatilhos, condições, passos, timezone, template via `?template=` e validação; não tornar um assistente de missão ou alterar ordem de execução |
| 17 | `/automations/[id]/edit` — `automations/[id]/edit/page.tsx` | Mesma nova apresentação do editor | Carregamento da automação e configuração persistida, erro/inexistente, retorno à lista e salvamento |
| 18 | `/automations/[id]/logs` — `automations/[id]/logs/page.tsx` | Parcial: relatórios SIS, tabela + detalhe expansível | Status/erro por execução e abertura do log; sem CSV/reprocessamento fictício |
| 19 | `/flows` — `flows/page.tsx` | Parcial: biblioteca SIS, cards de fluxo com estados | Criar por nome/template, excluir, estados, editar e identificação beta; permissões atuais |
| 20 | `/flows/[id]` — `flows/[id]/page.tsx` | Nova: canvas operacional com chrome SIS | Manter XYFlow/dagre, editor em lista, provider de estado, nós/conexões, validação, salvar/publicar conforme ações existentes; mobile força lista abaixo de 768px e mantém preferência desktop |
| 21 | `/flows/[id]/runs` — `flows/[id]/runs/page.tsx` | Parcial: relatórios SIS | Execuções, eventos, expansão, status e voltar ao editor; não criar retry pelo estilo do relatório |
| 22 | `/agents` — `agents/page.tsx` | Nova: mesa de IA detalhada na seção 5 | Abas playground/setup/usage, decisão inicial configurado→playground e não configurado→setup; usage restrito. Hoje é configuração **por conta**, não frota de agentes independentes |
| 23 | `/settings` — `settings/page.tsx` | Nova: Sistema SIS ampliado, aproveitando rail existente | Doze seções, URL `?tab=`, aliases e permissões; detalhamento abaixo. Não recolocar tudo em um modal |

### Configurações: doze subáreas, sem equivalente SIS completo

Arquivo agregador `src/components/settings/settings-sections.ts`; apresentação em `src/app/(dashboard)/settings/page.tsx` e `src/components/settings/*`.

| `?tab=` | Arquivos principais | Proposta de apresentação / aceite específico |
| --- | --- | --- |
| `overview` | `settings-overview.tsx` | Resumo editorial de conta/conexão/atalhos reais, sem score inventado. Respeitar tiles ocultos por capability |
| `profile` | `profile-form.tsx`, `browser-notifications-card.tsx` | Identidade e preferências em grupos legíveis; perfil, avatar e opt-in de notificações preservados |
| `security` | `security-panel.tsx`, `password-form.tsx`, `sessions-card.tsx` | Credenciais e sessões em duas seções, confirmações explícitas e recuperação de erro |
| `appearance` | `appearance-panel.tsx` | Modos e temas existentes + SIS; miniaturas e estado selecionado. Não apagar preferências nem fingir sincronização de perfil no servidor |
| `whatsapp` | `whatsapp-config.tsx` | Painel de conexão, estado textual, ação principal coerente, QR e formulário avançado separados; manter DTOs, validação, refresh, expiração/descarte e máscara de segredos |
| `templates` | Estado indisponível na página; `template-manager.tsx` legado | Com flag=false, apenas aviso com link para conexão; manter recurso fora do rail. Não montar manager nem oferecer sincronização Meta |
| `quick-replies` | `quick-replies-manager.tsx` | Lista com atalho, conteúdo e editor; manter CRUD/validação |
| `inbox` | `inbox-settings.tsx` | Preferências de atendimento agrupadas; preservar valores e efeitos reais |
| `fields` | `fields-and-tags-panel.tsx`, `tag-manager.tsx`, `custom-fields-settings.tsx` | Duas famílias de metadados com CRUD distinto; `?tab=tags` e `?tab=custom-fields` continuam resolvendo aqui |
| `deals` | `deals-settings.tsx` | Moeda e preferências de negócio; formato respeita locale, sem fixar BRL |
| `members` | `members-tab.tsx`, `invite-member-dialog.tsx`, `role-meta.ts` | Tabela de equipe e convites, papéis owner/admin/agent/viewer, alterações/remoção/transferência conforme controles existentes |
| `api` | `api-keys-settings.tsx` | Lista de chaves/scopes e estados; preservar exibição única, máscara, criação/revogação e confirmação real |

IA já tem casa em `/agents`; não duplicar os mesmos formulários em uma nova seção de settings. `?tab=` desconhecido continua caindo em overview. Aviso `AccountAccessAlert` continua acima do conteúdo quando houver falha de conta/papel.

### Superfícies secundárias que não podem desaparecer

| Família | Arquivos e elementos a reconstruir |
| --- | --- |
| Ficha de contato | `contacts/contact-detail-view.tsx`: Sheet com abas **details/tags/notes/custom/deals**, edição, ações e overlays encadeados. SIS inspira identidade/resumo, mas suas abas resumo/atividade/vendas/notas não substituem as cinco atuais |
| Formulários de contato | `contacts/{contact-form,import-modal,custom-fields-manager}.tsx`: criar/editar, importação com feedback e configuração de campos |
| Negócios | `pipelines/{pipeline-board,deal-card,deal-form,pipeline-settings,pipeline-analytics}.tsx`: cartão, drag, diálogo, configuração/estágios e métricas |
| Inbox | `inbox/{conversation-list,message-thread,message-composer,contact-sidebar,message-bubble,message-media,media-lightbox,reply-quote,message-actions,message-reactions,ai-thread-banner,quick-reply-picker,template-picker}.tsx`; também interactive builder/preview quando aplicável. Preservar handlers e capability, sem criar affordance falsa |
| IA | `agents/{ai-playground,ai-usage}.tsx`, `settings/{ai-config,ai-knowledge}.tsx`: configuração, teste, credenciais, limites, handoff, conhecimento/reindexação e métricas |
| Automações e fluxos | `automations/automation-builder.tsx`, `flows/{flow-editor-shell,header,flow-builder,flow-canvas,validation-panel,shared}.tsx`, `flows/forms/*`: lista/canvas, legendas, validação e edição de nós |
| Estados globais | `ui/*`, `themed-toaster.tsx`, `auth/require-role.tsx`, `layout/account-access-alert.tsx`, dashboard skeleton/empty/failed-messages-dialog, menus de perfil, notificações e confirmação destrutiva |

## 5. Desenhos novos coerentes com SIS

### Configurações

Manter o rail secundário existente, com grupos Conta/Workspace. Desktop: título/descritivo → rail 224–236px → painel com largura de leitura adequada. Mobile: seletor/accordion de seção acessível acima do formulário, preservando URL; não empilhar doze grandes tiles antes da configuração selecionada. Identificação da conta e status vêm de fontes já disponíveis.

```text
Command rail | Contexto / perfil / modo
             | Configurações
             | rail de seções | título + descrição
             |                | grupo de campos
             |                | status/erro + ação Salvar
```

### Agentes de IA

Página de configuração de IA por conta, com cabeçalho editorial e status real discreto. Manter abas atuais. Playground usa área de conversa e bloco de orientação/configuração; Setup organiza conexão/provedor → instruções → resposta automática/limites/handoff → conhecimento, sem mudar payloads. Usage apresenta chamadas/tokens e discriminação por modo/modelo já retornada; não estimar custo sem contrato.

```text
Agentes de IA                         [status real]
[Playground] [Configuração] [Uso, quando permitido]
Playground: conversa de teste | contexto/atalho para configurar
Setup: conexão → instruções → controles → conhecimento
Uso: período → KPIs existentes → distribuição por modelo/modo
```

Não criar catálogo de agentes, contratação, múltiplas personas salvas ou agentes executando missões SIS. Embora o nome de navegação seja plural, o modelo de dados inspecionado é por conta. Segredos nunca aparecem em capturas/evidências; playground não significa envio a um contato WhatsApp.

### Notificações, automações e fluxos

Notificações: feed por ordem existente, identidade, ação, horário, indicador textual de não lida e botão “Marcar todas como lidas”. Não inventar novos filtros ou eventos.

Automações: biblioteca com status e ações existentes; editor linear com grupos de gatilho/condição/passos e validação. Fluxos: preservar o canvas como workspace bidimensional; aplicar SIS ao chrome e aos nós, com tipos identificados por nome/ícone além da cor. Em mobile, editor em lista permanece sendo o caminho operacional.

### Autenticação e convite

Mesmo painel/manrope/superfícies do SIS, campos e estados reais do WACRM. Sem busca global/rail em auth. Convite apresenta conta, papel e consequência de aceitar; estado de conflito tem ação explícita e não descarta vínculos. Não trocar navegação completa por navegação suave onde o código exige recarregar contexto de sessão.

## 6. Visual transferível versus função de produto

| Elemento SIS | Tratamento neste plano | O que seria trabalho funcional separado |
| --- | --- | --- |
| Flowline, hero numérico, cards, rail, drawer, stepper | Transferir padrões e tokens, com dados/ações WACRM | Nenhum backend novo para justificar o visual |
| Visão geral de receita/audiência/verificados/leads quentes | Reutilizar composição com métricas WACRM disponíveis | Receita diária, score, audiência e verificação Instagram não existem no DTO atual como no SIS |
| CRM com Kanban/Lista/Tabela/Calendário sobre leads | Kanban de negócios e tabela de contatos mantêm suas entidades | Novas projeções de negócios, calendário e seleção unificada exigem especificação/dados próprios |
| Gerar leads, oito fontes, ICP/score, agendas, staging/histórico | Fora da navegação e da entrega visual inicial | Descoberta, scraping, enriquecimento, qualificação, fontes, persistência e orquestração |
| Missões multicanal e biblioteca de áudio | Somente referência de wizard/progresso | Instagram/DM/comentários/WhatsApp multicanal, ritmo, breaker, sequência e biblioteca SIS |
| Follow-ups SIS | Referência para biblioteca/editor de automações existentes | Não há equivalência automática entre campanhas SIS e engines WACRM |
| Relatórios dedicados, CSV, retry e imprimir/PDF | Referência para logs/runs/detalhe de broadcast existentes | Nova rota `/reports`, exportação universal, retry e PDF precisam de escopo e contratos; não adicionar botões sem handler real |
| Busca global SIS | Não inserir um input global inerte; manter buscas contextuais | Índice/pesquisa transversal, autorização por entidade, resultados e navegação |
| Popup de extensão, licença, backup, runtime sincronizado | Não portar | Extensão Chrome, licença SIS, backup/restauração e integrações fora do produto atual |
| Agentes múltiplos / central de operações | Não sugerir como função entregue | Novo modelo de agentes, execução e monitoramento |
| Broadcasts/templates/reactions/typing/mídia | Preservar apresentação histórica/indisponível conforme capabilities | Liberação depende da migração Evolution e de QA próprio, nunca da fase visual |

## 7. Fases executáveis e primeira delegação LUNA

### Regras de coordenação

- Executar `maestri list` antes de falar com agentes; usar nomes exatos e reservar arquivos por pacote. Não criar ou recrutar agentes neste planejamento.
- Um único dono por vez para `globals.css`, root layout, catálogo de temas, `messages/*` e primitives. Alterações nesses arquivos são sequenciais; fases de telas só paralelizam após F1/F2 e em conjuntos disjuntos.
- Os agentes de preparação/contrato/infra já têm alterações em cliente/eventos/queue/webhook Evolution, fixtures, migrations e testes SQL. **Não tocar `src/lib/whatsapp/**`, `src/app/api/**`, `infra/**`, `supabase/**`, `.env*`, workers ou contratos durante tarefas visuais.** Nem aplicar formatador global, reset/stash, revert ou commit abrangente sobre o workspace compartilhado.
- Há alterações concorrentes; `git status` não é prova de autoria. Comparar o diff de cada pacote, declarar arquivos próprios e não incluir alterações dos colegas. Este trabalho grava somente este documento.

### F1 — Fundação SIS opt-in — pronta para LUNA

**Objetivo:** disponibilizar a identidade SIS no sistema de temas existente, com Manrope local e tokens completos, sem mudar rotas, shell, dados ou defaults. Entrega pequena e revisável; ao selecionar SIS na Aparência já deve ser possível conferir fonte/superfícies/contraste sobre componentes atuais.

**Dependências:** reserva dos arquivos abaixo; manter instalação atual; confirmar licença da fonte local. Se não houver licença/atribuição no material, registrar pendência para distribuição e usar a fonte somente na validação local autorizada. Não acessar Google Fonts para obter substituta.

**Arquivos permitidos nesta fase:**

1. Novo `src/app/fonts/Manrope-Variable.woff2`, cópia do arquivo SIS já localizado.
2. `src/app/layout.tsx`: registrar `next/font/local` com `src` relativo, peso `200 800`, `display: swap` e variável distinta `--font-manrope`. Manter metadata, locale, providers e boot script existentes; manter Inter para temas legados nesta fase.
3. `src/app/globals.css`: adicionar bloco SIS delimitado por `html[data-theme="sis"]` e suas combinações `data-mode`; mapear tokens de cores, raios, fonte e movimento. Aplicar Manrope/`--font-sans` apenas no tema SIS; preservar `@theme inline` e o catálogo legado. A especificidade e a ordem devem impedir vazamento para outros temas. Não copiar reset global do protótipo.
4. `src/lib/themes.ts`: acrescentar ID/metadados `sis`; manter `DEFAULT_THEME="violet"`, `DEFAULT_MODE="dark"` e chaves de persistência. O picker atual já deriva cards de `THEMES`, portanto evitar alterar `appearance-panel.tsx` nesta fase.
5. Novo `docs/project/evidence/SIS-F1.md`: diff próprio, tokens/paridade, comandos e resultados, capturas e pendências. Evidência deve ocultar dados pessoais/segredos.

**Fora do pacote:** `src/hooks/use-theme.tsx`, qualquer componente de tela, sidebar/header, traduções, API, capability, banco, infraestrutura, package/lockfile. Se faltar um token, resolver no bloco SIS; se exigir contrato novo, relatar ao coordenador em vez de expandir a tarefa.

**Ordem de execução:**

1. Ler AGENTS, este plano, fontes SIS e guias locais Next citados; registrar `git status --short` e diff inicial dos arquivos reservados.
2. Copiar a fonte, adicionar o carregamento local e a variável sem quebrar o caminho legado.
3. Adicionar tema e tokens claro/escuro da seção 3, cobrindo popover, input, ring, sidebar, gráficos, estados e foreground da ação primária; `--accent` continua hover neutro.
4. Aplicar escala e raios por tokens/regras delimitadas; não globalizar `h1` de 44px sobre diálogos/card titles, nem reduzir input móvel abaixo de 16px. Sem animação de entrada global; reduzir movimento desde esta fase.
5. Conferir Aparência selecionando SIS, alternar modo, recarregar, retornar a um tema legado e confirmar persistência. Não interagir com WhatsApp nem executar mutações de negócio.
6. Rodar checks focados abaixo; entregar evidência e lista de arquivos ao coordenador. Não iniciar F2 por conta própria.

**Critérios de aceite F1:**

- [ ] Sexto tema SIS aparece no picker atual e funciona com `light` e `dark`; os cinco IDs legados continuam aceitos.
- [ ] Defaults/chaves de storage inalterados; preferência salva não é apagada; reload sem flash perceptível/hydration warning introduzido.
- [ ] Manrope é servida localmente e a fonte computada do tema SIS é Manrope; não há novo request de fonte externa para ela.
- [ ] Tokens batem com seção 3, incluindo botão dark de fundo claro com texto escuro; texto normal essencial não usa o terciário claro reprovado.
- [ ] Sem alteração em capabilities, requests de domínio, autenticação, formulários, ordenação ou navegação.
- [ ] Em 320px, Aparência e auth não ganham overflow por fonte/raios; verificar foco, input móvel e modo reduzido. Shell existente ainda não precisa coincidir com SIS.
- [ ] `npx eslint src/app/layout.tsx src/lib/themes.ts`, `npm run typecheck` e `git diff --check -- src/app/layout.tsx src/app/globals.css src/lib/themes.ts docs/project/evidence/SIS-F1.md` passam ou têm falha preexistente demonstrada. Se catálogo/tipagem de tema afetar teste existente, executar sua cobertura; não criar testes que espelhem hex CSS.
- [ ] Registrar capturas SIS claro/escuro e retorno a legado; execução de build completo fica serializada pelo coordenador para não concorrer com o servidor/infra local.

**Prompt pronto para delegar:**

> Execute somente F1 de `docs/project/sis-integration-plan.md` na raiz WACRM. Reserve com o coordenador os cinco destinos da whitelist; leia AGENTS e os guias Next instalados. Adicione tema SIS opt-in e Manrope local preservando defaults, storage, temas legados e todos os contratos atuais. Use os tokens atuais do SIS, com dark neutro e correção do uso de texto terciário claro. Não modifique API, transporte, banco, capabilities, shell, telas ou traduções; não instale dependências e não formate o projeto inteiro. Verifique os critérios F1 e escreva `docs/project/evidence/SIS-F1.md` com arquivos próprios, resultados e limitações. Informe ao coordenador quando estiver pronto para revisão; não envie mensagens WhatsApp nem avance para F2.

### F2 — Shell e primitives

**Depende de:** F1 aprovada. **Arquivos:** `src/components/layout/{sidebar,header,mode-toggle}.tsx`, `src/app/(dashboard)/dashboard-shell.tsx`, primitives afetadas em `src/components/ui/*`, toaster e traduções necessárias nos quatro catálogos sob dono único. Ajustes globais só pelo dono de tokens.

**Trabalho:** rail 232/72 com compactação e drawer móvel; topbar SIS com contexto real, perfil e modo. Preservar todos os destinos habilitados, badges, conta/papel, logout, alertas e listeners headless. Não criar busca global inerte nem pill “runtime sincronizado”. Header atual não mapeia `/agents` e `/flows` explicitamente: corrigir títulos localizados ao reconstruí-lo. Resolver duplicação de `h1` entre header e páginas: contexto no header sem heading principal e um `h1` por página, incluindo título acessível da inbox.

**Aceite:** navegação/deep links/subrotas corretos, rotas bloqueadas continuam bloqueadas, rail compacto com nomes/tooltip/foco, Escape/retorno de foco/inert no drawer, skip link e foco de rota, menus e diálogos não cortados por overflow/z-index. Testar 1440/1024/768/320, dois modos e textos longos. Definir contratos de scroll por workspace; não aplicar `max-width` indiscriminado. Evitar introduzir um segundo sistema de overlays.

### F3 — Dashboard, contatos e pipeline

**Depende de:** F2. **Arquivos:** páginas `dashboard`, `contacts`, `pipelines`; `src/components/{dashboard,contacts,pipelines}/*`. Subpacotes podem ser separados por família, sem editar primitives/globals em paralelo.

**Trabalho:** aplicar composições SIS mapeadas na seção 4; manter fontes de dados e hooks. Reorganizar hero/KPIs sem criar série de receita ausente; distinguir contato de negócio. Ficha SIS preserva cinco abas existentes. Board permanece dnd-kit com alternativa acessível de movimento disponível/planejada para o mesmo handler; nenhuma escrita nova no backend.

**Aceite:** mesmos registros/contagens/filtros/paginação e moeda antes/depois; valores vazios não viram zeros falsos; busca e lote mantêm escopo; formulário/ficha/overlay completos por teclado. Arrastar negócio mantém persistência e tratamento de falha; não portar score/audiência Instagram. Capturas com dados locais de teste, vazios e erro. QA de ações destrutivas somente com fixture descartável autorizada pelo coordenador.

### F4 — Inbox operacional

**Depende de:** F2; congelamento/revisão dos consumidores de transporte pelo coordenador. **Arquivos:** `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/*` e componentes interactive apenas se liberados; sem edição em hooks/serviços de transporte.

**Trabalho:** três áreas com densidade SIS; lista/conversa/contexto adaptáveis; padrão visual de bolhas, composer, banners, mídia e lightbox. Mobile navega lista→thread→contexto sem três colunas comprimidas. Preservar `?c=` e retorno da conversa, posição de scroll, paginação antiga, rascunho, optimistic messages, dedup e reconexão conforme runtime atual.

**Aceite:** comparação de fluxo antes/depois com mesmas fixtures, recibos não promovidos artificialmente, mídia histórica legível, erros/retry conforme handlers atuais e campos bloqueados explicados. Se texto/mídia ainda não liberados, validar apenas leitura/indisponibilidade; qualquer teste real de envio depende de autorização específica já registrada pelo coordenador, sem repetir prova anterior. Realtime não deve remontar a thread ao alternar apenas contexto/rail. Capturas sanitizadas, nunca de conversas pessoais.

### F5 — Configurações e IA

**Depende de:** F2; estabilização visual de formulários/dialogs. **Arquivos:** `settings/page.tsx`, `agents/page.tsx`, `src/components/settings/*`, `src/components/agents/*`. Dividir pacote por arquivos; `ai-config` e `ai-knowledge` pertencem ao pacote IA, não a dois agentes simultâneos.

**Trabalho:** executar os desenhos da seção 5 e as doze subáreas; preservar deep links, papéis e segredos. Playground/setup/usage continuam as mesmas abas com a mesma decisão inicial. Aparência recebe tratamento final e textos localizados, sem mudar persistência.

**Aceite:** cada `?tab=` abre corretamente inclusive aliases e templates indisponível; owner/admin/agent/viewer veem as ações adequadas, com backend mantendo sua guarda. Não criar configuração duplicada de IA ou modelo multiagente. QR/credenciais/erros e campos longos cabem em mobile; confirmação de sessão/chave/equipe nomeia consequência. Testes funcionais de configuração usam conta/fixture local e nenhuma credencial em evidência.

### F6 — Automações, fluxos, logs e notificações

**Depende de:** F2; tokens de nó e scroll definidos. **Arquivos:** páginas `automations/**`, `flows/**`, `notifications`; `src/components/automations/*`, `src/components/flows/*`. Não alterar engine, schedulers, tipos ou API para satisfazer o desenho.

**Trabalho:** biblioteca/editor/relatórios conforme seção 4, preservar canvas/lista e estados de execução. Logs têm expansão e leitura densa; controles sem equivalentes reais não aparecem.

**Aceite:** mesmos gatilhos/condições/passos e validações; salvar estado e alternar vistas sem perda; mobile mantém lista; foco visível em nós/controles e rota equivalente por teclado. Runs/logs exibem falha/pausa/espera com texto e não só cor. Notificações mantêm escopo de conta e deep link de conversa.

### F7 — Auth, convite e áreas indisponíveis

**Depende de:** F2; layouts de formulário estáveis. **Arquivos:** `src/app/(auth)/**`, `src/app/join/**`, layout/aviso de broadcasts e estado templates. As páginas `broadcasts/**` e seus step components só são reconstruídas operacionalmente quando capability correspondente for liberada em tarefa funcional separada.

**Trabalho:** painel de autenticação SIS com conteúdo WACRM, estados de recuperação/convite e guardas atuais. Avisos de indisponibilidade usam a mesma linguagem visual. Revisar affordances legadas em ficha/composer para que o redesign não reintroduza templates/ações desativadas.

**Aceite:** links de convite, sessão imediata, recuperação, estados inválidos, troca de conta e navegação completa preservados; layout protegido nunca monta as páginas de broadcast com flag=false. Fluxos reais de auth devem ser conferidos com fixture local e plano do coordenador, sem disparar emails externos de teste.

### F8 — Integração, padrão e QA final

**Depende de:** F3–F7 aprovadas no escopo de capabilities liberadas. **Arquivos:** ajustes finos por responsável, `src/lib/themes.ts` para novo default e evidências; sem alterações funcionais embutidas.

**Trabalho:** comparar famílias de telas, eliminar tokens/overrides duplicados, tornar `sis` default apenas para ausência de preferência; manter cinco temas legados e modo. Validar metadata/branding com nome definido pelo coordenador, sem decidir um rebranding comercial por conta própria.

**Aceite:** matriz da seção 8 preenchida, zero bloqueio HIGH, nenhum desvio funcional/regressão de permissão, checks concluídos e limitações explicitadas. `npm run typecheck`, `npm run lint`, testes existentes afetados e `npm run build` executados uma vez em janela serializada após integração. Lint preexistente separado do novo. Não repetir suíte sem mudança/falha que justifique; não concluir migração Evolution por ter concluído visual.

## 8. QA visual e funcional obrigatório

### Matriz e evidência por pacote

- Capturar **1440×1000, 1024×900, 768×1024, 320×760**, mais 200% de zoom e texto longo. Priorizar extremos primeiro. Mesmos viewport, tema, locale e estado para comparação; registrar URL sem tokens de convite/segredos, dados sanitizados e data/revisão.
- Tema SIS claro/escuro em todas as famílias; temas legados ao menos em auth, dashboard, inbox, formulário e overlay para detectar regressões. `prefers-reduced-motion`, forced colors e contraste renderizado precisam de verificação própria.
- Cada família: carregamento, dados, vazio inicial, vazio de busca, erro e recuperação, sem permissão, ação em curso. Registrar `não verificado` se não houver fixture/condição reproduzível; nunca converter ausência de evidência em aprovação.
- Anotar diferenças intencionais por domínio (ex.: negócios versus leads, quatro versus cinco etapas), e defeitos do protótipo não reproduzidos. Comparação não exige números/fixtures SIS iguais ao CRM real.
- Armazenar capturas sanitizadas/evidência em `docs/project/evidence/sis/F<n>/` quando a execução iniciar, com tabela estado/viewport/tema/resultado. Esta tarefa não gera essas capturas de implementação.

| Família | Verificação visual | Verificação de comportamento |
| --- | --- | --- |
| Shell | 232/72, drawer, hierarquia, z-index, badges longos | Destinos, perfil/logout, alertas, foco, rolagem e rotas restritas |
| Dashboard | Hero sem overflow, série com legenda, blocos alinhados | `?range=`, números/periodicidade, moeda/timezone, fila e atividade |
| Contatos/ficha | Tabela estreita com scroll interno, cinco abas, drawer longo | Filtros/página/lote, edição, notas/tags/campos/deals e retorno de foco |
| Pipeline | Largura de coluna/card, Flowline com significado, vazio | Pipeline/estágio selecionado, movimento, edição e atualização após erro |
| Inbox | Lista/thread/contexto em desktop e caminho móvel | Deep link, histórico, unread, atribuição, rascunho, status e reconexão |
| Configurações/IA | Formulários longos, estados/chips, inputs e segredos | Doze seções/aliases, permissões, mascaramento, tabs e payloads existentes |
| Automações/fluxos | Canvas/lista, legendas, validação e logs | Mesma configuração/execução, preferência de vista, salvar e estados reais |
| Auth/convite | Painel coeso, erros visíveis, labels e zoom | Sessão/redirect, token inválido, confirmação, conflito e recuperação |
| Indisponíveis | Aviso consistente com ação para conexão | Sem child mount, navegação ou ação que contorne capability |

### Acessibilidade e escrita

Um `h1`/`main` por tela, títulos coerentes, skip link; Tab/Shift+Tab, Enter/Espaço, setas de widgets, Escape, foco contido/restaurado em overlays. Foco mínimo planejado 2px e contraste medido contra superfícies adjacentes; alvo mínimo AA 24px, preferir 40px desktop/44px touch onde couber. Não aprovar acessibilidade só por análise estática: caminhada por teclado e leitor de tela real devem constar como realizadas ou pendentes.

Labels persistentes, erro junto ao campo e anunciado, controles icon-only nomeados, status com ícone/texto, leitura de resultado e foco após validação. Tabelas/canvas podem ser regiões 2D com rolagem acessível; restante deve refluir. Não esconder conteúdo essencial com ellipsis sem acesso ao valor completo.

Manter `next-intl`; novos textos nos quatro catálogos, mensagens completas com pluralização, sentence case, verbos claros (“Salvar alterações”, “Revogar chave”). Capturas SIS em português orientam hierarquia, não justificam strings PT hardcoded ou perda de outras línguas. Texto de indisponibilidade precisa explicar estado/ação real; sucesso só após resposta de sucesso. Não usar labels de “Enviado”, “Entregue” ou “Sincronizado” baseados apenas em animação.

## 9. Riscos e mitigação

| Risco | Impacto | Mitigação / gate |
| --- | --- | --- |
| Agentes editando arquivos compartilhados | Perda de trabalho e regressão de transporte | Whitelist/reserva por fase, sem formatador global; primeiro pacote isolado; coordenador integra |
| Handoff SIS antigo versus runtime/capturas atuais | Mistura de paletas, dados fictícios e contratos incompatíveis | Precedência e capturas rejeitadas registradas; não importar runtime |
| Fidelidade copiando falhas de contraste/reflow | Texto ilegível e ação inacessível | Correção dos pares medidos, QA em 320px e zoom; documentar diferença intencional |
| Mudança global de tema quebrar outros acentos | Regressão generalizada | `sis` opt-in com seletores delimitados; defaults só em F8, persistência preservada |
| UI habilitar funções Meta bloqueadas | Ação enganosa ou caminho indevido de envio | Capabilities são fonte de verdade, layouts de bloqueio mantidos, auditoria de affordances legadas |
| Reformulação apagar comportamento do CRM | Perda de seleção, drafts, histórico ou fluxo de conta | Manter hooks/handlers/entidades, comparar antes/depois por família e papéis |
| Hero/gráfico prometer dado indisponível | Métrica falsa | Usar DTO real, rótulo correto e vazio explícito; novas métricas são tarefa funcional |
| Novo shell romper altura/scroll de inbox/canvas | Composer ou validação fora de alcance | `minmax(0,1fr)`, scroll por região, ações no fluxo/chrome estável, QA em telas baixas |
| CSS do SIS colidir com shadcn/Base UI | Estados/overlays incorretos | Tokens semânticos e classes existentes; não copiar resets, bibliotecas ou `data-theme=dark` |
| Fonte/licença e build/localidade | Distribuição ou renderização divergente | Conferir licença, fonte local com loader da versão instalada; fallback legível |
| Capturas exporem dados/QR/credenciais | Vazamento em documentação | Fixture sanitizada, mascarar informações e nunca versionar QR/tokens/segredos |
| Checks disputarem máquina/servidor local | Falha de infra ou falso negativo | Build/suítes serializados pelo coordenador, sem reiniciar containers/volumes |

## 10. Definição de pronto desta versão do plano

- Inventário das **23 páginas**, **12 subáreas de configurações** e principais overlays documentado.
- Correspondências diretas, parciais, novas e adiadas registradas sem equiparar lead, contato, negócio e conversa.
- F1 tem objetivo, whitelist, dependências, ordem, checks, aceite e prompt copiável para LUNA.
- F2–F8 têm escopo, arquivos, dependências e critérios de aceite; QA distingue inspeção realizada de validação futura.
- Funções SIS ausentes, restrições Evolution, defeitos de capturas e diferenças de tokens explícitos.
- Somente este documento é a alteração desta tarefa; nenhum código, banco ou infraestrutura foi modificado.
