# Pingu - Dev Agent

<p align="center">
  <img src="./assets/pingu.png" alt="Pingu, a cara do Pingu - Dev Agent" width="240" />
</p>

Pingu e um agente de pair programming em tempo real orientado a arquivo e editor. Ele nao foi desenhado como um chat generico. Ele observa o buffer atual, encontra problemas e pedidos explicitos no proprio codigo, gera snippets idiomaticos por linguagem, cria contexto persistente, sugere ou cria testes, injeta dependencias faltantes e executa acoes de terminal com politica de risco.

O projeto funciona hoje em `Vim/Neovim`, `VS Code` e `Zed`, com runtime local e cobertura offline por linguagem. Isso significa que uma parte grande do fluxo funciona sem API key.

## O que o Pingu faz

- Analisa o arquivo atual em tempo real e publica diagnosticos orientados a manutencao.
- Interpreta comentarios acionaveis para gerar codigo no proprio arquivo.
- Cria `context_file` a partir de blueprints descritos no comentario, com scaffold nativo nas stacks principais.
- Gera ou complementa testes quando `tests/` ou `test/` ja existem no projeto.
- Detecta dependencias faltantes quando o snippet gerado exige imports, `use`, `require` ou `#include`.
- Tenta inserir imports e includes na fronteira correta do arquivo em vez de simplesmente despejar tudo na linha do comentario.
- Executa `terminal_task` com inferencia por stack e politica de risco configuravel.
- Expoe follow-up acionavel para continuar o pareamento sem sair do arquivo.
- Mantem um contrato de paridade entre `LazyVim`, `VS Code` e `Zed`.

## O que o Pingu melhora para quem usa

- Reduz troca de contexto: o pedido nasce no comentario do codigo e a resposta volta para o proprio arquivo.
- Acelera scaffolding: funcoes, estruturas, blueprints e testes saem sem interromper o fluxo.
- Diminui repeticao: imports, snippets base, comentarios de manutencao e testes complementares deixam de ser trabalho manual.
- Mantem consistencia arquitetural: o contexto `**` registra regras de stack e de arquitetura para orientar geracoes futuras.
- Torna o loop de review mais curto: o agente analisa, sugere, aplica, remove o gatilho e reanalisa.
- Funciona bem em ambiente local: boa parte das capacidades ja esta no runtime offline.

## Barra de excelencia

O backlog oficial da barra de excelencia do agente esta em [docs/agent-excellence-backlog.md](./docs/agent-excellence-backlog.md).

Esse contrato organiza o que o Pingu precisa fazer automaticamente para ser excelente:

- nao quebrar codigo nem imports
- operar no arquivo atual por padrao
- comentar e corrigir com contexto real
- validar e reverter sozinho quando piorar o estado do arquivo
- manter baixo custo no loop de edicao

## O que o Pingu nao e

- Nao e um chat generico de perguntas soltas.
- Nao substitui decisao arquitetural do time.
- Nao promete gerar qualquer coisa em qualquer linguagem sem contrato de capacidade.
- Nao cria testes automaticamente em projeto sem `tests/` ou `test/`.

## Como o loop funciona

1. Voce abre um arquivo suportado em `Vim/Neovim`, `VS Code` ou `Zed`.
2. O Pingu analisa o buffer em abertura, foco, edicao e `save`, conforme o editor.
3. Quando encontra um comentario acionavel, ele transforma isso em uma issue do tipo:
   - `comment_task`
   - `context_file`
   - `unit_test`
   - `terminal_task`
4. O editor aplica a acao automaticamente ou via quick fix, dependendo do fluxo.
5. Quando a acao termina com sucesso, a linha gatilho e removida.
6. O arquivo e reanalisado para continuar o pareamento.

## Tipos de comentario acionavel

### `:` ou `::` gera ou ajusta codigo

Use o prefixo de comentario da linguagem seguido de `:`:

```javascript
//: funcao soma
```

Em linguagens com comentario `//`, o formato recomendado para evitar ambiguidade com bloco e JSDoc e `//::`:

```javascript
//:: funcao soma
```

```python
#: implementar funcao para calcular total do pedido
```

