# WACRM — relatório Infra.a (engine Docker + Compose local)

Data: 2026-11-15 (America/Sao_Paulo)
Escopo: preparar runtime local no macOS; sem edição do produto, deploy, Supabase ou Evolution iniciados.

## Inventário do host

- MacBook Air Mac14,2, Apple M2 / arm64, macOS 26.5.1.
- 8 GiB RAM, 8 núcleos (4P + 4E).
- Antes da instalação: volume Data 228 GiB, cerca de 26 GiB livres. Após baixar imagem base e iniciar a VM: cerca de 22 GiB livres.
- Node v22.19.0 e npm v10.9.3 estavam instalados (conforme inventário do recorte); Git e curl disponíveis.
- Docker/Compose/Colima/Lima/Homebrew/Supabase CLI não estavam disponíveis no PATH.
- `/usr/local/bin/docker` existe como symlink quebrado para `/Applications/Docker.app/Contents/Resources/bin/docker`. Foi preservado sem alteração.

## Opções consultadas e escolha

- Docker Desktop foi excluído conforme instrução. Docs Docker dizem que o binário macOS é apenas o cliente e não inclui Engine, Compose ou buildx.
- Homebrew não está instalado. A instalação binária de Colima documenta download do release; Lima permite extrair o archive em prefixo de usuário. Escolhidos Colima + Lima + Docker CLI, usando o backend nativo Apple Virtualization (`vz`) no Apple Silicon.
- Releases oficiais consultados em 2026-11-15: Colima v0.10.3; Lima v2.3.0; Docker CLI v29.9.3; Docker Compose v5.7.1.
- Docker Engine fornecido pela VM Colima: v29.5.2, Ubuntu 24.04.4 LTS, linux/arm64.
- As docs oficiais do Colima indicam defaults de 2 CPU/2 GiB/100 GiB; para este host, o perfil foi criado explicitamente com 2 vCPU, 2 GiB e disco de dados virtual de 24 GiB (root disk de 20 GiB). O disco virtual cresce conforme uso; é necessário monitorar o espaço livre do host.

## Instalação e caminhos

- Binários e templates Lima: `$HOME/.local/share/wacrm-infra-a/`
  - `bin/colima`, `bin/limactl`, `bin/docker`, `bin/lima`
  - `share/lima/templates/`
  - Compose plugin isolado em `docker-config/cli-plugins/docker-compose`
  - Configuração de Docker isolada em `docker-config/`
  - Ambiente reutilizável em `env.sh`
- Lima VM state: `$HOME/.local/share/wacrm-infra-a/lima-home/colima-wacrm/`.
- Contexto Docker ativo: `colima-wacrm`, guardado na configuração isolada acima.
- O endpoint do contexto e o socket de host que Colima anunciou são `unix://$HOME/.colima/wacrm/docker.sock`. Embora `COLIMA_HOME` esteja definido no `env.sh`, o Colima v0.10.3 usou essa localização padrão para o socket/perfil. Não alterei outros perfis nem arquivos em `~/.docker` ou `~/.ssh`.
- Downloads de origem preservados em `/tmp/wacrm-infra-a-download/` para inspeção/reprodução; não contêm credenciais.
- Não instalei nada em `/usr/local` ou `/opt/homebrew` e não usei sudo.

## Verificação observada

1. `colima version` → v0.10.3, commit `00f6c297e92a82c04a4ab507db0a61435650d7e8`.
2. `limactl --version` → 2.3.0.
3. `docker --version` → 29.9.3, build `5457199`.
4. `docker compose version` → v5.7.1.
5. `colima list` → perfil `wacrm`, Running, aarch64, 2 CPUs, 2 GiB, disco 24 GiB, runtime docker.
6. `limactl list` → instância `colima-wacrm`, Running, driver `vz`, aarch64, 2 CPUs, 2 GiB, disco root 20 GiB.
7. `docker info` → Engine 29.5.2, Ubuntu 24.04.4 LTS, arm64, 2 CPUs, ~1.91 GiB reportados pelo guest; endpoint do cliente é Unix socket local, sem listener TCP do Engine configurado.
8. `docker compose ls --all` → sem projetos Compose.
9. Smoke `docker run --rm hello-world` → sucesso (“Hello from Docker!”, imagem arm64). Container temporário removido ao final; nenhuma imagem/serviço de Supabase ou Evolution foi iniciado.
10. Espaço livre observado após a VM: 22 GiB. Pegada alocada do diretório de ferramentas/VM: ~1.3 GiB; cache Colima: ~320 MiB.
11. SHA-256 publicado conferido: Lima archive `b7af444bd8f91d3c307477e562f2cf3bd7595d62b9429185e4fa841563578cfc`; Colima `980ad8bf61a4ca370243f4cb41401a61276dcd2c2502bee7b9b86f9250169f34`; Compose `5a9aa8b5fb5b1e3cd83f39c80e570ae30aafd74cd9b47264fbe4ff7e6e6251ca`. A página/índice oficial do Docker para macOS não publica checksum do archive `docker-29.9.3.tgz`; o download veio do domínio oficial por HTTPS.

## Comandos de operação

Em cada terminal novo:

```sh
source "$HOME/.local/share/wacrm-infra-a/env.sh"
```

O ambiente prepara PATH, DOCKER_CONFIG isolado, COLIMA_HOME e LIMA_HOME. Depois:

```sh
colima list
colima start wacrm
colima stop wacrm
colima status wacrm
docker context show
docker info
docker compose ls
```

`colima stop wacrm` desliga a VM e preserva seu estado; `colima start wacrm` reabre-a. Não usar `colima delete` para parar.

## Limites e próximo passo

- Este recorte só fornece runtime Docker/Compose. Nenhum arquivo do CRM foi editado. Não houve uso de Supabase remoto.
- A decisão atualizada do usuário define o banco do CRM como Supabase local e o banco do Evolution como separado.
- Infra.b: selecionar/consultar a versão da Supabase CLI e `supabase start --help`; manter db/auth/rest/storage/realtime/gateway e excluir opcionais (Studio, analytics/Logflare, vector, Edge Runtime, imgproxy e Supavisor) conforme flags efetivamente suportadas nessa versão. A recomendação oficial de memória para a stack completa é 7 GiB; portanto usar a stack mínima, planejar a VM em até 4 GiB/3 vCPU e monitorar crescimento real do disco.
- Para serviços publicados somente em localhost, criar uma rede Docker com `com.docker.network.bridge.host_binding_ipv4=127.0.0.1` e passar seu ID a `supabase start --network-id`, confirmando os parâmetros na ajuda da CLI selecionada. Não iniciar Supabase/Evolution neste recorte.
- RAM livre é limitada: o host tem 8 GiB totais; a VM atual reserva 2 GiB. Antes de subir a stack mínima, confirmar pressão de memória e reajustar a VM dentro do limite de 4 GiB/3 vCPU.

## Fontes oficiais

- Colima instalação binária: https://github.com/abiosoft/colima/blob/main/docs/INSTALL.md
- Colima releases: https://github.com/abiosoft/colima/releases/tag/v0.10.3
- Colima FAQ (COLIMA_HOME, DOCKER_CONFIG, contextos): https://github.com/abiosoft/colima/blob/main/docs/FAQ.md
- Lima instalação de archive: https://lima-vm.io/docs/installation/
- Lima releases: https://github.com/lima-vm/lima/releases/tag/v2.3.0
- Docker CLI para macOS (client-only): https://docs.docker.com/engine/install/binaries/
- Docker Compose releases: https://github.com/docker/compose/releases/tag/v5.7.1
