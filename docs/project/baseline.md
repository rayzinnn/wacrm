# WACRM — baseline T01

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

- Não foram instaladas dependências. Versões locais de Node/npm ainda não foram verificadas; pertencem a T02.a.
- Nenhum teste, build ou servidor foi executado.
- Nenhum banco, serviço externo, deployment ou arquivo remoto foi alterado.
- Mudança de escopo comunicada pelo usuário em 2026-11-15: UAZAPI não existe; Evolution API local autorizada somente em localhost. Os planos existentes não foram editados; cabe ao coordenador revisar o contrato antes dos recortes de implementação.