```lua
--: cria modulo billing com funcoes listar e criar
```

Para comentario de bloco, use marcador explicito dentro do bloco (`/*::`), em vez de texto livre:

```c
/*:: funcao dice que retorna um numero random de um dado de 20 lados */
```

### `**` ou `:::` cria contexto persistente e pode gerar scaffold

```javascript
// ** bff para crud de usuario
```

Formato recomendado em comentarios com `//`:

```javascript
//::: bff para crud de usuario
```

```lua
-- ** projeto existente usa onion architecture, controllers finos e casos de uso puros
```

Quando o blueprint descreve um fluxo de BFF CRUD, o scaffold nativo hoje e mais forte em:

- `JavaScript` e `TypeScript`
- `Python`
- `Go`
- `Rust`
- `Elixir`
- `Ruby`
- `C`

### `*` executa acao de terminal

```javascript
//* rodar testes
```

```python
# * listar arquivos do projeto
```

```lua
-- * executar este arquivo
```

### Marcadores escapados

Se voce quiser manter o comentario literal e impedir a acao do agente, use as variantes escapadas:

- `\s:`
- `\s::`
- `\s*`
- `\s**`
- `\s:::`

## Exemplos reais de uso e output

### 1. Geracao simples de funcao em JavaScript

Entrada:

```javascript
//: funcao soma
```

Output gerado:

```javascript
/**
 * Orquestra o comportamento principal de soma
 * @param {*} a Parametro de entrada do fluxo.
 * @param {*} b Parametro de entrada do fluxo.
 * @returns {*} Valor calculado conforme a regra principal da funcao.
 */
function soma(a, b) {
  // Retorna o resultado consolidado desta funcao.
  return a + b
}
```

O que melhora aqui:

- a funcao ja nasce com nome util
- a assinatura vem coerente com a intencao
- a documentacao minima de manutencao ja entra junto

### 2. Funcao com marcador explicito em C

Entrada:

```c
//:: funcao dice que retorna um numero random de um dado de 20 lados
```

Output gerado no arquivo:

```c
int dice(void) {
  // Retorna o resultado consolidado desta funcao.
  return (rand() % 20) + 1;
}
```

Output complementar de dependencia:

```c
#include <stdlib.h>
```

O que melhora aqui:

- o gatilho fica explicito e menos sujeito a falso positivo em comentario livre
- o retorno fica consistente com a semantica de `d20`
- o agente detecta o `#include` faltante

### 3. Blueprint de contexto com scaffold inicial

Entrada:

```javascript
//::: bff para crud de usuario
```

Outputs tipicos:

- atualiza `.gitignore` para ignorar `.realtime-dev-agent/`
- cria `.realtime-dev-agent/contexts/bff-crud-usuario.md`
- cria scaffold inicial seguindo Onion Architecture e o source root da stack atual

Arquivos tipicos gerados:

```text
.realtime-dev-agent/contexts/bff-crud-usuario.md
src/domain/entities/usuario.js
src/domain/repositories/usuario-repository.js
src/application/use-cases/list-usuarios.js
src/application/use-cases/get-usuario-by-id.js
src/application/use-cases/create-usuario.js
src/application/use-cases/update-usuario.js
src/application/use-cases/delete-usuario.js
src/infrastructure/repositories/in-memory-usuario-repository.js
src/interfaces/http/controllers/usuario-controller.js
src/interfaces/http/routes/usuario-routes.js
src/main/factories/usuario-crud-factory.js
```

Exemplo equivalente em Python:

```text
.realtime-dev-agent/contexts/bff-crud-usuario.md
app/domain/usuario.py
app/domain/usuario_repository.py
app/application/create_usuario.py
app/infrastructure/in_memory_usuario_repository.py
app/main/build_usuario_crud.py
```

O que melhora aqui:

- o time registra contexto arquitetural duravel
- o agente passa a usar esse contrato nas proximas geracoes
- o bootstrap de um BFF CRUD deixa de ser trabalho repetitivo

### 4. Acao de terminal no VS Code

Entrada:

```javascript
//* rodar testes
```

Output esperado no terminal integrado:

