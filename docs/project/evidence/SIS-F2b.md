# Evidência SIS F2.b — primitives e overlays

## Revisão e ajustes

- A revisão dos estilos confirmou conflito de stacking com o shell F2.a: rail em `z-index: 60`, enquanto dialog, sheet, menus e popovers estavam em `z-50`. As camadas de Dialog, Sheet, DropdownMenu, Popover, Select e Tooltip foram elevadas para `z-[70]`, acima do rail.
- Dialog e Sheet usam fundo de backdrop neutro `black/50` em ambos os modos. O conteúdo continua usando `popover`/`popover-foreground`, tokens semânticos que já variam por tema.
- Dialog passou a limitar a altura a `100dvh - 2rem` e rolar verticalmente com overscroll contido. Sheet limita a `100dvh` e faz o mesmo. Popover, dropdown e select usam a altura disponível do posicionador; foram adicionadas regras de overscroll contido. ScrollArea também contém o overscroll do seu viewport.
- As primitives Base UI continuam responsáveis por portal, comportamento modal, Escape e gestão/restauração de foco; os wrappers não substituem esses comportamentos.
- `ThemedToaster` não precisou de mudança: acompanha `mode`, aplica `popover`/`popover-foreground` via CSS vars e Sonner usa z-index `999999999`, acima das camadas modais.

## Verificações

- ESLint focado nas sete primitives alteradas: passou.
- `npm run typecheck`: passou.
- Teste existente `src/components/ui/dropdown-menu-group-label.test.tsx`: 2 testes passaram.
- `git diff --check` nos arquivos de primitives: passou.
- Um teste exploratório de SSR para conferir markup de portals falhou porque Base UI não emite os portals nesse caminho SSR. O teste foi removido: não demonstrava comportamento real de foco nem stacking.

## QA visual e limites

QA visual SIS claro/escuro e a caminhada de teclado em overlays: **não confirmados**. O portal isolado abriu a tela de login sem árvore acessível estável; a tentativa de leitura em outra instância encontrou a página oculta (`visibilityState=hidden`) e animações paradas em `currentTime=0`. A janela compartilhada também estava sendo usada por outra navegação. A avaliação final, portanto, é baseada nos wrappers, nas regras CSS, no contrato das primitives Base UI e nos checks de código acima; foco visual, stacking renderizado, contraste após composição e comportamento em tela real permanecem pendentes.

O portal criado para QA ficou na tela de login. Nenhuma credencial foi registrada nesta evidência. Não houve criação ou alteração de registros da aplicação.

## Escopo de arquivos

Alterados apenas `src/components/ui/dialog.tsx`, `sheet.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `select.tsx` e `scroll-area.tsx`. O toaster, tokens/globals, mensagens, shell, API, SQL e páginas não foram alterados.
