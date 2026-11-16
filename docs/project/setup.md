# Setup local WACRM

Estado em 2026-11-15: T02.a concluído. Infra.b/T02.b (Supabase local e banco) ainda pendente; T02.c (checks e smoke local) não executado.

## Runtime e instalação

- Node: `v22.19.0` (atende `>=22.12.0`).
- npm instalado no ambiente: `10.9.3`; a tarefa usou npm fixado `10.9.9` via `npx --yes npm@10.9.9 ci`.
- `npm ci`: exit code `0`; saída informou 691 pacotes adicionados e 692 auditados. O aviso de instalação reportou 23 vulnerabilidades (1 low, 16 moderate, 5 high, 1 critical). Nenhuma correção/atualização de dependências foi aplicada.
- SHA-256 `package-lock.json` antes/depois: `f5336fdba7b670d3daef78d3bbbdd4872310e608640f384f3e155e05908ae4d7` (inalterado).

## Ambiente local

`.env.local` estava ausente e foi criada uma vez, com permissões `0600`, sem valores Supabase/Meta. Nomes presentes:

- `NEXT_PUBLIC_APP_LOCALE` = `pt`
- `NEXT_PUBLIC_SITE_URL` = `http://localhost:3000`
- `ENCRYPTION_KEY` = chave aleatória hexadecimal de 32 bytes, gerada diretamente no arquivo; o valor não é registrado neste documento.

`git check-ignore -v .env.local` confirmou `.gitignore:34:.env*`. O arquivo local não deve ser adicionado ao Git. `.env.local.example` indica que Supabase é necessário para o app iniciar; URL/chaves não estão disponíveis, aguardam Infra.b/T02.b. Nenhuma variável Meta foi criada, embora o exemplo histórico do produto ainda as liste.

## Guias locais Next.js lidos após `npm ci`

- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`: Next carrega `.env*` da raiz; variáveis `NEXT_PUBLIC_` ficam embutidas no bundle de build; `.env.local` não é carregado em `NODE_ENV=test`.
- `node_modules/next/dist/docs/01-app/02-guides/local-development.md`: diferencia `next dev` de build/produção e recomenda desenvolvimento nativo para melhor resposta de arquivos, relevante ao escopo localhost.

Nenhum teste, lint, typecheck, build, banco, servidor ou fluxo de login/inbox foi executado nesta tarefa; isso pertence a T02.c e depende do ambiente local de dados.