```text
[RealtimeDevAgent] command: npm test
...
[RealtimeDevAgent] exit code: 0
[RealtimeDevAgent] terminal pronto para o proximo comando.
```

Comportamento esperado:

- o terminal integrado abre
- o comando e inferido pelo contexto do projeto
- a linha gatilho e removida quando o processo termina com sucesso

### 5. Follow-up acionavel

Quando o editor encontra um problema elegivel, o Pingu pode inserir um follow-up logo abaixo do trecho atual.

Exemplo de output:

```javascript
// : Use um ticket ou comentario estruturado para pedir a proxima alteracao aqui
```

O que melhora aqui:

- o pareamento continua no proprio arquivo
- o desenvolvedor nao precisa lembrar a sintaxe do marcador
- o editor vira a superficie principal de colaboracao com o agente

### 6. Diagnosticos de manutencao

Mesmo sem comentario acionavel, o Pingu pode propor manutencao.

Exemplo em Python:

Entrada:

```python
def soma(a, b):
    return a + b
```

Output tipico:

- `function_doc`
- `flow_comment`

Snippets esperados:

```python
# Orquestra o comportamento principal de soma
# a: parametro de entrada do fluxo.
# b: parametro de entrada do fluxo.
# Retorno: Valor calculado conforme a regra principal da funcao.
```

```python
    # Retorna o resultado consolidado desta funcao.
```

## O que o `:` consegue construir

O parser do `:` ja entende intencao explicita e tenta gerar estrutura idiomatica por linguagem.

Categorias suportadas:

- `function`
- `crud`
- `ui`
- `test`
- `comment`
- `enum`
- `class`
- `interface` ou `type`
- `struct`
- `module` ou `namespace`
- `object`
- `collection`
- `variable`
- `script`

Quando uma estrutura equivalente ja existir no arquivo, o agente tenta evitar duplicacao.

## Cobertura por linguagem

O contrato declarativo canonico fica em `lib/language-capabilities.js`. Esse arquivo define extensoes, `editorFeatures`, `commentTaskIntents`, capacidades offline e boas praticas da linguagem.

Resumo pratico:

- JavaScript, TypeScript e React:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, CRUD, UI, enum, class, interface/type, module, objeto, colecao e variavel
- Python:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, Enum, class, module, object, collection e variable
- Elixir:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `defmodule`, contratos com `@type`, enums por atoms e CRUD inicial
- Go:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `struct`, `interface`, enum tipado, module e object
- Rust:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `struct`, `trait`, `enum`, `mod`, object e collection
- Ruby:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `class`, `module`, `Struct`, hash e enum equivalente
- C:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `struct`, `enum` e contratos simples
- Lua:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, modulos, tabelas, enums equivalentes e CRUD inicial
- Vimscript:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, namespace local, dicionarios e helpers de automacao
- Shell:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, scripts, colecoes simples e enums equivalentes
- Terraform:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  snippets estruturados, `required_version`, blueprint de contexto e testes de contrato
- YAML:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  configuracao estruturada e testes de contrato
- Markdown:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  documentos, terminal acionavel por comentario e testes de contrato
- Mermaid:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  diagramas, terminal acionavel por comentario e testes de contrato
- Dockerfile:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  contrato de `WORKDIR`, contexto persistente, snippets operacionais e testes
- TOML:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  configuracao, secoes estruturadas, testes de contrato e terminal por comentario

## Regras de testes automaticos

- O agente so gera testes automaticamente quando o projeto ja possui `tests/` ou `test/`.
- Se nem `tests/` nem `test/` existirem, ele nao cria a pasta por conta propria.
- Quando o arquivo ainda nao tem teste correspondente, ele cria o teste base.
- Quando o arquivo ja tem teste base, ele tenta gerar testes complementares para comportamento novo.
- Para `Dockerfile`, `compose`, `Markdown` e `Mermaid`, o agente gera testes de contrato em shell dentro de `tests/`.

## Como o terminal e inferido

O Pingu tenta escolher o comando mais natural para o projeto e para a linguagem:

