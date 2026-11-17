# SIS F8 — cartão da conta em Configurações

Em 17/11/2026, o portal local mostrou que, a 320 px, o selo de função ocupava a mesma linha do nome e deixava “Administrador local” e o e-mail truncados. O cartão agora quebra a linha: avatar e identificação permanecem juntos, e o selo aparece abaixo no celular. A 1440 px, o selo volta à linha normal.

Conferi a tela a 320 e 1440 px. `innerWidth` e `documentElement.scrollWidth` foram iguais nos dois tamanhos. ESLint focado, TypeScript e `git diff --check` passaram. Esta inspeção não cobriu leitor de tela nem zoom real de 200%.
