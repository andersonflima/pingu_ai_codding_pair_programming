# Realtime Dev Agent for Zed

Esta extensao de desenvolvimento para Zed fornece snippets para inserir comentarios acionaveis do Realtime Dev Agent.

Prefixos disponiveis:

- `rda:` cria comentario de geracao ou ajuste de codigo
- `rda*` cria comentario de acao de terminal
- `rda**` cria comentario de contexto ou blueprint
- `rda\\s:` cria comentario escapado de geracao
- `rda\\s*` cria comentario escapado de terminal
- `rda\\s**` cria comentario escapado de contexto

Como instalar no Zed:

1. Abra `zed: extensions`
2. Clique em `Install Dev Extension`
3. Selecione esta pasta: `zed-extension/`

Escopo atual desta extensao:

- snippets para linguagens e formatos suportados pelo agente
- instalacao local como dev extension

Limitacao atual:

- a integracao em tempo real com diagnosticos, terminal e aplicacao automatica continua existindo hoje no Vim/Neovim e no VS Code
- no Zed, esta extensao entrega os atalhos de snippets para disparar os comentarios acionaveis com rapidez
