# F8 — QA visual de Settings e Agents (fixture sintética)

**Data:** 2026-11-16 · **Origem:** portal Maestri novo · `http://localhost:3000`

## Sessão

- A aba abriu em `/signup` sem cookie de autenticação. O cadastro sintético foi criado no Supabase local (`127.0.0.1:54322`); nenhuma conta existente foi aberta.
- A conta e o usuário foram removidos por IDs exatos. A verificação encontrou **zero resíduos em 72 escopos** relacionados à fixture. Cookies de autenticação foram limpos. O portal foi preservado em `/login` (1440×900).
- Não houve screenshot, alteração de configurações, chamada de provedor externo ou ação de WhatsApp. Nenhum email, UUID, token ou segredo aparece nesta evidência.

## Resultados

| Rota | Viewport / tema | Resultado observado |
| --- | --- | --- |
| `/agents` | 320×800, SIS dark | 3 tabs: Playground [16–104], Configuração [108–195], Uso [199–287] px. Todas dentro da viewport; `document` e `main` sem overflow horizontal. |
| `/agents` | 320×800, SIS light | As mesmas 3 tabs e limites; `document` sem overflow horizontal. |
| `/settings?tab=overview` | 320×800, SIS light/dark | Deep link selecionou “Visão geral”; sem overflow horizontal de `document` ou `main`. |
| `/settings?tab=appearance` | 320×800, SIS light | Deep link selecionou “Aparência”; sem overflow horizontal de `document` ou `main`. |
| `/settings?tab=appearance` | 320×800, SIS dark | Deep link selecionou “Aparência”. `document` sem overflow, mas `main.scrollWidth > main.clientWidth`. Um badge de estado termina em x=323, 3 px além da viewport; o contêiner interno mede 307 px de scroll para 271 px de largura. **Reprodução:** abrir Appearance em SIS dark a 320 px. |
| `/settings?tab=overview` | 1440×900, SIS light/dark | Deep link selecionou “Visão geral”; sem overflow horizontal de `document` ou `main`. |
| `/settings?tab=appearance` | 1440×900, SIS light/dark | Deep link selecionou “Aparência”; sem overflow horizontal de `document` ou `main`. |

## Foco e limites

A sequência de teclado chegou a uma tab selecionada. A leitura DOM retornou `:focus-visible=false`, `outline-style=none` e sombra totalmente transparente. Como a ativação inicial de foco foi feita pelo driver Maestri, **foco visual fica inconclusivo**; confirmar com teclado físico antes de aprovar esse critério.

O único defeito visual confirmado nesta amostra é o overflow interno em Appearance, 320 px, SIS dark. O resto da cobertura acima foi observado apenas nas combinações listadas; não extrapolar para outros estados ou conteúdo.

## Correção do overflow de Appearance

**Data:** 2026-11-16 · **Portal:** `WACRM appearance overflow fix synthetic QA 2026-11-16`

- Em `src/components/settings/appearance-panel.tsx`, o tile de modo usa duas linhas em viewport estreita: ícone/rótulo acima e badge ativo abaixo. O texto e badge continuam renderizados; a partir de `sm` o tile volta ao alinhamento horizontal anterior.
- Portal de conta sintética local, `/settings?tab=appearance`, SIS dark, 320×800: `document.scrollWidth/clientWidth = 320/320`; `main.scrollWidth/clientWidth = 303/303`. Tile ativo: x=158–270; badge: x=171–229, dentro do tile. O overflow interno reportado não se reproduziu.
- SIS dark, 1440×900: `document = 1440/1440`; `main = 1135/1135`. Rótulo e badge mantêm o mesmo centro vertical (y=441), preservando a composição desktop.
- ESLint focado (`src/components/settings/appearance-panel.tsx`) e `npm run typecheck` passaram. Não adicionei teste de busca de classes; a verificação da correção foi feita sobre o DOM renderizado no portal.
- Limite: esta correção foi conferida em 320 px e 1440 px somente no tema SIS escuro; não foi feita captura.
- A fixture sintética foi excluída por IDs exatos (uma conta e um usuário); verificação local retornou zero resíduos nos 72 escopos relacionados. Cookies de sessão foram limpos. O portal permanece aberto em `/login` (1440×900).
