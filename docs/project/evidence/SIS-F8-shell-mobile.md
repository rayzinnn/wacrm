# Evidência F8b — shell móvel

Data: 2026-11-16 (America/Sao_Paulo)

## Escopo

- Reproduzir a divergência móvel do relatório [SIS-F8-audit.md](SIS-F8-audit.md) na navegação comum do WACRM, em `/dashboard`, `/contacts` e `/pipelines` (negócios), nos viewports de 320 e 768 px.
- A sessão não alterou shell, rotas, dados, tema, permissões ou outras superfícies. Nenhum registro foi criado ou modificado.

## QA observado no portal local

Portal Maestri `WACRM Local`, localhost, conta sintética local; sem credenciais nesta evidência. O tema observado foi `data-theme=sis`, modo escuro.

| Rota / estado                 | Viewport observado | Resultado                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/dashboard`, drawer fechado  |          319 × 759 | DOM: documento 319 px, rail de 287 px fora da tela (`left=-293`, `right=-6`) e main com 319 px. O snapshot mostrou estado transitório de erro ao carregar o painel; esta observação cobre apenas o shell.                                                                                                                            |
| `/contacts`, drawer fechado   |          320 × 760 | DOM: documento e body 320 px, main 320 px, rail de 288 px fora da tela (`left=-294`, `right=-6`), menu acionador visível. Captura visual mostrou a página em compilação/carregamento; controles e conteúdo da rota não foram homologados.                                                                                            |
| `/contacts`, drawer aberto    |          320 × 760 | O drawer apareceu como diálogo de 288 px, o backdrop cobriu a viewport, o foco inicial foi para “Fechar menu”, o conteúdo permaneceu inerte e o scroll do body foi bloqueado. Escape fechou o drawer; a posição fora da tela e a liberação do scroll foram observadas depois. A restauração de foco ao acionador não foi confirmada. |
| `/pipelines`, qualquer estado |                  — | Não verificado. A navegação solicitada retornou “ok”, mas `info`, métricas e snapshot permaneceram em `/contacts`; não repeti a tentativa.                                                                                                                                                                                           |
| 768 px, estado fechado        |         768 × 1024 | Não verificado. Após o resize, o portal redirecionou para `/login`; um snapshot ainda mostrava o DOM anterior de Contatos e uma leitura seguinte confirmou `/login` sem shell. A leitura intermediária indicou rail de 288 px, porém estava associada a DOM/URL divergentes e não foi tratada como reprodução válida.                |

## Conclusão e limites

- Em 320 px, nos estados estáveis observados, o shell manteve o conteúdo na largura do viewport e ocultou o rail fechado; o drawer de Contatos cobriu a página como overlay. Não foi confirmado o defeito do shell relatado na auditoria.
- Não alterei CSS: a aparente largura de 288 px em 768 px ocorreu durante divergência entre URL e DOM, seguida por redirecionamento para login, portanto não é uma reprodução confiável.
- Contatos estava em carregamento/compilação durante a captura. Dashboard teve estado de erro transitório. Pipelines não abriu; 768 px ficou sem observação válida. O tema claro, teclado completo, 200% de zoom e leitor de tela não foram verificados nesta sessão.
- Não criei, editei ou excluí dados; não enviei mensagens nem executei workflows.

## Checks

- ESLint focado: `src/components/layout/sidebar.tsx`, `src/components/layout/header.tsx` e `src/app/(dashboard)/dashboard-shell.tsx` — passou, 0 erros.
- Busca por testes em `src/components/layout/**` e `src/app/(dashboard)/**` não encontrou testes dedicados a shell/dashboard-shell; nenhum teste automatizado foi executado.
- Typecheck global e build não executados, conforme o recorte e a orientação de coordenação.
- Sem alterações nos arquivos de código do shell.
