# WACRM — evidência Infra.b / T02.b: Supabase local mínimo

Data: 2026-11-15 (America/Sao_Paulo)

## Estado

Concluído para o recorte local. O banco do CRM usa a stack Supabase local. O banco do Evolution será separado; Evolution não foi iniciado nesta tarefa. Nenhum projeto Supabase remoto foi consultado, vinculado ou alterado. Não houve login, seed de usuário, edição das migrations históricas ou reset do banco.

## CLI e configuração

- CLI oficial Supabase v3.1.0, binário ARM64 em `$HOME/.local/share/wacrm-infra-a/bin/supabase`; SHA-256 verificado contra `checksums.txt` do release: `2bd2a45fd5cd9e45b6393cfd534651ac1dbfb78c8a311b7f48e14143594e7a26`.
- A versão v3 usa stack local por padrão para os comandos de banco. A ajuda foi lida antes de executar: `supabase start --help`, `supabase status --help`, `supabase migration list --help` e `supabase migration up --help`. `start` aceita `--network-id` e lista os nomes válidos de `--exclude`; `migration up` é local por padrão e oferece `--remote` apenas para seleção remota. Os comandos locais foram executados com `SUPABASE_ACCESS_TOKEN` removido e sem `--remote`.
- Em `supabase/config.toml`, `project_id = "wacrm-local"`, `auth.site_url = "http://localhost:3000"`, `auth.email.enable_confirmations = false`; mantidos `db.port = 54322`, `shadow_port = 54320`, Postgres major 17.
- `.env.local` já era ignorado pelo Git e estava em modo 0600. Foram escritos apenas `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`, usando os valores retornados pelo `supabase status` local. `ENCRYPTION_KEY`, `NEXT_PUBLIC_SITE_URL` e `NEXT_PUBLIC_APP_LOCALE` permaneceram inalterados. Nenhum valor de chave foi copiado para esta evidência.

## Runtime, rede e stack

- Colima profile `wacrm` redimensionado sem apagar a VM: Apple VZ, ARM64, 3 vCPU, 4 GiB RAM, disco de dados virtual 24 GiB (root disk 20 GiB).
- Docker network `wacrm-local`, ID `33b7fb11596f6a3c21308615efff9f6caa481f84b8baa44151c3bb7b9d323d1c`, opção `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`.
- Comando de inicialização registrado em `supabase/.temp/infra-b/start.log`:
  `supabase start --network-id <ID da rede wacrm-local> --exclude imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
- Serviços ativos no `docker ps`: Postgres, GoTrue/Auth, PostgREST/REST, Storage API, Realtime e Kong/gateway. A ajuda CLI lista `logflare` e `vector` como nomes de container para analytics; `analytics` não é nome aceito por `--exclude`. Studio, Mailpit, postgres-meta, Edge Runtime, imgproxy, Logflare, Vector e Supavisor/pooler ficaram excluídos.
- Bindings publicados confirmados: gateway `127.0.0.1:54321->8000/tcp`; Postgres `127.0.0.1:54322->5432/tcp`. Serviços internos não publicaram portas no host.
- `supabase start` terminou com exit code 0. `supabase status -o json` terminou com exit code 0. Ambos os arquivos de saída, que incluem credenciais locais, estão em `supabase/.temp/infra-b/` com modo 0600; `supabase/.temp/` é ignorado pelo Git.

## Migrations e verificação do banco

- Inventário anterior à execução: 57 arquivos `.sql` em `supabase/migrations/`.
- `supabase migration list` (alvo impresso: local stack, `127.0.0.1:54322`): 57 linhas de migração, todas presentes no histórico, zero pendências.
- `supabase migration up --network-id <ID da rede wacrm-local>` (target local por padrão): exit code 0. A CLI verificou o histórico, sem SQL pendente para reexecutar. Saída guardada em `supabase/.temp/infra-b/migration-up.log`, modo 0600.
- `docker exec supabase_db_wacrm-local psql -U postgres -d postgres -Atqc 'SELECT count(*), min(version), max(version) FROM supabase_migrations.schema_migrations;'` → `57|001|059` (os IDs 050 e 056 não existem no conjunto local).
- Consulta `information_schema.tables` confirmou as tabelas públicas do CRM, incluindo `accounts`, `profiles`, `contacts`, `conversations`, `messages`, `deals`, `pipelines` e `whatsapp_config`.
- `docker ps`: seis containers da stack base ativos; Postgres, Auth, Storage, Realtime e gateway saudáveis. Host ficou com aproximadamente 17 GiB livres após pulls. Docker reportou aproximadamente 4 GiB em imagens e ~81 MiB em volumes locais.

## Comandos de retomada

```sh
source "$HOME/.local/share/wacrm-infra-a/env.sh"
cd /Users/raymozer/Desktop/Projetos/WACRM
colima list
docker network inspect wacrm-local
supabase status
supabase migration list
```

Para encerrar apenas o Supabase local sem apagar seu banco: `supabase stop`. Para iniciar de novo mantendo a mesma rede e serviços mínimos, obtenha o ID com `docker network inspect --format '{{.Id}}' wacrm-local` e use o comando de `supabase start` acima. Para desligar a VM mantendo o estado: `colima stop wacrm`.

## Fontes oficiais consultadas

- CLI v3.1.0 release/checksum: https://github.com/supabase/cli/releases/tag/v3.1.0
- Mudanças CLI v3 e alvo local por padrão: https://supabase.com/changelog/supabase-cli-v3
- Início local, RAM recomendada da stack completa e rede com bind localhost: https://supabase.com/docs/guides/local-development
- Configuração local de Auth e site URL: https://supabase.com/docs/guides/local-development/cli/config
- CLI `start` reference (nomes `--exclude`): https://supabase.com/docs/reference/cli/supabase-start
