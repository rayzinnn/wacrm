# F8 — QA visual do tema no portal

**Data:** 2026-11-16 · **Portal:** `WACRM Local` · `http://localhost:3000`

## Observado

- Em `/dashboard`, viewport CSS **768×1024**, removi temporariamente apenas a preferência `wacrm.theme` no armazenamento isolado do portal. O DOM reportou `data-theme="sis"`; `wacrm.mode` e `data-mode` permaneceram `dark`.
- Em **1440×1000**, navegar para `/login` redirecionou ao dashboard, pois a sessão já estava autenticada. Assim, a tela de login não ficou observável sem sair da sessão.
- Com `wacrm.theme="violet"` e modo dark salvos no portal, após hidratação a página reportou `data-theme="violet"`. Acionar o controle de modo levou a `data-mode="light"` e salvou `wacrm.mode="light"`. Ao final, solicitei a restauração das preferências SIS/dark; o estado pós-navegação não foi reconfirmado.
- Foram observados apenas atributos de tema/modo e estrutura agregada do dashboard. Não foram salvas capturas.

## Não verificado / limites

- **Inbox:** não verificada por privacidade. Nenhum conteúdo ou captura da conversa foi incluído nesta evidência.
- **320 px:** não verificado. A revisão foi encerrada sem novas tentativas no portal.
- A tela de login não foi validada; o portal redirecionou para o dashboard autenticado.
- Não foi possível confirmar por observação final se a restauração SIS/dark terminou após a navegação.
