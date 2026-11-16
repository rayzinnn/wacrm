# Evidência SIS F5 — Agentes de IA

Data: 2026-11-16. Escopo: `agents/page.tsx`, componentes `agents/*`, `settings/ai-config.tsx` e `settings/ai-knowledge.tsx`, conforme F5 e seção 5 de `docs/project/sis-integration-plan.md`.

## Alterações

- Página `/agents` recebeu cabeçalho editorial, indicador discreto derivado de `configured`/`is_active` e abas SIS com hierarquia linear; as abas continuam sendo Playground, Configuração e Uso, com Uso restrito a `canEditSettings`.
- Playground passou a compor a conversa com um bloco lateral de contexto e atalho para configuração. Payload `{ messages: [{ role, content }] }`, estados da conversa, reinício, erros e handoff continuam nos mesmos handlers.
- Configuração e base de conhecimento receberam superfícies, agrupamentos e vazios redesenhados. Fluxo por conta, papéis, DTOs, máscaras de segredo, validação, salvar/testar/remover, CRUD de conhecimento e reindexação não foram alterados.
- Uso recebeu cartões e estado vazio redesenhados, preservando período, chamadas, tokens, modos, modelos e série diária do endpoint. Nenhum custo foi estimado.
- Ajuste de revisão: o badge usa `Agents.statusActive`, `Agents.statusPaused` e `Agents.statusNotConfigured`, com rótulo visível nos quatro catálogos. O wrapper interno da página é `div`, preservando classes sem aninhar outro landmark `main`.
- A página recebe mudanças de estado pelo callback opcional do `AiConfig`; fetch, save e remove notificam `configured`/`isActive` ao pai sem modificar payloads.
- O spinner da configuração usa a nova chave `Settings.aiConfig.loading` nos quatro idiomas; comentários de rascunho removidos.
- Nenhum arquivo de `settings/page`, rail, API, banco, mensagens, tokens, shell ou outro pacote foi alterado. Nenhum segredo foi gravado e não houve commit.

## Verificações de código

- `npm run typecheck` — pendente para execução serializada no F8, conforme orientação da coordenação: interrompi apenas o typecheck iniciado nesta sessão após o callback mais recente.
- ESLint focado na página e no componente de configuração — exit 0, sem warnings; a execução focada anterior dos cinco arquivos F5 também passou.
- `npx vitest run src/i18n/messages.test.ts src/i18n/icu-safety.test.ts` — 2 arquivos, 11 testes passaram; valida paridade e formato das novas chaves.
- Testes focados: `src/lib/ai/{config,usage,knowledge}.test.ts` e rotas de configuração, uso e reindexação — 6 arquivos, 31 testes passaram. Uma execução inicial teve timeout isolado no teste de truncamento de uso enquanto os checks concorriam; a repetição focada com `--testTimeout=30000` passou.
- `git diff --check` para os arquivos F5 — limpo.
- O aviso preexistente do Vitest sobre `configLoader: 'native'` e ESM em `vitest.config.ts` apareceu durante os testes.
- O callback de estado foi validado por lint e revisão do fluxo; não houve teste de interação no browser após a falha local Auth/REST previamente registrada. A compilação final desse callback fica pendente para o typecheck serializado do F8.

## QA visual local e limites

- A sessão local mostrou a tela F5 a 1440×900 com abas, Setup inicial sem configuração, campos de provedor/modelo, campos de chave em branco com placeholders, regras de resposta e atalho para adicionar conhecimento. O Playground vazio também renderizou; não foi enviada mensagem.
- O seletor de provedor abriu a lista de opções. Teste completo de teclado/dismissal do overlay, edição/cancelamento do formulário de conhecimento, estado de Uso e matriz de viewports/modos não foi concluído.
- Após a navegação local, a sessão exibiu erro de carregamento/permissões (Auth/REST). O QA foi interrompido conforme orientação; não houve nova tentativa ou alteração de configuração de IA/segredo. A conta sintética autenticou no portal dedicado, mas a rota `/dashboard` e a tentativa seguinte de navegação apresentaram falha de permissões.
- Embora o tema SIS e modo claro tenham sido selecionados na preferência visual de uma sessão local, a instabilidade impediu confirmar de forma confiável a tela F5 em ambos os modos. Não há capturas salvas nesta evidência; nenhuma captura contém dados pessoais.
- A preferência visual da sessão `WACRM Configurações` ficou em SIS/claro ao interromper o QA. A configuração de IA não foi salva nem modificada; não tentei restaurar a aparência após a orientação para encerrar a navegação.
- QA visual completo em 1440/1024/768/320, claro/escuro e teclado continua pendente por essa falha local. Este pacote fica pronto para revisão de código, com a limitação visual registrada; sem dados de uso reais.
