# F8 — rodada parcial de zoom e teclado

- Portal novo com conta sintética isolada; medição feita somente em `/dashboard`.
- Viewport observado: 1440×900. `innerWidth` 1440, `devicePixelRatio` 2, `visualViewport.scale` 1. Documento/body: 1440 px; `main`: x=72, largura/clientWidth/scrollWidth=1368 px, sem overflow horizontal nessa medição.
- Zoom real de 200% não verificado: o driver rejeitou `ctrl+plus` quatro vezes como tecla desconhecida.
- Dois comandos Tab foram aceitos, mas o elemento ativo permaneceu `BODY` e `:focus-visible` foi falso. Não foi possível comprovar foco por teclado em controles.
- Inbox, Configurações e IA não foram inspecionadas; a rodada foi interrompida antes de completar as páginas solicitadas. Nenhuma aprovação visual é inferida para elas.
- Limpeza da fixture: contagem final de usuário sintético=0 e conta sintética=0; arquivo temporário removido.
