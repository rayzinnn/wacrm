# Evidência F1 — fundação SIS opt-in

Data: 2026-11-16 · Ambiente: `http://localhost:3000` · Fase: somente F1

## Arquivos deste pacote

- `src/app/fonts/Manrope-Variable.woff2` — cópia da fonte local SIS; SHA-256 `a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972`.
- `src/app/layout.tsx` — `next/font/local`, variável `--font-manrope`, pesos 200–800 e `display: swap`; Inter e boot script permanecem.
- `src/app/globals.css` — tokens SIS isolados em `html[data-theme="sis"][data-mode]`, tipografia, raios e movimento reduzido.
- `src/lib/themes.ts` — metadados do sexto tema; `DEFAULT_THEME="violet"`, `DEFAULT_MODE="dark"` e chaves de storage mantidos.
- `docs/project/evidence/SIS-F1.md` — esta evidência.

## Verificações

| Critério | Resultado |
| --- | --- |
| SIS no picker; temas legados aceitos | Passou: o picker atual exibiu SIS e Violet. Selecionar SIS aplicou o tema sem alterar componentes. |
| Tema SIS claro/escuro | Passou no portal a 1440×1001. Claro: canvas `rgb(244, 246, 248)`, primary `#3b4de8`; escuro: canvas `rgb(10, 10, 10)`, primary `#ededed` e foreground `#111`. |
| Fonte e request | Passou: `getComputedStyle(body).fontFamily` iniciou com Manrope em SIS e com Inter em Violet. O arquivo servido foi um recurso local `localhost/_next/static/media/Manrope_Variable-…woff2`; nenhum host externo foi usado para Manrope. |
| Persistência, reload e hidratação | Passou: `wacrm.theme=sis` e `wacrm.mode=dark` reaplicados após navegação/reload; console sem mensagens de hidratação. O retorno pelo picker gravou `violet` e manteve o modo; o browser foi deixado em Violet/dark. |
| Contraste estático dos tokens | Medido: texto secundário `#5E6673` sobre branco 5,79:1 e sobre canvas claro 5,35:1; terciário dark `#8F8F8F` sobre `#121212` 5,79:1; primary claro `#3B4DE8` sobre branco 6,15:1; texto no botão primary dark `#111111` sobre `#EDEDED` 16,13:1. O terciário claro usa o secundário acessível, não `#7B8491`. |
| Reflow em 320 px | Passou para Aparência: a 320×760 `documentElement.scrollWidth=320`, sem overflow horizontal. Nenhum input aparece nessa tela. |
| Auth em 320 px | Não verificado: a sessão local autenticada redirecionou `/forgot-password` para `/settings`; não foi encerrada para evitar alterar o estado da sessão. |
| Movimento reduzido | Regra SIS delimitada presente em `prefers-reduced-motion: reduce`; walkthrough de animações não realizado. |
| Contratos fora do escopo | Sem alterações em hooks, shell, telas, traduções, APIs, capabilities ou dados; requests e comportamento de negócio não foram exercitados. |

## Checks focados

- `npx eslint src/app/layout.tsx src/lib/themes.ts` — passou.
- `npm run typecheck` — passou antes do aviso de edição concorrente de `src/lib/whatsapp/send-message.ts`; nenhuma mudança TS visual ocorreu depois. Não repetido durante a edição de Quartzo.
- `git diff --check -- src/app/layout.tsx src/app/globals.css src/lib/themes.ts docs/project/evidence/SIS-F1.md` — passou.

## QA visual local

Aparência SIS claro e escuro foram capturados e inspecionados no portal local a 1440×1001. Os PNGs são temporários do portal e não foram adicionados ao repositório, conforme o pacote reservado. O estado de Aparência a 320×760 foi aferido no DOM; não foi possível validar auth nessa largura porque a sessão local redirecionou a rota.

- Dark, 1440×1001: `/var/folders/35/jk9st2dd2dg4f2n2s6m1xk380000gn/T/maestri-portal-8D3D50E8-9BEE-4EA1-853A-E02F14D93F02.png`
- Light, 1440×1001: `/var/folders/35/jk9st2dd2dg4f2n2s6m1xk380000gn/T/maestri-portal-8DCC15F2-162F-4851-9C0B-5121647AB17F.png`

## Pendência

O README e a raiz do protótipo SIS não incluem licença/atribuição da fonte. A fonte foi copiada para a validação local autorizada; confirmar licença e atribuição antes de distribuição.
