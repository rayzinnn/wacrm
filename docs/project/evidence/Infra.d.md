# Evidência Infra.d — recuperação do runtime local existente

**Data:** 2026-11-16 (America/Sao_Paulo)  
**Escopo:** recuperar somente VM/perfil Colima/Lima `wacrm` e engine Docker existentes, preservando disco e volumes. Sem recriar VM, reset, mudança no produto, configuração local de aplicação, secrets ou serviços de outros projetos.

## Diagnóstico

- `source /Users/raymozer/.local/share/wacrm-infra-a/env.sh` definiu `COLIMA_HOME=/Users/raymozer/.local/share/wacrm-infra-a/colima-home` e `LIMA_HOME=/Users/raymozer/.local/share/wacrm-infra-a/lima-home`. O caminho customizado de `COLIMA_HOME` não existe; o perfil Colima preexistente e sua configuração estão em `~/.colima/wacrm`, enquanto o estado da VM Lima está em `$LIMA_HOME/colima-wacrm`. O contexto isolado `colima-wacrm` já apontava ao socket esperado `unix://~/.colima/wacrm/docker.sock`. Isso coincide com o comportamento registrado em Infra.a; `env.sh` não foi alterado.
- Inventários inicialmente incoerentes: `colima list -j` e `limactl list --json` mostravam `Running`, mas `colima --profile wacrm status --extended` retornava `error retrieving current runtime: empty value`; `limactl shell colima-wacrm ...` recebia `kex_exchange_identification: read: Connection reset by peer`; Docker não conectava ao socket.
- `$LIMA_HOME/colima-wacrm/ha.stderr.log` registrava repetidamente `VZErrorDomain Code=3` e `The virtual machine is no longer live`, embora o processo hostagent estivesse vivo. O processo era hostagent PID 54404 e a VM VZ correspondente já não estava ativa. Portanto, o estado `Running` e o socket existente estavam obsoletos: VM Apple Virtualization encerrada com hostagent residual. A falha não era falta de daemon por ausência de configuração nem erro de `DOCKER_HOST`.

## Recuperação executada

1. Consultados `colima start --help`, `limactl shell --help`, `limactl stop --help` e `colima stop --help` antes das operações.
2. `source /Users/raymozer/.local/share/wacrm-infra-a/env.sh`.
3. `limactl stop --force colima-wacrm` encerrou somente o processo VZ/hostagent residual e removeu arquivos transitórios PID/socket/tmp. Não removeu a instância Lima, a configuração ou discos.
4. `colima --profile wacrm start` informou `Using the existing instance colima-wacrm`, montou o disco de dados preexistente e iniciou o runtime Docker. Nenhum `delete`, `reset`, instalação ou upgrade foi executado.

## Verificação final

- `colima list -j`: perfil `wacrm`, `Running`, `aarch64`, 3 CPUs, 4 GiB, runtime `docker`.
- `limactl list --json`: instância existente `colima-wacrm`, `Running`, driver `vz`, 3 CPUs, 4 GiB.
- `docker context show`: `colima-wacrm`; `docker info`: Engine 29.5.2, Ubuntu 24.04.4 LTS, aarch64, 3 CPUs.
- `docker ps -a`: nove containers WACRM ativos: Supabase DB, Auth, REST, Storage, Realtime e Kong; Evolution API, PostgreSQL e Redis. Os containers com healthcheck reportavam `healthy`.
- Volumes WACRM ainda presentes: `supabase_db_wacrm-local`, `supabase_storage_wacrm-local`, `wacrm-evolution_instances`, `wacrm-evolution_postgres`, `wacrm-evolution_redis`. Redes `wacrm-local` e `wacrm-evolution` presentes.
- Probes somente leitura: `http://localhost:3000/` → 307 (redirecionamento normal do CRM), `http://127.0.0.1:54321/auth/v1/health` → 200, `http://127.0.0.1:8080/` → 200.
- Não foi iniciado nem acionado o daemon worker TypeScript nem repetido o retry do cron; esse passo cabe ao coordenador/QA após a disponibilidade do runtime.

## Retomada e retorno

Em terminal novo, carregar `source /Users/raymozer/.local/share/wacrm-infra-a/env.sh`. Para uso normal, `colima --profile wacrm start` inicia a VM existente e preserva seus discos/volumes. Para desligar sem apagar dados, `colima --profile wacrm stop`. Se o runtime exibir novamente estado `Running` obsoleto com erros VZ `The virtual machine is no longer live`, usar, após inspecionar os logs, `limactl stop --force colima-wacrm` e depois `colima --profile wacrm start`. Não usar `colima delete`, `limactl delete`, `supabase db reset` ou remoção de volumes para esta recuperação.
