# SIS F4 — Inbox

Base revisada: `f986821`, com o fluxo de envio idempotente já presente em `846126b`.

## Mudanças

- Recompus lista, thread e contexto com superfícies neutras e tokens semânticos existentes, deixando a terceira coluna para telas largas (`xl`). Entre `lg` e `xl`, a lista e a thread dividem a área; abaixo de `lg`, a inbox continua em lista → thread. O contexto abre como painel próprio com retorno à thread, sem desmontá-la ou limpar sua posição de rolagem.
- Mantive busca, filtros, seleção, `?c=`, paginação, realtime, leitura e histórico de mídia nos mesmos handlers. O estado móvel novo só controla qual painel é exibido; o conteúdo da thread permanece montado enquanto o contexto aparece.
- Ajustei superfícies de mensagem recebida/enviada, composer, mídia e contexto. As guardas de envio, read-only, capability, rascunho, optimistic/reconciliação e recibos continuam nos componentes existentes.
- Limite funcional informado pela coordenação T10: a capability de texto Evolution foi ativada fora deste recorte, mas o composer ainda aplica a guarda legada da janela de 24 horas. F4 não altera essa regra; Quartzo fará a integração funcional após o commit sequencial.
- Não alterei `text-send-operation.ts` nem seu teste, hooks, serviços, API, tokens/globals ou catálogos. Nenhuma mensagem foi enviada e nenhum registro foi criado.

## Checks

- `npx vitest run src/components/inbox/text-send-operation.test.ts` — passou: 1 arquivo, 7 testes.
- ESLint inicial dos arquivos alterados — terminou sem erros, com avisos preexistentes. Após remoção de imports não usados, a repetição foi interrompida durante a contenção local; antes da interrupção reportou três avisos existentes: duas imagens com `<img>` e a dependência `tQuote` em `message-thread.tsx`.
- `npm run typecheck` global — interrompido após mais de dois minutos conforme orientação de coordenação, enquanto havia vários `tsc` concorrentes. Pendente para execução serial em F8; nenhum erro de TS foi emitido.
- `git diff --check` nos arquivos do recorte — passou.
- Portal Maestri `WACRM Inbox QA`: sessão de teste documentada com inbox vazia, em `http://localhost:3000/inbox` (`1280×801`). A árvore acessível mostrou a busca, filtro e estado “Nenhuma conversa encontrada”. A captura visual falhou com status 0, então não há screenshot nesta evidência.

## Limites do QA

Sem conversas sintéticas disponíveis na sessão vazia, não foi possível conferir visualmente uma thread aberta, contexto com dados, scroll/paginação de mensagens, reconciliação na tela, mídia histórica ou deep link `?c=` válido. Os handlers correspondentes não foram alterados; o teste existente de envio idempotente passou. Nenhum teste de envio real foi executado.

**Estado:** pronto para revisão; sem commit. Typecheck global serial fica pendente para F8.
