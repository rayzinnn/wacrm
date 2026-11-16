# Evidência SIS F6 — Fluxos

Data: 2026-11-16 (America/Sao_Paulo)

## Escopo

- Reorganizei visualmente a biblioteca de fluxos, o diálogo de criação, o chrome do editor, a alternância Canvas/Lista, formulários de nós, painel de validação e histórico de execuções com superfícies e espaçamentos SIS.
- Mantive a lógica de estado do editor, XYFlow, dagre, tipos/catálogo de nós, conexões, validação, salvar/ativar/pausar, execuções, permissões, APIs e banco sem alteração. Em larguras abaixo de 768 px, a implementação continua selecionando a Lista e preservando a preferência desktop; essa condição de editor não pôde ser observada porque a conta não contém fluxos.
- Não criei, editei, salvei, publiquei ou executei fluxo. Nenhuma mensagem WhatsApp foi enviada.

## Arquivos do pacote

- `src/app/(dashboard)/flows/page.tsx`
- `src/app/(dashboard)/flows/flows.module.css`
- `src/app/(dashboard)/flows/[id]/runs/page.tsx`
- `src/app/(dashboard)/flows/[id]/runs/runs.module.css`
- `src/components/flows/flow-editor-shell.tsx`
- `src/components/flows/flow-editor.module.css`
- `src/components/flows/header.tsx`
- `src/components/flows/flow-builder.tsx`
- `src/components/flows/flow-canvas.tsx`
- `src/components/flows/validation-panel.tsx`
- `src/components/flows/forms/node-config-form.tsx`
- `docs/project/evidence/SIS-F6-flows.md`

## QA observado no portal local

| Verificação     | Resultado observado                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessão          | Conta sintética local A autenticada como proprietária. Credenciais não foram incluídas na evidência.                                                                            |
| Tema e viewport | `data-theme=sis`, modo claro, 1440 × 901 px.                                                                                                                                    |
| Biblioteca      | `/flows` renderizou a lista vazia com ação de criar e orientação; a conta não tem fluxo cadastrado.                                                                             |
| Diálogo         | Abriu sem salvar: mostrou três modelos, campo de nome, Cancelar e ação de criar em branco desabilitada enquanto o campo está vazio. Nenhum modelo foi escolhido.                |
| Teclado         | O snapshot mostrou foco no primeiro modelo. Após Tab, o foco continuou no mesmo botão; Escape não fechou o diálogo nessa tentativa. A navegação por teclado não foi homologada. |
| Captura         | A árvore acessível e o estado do DOM foram observados. O comando de screenshot do portal falhou com `status 0`; nenhuma imagem foi anexada.                                     |

## Limites desta sessão

- Como não havia fluxo na conta sintética, não foi possível observar visualmente o canvas, a vista em lista do editor, nós/conexões, edição de formulário de nó, validação de um fluxo real ou relatório de runs. Não criei um fluxo para preencher essa lacuna.
- O portal apresentou carga instável. A QA visual encerrou-se em 1440 px no tema SIS claro; 1024/768/320 px e tema escuro ficaram sem observação renderizada. A regra de lista abaixo de 768 px permaneceu intacta no código, mas não foi verificada no navegador.
- A sessão não executou nem publicou fluxos e não enviou WhatsApp.
- Não alterei engine, APIs, SQL, hooks de estado, catálogos, tokens, globals ou primitives.

## Checks

| Check                                                                                               | Resultado                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint focal em páginas e componentes de Fluxos                                                     | 0 erros; 7 avisos existentes: dependências de efeitos e variáveis locais sem uso.                                                                             |
| `npx vitest run src/components/flows/shared.test.ts src/components/flows/flow-editor-state.test.ts` | Passou: 18 testes. Vite mostrou aviso de configuração `configLoader: 'native'`.                                                                               |
| `git diff --check` no escopo F6                                                                     | Passou antes da criação desta evidência.                                                                                                                      |
| Prettier                                                                                            | Formatação executada nos arquivos de código F6.                                                                                                               |
| `npm run typecheck`                                                                                 | Adiado para F8 conforme orientação da coordenação, devido aos 503 causados por execuções globais simultâneas. `.next` não foi limpa nem alterada manualmente. |
