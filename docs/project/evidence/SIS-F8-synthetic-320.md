# SIS F8 — sessão sintética em 320 px

Data: 16/11/2026. Portal Maestri novo `WACRM F8 sintético 320`, sessão criada exclusivamente no Supabase local. Uma conta e um contato de teste foram usados para inspecionar estados vazios e uma ficha preenchida. Não houve conexão WhatsApp, envio, dados de cliente ou publicação. Nenhuma captura foi adicionada ao repositório.

## Observações

- `/signup` coube em 320×721, com campos, ação e link de acesso visíveis.
- `/dashboard` em 320×721, claro e escuro, não teve overflow horizontal da página. O checklist comprimia títulos contra os botões; o layout foi corrigido para colocar a ação abaixo do texto em telas estreitas e conferido novamente.
- `/contacts` em 320×721 mostrou a lista com um contato sintético, formulário de criação e ficha. Os botões de ação foram ajustados para não quebrar o texto; a primeira aba da ficha deixou de ficar cortada ao iniciar a rolagem horizontal. A ficha foi conferida nos modos claro e escuro.
- `/pipelines`, `/inbox`, `/settings`, `/agents`, `/automations`, `/flows` e `/notifications` carregaram em 320 px sem overflow horizontal do documento (`scrollWidth ≤ innerWidth`). Inbox vazia, Configurações e Agentes de IA tiveram inspeção visual em tela pequena.
- A conta foi desconectada no portal. O usuário Auth, a conta e o contato sintéticos foram excluídos do banco local; verificação final: `0|0|0`.

## Limites restantes

O teste de teclado pelo portal não deslocou o foco após `Tab`, mesmo ao focar manualmente um campo; não é evidência de navegação por teclado. Zoom real de navegador a 200%, leitor de tela, Inbox com mensagens, pipelines com negócios e outras telas com dados continuam sem QA completo. O portal permanece aberto na tela de login, sem sessão sintética.
