# SIS F8 — Inbox e Pipeline com dados sintéticos

Data: 16/11/2026. Portal Maestri `WACRM F8 sintético 320`, em conta exclusiva do Supabase local. Dados criados apenas para esta verificação: uma conversa de texto recebida, um contato, um pipeline de duas etapas e um negócio. Não houve envio de WhatsApp, conexão da conta sintética à Evolution, acesso a dados de cliente nem publicação.

| Tela/estado | Largura e modo | Resultado observado |
| --- | --- | --- |
| Inbox com conversa e mensagem | 320 px, SIS claro e escuro | Lista e thread abriram, horário relativo em português, sem rolagem horizontal do documento. Composer terminou no limite inferior da viewport; placeholder curto e ações indisponíveis ocultas. |
| Inbox com conversa e mensagem | 768 e 1440 px | Composer permaneceu dentro da viewport, sem rolagem horizontal do documento. |
| Pipeline com negócio | 319/320 px, SIS claro; 1440 px, SIS escuro | Board e cartão renderizaram. No celular, o formulário passou a ocupar toda a largura, rolou até notas e ações de status e manteve salvar/cancelar dentro da tela. |

Arquivos de captura sintética: [Inbox móvel](sis/F8/inbox-mobile-text.png), [formulário no início](sis/F8/pipeline-form-mobile-top.png) e [formulário no fim](sis/F8/pipeline-form-mobile-bottom.png). A captura foi feita no servidor de desenvolvimento; o indicador circular `N` é do Next e não faz parte do produto.

Correções decorrentes: `formatRelativeTime` respeita locale em Inbox, Notificações e Runs; altura da Inbox usa `dvh` e cabeçalhos reais; composer apresenta ações de mídia, interativo e modelos somente quando a capability permite; formulário de negócio ocupa largura móvel e empilha ações de status.

Verificações de código desta rodada: teste do helper de tempo relativo e testes i18n passaram; typecheck e ESLint dos arquivos alterados passaram. Esta rodada não valida envio real, mídia, zoom de navegador a 200%, teclado/leitor de tela nem todas as famílias da matriz F8. Esses pontos permanecem abertos.

Após a inspeção, o portal foi desconectado e ficou em `/login`. Usuário Auth, conta, contato, conversa e negócio sintéticos foram apagados do banco local; contagens finais: `0|0|0|0|0`.