- Node.js: `npm test`, `npm run dev`, `npm run build`, `npm run lint`, `npm run format`
- Elixir: `mix test`, `mix run`, `mix compile`, `mix format`
- Go: `go test ./...`, `go run`, `go build ./...`, `gofmt -w`
- Rust: `cargo test`, `cargo run`, `cargo build`, `cargo fmt`, `cargo clippy`
- Python: `python -m pytest`, `python3 -m pytest`, `python arquivo.py`, `python3 arquivo.py`, `python -m py_compile`, `python3 -m py_compile`
- Ruby: `ruby arquivo.rb` ou testes quando `test/` existir
- Vimscript: `nvim --headless -u NONE -i NONE -S arquivo +qa!`
- Comandos genericos de leitura: `pwd`, `ls -la`, `git status`, `git diff`

## Como o Pingu aparece em cada editor

### Vim / Neovim

- analise continua
- painel do agente
- auto-fix
- `terminal_task`
- follow-up no painel

Atalhos principais:

- `<leader>i`: analisa o arquivo atual
- `<leader>ia`: abre ou fecha o painel
- `<Tab>`, `i` ou `a`: aplica a sugestao selecionada
- `f`: insere follow-up acionavel
- `r`: reanalisa
- `q`: fecha o painel

### VS Code

- analisa ao abrir, focar, editar e salvar
- publica diagnosticos
- auto-fix para `comment_task`, `context_file` e `unit_test`
- usa terminal integrado para `terminal_task`
- expoe follow-up via code action

Comandos:

- `Pingu - Dev Agent: Analyze Current File`
- `Pingu - Dev Agent: Toggle Realtime Analysis`

### Zed

- diagnosticos em tempo real via language server local
- quick fixes para `comment_task`, `context_file` e `unit_test`
- `terminal_task` executavel via code action
- follow-up acionavel via code action

## Instalacao via GitHub no Vim

O repositorio expoe `plugin/` e `autoload/` na raiz, entao pode ser instalado direto do GitHub.

### `lazy.nvim`

```lua
{
  "andersonflima/pingu_ai_codding_pair_programming",
  config = function()
    vim.g.realtime_dev_agent_start_on_editor_enter = 1
    vim.g.realtime_dev_agent_open_window_on_start = 0
    vim.g.realtime_dev_agent_auto_fix_enabled = 1
    vim.g.realtime_dev_agent_target_scope = "current_file"
    vim.g.realtime_dev_agent_auto_fix_scope = "near_cursor"
    vim.g.realtime_dev_agent_auto_fix_near_cursor_radius = 24
    vim.g.realtime_dev_agent_auto_fix_cluster_gap = 8
    vim.g.realtime_dev_agent_auto_fix_visual_mode = "preserve"
    vim.g.realtime_dev_agent_review_on_open = 0
    vim.g.realtime_dev_agent_realtime_on_change = 1
    vim.g.realtime_dev_agent_realtime_on_cursor_hold = 1
    vim.g.realtime_dev_agent_realtime_on_buf_enter = 1
    vim.g.realtime_dev_agent_realtime_insert_mode = 0
    vim.g.realtime_dev_agent_auto_check_max_lines = 600
    vim.g.realtime_dev_agent_auto_fix_doc_cursor_context_only = 1
    vim.g.realtime_dev_agent_auto_fix_local_cursor_context_only = 1
  end,
}
```

### `vim-plug`

```vim
Plug 'andersonflima/pingu_ai_codding_pair_programming'
```

### Startup automatico no Vim

