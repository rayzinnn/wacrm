# Auditoria F8 — integração visual

Data: 2026-11-16. Auditoria somente leitura dos pacotes concluídos: shell, dashboard, contatos, negócios, Inbox, Settings/IA, automações e notificações. Sem portal, alterações de UI, checks globais ou commit. Referências: seção 8 de `docs/project/sis-integration-plan.md`; `SIS/DESIGN_SYSTEM.md`, tokens, `AppShell.tsx`/`shell.css`, `OverviewScreen.tsx`/`overview.css`, `CrmScreen.tsx`/`crm.css`, `LeadDrawer.tsx` e `SupportScreens.tsx`/`support.css` em `prototype-rebrand`.

## Gaps comprovados

- **HIGH — nenhum confirmado** por esta leitura estática e pelas evidências disponíveis.
- **MEDIUM — default ainda Violet.** `src/lib/themes.ts` mantém `DEFAULT_THEME = "violet"`; F8 seção 8 pede SIS como padrão apenas quando não existe preferência. Preferências já salvas devem continuar intactas.
- **MEDIUM — integração móvel do shell sem resultado coerente.** F2.a registra drawer fechado e fora da tela em 320 px; dashboard relata rail ocupando quase toda a tela, contatos relata drawer cobrindo a página em 320 px e Pipelines relata menu ocupando boa parte em 768 px. A causa não foi confirmada em navegador; precisa de uma reprodução serializada antes de fechar responsividade.
- **MEDIUM — superfícies de contato sem aprovação visual.** F3 registra formulário/importação/campos personalizados com `opacity: 0` no portal e ficha não observada por falta de registro sintético. Os handlers e cinco abas estão no código, mas não há evidência visual confiável desses estados.
- **MEDIUM — Inbox sem thread populada; guard 24h segue legado.** F4 (`13c5dd3`) observa apenas Inbox vazia e confirma que `sessionExpired` ainda bloqueia composer/ações dependentes de janela. F4 preservou a regra; a integração funcional foi delegada a Quartzo e não foi verificada nesta auditoria. Thread populada, limite 24h e estados bloqueado/liberado precisam de QA após a integração.
- **MEDIUM — gates de entrega pendentes.** F1 deixa licença/atribuição de Manrope em aberto para distribuição. F5 IA registra typecheck final e teste de interação do callback de status pendentes. A seção 8 ainda requer a rodada serializada final de `typecheck`, `lint`, testes afetados e `build`.

## Matriz de QA ainda não verificada

| Família | Cobertura registrada | Ainda não verificado |
| --- | --- | --- |
| Shell | Dimensões 1440/1024/768/320, drawer e foco/escape registrados; SIS dark observado | Reflow a 200%, forced colors, leitor de tela e walkthrough de `prefers-reduced-motion`; resolver a divergência móvel acima |
| Dashboard | Estados de setup vazio, filtros/períodos e viewports 1440/1024/768/320 anotados | Dados populados (KPIs/fila/atividade); inspeção visual útil em 320 px, hoje obstruída pelo shell |
| Contatos/ficha | Lista vazia em SIS claro/escuro a 1440; tamanhos registrados | Ficha com cinco abas e registro sintético; overlays visíveis, foco/restauração; busca sem resultado, erro/recuperação e teclado em 320 px |
| Negócios/Pipelines | Board vazio em quatro larguras; SIS claro/escuro nos extremos 1440/320; formulário/configuração abertos sem salvar | Cartões e analytics preenchidos; drag/reordenação efetiva por teclado; recuperação após falha e 200% zoom |
| Inbox | Commit F4 `13c5dd3`; busca/filtro/vazio na árvore; teste unitário da operação idempotente passou | Thread populada, contexto/sidebar, scroll/paginação, mídia histórica, deep link e reconciliação em viewport estreito; fronteira da janela 24h e guard efetivo pós-Quartzo |
| Settings e IA | Settings: rail/abas/deep links, quatro larguras e alternância claro/escuro anotados. IA: Setup vazio e Playground vazio renderizados em 1440; sem ação externa | Permissões de papéis não-owner e ativação por teclado em Settings; IA em SIS claro/escuro e tamanhos completos, Uso com dados, mascaramento de chave armazenada e callback de status no browser |
| Automações | Lista vazia em 4 viewports Violet dark; SIS claro/escuro em 1024; editor em desktop e 320 | Execução/log real ou fixture segura, contenção/restauração do foco validada no browser, leitor de tela, forced colors e zoom 200% |
| Notificações | Vazio em 1440 SIS claro e Violet dark | SIS dark, 1024/768/320, feed não lido/povoado, realtime/deep link e navegação por teclado |

Além da matriz acima, não encontrei capturas sanitizadas versionadas em `docs/project/evidence/sis/`; os relatórios de F1–F6 descrevem capturas temporárias ou inspeções sem artefato armazenado. F8 deve gerar a evidência/capturas sanitizadas por família conforme a seção 8, sem dados pessoais ou segredos.

## Leitura de alinhamento SIS

- O shell usa 232/72 px e drawer móvel; tokens SIS em `globals.css` seguem a decisão do plano de dark neutro, apesar do dark azulado histórico no documento SIS.
- Dashboard conserva dados reais em vez de importar hero/score SIS. Pipeline mantém negócio e scroll interno; contato conserva cinco abas. Automações não portam missões multicanal. IA permanece por conta. Notificações usam feed/vazio do domínio WACRM sem inventar eventos.
- Não identifiquei nesta leitura estática affordance nova que libere capability Evolution ou rota/API adicional.
- F4 manteve o composer e a guarda `sessionExpired` existente; a seleção não valida se a janela liberada/restrita corresponde ao novo contrato funcional delegado.

Sem dados pessoais, credenciais ou QR; nenhum browser/portal foi aberto e nenhum registro foi criado ou alterado nesta auditoria.
