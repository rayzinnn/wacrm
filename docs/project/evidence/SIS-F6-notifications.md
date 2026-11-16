# Evidência SIS F6 — Notificações

Data: 2026-11-16 (America/Sao_Paulo)

## Escopo e implementação

- Alterada somente `src/app/(dashboard)/notifications/page.tsx`.
- Cabeçalho editorial, contador de não lidas, feed em linha do tempo e estado vazio seguem a linguagem SIS, usando tokens e traduções existentes.
- A indicação de não lida aparece em texto visível junto do título. Título, corpo e horário podem quebrar linha; o foco do item tem contorno visível.
- Mantidos a consulta limitada pela conta (`account_id`), ordenação descendente por `created_at`, limite de 100, atualização realtime, ações de marcar individual/todas como lidas e deep link `/inbox?c=...`. Sem alteração no listener de browser, APIs, banco, shell ou mensagens.

## QA local observado

- Portal dedicado `WACRM Notifications QA`, em localhost, autenticado com a conta sintética local B. Nenhum segredo foi registrado.
- Em 1440×961, `/notifications` renderizou o estado vazio da conta B, o contador `Não lidas 0` e “Marcar todas como lidas” desabilitado.
- Com Aparência SIS selecionada, a página renderizou em claro; leitura do documento confirmou `document.documentElement.dataset.theme === "sis"` e `dataset.mode === "light"`.
- Uma captura anterior em violet/escuro também mostrou a página vazia. Nenhuma notificação foi inserida, aberta ou marcada; não houve alteração de dados nem disparo externo.

## Limites

- Após a captura SIS clara, o snapshot do portal retornou `status 0`. Conforme orientação, não houve novas tentativas. SIS escuro, breakpoints móveis e percurso por teclado ficam **não verificados**.
- A conta sintética não tinha notificações persistidas. Portanto, feed preenchido, badge visível em item não lido, navegação pelo deep link e atualização de leitura não foram exercitados visualmente.
- O portal dedicado foi deixado na preferência de aparência usada no teste (SIS/claro); não foi possível confirmar uma restauração após a falha do portal. Essa alteração é local à sessão de QA; nenhum dado do CRM foi gravado.

## Checks executados uma vez

- `npm run typecheck`: aprovado.
- `npx eslint 'src/app/(dashboard)/notifications/page.tsx'`: aprovado, sem avisos.
- `npx vitest run src/lib/notifications/unread-count.test.ts`: 1 arquivo, 7 testes aprovados.
- `npx prettier --check 'src/app/(dashboard)/notifications/page.tsx'`: aprovado.

Sem commit.
