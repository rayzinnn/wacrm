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

## Complemento pela coordenação: Chrome local

Depois da falha do portal, abri `/login` em Chrome headless descartável e usei
o protocolo de depuração para fixar uma viewport **real de 320 × 760 CSS px**.
O navegador retornou `innerWidth=320` e `documentElement.scrollWidth=320`,
sem overflow horizontal. O link “Esqueceu a senha?” estava dentro da viewport;
a [captura escura de 320 px](sis/F7-login/after-dark-320-cdp.png) mostra o
formulário completo. Cinco pressões de Tab focaram, em ordem, e-mail, senha,
recuperação, Entrar e Criar conta. Nenhum formulário foi enviado.

O Chrome em modo headless impõe largura mínima de 500 px ao argumento
`--window-size`; por isso a primeira captura com esse argumento foi descartada
como evidência de 320 px. A medição acima usou
`Emulation.setDeviceMetricsOverride` e verificou `innerWidth` antes de aceitar
a captura. Repeti a viewport de 320 px com a preferência local SIS claro:
`innerWidth=scrollWidth=320`, link de recuperação visível e
[captura clara de 320 px](sis/F7-login/after-light-320-cdp.png). Também observei
o layout em 1440 px no mesmo Chrome, sem inserir dados. Este complemento
comprova o reflow em 320 px nos dois modos e a ordem de Tab no login escuro;
**zoom real de 200%, anel de foco observado e Shift+Tab permanecem pendentes**.
Não alterei o código do login.
