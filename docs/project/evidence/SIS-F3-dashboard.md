# SIS F3 — dashboard

## Escopo implementado

- `src/app/(dashboard)/dashboard/page.tsx`: aumentei o respiro vertical da composição e dei um pouco mais de área ao gráfico de volume em relação à fila; carregamento, filtros, consulta, realtime, permissões, moeda, timezone, estados e handlers foram preservados.
- `src/components/dashboard/overview-header.tsx`: saudação localizada é o `h1` da página, com hierarquia editorial e separador usando tokens existentes. Períodos continuam em `?range=` e as ações mantêm os destinos existentes.
- `src/components/dashboard/kpi-row.tsx` e `kpi-tile.tsx`: conversas novas recebe destaque visual; os outros quatro indicadores reais seguem visíveis com comparações e rodapés atuais. Nenhuma série de receita, audiência ou score foi criada. Valor de negócios ganhos permanece vinculado à moeda configurada.

Não houve mudanças em mensagens, shell, primitives, tokens/globals, API, SQL ou telas de contatos/pipeline. Nenhum dado pessoal ou credencial foi incluído nesta evidência. Não foram criados/alterados registros.

## Verificações

- `npx eslint 'src/app/(dashboard)/dashboard/page.tsx' src/components/dashboard/overview-header.tsx src/components/dashboard/kpi-row.tsx src/components/dashboard/kpi-tile.tsx` — passou.
- `npm run typecheck` — passou na primeira rodada. Repetição após o `h1` acessível na tela de erro ficou sem saída por mais de dois minutos, durante a instabilidade local de Auth; foi interrompida para não prolongar o QA, sem diagnóstico de TypeScript emitido.
- `git diff --check` nos quatro arquivos alterados — passou.
- Portal WACRM Local: conta em configuração inicial vazia, `?range=7`, saudação e lista de configuração renderizadas. O tema SIS claro foi conferido visualmente em 1440 px; a métrica principal e a hierarquia aparecem somente quando os dados reais permitem sair do estado de setup.
- Matriz no portal: 1440, 1024, 768 e 320 px em modo claro e escuro. Em 1440/1024/768 a largura do documento não excedeu o viewport. Em 320 px, `scrollWidth` permaneceu dentro da largura disponível (303–320 px conforme captura), mas o rail móvel do shell ocupou visualmente quase toda a viewport embora `data-open="false"`; o dashboard atrás dele não ficou visualmente verificável nesse tamanho. O shell não foi alterado neste recorte.
- Teclado: foco e avanço por seta no seletor de período, ativação por Espaço (mudou para 30 dias), com `qa=1` preservado pela URL. Deep link `?range=90` foi aceito. O skip link permaneceu fornecido pelo shell.
- Limite do portal: durante a sessão, o perfil local mudou e houve falha intermitente de carregamento. Infra reportou `supabase_auth_wacrm-local` unhealthy às 16:12, com Next `/login` respondendo 200 e demais containers healthy. Não repeti login nem usei dados de pessoas; por isso, cards com métricas, fila e atividade com dados reais não foram visualmente confirmados. O QA visual de desktop cobre o estado de setup vazio, não dados populados.

## Estado

Pronto para revisão. Sem commit; F4/F2b ou outras telas não foram iniciadas neste recorte.
