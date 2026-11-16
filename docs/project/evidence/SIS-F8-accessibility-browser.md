# Evidência F8 — teclado e foco visível

Data: 2026-11-16 (America/Sao_Paulo)

## Escopo e privacidade

- Revisão de Dashboard, Inbox, Configurações e Agentes de IA no código local, limitada a foco/teclado e rótulos de controles.
- Usei somente o portal novo `WACRM F8 A11y LUNA fresh`, sem sessão, em `/login`. Não abri o portal `WACRM Local`, Inbox autenticada, contatos, mensagens ou valores de chaves.
- Não criei dados, fixtures ou testes, e não enviei mensagens nem executei workflows.

## Correções de baixo risco

- `src/components/agents/ai-playground.tsx`: textarea do Playground tinha `outline-none` e apenas troca sutil de borda; agora tem indicador `focus-visible` de 2 px.
- `src/components/inbox/message-composer.tsx`: campo de legenda de anexo tinha `outline-none` e apenas troca de borda; agora tem rótulo acessível e indicador `focus-visible` de 2 px. A área principal de mensagem já tinha foco visível.
- `src/components/settings/deals-settings.tsx`: seletor de moeda tinha anel de 1 px e rótulo sem associação; agora liga o `<Label>` ao select e usa anel `focus-visible` de 2 px.
- `src/components/settings/ai-config.tsx` e `messages/{pt,en,es,ko}.json`: botão de mostrar chave saiu de `tabIndex=-1`, recebe rótulo localizado Mostrar/Ocultar conforme `showKey` e mantém `aria-pressed`. A chave continua mascarada por padrão. Em coreano, os valores verificados são `API 키 표시` e `API 키 숨기기`, sem espaços extras.
- Dashboard usa os botões compartilhados que já definem `focus-visible:ring-3`; não fiz alteração nessa rota.

## Verificação de teclado e foco

- Portal novo e sem sessão: snapshot de `/login` expôs E-mail, Senha, Esqueceu a senha, Entrar e Criar conta. `data-theme=sis`, modo escuro. Uma tentativa de Tab deixou `document.activeElement` no body; o foco visível não foi confirmado nessa tela.
- Toggle de chave: verificação pelo código confirma botão nativo `type="button"`, agora incluído na ordem natural de Tab, sem `tabIndex=-1`; Enter/Space ativam o mesmo `onClick` que alterna `showKey`, com `aria-pressed` refletindo o estado. Não testei essa interação no navegador: Configurações/IA exigem sessão e não usei portal autenticado.
- Dashboard, Inbox, Configurações e IA: revisão estática dos componentes. Não verifiquei a ordem real de Tab, outline computado ou ativação de controles no browser dessas rotas.
- SIS claro, zoom de 200%, leitor de tela, forced colors e o restante da interação de login ficaram sem teste. Não alego cobertura desses estados.

## Checks

- ESLint focal nos quatro TSX alterados: passou sem erros.
- JSON parseado e `showApiKey`/`hideApiKey` conferidos em `messages/pt.json`, `en.json`, `es.json` e `ko.json`; todos passaram.
- `npm run typecheck`: falhou em `src/lib/ai/evolution-reply-executor.ts`, arquivo novo que Cedro está editando em paralelo. As mensagens citam incompatibilidades de tipos em `AiGenerationClaim`, `DispatchStepClaim` e `EvolutionTextSendInput`; não alterei nem investiguei esse arquivo.
- Nenhum teste automatizado foi criado ou executado. O tsconfig temporário de triagem foi removido; o resultado acima é do comando global solicitado.
- `docs/project/status.md` já tinha alterações compartilhadas; para não sobrescrever trabalho alheio, esta evidência registra o estado e os limites do recorte.
