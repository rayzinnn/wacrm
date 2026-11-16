# WACRM — baseline T02.c-checks (complemento de T01/T02.a)

Data: 2026-11-15

## Código fixado

- Repositório de referência: `ArnasDon/wacrm`.
- Commit/base: `c81299d1488aac02fa584f68d97c2524c1e7a661`.
- Branch local: `feat/uazapi-only`.
- Inventário no commit: 647 caminhos Git rastreados; 57 migrations em `supabase/migrations/`.
- `package-lock.json`: presente e preservado.
- Clone inicial: `/tmp/wacrm-t01a-clone.I3vmx1/repo`; cópia integrada para esta raiz preservando caminhos existentes.
- Remotes locais: `upstream` → `https://github.com/ArnasDon/wacrm.git`; `origin` → `https://github.com/rayzinnn/wacrm.git`.
- O usuário informou que o plugin GitHub confirmou o login `rayzinnn`, repositório próprio público `rayzinnn/wacrm` e permissões admin/push. Nenhum fork foi criado e nenhum push foi feito.

## Workspace e documentação

- Antes da integração, a raiz não era um worktree Git e continha somente os planos do projeto em `docs/` e arquivos locais `.maestri/`.
- Backup exclusivo fora do workspace: `/tmp/wacrm-t01a-backup.Igl0X9/docs/`.
- Colisões exatas entre os 647 caminhos rastreados pelo clone e os 14 arquivos existentes antes da integração: zero. Cópia executada sem sobrescrita.
- `.maestri/` foi preservada e excluída apenas em `.git/info/exclude`, sem editar arquivos do usuário.
- SHA-256 de `docs/superpowers/plans/2026-11-15-crm-whatsapp.md`: `7034f49e444189c20376f80afd710ac86eef7b752b54d720aa03b6c417ac278f`.
- SHA-256 de `docs/superpowers/plans/2026-11-15-wacrm-execucao.md`: `cc2c6c9e4710b09392837b28b69a40aafda67ff8415257747227f9db1ad8d629`.
- Hashes verificados iguais aos da cópia pré-integração e do backup externo.

## Referência do produto lida no SHA fixado

- `AGENTS.md` exige consultar guias Next em `node_modules/next/dist/docs/` antes de editar código Next.
- `CLAUDE.md` inclui `AGENTS.md`.
- README anuncia inbox, contatos, funis/negócios, broadcasts, automações, IA, equipe e API pública.
- `LICENSE` declara MIT; manter avisos e licença ao distribuir.
- `package.json`: WACRM `0.8.0`, Next `16.3.8`, React `19.2.4`, Node `>=22.12.0`, npm `10.9.9`; scripts lint/typecheck/test/build declarados.

## Estado de execução

- Node `v22.19.0`; npm do ambiente `10.9.3`; checks via npm `10.9.9` quando disponível por npx. `npm ci` exit 0, 691 pacotes adicionados; hash `package-lock.json` `f5336fdba7b670d3daef78d3bbbdd4872310e608640f384f3e155e05908ae4d7`, inalterado.
- Lint exit 0: 40 warnings, 0 errors. Typecheck exit 0.
- Vitest limitado com `npm test -- --maxWorkers=2`: exit 0, 158 arquivos e 1.695 testes passaram. A ajuda local confirmou suporte a `--maxWorkers`. A primeira execução padrão também passou, mas usou os 158 workers padrão.
- Build exit 0 usando variáveis Supabase de processo com URL loopback `http://127.0.0.1:54321` e placeholders de baseline; nenhum serviço foi contatado. `META_APP_SECRET` não foi necessário para compilar. `vitest.config.ts` injeta valor sintético nos testes; o helper de webhook continua exigindo variável no runtime quando exercitado.
- Saídas completas dos checks estão em `.t02c-logs/`, excluída localmente por `.git/info/exclude`.
- Nenhum servidor, login/inbox, banco Supabase, serviço externo, deployment ou arquivo remoto foi alterado. T02.c smoke/login não foi executado.
- Mudança de escopo comunicada pelo usuário em 2026-11-15: UAZAPI não existe; Evolution API local autorizada somente em localhost. Os planos existentes não foram editados; cabe ao coordenador revisar o contrato antes dos recortes de implementação.
