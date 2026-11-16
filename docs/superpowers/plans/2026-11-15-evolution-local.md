# WACRM — execução local com Evolution API

> Decisão do usuário em 15/11/2026: ainda não há serviço UAZAPI; foi autorizada a substituição por Evolution API executada localmente. Este adendo prevalece sobre as referências a UAZAPI nos dois planos originais para a execução atual. Os planos originais e seus backups são preservados.

**Objetivo:** executar o WACRM em `http://localhost:3000`, com autenticação, inbox, contatos e funis persistentes e integração por QR à Evolution API local, sem transporte Meta e sem publicação.

**Arquitetura:** preservar Next.js/React e Supabase do commit `c81299d1488aac02fa584f68d97c2524c1e7a661`. Usar Supabase local para o CRM e Evolution local com seu próprio banco/cache. Uma instância Baileys por conta operacional. O contrato concreto será fixado por versão e comprovado antes dos consumidores; não adaptar payloads UAZAPI por suposição.

## Decisões e limites

- Provedor: Evolution API local, autorizado pelo usuário; nenhum provedor adicional ou fallback Meta.
- Banco: Supabase local, decisão técnica do coordenador para preservar os projetos remotos existentes e manter esta execução local.
- Runtime de containers: preferir ferramentas userland suportadas no macOS, com serviços e volumes próprios do WACRM. Não alterar os bancos de outros projetos.
- Serviços expostos apenas em loopback. Callback da Evolution para o CRM usa caminho de rede local alcançável pelos containers, autenticado e sem túnel público.
- Segredos gerados diretamente em arquivos locais ignorados, com permissões restritas; nunca incluídos em relatório, resposta ou commit. QR e tokens não são logados.
- Operador ainda precisa vincular o WhatsApp pelo QR; a sessão não pode ser considerada conectada por inferência.
- T15/T16 (staging, produção e piloto externo) ficam fora desta solicitação. Testes reais de WhatsApp dependem de vinculação e destinatário definido, sem envios não solicitados.
- Nenhum push, merge ou deploy. Commits locais por entrega verificada.

## Correspondência com o plano original

T01/T02 mantêm a preparação e baseline. T03 passa a fechar o contrato da versão Evolution instalada, incluindo criação local da instância, QR/estado, credencial de instância, webhook e mídia. T04 mantém o inventário completo e o desenho transacional. T05–T14 mantêm os mesmos aceites de deduplicação, isolamento, idempotência, estados incertos, mídia privada, motores e bloqueio Meta.

Nomes de arquivos, rotas e identificadores específicos do novo provedor usarão `evolution`, sem conservar nomes `uazapi` que induzam erro. Os contratos comuns de credenciais/estado/eventos/operações mantêm a semântica; o contrato exato Evolution e a correspondência SQL precisam ser revisados e registrados antes de T05/T06. O allowlist local deverá aceitar somente a origem exata da Evolution provisionada pelo operador, inclusive HTTP de loopback para este laboratório; não liberar HTTP arbitrário nem origens definidas pelo callback.

## Sequência delegada

1. T01.a/b: backup, clone fixado, integração sem colisão, remotes e evidências.
2. Infra.a: runtime de containers local verificado com operação simples.
3. T02.a: npm fixado, instalação por lockfile, configuração local sem Meta real.
4. Infra.b / T02.b: Supabase e dependências Evolution locais em volumes separados; migrations completas somente no banco local novo.
5. T02.c: lint, typecheck, testes, build e login/inbox/contatos/funil locais.
6. T03.a–c: versão/contrato Evolution, instância e fixtures sanitizadas; rever permissões e callback local.
7. T04.a–c: consumidores, schema/RPC/dispatch e cobertura de referências; revisão do coordenador.
8. T05–T14 nos recortes originais adaptados ao contrato Evolution. Nenhuma dependência pendente é marcada como satisfeita.
9. Revisão independente LUNA do diff e verificação do fluxo local. Manter serviços necessários acessíveis e documentar comandos de iniciar/parar.

## Evidências de conclusão

Registrar comandos e resultados em `docs/project/evidence/`, status real em `docs/project/status.md` e instruções em `docs/project/setup.md`. A tela de login isolada não comprova CRM funcional; QR isolado não comprova troca de mensagens. Registrar separadamente o que passou, o que depende do operador e o que está fora desta execução.
