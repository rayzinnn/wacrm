# Setup local WACRM

Estado em 2026-11-16: T02.a, T02.b, T02.c-checks e T02.c-smoke concluídos. O CRM usa Supabase local; Evolution ainda não foi iniciado neste recorte. O bug de signup com sessão imediata foi corrigido no commit `84245f0`, conforme evidência T02.d. O banco de Evolution permanece separado do banco do CRM.

## Runtime e instalação

- Node: `v22.19.0` (atende `>=22.12.0`).
- npm instalado no ambiente: `10.9.3`; a tarefa usou npm fixado `10.9.9` via `npx --yes npm@10.9.9 ci`.
- `npm ci`: exit code `0`; saída informou 691 pacotes adicionados e 692 auditados. O aviso de instalação reportou 23 vulnerabilidades (1 low, 16 moderate, 5 high, 1 critical). Nenhuma correção/atualização de dependências foi aplicada.
- SHA-256 `package-lock.json` antes/depois: `f5336fdba7b670d3daef78d3bbbdd4872310e608640f384f3e155e05908ae4d7` (inalterado).

## Ambiente local

`.env.local` foi criada localmente com permissões `0600`. Contém a URL e as chaves reais somente da instância Supabase local, além de `ENCRYPTION_KEY`; não copie nem registre os valores. Nomes relevantes:

- `NEXT_PUBLIC_APP_LOCALE` = `pt`
- `NEXT_PUBLIC_SITE_URL` = `http://localhost:3000`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` = valores da instância local, mantidos apenas em `.env.local`.
- `ENCRYPTION_KEY` = chave aleatória hexadecimal de 32 bytes, gerada diretamente no arquivo; o valor não é registrado neste documento.

`git check-ignore -v .env.local` confirmou `.gitignore:34:.env*`. O arquivo local não deve ser adicionado ao Git. As chaves foram obtidas do `supabase status` local. `ENCRYPTION_KEY` e as variáveis existentes de locale/site foram preservadas. Nenhuma variável Meta foi criada. Nenhum projeto Supabase remoto foi usado ou vinculado.

## Supabase local e comandos de execução

- CLI Supabase oficial v3.1.0, instalada em `$HOME/.local/share/wacrm-infra-a/bin/supabase`.
- Colima profile `wacrm`: ARM64, 3 vCPU, 4 GiB RAM e disco de dados de 24 GiB. A rede `wacrm-local` publica bindings somente em `127.0.0.1`.
- Stack mínima ativa: Postgres, Auth, REST, Storage, Realtime e gateway. Studio, Mailpit, postgres-meta, edge-runtime, Logflare, Vector, imgproxy e Supavisor estão excluídos.
- Configuração: `project_id = "wacrm-local"`, Auth `site_url = "http://localhost:3000"` e confirmação de e-mail desativada somente para este laboratório local.
- As 57 migrations existentes estão aplicadas; nenhuma migration histórica foi alterada. Não use `db reset` para retomar o ambiente.

Para iniciar a partir de um terminal novo, mantendo os volumes locais:

```sh
source "$HOME/.local/share/wacrm-infra-a/env.sh"
cd /Users/raymozer/Desktop/Projetos/WACRM
NETWORK_ID="$(docker network inspect --format '{{.Id}}' wacrm-local)"
supabase start --network-id "$NETWORK_ID" --exclude imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase status
```

Para parar apenas os serviços Supabase, preservando banco e volumes: `supabase stop`. Para também desligar a VM Colima, depois de parar o Supabase: `colima stop wacrm`. Não execute `colima delete` ou `supabase db reset` para o fluxo normal.

## Smoke T02.c

- Logout real da sessão B seguido de login real como A (`admin@wacrm.local`); a sessão final permanece autenticada como A em `/inbox`.
- A inbox carregou sem conversas. O estado “WhatsApp não conectado” é esperado; nenhuma configuração, QR code ou mensagem foi usada.
- Na UI de A, Contatos exibiu estado vazio e Pipelines exibiu zero registros/valores. Consulta somente leitura confirmou o contato e o negócio de teste no escopo de B (BRL 100, Qualificado), não visíveis para A.
- Detalhes e limites em [evidence/T02.c-smoke.md](evidence/T02.c-smoke.md). Nenhum serviço saudável foi reiniciado e nenhum dado foi criado durante o smoke.

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
