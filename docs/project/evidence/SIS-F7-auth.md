# SIS F7 — autenticação e convite

Data: 2026-11-16
Escopo: `/login`, `/signup`, `/forgot-password`, `/reset-password` e `/join/[token]`.

## Implementação

- As rotas de auth e convite compartilham um frame editorial SIS: formulário responsivo à esquerda e painel de identidade carvão à direita em telas `lg` ou maiores.
- Os formulários usam hierarquia de título consistente, superfícies com tokens do tema e campos/alvos principais com 44 px. A apresentação dos erros passa a usar regiões de alerta acessíveis.
- `/join/[token]` preserva acesso híbrido, `no-referrer`, metadados de robots, peek/redeem e as ações explícitas de conflito. Nenhuma aceitação automática foi adicionada.
- Handlers, redirects de sessão, chamadas Supabase, textos compartilhados, APIs, banco e tokens/globals não foram alterados. O redirect de página inteira existente permanece para propagar cookies de sessão.

## QA executado

Portal local dedicado: `WACRM F7 Auth QA` (`localhost:3000`). As observações foram sanitizadas; nenhuma captura foi salva na evidência.

| Caso | Resultado |
| --- | --- |
| Login sem preencher, 1440×1001, tema escuro | Frame e formulário visíveis; painel de marca escuro e conteúdo claro após correção de contraste. |
| Login sem preencher, 1440×1001, tema claro SIS | Formulário e painel carvão legíveis; tema aplicado apenas no DOM do portal, sem persistir preferência. |
| Login, 1024×900 | Grade de duas colunas visível; painel lateral presente; `scrollWidth` igual à largura do viewport. |
| Login, 767×1024 (resize solicitado em 768) | Painel lateral recolhido; formulário visível; sem overflow horizontal. |
| Login, 321×759 (resize solicitado em 320) | Formulário ajustado à largura; campos e ação de 44 px; sem overflow horizontal. |
| Cadastro, 321×760 | Nome, email, senha, confirmação e CTA presentes; campos/CTA com 44 px. Nenhum cadastro foi enviado. |
| Login com `link_expired` e contexto de convite sintético | Aviso de expiração e caminho de entrada foram renderizados. Nenhum token real foi usado. |
| Convite sintético inválido | A rota apresentou estado recuperável com ações de cadastro/entrada em uma observação do portal; não houve tentativa de resgate. |
| Navegação por teclado | Não verificada: a automação do portal não avançou o foco com Tab de forma confiável; o host alternativo de navegador estava indisponível. |
| Login com conta fixture / sessão autenticada | Não verificado: as ações finais do portal retornaram `status 0`; não houve confirmação de envio do formulário nem captura pós-login. |
| Solicitação de email, confirmação de envio e reset com sessão de recuperação | Não verificados em browser; não foram disparados emails nem alteradas credenciais. |
| Papéis/convite aceito, conflito de vínculo, troca de conta e guardas autenticadas | Não verificados em fluxo autenticado; nenhum convite real ou vínculo foi alterado. |

## Checks

- `npm test -- src/app/auth/callback/route.test.ts`: **passou**, 8 testes.
- ESLint focado nas rotas F7: **0 erros**; 1 warning existente em `join/[token]/page.tsx:187` sobre o redirect completo deliberado para atualizar contexto de sessão.
- Prettier nos arquivos F7: **passou**.
- `git diff --check` no escopo F7: **passou**.
- `npm run typecheck`: interrompido por solicitação após cerca de 4 minutos sem saída, sob carga de múltiplos `tsc` concorrentes. Processo desta sessão encerrado com código 130; nenhum `.next` ou serviço foi alterado. O typecheck fica para a janela serializada de F8.

## Limitações

O QA visual cobriu os formulários em todos os breakpoints indicados, mas não confirmou a sessão autenticada nem os estados que dependem de envio de email ou de convite válido. A fixture local não foi alterada. Nenhuma captura com dados de conta, credenciais ou token foi mantida.
