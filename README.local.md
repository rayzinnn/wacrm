# Instalação local do WACRM

Este guia prepara o WACRM desta branch para desenvolvimento local com Supabase e Evolution API locais. Não conecta o app a banco hospedado, não publica o site e não apaga dados.

## O que você precisa

- macOS em Apple Silicon (ARM64). Esse é o ambiente validado pelo projeto; Linux e Windows/WSL não foram verificados neste guia.
- Pelo menos 8 GB de RAM e cerca de 25 GB livres em disco.
- Git, Node.js 22.12 ou superior, npm 10.9.9, Colima, Lima, Docker CLI com Compose e Supabase CLI 3.1.0.
- A instalação inicial precisa de internet para baixar dependências e imagens. Depois, o CRM, Supabase, Evolution, Postgres e Redis executam localmente. WhatsApp real e provedores externos de IA continuam dependendo de rede; use fixtures e testes simulados para uma verificação sem chamadas externas.

Instale Colima, Lima, Docker CLI/Compose e Supabase CLI usando as instruções oficiais. No macOS, não é necessário instalar Docker Desktop.

- [Instalar Colima](https://github.com/abiosoft/colima/blob/main/docs/INSTALL.md)
- [Instalar Lima](https://lima-vm.io/docs/installation/)
- [Instalar Docker CLI](https://docs.docker.com/engine/install/binaries/)
- [Instalar Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Baixar o código

```sh
git clone --branch feat/uazapi-only https://github.com/rayzinnn/wacrm.git
cd wacrm
npm ci
```

Use o Node e npm indicados acima para manter as instalações compatíveis com o lockfile.

## Iniciar Docker e Supabase local

Crie e inicie o perfil Colima. Isso cria uma VM local; não use `colima delete` para desligá-la.

```sh
colima start --profile wacrm --arch aarch64 --vm-type vz --cpu 3 --memory 4 --disk 24
```

Crie uma rede Docker que publique os serviços locais somente em loopback e inicie a stack mínima do Supabase:

```sh
docker network create \
  --driver bridge \
  --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
  wacrm-local

NETWORK_ID="$(docker network inspect --format '{{.Id}}' wacrm-local)"
supabase start \
  --network-id "$NETWORK_ID" \
  --exclude imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
supabase status
supabase migration up
supabase migration list
```

Confirme que as migrations locais estão aplicadas. Não execute `supabase link`, não selecione um projeto remoto e não use `supabase db reset` para iniciar o ambiente.

## Configurar o app

Crie `.env.local` na raiz do repositório. Obtenha a URL e as chaves **da saída local** de `supabase status`; elas são diferentes em cada computador. Não reutilize nem envie as chaves de outra máquina.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key da saída local do Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service role key da saída local do Supabase>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_LOCALE=pt
ENCRYPTION_KEY=<64 caracteres hexadecimais gerados localmente>
EVOLUTION_ALLOWED_ORIGINS=http://127.0.0.1:8080
EVOLUTION_WEBHOOK_BASE_URL=http://host.lima.internal:3000
EVOLUTION_EVENTS_CRON_SECRET=<segredo aleatório gerado localmente>
```

Gere `ENCRYPTION_KEY` e `EVOLUTION_EVENTS_CRON_SECRET` localmente, por exemplo com `openssl rand -hex 32`; guarde os resultados apenas nos arquivos locais. Proteja o arquivo:

```sh
chmod 600 .env.local
```

`.env.local` é ignorado pelo Git. Nunca o adicione ao commit nem compartilhe suas chaves.

## Iniciar a Evolution API local

A imagem desta branch aplica correções locais sobre a versão fixada da Evolution. Construa-a na máquina nova e use um arquivo override ignorado pelo Git, porque o digest da imagem compilada pode variar entre máquinas.

```sh
mkdir -p .local
docker build \
  --pull=false \
  --platform linux/arm64 \
  -t wacrm-evolution-api:local \
  -f infra/evolution/build/Dockerfile \
  infra/evolution/build

cat > .local/evolution-compose.override.yaml <<'YAML'
services:
  evolution-api:
    image: wacrm-evolution-api:local
YAML
```

Crie `infra/evolution/.env` com valores novos para esta máquina. Gere senhas aleatórias hexadecimais para evitar caracteres especiais na URL do banco.

```dotenv
POSTGRES_USER=wacrm
POSTGRES_PASSWORD=<senha aleatória>
POSTGRES_DB=evolution
DATABASE_CONNECTION_URI=postgresql://wacrm:<mesma senha>@postgres:5432/evolution
AUTHENTICATION_API_KEY=<chave administrativa aleatória>
INSTANCE_TOKEN=<token restrito aleatório para a instância>
```

Proteja o arquivo e inicie os serviços:

```sh
chmod 600 infra/evolution/.env
docker compose \
  --env-file infra/evolution/.env \
  -f infra/evolution/compose.yaml \
  -f .local/evolution-compose.override.yaml \
  config --quiet
docker compose \
  --env-file infra/evolution/.env \
  -f infra/evolution/compose.yaml \
  -f .local/evolution-compose.override.yaml \
  up -d
docker compose \
  --env-file infra/evolution/.env \
  -f infra/evolution/compose.yaml \
  -f .local/evolution-compose.override.yaml \
  ps
```

Para testar WhatsApp, crie uma instância local `wacrm-local` na Evolution com integração `WHATSAPP-BAILEYS`. Use a chave administrativa apenas no bootstrap e configure no WACRM somente o token restrito da instância. Parear o QR conecta a uma conta real e requer ação consciente do operador; não é necessário para os testes automatizados locais.

## Iniciar o WACRM e o processador de eventos

Inicie o app em um terminal:

```sh
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Em outro terminal, inicie o processador local de eventos Evolution:

```sh
node scripts/evolution-events-local.mjs
```

Endereços locais:

- WACRM: <http://localhost:3000>
- Supabase API: <http://127.0.0.1:54321>
- Evolution API: <http://127.0.0.1:8080>
- Configuração de WhatsApp: <http://localhost:3000/settings?tab=whatsapp>

O script versionado `evolution-events-local.mjs` processa eventos de conexão. Antes de testar automações, fluxos ou IA no navegador, confira o status e as evidências atuais: os processadores locais desses recursos podem exigir execução agendada separadamente.

## Verificações básicas

```sh
curl -fsS http://127.0.0.1:8080/
npm run typecheck
npm test -- --maxWorkers=2
```

Para executar o processador de eventos uma única vez, sem deixá-lo rodando:

```sh
node scripts/evolution-events-local.mjs --once
```

Consulte `docs/project/status.md` e `docs/project/evidence/` para saber quais recursos foram verificados e quais ainda dependem de teste. Um teste com fixture/mock confirma a lógica local, mas não comprova que o WhatsApp recebeu uma mensagem.

## Parar sem apagar dados

Use `Ctrl+C` nos terminais do app e do processador. Depois, pare os containers sem remover volumes:

```sh
docker compose \
  --env-file infra/evolution/.env \
  -f infra/evolution/compose.yaml \
  -f .local/evolution-compose.override.yaml \
  stop
supabase stop
colima stop --profile wacrm
```

Não use `docker compose down -v`, `supabase db reset` ou `colima delete` para parar o ambiente: esses comandos podem apagar dados locais.

## Dados locais e outro computador

Cada clone tem seu próprio banco, volumes, usuários, chaves e sessão Evolution. O Git sincroniza o código, não os dados locais. Para começar no segundo computador, crie um ambiente novo. Não copie `.env.local`, `infra/evolution/.env`, volumes ou QR por chat. Se for necessário migrar dados, faça um backup e um plano de restauração separados antes de transportar qualquer arquivo.
