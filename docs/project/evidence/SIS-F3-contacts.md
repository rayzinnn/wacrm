# SIS F3 — Contatos

Data: 16/11/2026
Escopo: `/contacts`, ficha de contato, formulário, importação e gestão de campos personalizados.

## Implementação

- Recompus o cabeçalho, a barra de busca/filtros e a tabela como superfícies discretas com hierarquia SIS, mantendo os tokens atuais do WACRM e sem alterar primitives, globals, shell ou catálogo de temas.
- Mantive a busca e o filtro de tags no servidor, seleção limitada à página, lote, paginação, estados de carregamento/vazio/erro, permissões e handlers existentes.
- A tabela agora permite abrir a ficha com Enter ou Espaço quando a linha está focada. Campos da ficha receberam associação explícita com seus labels; a ação de excluir nota mantém foco visível.
- A ficha segue com as cinco abas existentes: detalhes, tags, notas, campos personalizados e negócios. Formulário, importação e gestão de campos receberam dimensões locais adaptáveis.
- Arquivos alterados: `src/app/(dashboard)/contacts/page.tsx`, `src/app/(dashboard)/contacts/contacts.css`, `src/components/contacts/contact-detail-view.tsx`, `src/components/contacts/contact-form.tsx`, `src/components/contacts/import-modal.tsx`, `src/components/contacts/custom-fields-manager.tsx`.

## Referências consultadas

- Plano: `docs/project/sis-integration-plan.md`, seção F3 e inventário de ficha/formulários.
- Protótipo: `SIS/src/screens/crm/CrmScreen.tsx`, `crm.css`, `LeadDrawer.tsx`, `DESIGN_SYSTEM.md`, `COVERAGE.md`, `QA.md` e `INTERFACE_REVIEW.md` em `/Users/raymozer/Downloads/16.04.2026 SIS/LAB. SIS/prototype-rebrand`.
- Guias instalados do Next 16.3.8: `node_modules/next/dist/docs/01-app/01-getting-started/{03-layouts-and-pages,05-server-and-client-components,11-css,13-fonts}.md` e `01-app/03-api-reference/02-components/font.md`.
- Skills usadas: frontend-design, better-layout, better-ui, better-accessibility, better-writing, better-typography e better-colors.

## QA e checks

| Verificação | Resultado |
| --- | --- |
| Portal | Sessão local de teste em `WACRM Contatos`, rota `/contacts`; lista vazia, sem contatos de clientes. |
| Lista vazia, 1440×1000, SIS dark/light | Inspecionada visualmente nos dois modos. A hierarquia e a tabela permanecem contidas no painel. Capturas temporárias não foram adicionadas ao repositório. |
| Larguras 1440, 1024, 768 e 320 px, SIS dark | `document.documentElement.scrollWidth` e `document.body.scrollWidth` coincidiram com a largura de viewport. |
| 320×760 | O shell abre o menu móvel sobre a página; não consegui fechá-lo pelo portal. A árvore de acessibilidade contém a rota, mas a inspeção visual desobstruída fica limitada pelo shell, fora do escopo. |
| Formulário, importação e campos personalizados | Sem salvar. Os três overlays abriram e expuseram seus campos/ações na árvore de acessibilidade. No portal, porém, cada overlay manteve `data-starting-style` e `opacity: 0`; as capturas continuaram mostrando a lista vazia, então não aprovo a aparência visual desses overlays. |
| Ficha de contato | Não verificada: a conta de teste não tem contatos e não criei um registro para abrir a ficha. As cinco abas e handlers continuam presentes no código. |
| Claro/escuro | Lista vazia verificada em SIS claro e escuro. Formulário abriu em ambos os modos, mas sem inspeção visual por causa do estado de opacidade acima. Importação e campos personalizados foram abertos em SIS dark. |
| ESLint nos cinco TSX alterados | Concluiu sem erros. Há 7 avisos em código existente: imports sem uso em `contact-detail-view.tsx`/`contact-form.tsx` e dependências do efeito em `contact-form.tsx`. |
| TypeScript | `npm run typecheck` passou após a correção do erro global de `showTemplates`. |
| Testes focados | 7 arquivos, 70 testes aprovados: filtros, limites de paginação, parser CSV, deduplicação, gravação de campos personalizados, resolução de tags e escrita de tags. |
| `git diff --check` | Aprovado. |

Não criei, editei, importei ou removi contatos. Restaurei a preferência do portal para o tema anterior (`violet`/dark) ao encerrar a QA. Não alterei API, SQL, WhatsApp, autenticação, permissões ou outros pacotes. O limite de observação dos overlays foi registrado sem atribuir causa a primitives compartilhadas.
