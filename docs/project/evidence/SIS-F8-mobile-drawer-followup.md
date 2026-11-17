# F8 mobile drawer follow-up

QA local pelo portal `WACRM Local`, na rota de editor informada, viewport 320×760. O snapshot inicial mostrou o drawer aberto cobrindo o editor (`aside` em x=0); a captura visual confirmou essa composição. Não guardei a imagem porque ela exibia conteúdo da conta e do flow.

## Resultado

- **Limitação do portal, sem defeito visual confirmado no app.** Após Fechar e Escape, `data-open` mudou para `false` e `document.body.style.overflow` voltou ao valor anterior. O `transform` e a captura continuaram em x=0 enquanto a transição CSS reportava `running` e `currentTime=0`, mesmo após a espera do portal.
- Com `transition: none` aplicado somente temporariamente no DOM do portal, o mesmo drawer fechado foi para x≈−294px (largura do rail 288px); removida a transição da página de teste. Isso confirma que o estado fechado e o seletor CSS funcionam quando a animação é renderizada.
- O foco dentro do drawer e o retorno do foco para o botão Fechar ao tentar focar o conteúdo inerte funcionaram no portal. O foco inicial/restaurado agendado por `requestAnimationFrame` não é conclusivo neste portal, cuja animação/RAF ficou congelada.
- Enquanto aberto, o body ficou com scroll bloqueado; ao fechar, o bloqueio foi removido. Nesta altura, o menu não precisava de scroll interno (`scrollHeight` igual a `clientHeight`), e a página não tinha scroll vertical adicional (`scrollY=0`).

## Escopo e checks

Nenhum código do app foi alterado e nenhum dado do flow foi editado. Clique em Fechar e Escape foram exercitados; o estado, geometria, overflow e foco foram inspecionados via portal. Captura e snapshot foram observados no portal, mas não arquivados para evitar persistir conteúdo da conta/flow. `git diff --no-index --check /dev/null docs/project/evidence/SIS-F8-mobile-drawer-followup.md` não reportou problemas de whitespace.

Guias locais do Next 16.3.8 consultados antes de qualquer possível edição: App Router — Server and Client Components, CSS, Layouts and Pages. A implementação visual original SIS consultada foi `src/components/shell/{AppShell.tsx,shell.css}`.
