# Setup local WACRM

Estado em 2026-11-15: T02.a e T02.c-checks concluídos. Infra.b/T02.b (Supabase local e banco) ainda pendente; T02.c smoke/login ainda não executado.

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

## Checks de baseline (T02.c-checks)

- `npx --yes npm@10.9.9 run lint`: exit 0, 40 warnings e 0 errors.
- `npx --yes npm@10.9.9 run typecheck`: exit 0.
- `npm test -- --maxWorkers=2`: exit 0, 158 arquivos e 1.695 testes passaram. `vitest --help` documenta `--maxWorkers`. Uma execução inicial sem limite também passou; a repetição limitada é a evidência final.
- `npx --yes npm@10.9.9 run build`: exit 0 com `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` e chaves sintéticas de baseline apenas no ambiente do processo. Nenhum Supabase foi iniciado ou contatado.
- Nenhum `META_APP_SECRET` foi passado ao build. A compilação completou sem essa variável; `vitest.config.ts` já fornece valor sintético estrito aos testes, e o webhook requer secret somente quando seu comportamento é exercitado.
- Saídas completas: `.t02c-logs/{lint,typecheck,test,test-workers2,build}.log`; diretório ignorado localmente. A suíte reportou aviso do loader de configuração Vite (CommonJS/ESM), também registrado na evidência.

T02.c smoke/login permanece pendente até Infra.b/T02.b provisionar Supabase local. Nenhum servidor foi iniciado.