- inicia no primeiro buffer suportado
- mantem o painel fechado por padrao
- por padrao limita diagnosticos exibidos e auto-fix ao arquivo atual
- `let g:realtime_dev_agent_open_window_on_start = 0` mantem o agente ativo sem abrir painel
- `let g:realtime_dev_agent_open_window_on_start = 1` reabre o painel no startup automatico
- `let g:realtime_dev_agent_start_on_editor_enter = 0` desliga o startup automatico
- `let g:realtime_dev_agent_review_on_open = 1` reativa revisao automatica ao abrir arquivos
- `let g:realtime_dev_agent_target_scope = 'current_file'` mantem analise e correcoes no arquivo aberto
- `let g:realtime_dev_agent_target_scope = 'workspace'` reativa acoes multi-arquivo como `context_file` e `unit_test`
- `let g:realtime_dev_agent_auto_fix_scope = 'near_cursor'` aplica apenas o trecho mais proximo do cursor
- `let g:realtime_dev_agent_auto_fix_scope = 'file'` volta para o comportamento de arquivo inteiro por ciclo
- `let g:realtime_dev_agent_auto_fix_scope = 'cursor_only'` restringe ao cursor imediato
- `let g:realtime_dev_agent_auto_fix_near_cursor_radius = 24` controla a distancia maxima entre cursor e trecho elegivel
- `let g:realtime_dev_agent_auto_fix_cluster_gap = 8` controla a distancia maxima entre issues do mesmo trecho
- `let g:realtime_dev_agent_realtime_on_cursor_hold = 1` faz o agente agir sozinho quando o cursor para sobre um bloco sem exigir edicao manual
- `let g:realtime_dev_agent_realtime_on_buf_enter = 1` agenda uma checagem leve ao entrar no arquivo atual
- `let g:realtime_dev_agent_auto_fix_visual_mode = 'preserve'` reduz ruido visual durante o batch
- `let g:realtime_dev_agent_realtime_insert_mode = 1` volta a analisar tambem no meio da digitacao
- `let g:realtime_dev_agent_auto_check_max_lines = 600` limita checks automaticos a arquivos menores
- `let g:realtime_dev_agent_auto_fix_doc_cursor_context_only = 1` restringe `function_doc`, `class_doc`, `variable_doc` e `flow_comment` ao bloco textual atual do cursor
- `let g:realtime_dev_agent_auto_fix_local_cursor_context_only = 1` restringe `debug_output`, syntax local, `trailing_whitespace`, `function_spec`, `markdown_title`, `terraform_required_version` e `dockerfile_workdir` ao bloco textual atual
- `let g:realtime_dev_agent_auto_fix_doc_cursor_context_max_lines = 80` controla o tamanho maximo desse bloco automatico
- por padrao no Vim o auto-fix automatico fica no conjunto local e seguro do arquivo atual; `context_file`, `unit_test` e `terminal_task` continuam disponiveis por quick fix ou por opt-in em `g:realtime_dev_agent_auto_fix_kinds`

### Terminal no Vim / Neovim

- `let g:realtime_dev_agent_terminal_actions_enabled = 0` desliga `terminal_task`
- `let g:realtime_dev_agent_terminal_risk_mode = 'safe'`
- `let g:realtime_dev_agent_terminal_risk_mode = 'workspace_write'`
- `let g:realtime_dev_agent_terminal_risk_mode = 'all'`
- `let g:realtime_dev_agent_terminal_strategy = 'vscode'`
- `let g:realtime_dev_agent_terminal_strategy = 'toggleterm'`
- `let g:realtime_dev_agent_terminal_strategy = 'native'`
- `let g:realtime_dev_agent_terminal_strategy = 'background'`

## Instalacao via GitHub no VS Code

### Instalar a partir de release

1. Baixe `pingu-dev-agent.vsix` na pagina de `Releases`.
2. Instale com:

```bash
code --install-extension pingu-dev-agent.vsix
```

### Empacotar localmente

```bash
npm run package:vscode
code --install-extension ./pingu-dev-agent.vsix --force
```

### Migracao do nome antigo

Se voce ja instalou a extensao antiga `andersonflima.realtime-dev-agent`, o VS Code pode manter as duas instaladas ao mesmo tempo. Para ficar apenas com o nome novo:

```bash
code --uninstall-extension andersonflima.realtime-dev-agent
code --install-extension ./pingu-dev-agent.vsix --force
```

### Problema comum ao instalar pelo CLI

Se o `code --install-extension` falhar com algo como `uv_cwd` ou `getcwd: cannot access parent directories`, o problema nao e da extensao. O terminal atual esta em um diretorio invalido.

Rode a instalacao a partir de um diretorio existente:

```bash
cd ~
code --install-extension /caminho/absoluto/para/pingu-dev-agent.vsix --force
```

### Configuracoes do VS Code

