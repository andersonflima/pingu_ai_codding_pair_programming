# Realtime Dev Agent for Zed

Esta extensao de desenvolvimento para Zed fornece snippets e um language server local para manter o Realtime Dev Agent ativo no editor.

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

Pre-requisito:

- `node` disponivel no PATH para o language server local
- toolchain Rust instalada para o Zed compilar a dev extension

Escopo atual desta extensao:

- snippets para linguagens e formatos suportados pelo agente
- diagnostics em tempo real via language server local
- code actions para aplicacao de sugestoes baseadas em snippet dentro do proprio arquivo
- code action de `terminal_task` com execucao local em background e logs em tempo real
- instalacao local como dev extension

Observacao:

- `context_file` e `unit_test` continuam sendo aplicados por quick fix no proprio arquivo
- `terminal_task` no Zed usa code action e logs do language server, enquanto Vim/Neovim e VS Code usam terminal visivel do editor
