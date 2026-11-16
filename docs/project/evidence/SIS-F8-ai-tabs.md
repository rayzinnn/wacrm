# SIS F8 — abas de IA em 320 px

Na leitura local em 320 px, a aba **Uso** começava perto da borda direita e ficava parcialmente fora da tela. A lista de abas foi ajustada para duas ou três colunas conforme a permissão do usuário; no tamanho estreito, os rótulos podem quebrar linha e os ícones saem da faixa. Em telas maiores, a apresentação com ícones continua.

O agente Luna executou lint, typecheck e testes focados sem erros. A revisão retirou um teste que apenas procurava classes no arquivo fonte, pois não comprovava o comportamento no navegador. A correção ainda precisa de conferência visual com uma conta sintética; nenhuma conta autenticada existente foi usada na verificação posterior.