- `realtimeDevAgent.enabled`
- `realtimeDevAgent.nodePath`
- `realtimeDevAgent.scriptPath`
- `realtimeDevAgent.maxLineLength`
- `realtimeDevAgent.realtimeOnSave`
- `realtimeDevAgent.realtimeOnChange`
- `realtimeDevAgent.changeDebounceMs`
- `realtimeDevAgent.terminalActionsEnabled`
- `realtimeDevAgent.terminalRiskMode`
- `realtimeDevAgent.autoFixEnabled`
- `realtimeDevAgent.autoFixKinds`

### Modos de risco do terminal no VS Code

- `safe`: apenas comandos de leitura
- `workspace_write`: leitura, testes, build, formatacao, install e execucao local
- `all`: inclui comandos classificados como destrutivos

## Instalacao local no Zed

O suporte do Zed fica em [zed-extension/](./zed-extension).

### Instalar como dev extension

1. Abra `zed: extensions`
2. Clique em `Install Dev Extension`
3. Selecione a pasta `zed-extension/`

Pre-requisitos:

- `node` no PATH
- toolchain Rust instalada para o Zed compilar a extensao

## Credenciais e variaveis de ambiente

Os fluxos orientados por IA usam OpenAI Codex por padrao. O contrato principal agora e `OPENAI_API_KEY`.

Linguagens ativas por padrao no runtime:

- todas as linguagens mapeadas no registry, exceto o fallback `default`
- hoje isso inclui `javascript`, `python`, `elixir`, `go`, `rust`, `ruby`, `lua`, `vim`, `c`, `terraform`, `yaml`, `markdown`, `mermaid`, `dockerfile`, `shell` e `toml`

Variaveis comuns:

- `OPENAI_API_KEY`
- `PINGU_OPENAI_MODEL`
- `PINGU_OPENAI_TIMEOUT_MS`
- `PINGU_AUTOMATIC_AI_COMMENT_MAX_ISSUES`
- `PINGU_FLOW_COMMENT_MAX_LINES`
- `PINGU_VALIDATE_WITH_OPENAI`

Exemplo:

```bash
export OPENAI_API_KEY="sua_chave_aqui"
export PINGU_OPENAI_MODEL="gpt-5-codex"
```

Importante:

- Vim, Neovim e VS Code herdam variaveis de ambiente no momento em que sao iniciados
- se a chave mudar depois que o editor ja estiver aberto, reinicie o editor
- nunca commite credenciais
- `PINGU_AUTOMATIC_AI_COMMENT_MAX_ISSUES=8` limita quantas issues de comentario/documentacao podem subir para IA por ciclo automatico; use `0` para remover o limite
- `PINGU_DOCUMENTATION_AUTO_FIX_MIN_CONFIDENCE=0.60` controla o limiar minimo de confianca para comentario automatico documental; valores menores deixam o lote mais agressivo
- `PINGU_DOCUMENTATION_MAX_LINES=420` evita `function_doc`, `class_doc`, `variable_doc` e `flow_comment` automaticos em arquivos grandes; use `0` para remover o corte
- `PINGU_FLOW_COMMENT_MAX_LINES=260` evita `flow_comment` automatico em arquivos grandes; use `0` para remover o corte
- `PINGU_AUTOFIX_LARGE_FILE_LINE_THRESHOLD=260` define a partir de quantas linhas o VS Code passa a encolher o lote automatico
- `PINGU_AUTOFIX_DOC_MAX_PER_PASS=0` limita quantas issues documentais o VS Code aplica por ciclo; `0` remove o corte
- `PINGU_AUTOFIX_DOC_MAX_PER_PASS_LARGE_FILE=4` limita docstrings/comentarios por ciclo em arquivo grande no VS Code
- `PINGU_VALIDATE_WITH_OPENAI=1` liga os cenarios live durante os validadores que ja suportam OpenAI Codex
- no LazyVim, os equivalentes sao `g:realtime_dev_agent_auto_fix_large_file_line_threshold`, `g:realtime_dev_agent_auto_fix_large_file_radius` e `g:realtime_dev_agent_auto_fix_doc_max_per_check_large_file`
- no LazyVim, `debug_output` e `function_spec` cursor-local entram no lote automatico seguro sem depender da trilha live

