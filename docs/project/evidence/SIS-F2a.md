# Evidência SIS F2.a — command rail WACRM

## Escopo entregue

- Shell de navegação redesenhado como rail expandido de 232 px em viewport amplo e recolhido de 72 px em viewport compacto, com drawer sobreposto em viewport móvel.
- Topbar mostra o contexto da rota e o contexto real de conta/papel. A busca global foi removida; nenhuma ação de busca foi simulada.
- Mode toggle permanece ligado ao tema atual e troca apenas entre claro/escuro.
- Rotas, filtros de capability Evolution, badges beta/não lidas, indicador de inbox, identidade e papel, menus de conta, configurações e logout preservados em relação à versão de `HEAD`.
- Drawer fecha por Escape e navegação; mantém o foco inicial no botão Fechar, conteúdo atrás inerte, trava de scroll do body e restaura o foco que abriu o menu. O skip link foi acionado: atualizou a âncora para `#main-content` e focou o `main` com `tabIndex=-1`.
- Catálogos `en`, `pt`, `es` e `ko` receberam os rótulos de menu recolhido, conta, fluxos, agentes e skip link necessários.

## QA visual e navegação

Portal localhost `http://localhost:3000`, sessão administrativa local. Captura ampla revisada em 1440 × 899: rail 232 px, topbar 76 px, contexto “Agentes de IA” e “Administrador local · Proprietário”, rota ativa destacada e sem barra horizontal.

| Viewport pedido | Viewport observado pelo portal | Rail | Topbar | Overflow horizontal |
| --- | --- | ---: | ---: | --- |
| 1440 × 900 | 1440 × 899 | 232 px | 76 px | não |
| 1024 × 768 | 1023 × 769 | 72 px | 64 px | não |
| 768 × 1024 | 769 × 1023 | 72 px | 64 px | não |
| 320 × 760 | 319 × 760 | drawer fechado, fora da tela | 64 px | não |

Também verificado em 767 × 1024 (drawer móvel) e 321 × 760 (sem overflow). O portal normaliza algumas larguras em ±1 px; os checks cobriram os dois lados do breakpoint móvel de 768 px.

- `/agents` e `/flows` carregam com contexto correspondente e link atual; `/settings?tab=appearance` mantém query string e `/settings` ativo.
- `/broadcasts` mostra a indisponibilidade existente para a capability Evolution local; o item não aparece no menu quando a capability está desligada.
- Drawer móvel abre como diálogo, torna o conteúdo inerte e bloqueia scroll. Escape fecha, remove `inert`, libera scroll e devolve foco ao acionador; tentativa de foco fora do drawer é contida no botão Fechar.
- Mode toggle foi exercitado e retornado ao modo escuro inicial. Tema SIS visualizado com fundo escuro neutro e acento roxo existente.
- Presence heartbeat, listeners de notificações e alerta de acesso continuam montados no shell.
- Chaves novas verificadas nos quatro JSONs de tradução.

## Checks de código

- ESLint focado nos quatro componentes de shell: passou.
- `git diff --check` nos arquivos reservados de F2.a: passou.
- Typecheck global final (`npm run typecheck`, `tsc --noEmit`): passou no estado compartilhado atual, incluindo o diff T10 ainda não commitado. Uma execução anterior, durante a edição transitória de T10, reportou nulabilidade em `src/lib/whatsapp/send-message.ts`; o resultado atual está verde.

## Limites de heading

A topbar fornece contexto de rota sem ser heading; páginas existentes mantêm seus próprios H1. O shell acrescenta H1 acessível oculto somente para `/inbox`, que não tem H1 de página. Ainda não têm H1 de página: `/dashboard`, `/pipelines`, `/automations/new`, `/automations/[id]/edit` e o editor `/flows/[id]`. Esses headings pertencem às páginas e ficam fora de F2.a.
