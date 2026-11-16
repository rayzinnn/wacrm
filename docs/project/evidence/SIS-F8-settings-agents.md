# F8 — QA visual de Configurações e Agentes de IA

**Data:** 2026-11-16 · **Alvo:** localhost · **Portal:** `WACRM Settings Agents Fresh QA`

## Ambiente e sessão sintética

- Confirmados Docker context `colima-wacrm`, Supabase Auth/API `127.0.0.1:54321` e Postgres `127.0.0.1:54322`.
- O portal novo abriu em `/signup` sem sessão autenticada. O viewport inicial foi 800×600; o resize explícito para 1440×900 funcionou.
- Foi criada uma conta com nome de teste sintético longo e email em `fixture.invalid`; o cadastro chegou a `/dashboard`.

## Resultado observado e limite

- Navegar para `/settings?tab=overview` retornou confirmação de navegação. A avaliação DOM agregada não terminou dentro de 10 s, então interrompi a varredura.
- **Não foi obtida observação visual/DOM de Configurações ou Agentes de IA.** `/agents`, deep links das seções, campos longos, overlays e overflow em 320/1440 e SIS claro/escuro ficam **não verificados**. Nenhum defeito reproduzível foi confirmado; isso não equivale a aprovação das superfícies.
- Não capturei screenshots, não abri QR, não usei segredos, não salvei configurações nem acionei envio/provedores externos. O coordenador confirmou por `maestri portal info` que o portal está em `/login`.

## Limpeza

- Removida exatamente uma linha de `public.accounts` pela combinação do UUID sintético da conta com o UUID do proprietário.
- Removida exatamente uma linha de `auth.users` pelo UUID sintético e domínio `fixture.invalid`.
- Verificação local retornou **zero linhas residuais em 72 escopos** de conta/usuário, incluindo sessões, identidades, perfis e tabelas com `account_id`/referências ao usuário. Essa verificação foi restrita aos escopos ligados à fixture; não foi uma contagem global do banco.
- Cookies de sessão do portal sintético foram descartados. A fixture temporária com identificadores foi removida após a verificação; nenhum identificador ou segredo está neste arquivo.

Sem alterações de código/status e sem commit.