## Validacao

O repositorio possui validadores locais para segurar regressao do runtime e da paridade entre editores.

Antes de rodar os validadores de matriz/checkup/intent contract, configure:

```bash
export OPENAI_API_KEY="sua_chave_aqui"
```

Para executar tambem os cenarios live contra OpenAI Codex durante a validacao:

```bash
export PINGU_VALIDATE_WITH_OPENAI="1"
```

Importante para a trilha live:

- a chave precisa ter acesso real ao endpoint `/v1/responses`
- conta sem billing ativo ou sem permissao de uso live falha no preflight antes da suite completa
- a suite live completa agora inclui uma validacao semantica dedicada para comentarios gerados por IA

### Matriz do agente

```bash
npm run validate:matrix
```

### Integracoes de editor

```bash
npm run validate:editors
```

### Orquestracao, memoria local e confianca

```bash
npm run validate:orchestration
```

Para inspecionar a confianca agregada de um arquivo com prioridades e contexto local:

```bash
node scripts/issue_confidence_report.js caminho/do/arquivo.py
```

### Contratos objetivos por stack

```bash
npm run validate:stack-contracts
```

### Quality gates de todas as linguagens ativas

```bash
npm run validate:quality-gate:active
```

### Contrato de linguagem 100% fechada

```bash
npm run validate:language:100-contract
```

### Incluir tambem o empacotamento real da extensao do VS Code

```bash
PINGU_VALIDATE_PACKAGE=1 npm run validate:editors
```

### Rodar tudo de uma vez

```bash
npm run validate:all
```

### Rodar a trilha live completa com OpenAI Codex

```bash
OPENAI_API_KEY="sua_chave_aqui" npm run validate:live:openai
```

### Rodar so a validacao live da qualidade semantica dos comentarios

```bash
OPENAI_API_KEY="sua_chave_aqui" npm run validate:live:semantic-comments
```

No CI remoto, o repositorio roda tres trilhas:

- `validate-all`: suite estrutural completa do repositorio
- `active-language-quality-gates`: gates reais de todas as linguagens ativas
- `openai-live-validation`: workflow manual e noturno para exercitar cenarios live com `OPENAI_API_KEY`

### Recriar a suite externa em `~/snippets/agent_test`

```bash
npm run rebuild:external-agent-test
```

### Validar a suite externa em `vim` e `vscode`

```bash
npm run validate:external-editors
```

### Abrir a suite manual do VS Code

```bash
npm run open:vscode:validation
```

### Abrir a suite externa inteira no VS Code

```bash
npm run open:vscode:external-validation
```

O resumo da suite externa fica em:

```bash
~/snippets/agent_test/editor-validation-report.json
```

## Contrato de paridade

- `scripts/editor_parity_contract.js` define o contrato formal entre `LazyVim`, `VS Code` e `Zed`
- `lib/language-capabilities.js` define o contrato declarativo por linguagem
- `npm run validate:editors` quebra quando uma feature obrigatoria de editor regride
- `npm run validate:matrix` quebra quando o registry declarativo e a matriz de fixtures saem de sincronia

## Como funciona internamente

- `realtime_dev_agent.js`: CLI do runtime principal
- `lib/analyzer.js`: analise e emissao de issues
- `lib/generation*.js`: geracao de snippets, blueprints, testes, dependencias e terminal tasks
- `lib/language-capabilities.js`: contrato declarativo de linguagem
- `vscode/`: runtime da extensao VS Code
- `vim/`, `plugin/`, `autoload/`: runtime do plugin Vim / Neovim
- `zed-extension/`: extensao do Zed com language server local

## Estrutura principal

- `realtime_dev_agent.js`: entrada CLI do agente
- `lib/`: analise, geracao e suporte
- `vscode/`: extensao VS Code
- `vim/`: implementacao principal do plugin Vim
- `plugin/` e `autoload/`: wrappers para instalacao direta no Vim
- `zed-extension/`: extensao do Zed
- `anget_test/`: fixtures de validacao
- `scripts/`: validadores, smokes e tooling de suporte
- `.github/workflows/vscode-package.yml`: empacotamento e release da extensao VS Code
