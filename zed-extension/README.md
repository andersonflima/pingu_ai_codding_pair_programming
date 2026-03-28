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
- instalacao local como dev extension

Limitacao atual:

- a extensao do Zed ainda nao executa automaticamente acoes de terminal como o fluxo do Vim/Neovim e do VS Code
- `context_file` e `unit_test` aparecem como diagnostico e quick fix, mas a base ativa no Zed ainda esta em evolucao
