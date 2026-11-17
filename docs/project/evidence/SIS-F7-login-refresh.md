# F7 — Revisão visual do login

**Status: pronto para revisão.** A tela de login foi atualizada para retirar o card pesado e a marca duplicada, seguindo a composição editorial de `.auth-stage`, `.auth-panel` e `.auth-signal` da referência SIS. O formulário, os handlers, as traduções, os estados, os destinos e os controles de acesso existentes foram preservados.

## Verificação renderizada

As capturas foram feitas no portal dedicado **WACRM Login revisão**, em `/login`, sem sessão autenticada nem dados de conta. O DOM indicava `data-theme="sis"` nos estados claro e escuro. Nenhum formulário foi preenchido ou enviado.

- Antes, desktop 1440: [before-1440.png](sis/F7-login/before-1440.png)
- Antes, mobile 390: [before-390.png](sis/F7-login/before-390.png)
- Depois, escuro, desktop 1440: [after-dark-1440.png](sis/F7-login/after-dark-1440.png)
- Depois, escuro, mobile 390: [after-dark-390.png](sis/F7-login/after-dark-390.png)
- Depois, claro, desktop 1440: [after-light-1440.png](sis/F7-login/after-light-1440.png)
- Depois, claro, mobile 390: [after-light-390.png](sis/F7-login/after-light-390.png)

No login, confirmei marca única, painel lateral com Flowline, controles e links visíveis, e ausência de overflow horizontal nas larguras observadas. No mobile, o painel decorativo fica oculto e a composição mantém uma coluna.

## Limites e checks

Após o typecheck, tentei reabrir o portal para uma passada rápida em `/signup` e `/forgot-password`, sem enviar formulários. O host do navegador retornou `Browsers: Error: The browser access host is unavailable`; portanto, essas duas rotas não tiveram nova confirmação visual. Revisei por código que ambas continuam usando `AuthFrame`; o mesmo vale para `/reset-password`. Nenhuma conta, email ou alteração de senha foi criada.

- `npx eslint` nos arquivos AuthFrame e nas quatro páginas de autenticação: passou.
- `npm run typecheck`: passou (`tsc --noEmit`, exit 0).
- Não há testes dedicados listados no recorte `(auth)`.
- Sem teste de envio/autenticação, leitor de tela ou outros navegadores.
- Sem commit.
