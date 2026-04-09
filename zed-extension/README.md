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

Ajustes de fluidez do language server:

- debounce por mudanca de texto antes de reanalisar
- cache por versao do documento
- reaproveitamento da analise apos quick fix para evitar rodada duplicada
- open/change usam analise leve por padrao; save continua completo
- mudancas de texto priorizam a faixa alterada com padding configuravel, em vez de sempre reanalisar o arquivo inteiro

Knobs opcionais por ambiente:

- `PINGU_ZED_OPEN_DEBOUNCE_MS`
- `PINGU_ZED_CHANGE_DEBOUNCE_MS`
- `PINGU_ZED_SAVE_DEBOUNCE_MS`
- `PINGU_ZED_REALTIME_ANALYSIS_MODE`
- `PINGU_ZED_REALTIME_FOCUS_PADDING_LINES`

Observacao:

- no `save`, o Zed agora consolida automaticamente `comment_task`, fixes locais, `unit_test` adjacente seguro e `context_file` quando o alvo estiver em `.realtime-dev-agent/`, `.gitignore`, `README.md`, `docs/`, `.github/` ou em raizes arquiteturais previsiveis como `src/`, `lib/`, `app/`, `domain/`, `application/`, `infrastructure/`, `interfaces/`, `main/`, `internal/`, `pkg/` e `cmd/`
- `terminal_task` no Zed entra automaticamente no `save`, respeitando o mesmo modo de risco do runtime e mantendo logs no language server
