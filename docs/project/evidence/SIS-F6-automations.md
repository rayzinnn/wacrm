# Evidência SIS F6 — Automações

Data: 2026-11-16 (America/Sao_Paulo)

## Escopo

- Redesenho limitado à biblioteca, editor e logs em `src/app/(dashboard)/automations/**` e `src/components/automations/**`.
- Referência consultada: `src/screens/support/SupportScreens.tsx` e `src/screens/support/support.css` de `prototype-rebrand`; plano F6 e seção de desenho de Automações.
- Sem mudanças em engine, API, banco, mensagens, tokens, primitives ou shell. Não foi criada nem ativada automação e nenhuma mensagem foi enviada.

## O que mudou

- Biblioteca com cartões SIS, hierarquia editorial, estados de execução existentes e total de execuções calculado dos dados carregados. Templates continuam levando aos mesmos deep links.
- Editor linear com cartões e conexões ampliados, configurações preservadas, resumo de passos legível e cabeçalho em duas linhas no viewport estreito.
- Editor em `z-[65]`, acima do rail F2.b (`z-index: 60`) e abaixo dos overlays compartilhados (`z-[70]`). Enquanto o editor está montado, rail, cabeçalho do shell e link de salto ficam `inert`; o valor anterior é restaurado no unmount.
- Gatilhos, condições, timezone, recursos, mutações da árvore, serialização, validações, permissões, handlers e payload de salvar permaneceram nos mesmos pontos.
- Logs mantêm a expansão por execução e exibem sucesso, parcial, falha e etapa ignorada com texto e ícone, além de mensagens de erro sem truncamento.

## QA visual local

- Portal usado: `WACRM Automações`, sessão isolada autenticada com a conta de teste local lida de `.local/dev-credentials.json`. Credenciais não foram incluídas nesta evidência nem em saída de comando.
- Biblioteca no tema violet escuro: 1440×1000, 1024×900, 768×1024 e 320×760. No viewport de 320 px, conteúdo e cartões empilham sem overflow horizontal visível.
- Biblioteca no tema SIS: 1024×900 em claro e escuro. O teste revelou e corrigiu a superfície dos cartões-template no modo escuro; ambos os modos foram observados novamente após a correção.
- Editor: 1024×900 em SIS escuro e 320×760 em violet escuro. Em 320 px, a inspeção visual confirmou o editor sobre o rail móvel (editor z-65, rail z-60), cabeçalho sem sobreposição e sequência em uma coluna. O portal não permitiu confirmar por navegação completa se todo controle subjacente fica fora da ordem de foco; o estado `inert` foi aplicado ao shell e restaurado ao fechar o editor.
- Largura de documento medida igual à viewport em 768 e 1024 px. Sem alterações de formulário foram salvas.
- Tema original restaurado ao final: violet escuro. Portal deixado em `/automations`.

## Limites observados

- A conta local de teste não tem automações nem execuções persistidas; o estado vazio da biblioteca foi verificado, mas não havia uma execução real para abrir e inspecionar na tela de logs. Não foram criados dados artificiais nem disparada execução.
- Limite do portal no teste mobile/teclado: embora o rail apareça coberto no screenshot de 320×760 e o shell estivesse `inert` durante o editor, a árvore de acessibilidade do portal ainda listou alguns controles do shell e o envio de `Tab` não avançou de modo confiável. Portanto, o overlay foi validado visualmente, mas isolamento completo da árvore de acessibilidade e ordem de foco por teclado permanecem **não verificados**. O teste não demonstra falha reproduzível de foco no navegador real.
- Leitor de tela real, forced colors e zoom manual de 200% não foram verificados.

## Checks

- `npm run typecheck`: aprovado.
- Vitest focado (`builder-tree`, `steps-tree`, `time-of-day`, `validate`): 4 arquivos, 56 testes aprovados.
- ESLint nos arquivos F6 alterados: 0 erros; avisos de dependência de hooks já presentes em `automations/page.tsx` (`load`) e `[id]/logs/page.tsx` (`t`).
- Prettier nos três arquivos alterados: aprovado.
