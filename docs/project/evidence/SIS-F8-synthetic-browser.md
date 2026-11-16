# F8 — QA de tema com conta sintética

**Data:** 2026-11-16 · **Portal novo:** `SIS F8 Synthetic QA` · `http://localhost:3000`

## Sessão e privacidade

- O portal novo abriu em `/signup` (1440×961), com formulário de cadastro e sem sessão local já autenticada. A conta criada usou nome/email sintéticos em `fixture.invalid`.
- O cadastro levou a sessão sintética para `/dashboard`. UUID/email de limpeza foram guardados temporariamente em arquivo local com modo `600`. Senha e tokens não foram registrados nesta evidência.
- Nenhuma captura foi salva. Resultados abaixo são somente agregados; conteúdo de conversas, textos de contato, emails e identificadores não foram incluídos.

## Resultados observados

| Rota | Tema/modo | Viewport CSS reportado | Observação agregada |
| --- | --- | ---: | --- |
| `/signup` | Não medido | 1440×961 | Formulário de cadastro visível antes da criação da sessão; quatro campos e ação de cadastro. |
| `/dashboard` | SIS / claro | 769×901 | Um landmark `main`; sem overflow horizontal de página ou do `main`. |
| `/contacts` | SIS / claro | 1439×959 | Um `main`; sem overflow horizontal de página. |
| `/contacts` | SIS / claro | 769×901 | Um `main`; sem overflow horizontal de página ou do `main`; sinal agregado de estado vazio presente. |
| Controle de modo | SIS / claro | — | O controle mudou o modo para `light`; `wacrm.mode` passou a `light`. A preferência de tema continuava ausente no momento da medição. |

O portal falhou ao navegar para a próxima rota do ciclo em 768×900 (`Request failed`, status 0). A varredura foi encerrada sem retry adicional.

## Matriz e lacunas

| Superfície | 1440 | 768 | 320 | 200% zoom |
| --- | --- | --- | --- | --- |
| Dashboard | Não verificado | SIS/claro: medição agregada acima | Não verificado | Não verificado |
| Contatos | SIS/claro: medição agregada acima | SIS/claro: medição agregada acima | Não verificado | Não verificado |
| Pipelines | Não verificado | Não verificado; navegação falhou antes do resultado | Não verificado | Não verificado |
| Inbox vazia | Não verificado | Não verificado | Não verificado | Não verificado |
| Configurações | Não verificado | Não verificado | Não verificado | Não verificado |
| Auth/login | Não verificado | Não verificado | Não verificado | Não verificado |

Tema escuro não foi medido nesta sessão. A tela de cadastro foi observada somente em 1440×961; login não foi aberto após a autenticação. Nenhuma interação de Inbox, WhatsApp, provedor externo ou gravação de dados de CRM foi realizada. Zoom real de navegador a 200% não foi medido.

Após a revisão, a coordenação apagou a conta sintética antes do usuário Auth, confirmou zero linhas restantes de usuário, conta e perfil e removeu o arquivo temporário de limpeza. Nenhum registro de CRM foi criado nessa conta.
