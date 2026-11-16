# SIS F7 — aviso de envios em massa indisponíveis

Data: 2026-11-16
Arquivo de implementação: `src/app/(dashboard)/broadcasts/layout.tsx`

## Apresentação

- O estado `broadcasts=false` agora usa uma superfície SIS com ícone de aviso, título e descrição preservados, hierarquia tipográfica mais clara e ação principal para `/settings?tab=whatsapp`.
- Em mobile, o link ocupa a largura disponível; em telas maiores, acompanha o conteúdo. A ação tem alvo mínimo de 44 px e foco de teclado visível.
- `getEvolutionCapabilities()` e seu valor `broadcasts: false` não foram alterados. A bifurcação do layout permanece: com capability ativa retorna `children`; com capability indisponível retorna somente o aviso. Rotas internas não são montadas no estado bloqueado.
- Nenhuma página interna, API, flag, mensagem compartilhada ou envio foi alterado ou executado.

## Verificações

- Teste focado: `npm test -- src/lib/whatsapp/evolution/client.test.ts -t getEvolutionCapabilities` — **1 passou**, incluindo a expectativa `broadcasts: false` (70 testes do mesmo arquivo ignorados pelo filtro).
- A suíte não tem teste de componente para montagem dos `children`; o branch preservado foi conferido no layout: `broadcasts=true` retorna `children`, enquanto o estado false retorna somente a seção do aviso.
- ESLint em `src/app/(dashboard)/broadcasts/layout.tsx` — **passou**, sem erros ou warnings.
- Prettier e `git diff --check` no arquivo — **passaram**.
- Typecheck global adiado para F8, conforme instrução do coordenador.

## Limite de QA visual

O portal dedicado abriu `/login` por isolamento de sessão. Conforme orientação, a navegação parou nessa leitura: sem autenticação, sem acesso a dados de clientes e sem captura visual do aviso. O layout responsivo e o foco foram conferidos no código; a renderização no portal permanece não verificada.

Sem criação ou envio de mensagens. Sem alteração de sessão persistente, credenciais, convites ou dados. Sem commit.
