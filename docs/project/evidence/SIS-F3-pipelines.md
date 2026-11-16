# Evidência SIS F3 — Pipelines

Data: 2026-11-16 (America/Sao_Paulo)

## Escopo e decisões

- Redesenhei a hierarquia da página, controles do board, indicadores, cartões, formulário de negócio e configuração de pipeline/etapas com superfícies discretas, espaçamento SIS e Flowline entre etapas.
- Mantive o board com dnd-kit e sensores pointer/keyboard; a configuração de ordem das etapas também usa dnd-kit e sensor de teclado. Consultas, ordenação, dados, moeda, filtros, persistência, toasts de erro/sucesso e `GatedButton` com as permissões atuais foram preservados. Nenhuma capability, endpoint ou contrato mudou.
- A entidade continua sendo negócio. Não introduzi score, audiência ou atributos do Instagram.
- QA usou somente a conta sintética local documentada em `evidence/T02.c-smoke`. Nenhum cliente real foi usado; não criei, editei ou removi registros. A captura mostra apenas as etapas vazias existentes.

## Arquivos deste pacote

- `src/app/(dashboard)/pipelines/page.tsx`
- `src/app/(dashboard)/pipelines/pipeline.module.css`
- `src/components/pipelines/pipeline-board.tsx`
- `src/components/pipelines/deal-card.tsx`
- `src/components/pipelines/pipeline-analytics.tsx`
- `src/components/pipelines/deal-form.tsx`
- `src/components/pipelines/pipeline-settings.tsx`
- `docs/project/evidence/SIS-F3-pipelines.md`

## QA renderizado

- A comparação claro/escuro foi feita no portal dedicado WACRM Pipelines com `document.documentElement.dataset.theme === "sis"`; o tema observado não era o violet legado. As capturas SIS claro/escuro foram repetidas nos extremos de 1440 px e 320 px.
- Renderizei e conferi a página em 1440, 1024, 768 e 320 px. O documento não ganhou overflow horizontal; o board mantém scroll horizontal próprio quando a soma das colunas ultrapassa a área disponível. Observação do menor viewport: 5 etapas ocupam cerca de 1424 px de conteúdo para uma área de board de aproximadamente 271 px, com rolagem horizontal interna.
- Em 1440 px, o board também é rolável internamente quando necessário; o documento se mantém dentro de 1440 px. A 1024 px o board fica mais largo que a área disponível e exige rolagem horizontal. Em 768 px, o menu lateral do shell compartilhado ocupa grande parte da área visível; esse comportamento pertence ao shell fora do escopo F3.
- Conferi tema claro e escuro no tema SIS; a tela mostrou nome do pipeline, seis métricas e cinco etapas vazias. Formulário de negócio e configuração de etapas foram abertos e inspecionados sem salvar. Os campos e ações preservam labels, moeda, data, etapa, responsável, notas e controles já existentes.
- Conferi a região do board acessível por teclado e o foco inicial do formulário. A reordenação efetiva por teclado não foi homologada no portal: a conta não tem negócios para testar arraste de cartão e o fluxo de reordenação de etapa não foi concluído. Sensores e instruções de teclado seguem implementados; isso não substitui a confirmação interativa.

## Limites da observação

- A conta sintética contém um pipeline com cinco etapas e zero negócios. Assim, não foi possível observar cartões reais, valores agregados diferentes de zero nem estado de analytics preenchido sem criar dados, o que foi evitado para preservar a base.
- As capturas foram observadas no portal durante a sessão e não foram adicionadas como arquivos ao repositório; o escopo reservado permite apenas este Markdown de evidência fora dos componentes F3.
- Não alterei primitives, globals, tokens ou mensagens. Nenhum ajuste compartilhado foi necessário para concluir este pacote.

## Checks

| Check                                                 | Resultado                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ESLint focal nos componentes TSX de Pipelines         | Passou sem erros                                                                                                    |
| `git diff --check` no escopo F3                       | Passou                                                                                                              |
| `npx vitest run src/lib/pipelines/stage-sync.test.ts` | Passou: 6 testes; Vite exibiu aviso de configuração `configLoader: 'native'`                                        |
| `npm run typecheck`                                   | Falhou nesta execução em `.next/dev/types/validator.ts:5`: `routes.d.ts` não é um módulo                            |
| Prettier nos arquivos do pacote                       | A checagem sinalizou somente este Markdown; `prettier --write` foi aplicado e confirmou o arquivo inalterado depois |
