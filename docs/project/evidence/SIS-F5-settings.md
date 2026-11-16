# Evidência SIS F5 — Configurações

Data: 16/11/2026
Ambiente: portal Maestri `WACRM Configurações`, localhost, viewport de QA.
Escopo: `settings/page.tsx` e componentes `src/components/settings/*`, exceto `ai-config.tsx` e `ai-knowledge.tsx`.

## Implementação

- Cabeçalho editorial e grade de leitura com rail secundário agrupado em Conta e Espaço de trabalho no desktop; seletor nativo acessível em viewports abaixo de 1024px.
- O rail continua ligado a `?tab=` como fonte da seção. `tags` e `custom-fields` continuam resolvendo para Campos e tags; parâmetro desconhecido continua em Visão geral.
- Mantidas as doze rotas de seção. Com `templates=false`, Modelos permanece fora do rail e abre o aviso real de indisponibilidade pelo deep link, com caminho para a conexão; o manager não é renderizado nesse estado. No seletor móvel, Modelos só aparece como opção atual desabilitada quando a pessoa chega diretamente pelo deep link.
- Refinados cabeçalhos, superfícies e larguras dos painéis, estados de conexão, cartões de resumo e leitura de listas. O painel WhatsApp mantém formulário avançado, token mascarado e QR condicionado ao estado retornado; a coluna auxiliar só divide o layout a partir de `xl`.
- Papéis owner/admin/agent/viewer, guards de permissão, confirmação e estados existentes foram mantidos. O texto do chip owner ganhou contraste adequado em tema claro.
- `ai-config.tsx`, `ai-knowledge.tsx`, shell, primitives, globals/tokens, mensagens, APIs, DTOs, SQL, `agents/page.tsx` e arquivos de outros pacotes não foram alterados.

## QA visual e funcional

| Viewport | Verificação | Resultado |
| --- | --- | --- |
| 1440×1000 | Overview, rail desktop e hierarquia visual em modo escuro | Inspecionado no portal; sem overflow horizontal |
| 1024×900 | Rail e WhatsApp | Rail de 232px visível com os 11 destinos disponíveis; Modelos fica oculto por `templates=false`. Painel WhatsApp empilhado, campos dentro da largura e sem overflow |
| 768×1024 | Navegação móvel | Seletor nativo visível; conteúdo sem overflow horizontal |
| 320×760 | Navegação móvel e painel WhatsApp | Seletor nativo visível; conteúdo sem overflow horizontal |

- Modo claro e escuro foram alternados na página Aparência; a preferência original escura foi restaurada.
- Foram abertas as seções por `?tab=` e verificados os aliases `tags`/`custom-fields`, o aviso em `?tab=templates` e o fallback desconhecido para overview.
- O portal estava conectado ao WhatsApp; QR não foi gerado nem capturado. O campo de token apareceu como `type=password`. Nenhuma chave foi criada/revogada e nenhum formulário operacional foi enviado.
- A conta usada foi a conta local de teste; valores de credenciais, segredos, QR, dados de clientes e identificadores não foram gravados nesta evidência.
- Teclado: o portal conseguiu focar os botões do rail; Enter/Espaço enviados pelo driver não acionaram a troca de seção. A navegação por clique funcionou. Ativação por teclado permanece **não verificada** no browser real.
- Zoom 200%, papéis diferentes do owner e QR em estado desconectado permanecem **não verificados** nesta sessão.

## Checks

- ESLint nos arquivos F5 alterados: 0 erros; 1 warning já presente em `api-keys-settings.tsx:97` sobre dependência `t` em `useCallback`.
- Testes focados `account-catalog.test.ts` e `reply-target.test.ts`: 2 arquivos, 5 testes aprovados. Vitest exibiu aviso preexistente de `configLoader: 'native'` no `vitest.config.ts`.
- `npm run typecheck`: aprovado.
- `git diff --check` nos arquivos F5: aprovado.

## Arquivos do pacote

- `src/app/(dashboard)/settings/page.tsx`
- `src/components/settings/{api-keys-settings,appearance-panel,custom-fields-settings,deals-settings,fields-and-tags-panel,inbox-settings,members-tab,profile-form,quick-replies-manager,role-meta,security-panel,settings-overview,settings-panel-head,settings-rail,whatsapp-config}.tsx` (`role-meta.ts`)
- `docs/project/evidence/SIS-F5-settings.md`

Sem commit, publicação, envio de WhatsApp ou escrita de dados operacionais.
