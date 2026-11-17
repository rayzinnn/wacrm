# SIS F8 — rodada visual de bugs (desktop e mobile)

Data: 17/11/2026 (America/Sao_Paulo)

## Escopo e limites

- Portal Maestri `WACRM Local`, `http://localhost:3000`, sessão local já autenticada, tema SIS escuro.
- Viewports solicitados: 1440×900, 768×1024 e 320×760. O portal reportou 1439×900 ao redimensionar para 1440×900; a página foi avaliada também com largura CSS de 1440 px antes do redimensionamento.
- Telas: login, Dashboard, Inbox, Automações, Fluxos, Configurações e Agentes de IA.
- Não salvei capturas no repositório nem registrei conteúdo de contatos, conversas, conta ou perfil.
- A sessão ativa redireciona `/login` para `/dashboard`; não encerrei a sessão. Portanto, o formulário de login não ficou disponível para inspeção nesta rodada.

## Defeitos reproduzidos e correções

| URL e viewport | Defeito observado | Correção |
| --- | --- | --- |
| `/dashboard`, 1440×900 | Títulos de quatro KPIs secundários eram cortados com reticências nos cartões (“Mediana da primeira resposta”, “Taxa de leitura dos disparos” e rótulos equivalentes). | Em `src/components/dashboard/kpi-tile.tsx`, permitir quebra do título e alinhar o ícone de ajuda ao início do texto. O texto completo foi confirmado na captura após a alteração. |
| `/dashboard`, 768×1024 | Os rótulos dos cartões de atenção eram truncados (“Aguardando resposta”, “Sem responsável”, “Mensagens com falha”). | Em `src/components/dashboard/attention-row.tsx`, remover o truncamento e permitir quebra de linha. Após a alteração, os três rótulos aparecem completos e o `scrollWidth` das labels coincide com a largura disponível. |

Os ajustes alteram apenas apresentação. Não alteram valores, ações, navegação, autenticação, permissões ou dados.

## Rodada por viewport

`documentElement.scrollWidth` e `body.scrollWidth` permaneceram no limite do viewport nos estados estáveis medidos. Listas e conteúdo de páginas mais longas rolam dentro do conteúdo vertical.

| URL | 1440×900 | 768×1024 | 320×760 |
| --- | --- | --- | --- |
| `/login` | Redireciona para `/dashboard` na sessão atual; formulário não observado. | Mesmo comportamento; não inspecionado. | Mesmo comportamento; não inspecionado. |
| `/dashboard` | Captura após carregamento: títulos dos KPIs completos; sem corte horizontal. | Captura após carregamento: atenção e KPIs completos; sem corte horizontal. | Captura após carregamento: cabeçalho e controles empilhados, cartões seguem abaixo da dobra; largura do documento 320 px. |
| `/inbox` | Shell e conteúdo renderizados, sem overflow horizontal do documento. | Documento permaneceu dentro de 768 px. | Lista em largura integral, linhas empilhadas e rolagem vertical; documento 320 px. |
| `/automations` | Documento dentro de 1440 px. | Documento dentro de 768 px. | Cabeçalho e cartões de modelos em coluna; documento 320 px e conteúdo abaixo da dobra acessível por rolagem. |
| `/flows` | Documento dentro de 1440 px. | Documento dentro de 768 px. | CTA e cartão visíveis sem expansão horizontal; documento 320 px. |
| `/settings` | Documento dentro de 1440 px. | Documento dentro de 768 px. | Seletor de seção e cartões empilhados; documento 320 px. |
| `/agents` | Documento dentro de 1440 px. | Documento dentro de 768 px. | Abas Playground/Configuração/Uso cabem na largura; conteúdo do formulário continua por rolagem vertical; documento 320 px. |

## Sobreposição e foco

- Em `/inbox` a 320×760, abri o menu pelo controle da topbar. O drawer recebeu papel de diálogo modal, bloqueou a rolagem do body e o fechamento por Escape restaurou o estado fechado e a rolagem. A navegação permaneceu dentro da viewport.
- Os controles principais de navegação e tema mantiveram nomes acessíveis no snapshot. Não fiz auditoria completa de leitor de tela, tabulação em todas as telas ou zoom real de 200%.
- A inspeção de carregamento do Dashboard em 768/320 teve capturas transitórias de skeleton; aguardei o conteúdo estabilizar e repeti as capturas antes de aprovar os títulos.

## Checks

- Portal: navegação e inspeção nos viewports listados; snapshots e capturas temporárias sem cópias anexadas ao repositório.
- ESLint focado: `src/components/dashboard/kpi-tile.tsx` e `src/components/dashboard/attention-row.tsx` — passou.
- TypeScript: `npm run typecheck` — passou.
- `git diff --check` — passou.
- Testes automatizados não executados; o ajuste é visual e restrito aos dois componentes acima.

## Arquivos desta rodada

- `src/components/dashboard/kpi-tile.tsx`
- `src/components/dashboard/attention-row.tsx`
- `docs/project/evidence/SIS-F8-visual-bugs-round.md`
