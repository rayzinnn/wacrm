# F8 — QA de acessibilidade do login

**Status: limitado; sem aprovação visual nesta passada.** O portal solicitado, WACRM Login revisão, não ficou acessível pelo driver: `cua.getState()` retornou `Browsers: Error: The browser access host is unavailable`. Não consegui abrir `/login` nesta rodada.

## Verificações solicitadas

- Zoom do navegador a 200%: não verificado; o driver não disponibilizou navegador para controlar ou observar o zoom.
- Teclado e foco visível: não verificados; não foi possível enviar Tab nem observar o foco no portal.
- Overflow em 320 px, temas SIS claro e escuro: não verificado nesta rodada.
- Overflow em 1440 px, temas SIS claro e escuro: sem nova medição nesta rodada. Há capturas anteriores do login em 1440 px e 390 px nos dois temas em [SIS-F7-login-refresh.md](SIS-F7-login-refresh.md), mas elas não substituem a inspeção de zoom e teclado pedida agora.
- Formulários: nenhum preenchido ou enviado. Nenhuma conta real foi usada.

Como não houve renderização disponível para esta verificação, não identifiquei defeito concreto que pudesse corrigir com segurança. Não alterei código.

## Checks

- ESLint focado em `auth-frame.tsx` e `login/page.tsx`: passou.
- Sem testes de navegador nesta rodada; driver indisponível.
- Sem commit.
