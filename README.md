# Realtime Dev Agent

<p align="center">
  <img src="./assets/pingu.png" alt="Pingu, a cara do Realtime Dev Agent" width="240" />
</p>

<p align="center">Pingu e a identidade visual do Realtime Dev Agent.</p>

Agente de pair programming em tempo real com foco em revisao automatica, comentarios de manutencao, geracao de codigo, dependencias e testes unitarios por linguagem.

## Requisitos

- Node.js no PATH
- Vim ou Neovim para o plugin Vim
- VS Code 1.85+ para a extensao

## Validacao

O repositorio agora possui validadores locais para reduzir regressao no runtime do agente e nas integracoes de editor.

Matriz do agente baseada nas fixtures de `anget_test/`:

```bash
npm run validate:matrix
```

Integracoes de editor:

```bash
npm run validate:editors
```

Para incluir tambem o empacotamento real da extensao do VS Code:

```bash
PINGU_VALIDATE_PACKAGE=1 npm run validate:editors
```

Tudo de uma vez:

```bash
npm run validate:all
```

Se voce quiser validar tambem a suite externa em `~/snippets/agent_tests`, rode:

```bash
PINGU_EXTERNAL_FIXTURES_DIR="$HOME/snippets/agent_tests" node scripts/validate_agent_matrix.js
```

## Credenciais e variaveis de ambiente

O agente possui dois modos de operacao:

- Modo local: usa apenas a logica embarcada no projeto e nao exige chave de API.
- Modo remoto: quando o agente passar a usar um provedor de LLM externo, a credencial precisara estar disponivel no environment antes de abrir o editor.

### Regra pratica

- Se o agente estiver rodando apenas com as heuristicas locais deste repositorio, nenhuma chave de API e obrigatoria.
- Se o agente estiver configurado para chamar um provedor externo, a chave deve estar exportada no ambiente do processo.

### Exemplos de variaveis comuns

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

### Exemplo no shell

```bash
export OPENAI_API_KEY="sua_chave_aqui"
```

### Importante

- Vim, Neovim e VS Code herdam as variaveis de ambiente no momento em que sao iniciados.
- Se voce adicionar ou alterar a chave depois que o editor ja estiver aberto, reinicie o editor para o agente receber o novo environment.
- Nunca commite credenciais no repositorio.

## Cobertura offline por linguagem

O runtime local usa perfis de linguagem versionados com snippets offline e boas praticas por stack. Isso permite gerar codigo util sem depender de API key.

- JavaScript, TypeScript e React: funcoes simples, funcoes aritmeticas, retornos literais, componentes e fluxos de dado, CRUD inicial, testes e acoes de terminal.
- Python: funcoes simples, funcoes aritmeticas, retornos literais, dado aleatorio, CRUD inicial, testes e acoes de terminal.
- Elixir: funcoes simples, funcoes aritmeticas, retornos literais, dado aleatorio, CRUD inicial, encapsulamento em modulo, testes e acoes de terminal.
- Go, Rust, C, Lua e Vimscript: funcoes utilitarias, funcoes aritmeticas, retornos literais, testes iniciais e acoes de terminal conforme o perfil da linguagem.
- Terraform, YAML, Dockerfile, Markdown e Mermaid: snippets estruturados, correcoes de contrato, testes de contrato e contexto persistente.

O contexto `**` agora registra no blueprint as boas praticas e a cobertura offline da linguagem ativa, para o agente seguir esse contrato ao continuar a implementacao.

## Instalacao via GitHub no Vim

O repositorio agora expõe `plugin/` e `autoload/` na raiz, entao pode ser instalado direto por URL do GitHub em gerenciadores comuns.

### lazy.nvim

```lua
{
  "andersonflima/pingo_ai_codding_pair_programming",
  config = function()
    vim.g.realtime_dev_agent_start_on_editor_enter = 1
    vim.g.realtime_dev_agent_open_window_on_start = 1
    vim.g.realtime_dev_agent_auto_fix_enabled = 1
    vim.g.realtime_dev_agent_review_on_open = 1
    vim.g.realtime_dev_agent_realtime_on_change = 1
  end,
}
```

### vim-plug

```vim
Plug 'andersonflima/pingo_ai_codding_pair_programming'
```

### Atalhos padrao no Vim

- `<leader>i`: dispara analise do arquivo atual
- `<leader>ia`: abre ou fecha a janela do agente

### Startup automatico no Vim

- O agente inicia automaticamente no primeiro buffer suportado da sessao.
- O painel abre sozinho no startup por padrao.
- Para manter o agente ligado sem abrir o painel: `let g:realtime_dev_agent_open_window_on_start = 0`
- Para desligar o startup automatico: `let g:realtime_dev_agent_start_on_editor_enter = 0`

### Atalhos do painel do agente no Vim

- `<Tab>`, `i` ou `a`: aplica a sugestao selecionada no codigo
- `<CR>`: navega ate o item no arquivo
- `f`: insere um follow-up acionavel para o agente
- `r`: reanalisa o arquivo atual
- `q`: fecha o painel

### Comentarios acionaveis

- Comentarios com `:` geram ou ajustam codigo no proprio arquivo.
- Comentarios com `**` criam contexto persistente para o agente e podem gerar estrutura inicial de projeto conforme o blueprint descrito.
- Comentarios com `*` executam acoes de terminal inferidas pelo contexto do projeto.
- O agente remove a linha do comentario acionavel depois da aplicacao bem-sucedida da acao.
- Instrucoes incompletas, como `funcao que` ou `function that`, sao ignoradas para evitar geracao imprecisa.
- Para desligar a execucao de terminal: `let g:realtime_dev_agent_terminal_actions_enabled = 0`
- No Neovim, o backend do terminal e escolhido automaticamente: terminal do VS Code em `vscode-neovim`, `ToggleTerm` quando `:TermExec` existir e split nativa como fallback.
- Para forcar o backend no Vim/Neovim: `let g:realtime_dev_agent_terminal_strategy = 'vscode'`, `let g:realtime_dev_agent_terminal_strategy = 'toggleterm'`, `let g:realtime_dev_agent_terminal_strategy = 'native'` ou `let g:realtime_dev_agent_terminal_strategy = 'background'`
- O modo `background` abre o terminal, inicia o comando e devolve o foco ao editor, mantendo o output visivel em tempo real durante a execucao.

### Exemplos de geracao com `:`

```lua
-- : complete user crud
```

```javascript
// : create login form component
```

```python
# : implementar funcao para calcular total do pedido
```

```lua
-- : funcao de soma
```

```javascript
// : funcao que recebe um numero e soma + 10 e retorna
```

```vim
" : adicionar comando para recarregar configuracao
```

### Exemplos de contexto com `**`

Criar contexto persistente para um projeto existente:

```lua
-- ** projeto existente usa onion architecture, controllers finos e casos de uso puros
```

Criar blueprint com scaffolding inicial:

```javascript
// ** bff para crud de usuario
```

Comportamento do `**`:

- cria arquivos em `.realtime-dev-agent/contexts/`
- atualiza o `.gitignore` para ignorar `.realtime-dev-agent/`
- remove a linha do comentario depois da aplicacao
- quando o blueprint for de `bff + crud`, pode criar estrutura inicial em Onion Architecture

### Exemplos de acoes de terminal com `*`

Rodar testes do projeto:

```lua
-- * rodar testes do projeto
```

```lua
-- * run my tests
```

```javascript
// * executar testes
```

```python
# * rodar test
```

Formatar o codigo ou o projeto:

```lua
-- * formatar arquivo atual
```

```javascript
// * rodar format
```

```elixir
# * mix format
```

Executar o arquivo atual:

```lua
-- * executar este arquivo
```

```javascript
// * rodar este arquivo
```

```python
# * executar arquivo atual
```

Rodar build ou lint:

```javascript
// * rodar build do projeto
```

```rust
// * rodar lint
```

```go
// * compilar projeto
```

Acoes de Git:

```lua
-- * git status
```

```javascript
// * git diff
```

```python
# * commit: feat: adiciona fluxo automatico do agente
```

### Regras de testes unitarios automaticos

- O agente so gera testes automaticamente quando o projeto ja possuir a pasta `tests/` ou `test/`.
- Se nem `tests/` nem `test/` existirem, o agente nao cria a pasta e nao gera testes unitarios.
- Quando um arquivo novo ainda nao tiver teste correspondente, o agente cria o teste base na pasta de testes ja existente.
- Quando o arquivo ja possuir teste base, o agente procura metodos ainda sem cobertura e cria testes complementares.
- `unit_test` agora faz parte do auto-fix padrao do plugin Vim/Neovim, entao o arquivo de teste passa a ser criado automaticamente quando a sugestao for detectada.
- O suporte atual cobre testes nativos para `React`, `Node.js`, `Elixir`, `Rust`, `Go`, `Python`, `C`, `Lua` e `.vim`.
- Para `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`, `Markdown` (`.md`) e `Mermaid` (`.mmd` e `.mermaid`), o agente gera testes de contrato em shell dentro de `tests/`.
- Em projetos `Go` sem `go.mod` e `Rust` sem `Cargo.toml`, o agente usa fallback de contrato em shell para nao bloquear a validacao automatica.

Exemplo de fluxo:

```lua
function retornar_valor()
  return "anderson"
end
```

Se `tests/` existir e `retornar_valor` ainda nao estiver coberta, o agente cria um arquivo como:

```lua
tests/teste_lua_spec.lua
```

Se depois surgir um metodo novo no mesmo arquivo, o agente cria um teste complementar para o metodo descoberto.

### Como o agente infere o comando

- Em projetos Node.js, o agente procura `package.json` e usa scripts como `test`, `dev`, `start`, `build`, `lint` e `format`.
- Em projetos Elixir, o agente usa comandos como `mix test`, `mix run`, `mix compile` e `mix format`.
- Em projetos Go, o agente usa `go test ./...`, `go run`, `go build ./...` e `gofmt -w`.
- Em projetos Rust, o agente usa `cargo test`, `cargo run`, `cargo build`, `cargo fmt` e `cargo clippy`.
- Em projetos Python, o agente usa `python -m pytest`, `python arquivo.py` e `python -m py_compile`.
- Para comentarios de Git, o agente pode executar `git status`, `git diff` e `git add -A && git commit -m ...`.

## Instalacao via GitHub no VS Code

A extensao VS Code fica empacotada como `VSIX` direto pelo GitHub Actions.

### Instalar a partir de um release do GitHub

1. Baixe o arquivo `realtime-dev-agent.vsix` em `Releases`.
2. Instale com:

```bash
code --install-extension realtime-dev-agent.vsix
```

### Empacotar localmente a partir do clone

```bash
npm run package:vscode
code --install-extension realtime-dev-agent.vsix
```

## Instalacao local no Zed

O suporte atual para Zed fica em [zed-extension/](./zed-extension) e entrega snippets com uma base de language server local para manter o agente ativo com diagnosticos em tempo real.

### Instalar como dev extension no Zed

1. Abra `zed: extensions`
2. Clique em `Install Dev Extension`
3. Selecione a pasta `zed-extension/` deste repositorio

Pre-requisito:

- `node` no PATH para o language server local
- toolchain Rust instalada para o Zed compilar a dev extension

### O que esta disponivel no Zed hoje

- snippets para comentarios `:`, `*` e `**`
- variantes escapadas como `\s:` e `\s*`
- suporte para JavaScript, TypeScript, React, Python, Elixir, Go, Rust, C, Lua, Dockerfile, YAML, Terraform, Markdown e Mermaid
- diagnostics em tempo real via language server local
- quick fixes para sugestoes baseadas em snippet no proprio arquivo
- `terminal_task` via code action com execucao local em background e logs em tempo real pelo language server

## Comandos da extensao VS Code

- `Realtime Dev Agent: Analyze Current File`
- `Realtime Dev Agent: Toggle Realtime Analysis`

## Configuracoes do VS Code

- `realtimeDevAgent.enabled`
- `realtimeDevAgent.nodePath`
- `realtimeDevAgent.scriptPath`
- `realtimeDevAgent.maxLineLength`
- `realtimeDevAgent.realtimeOnSave`
- `realtimeDevAgent.realtimeOnChange`
- `realtimeDevAgent.changeDebounceMs`
- `realtimeDevAgent.terminalActionsEnabled`
- `realtimeDevAgent.autoFixEnabled`
- `realtimeDevAgent.autoFixKinds`

### Terminal no VS Code

- Comentarios com `*` abrem o terminal integrado do VS Code quando a acao inferida for executavel.
- Exemplo: `-- * run my tests` cria um terminal visivel, executa o comando de teste inferido e remove a linha gatilho quando o processo termina com sucesso.
- A execucao no VS Code preserva o foco no editor e deixa o output visivel em tempo real no terminal integrado.

### Auto-fix no VS Code

- A extensao roda em tempo real quando `realtimeDevAgent.enabled` estiver ativo.
- Por padrao, abertura de arquivo, troca de foco, mudancas de buffer e `save` disparam nova analise.
- Comentarios acionaveis como `//:`, `#:`, `--:` e equivalentes agora sao autoaplicados pela extensao.
- Arquivos de contexto `**` e testes gerados em `test/` ou `tests/` tambem podem ser criados automaticamente no VS Code.

## Paridade por editor

- Vim/Neovim: analise continua, auto-fix, painel e acoes de terminal.
- VS Code: analise continua ao abrir, focar, editar e salvar arquivos, com auto-fix e terminal integrado.
- Zed: analise continua, quick fixes para `comment_task`, `context_file` e `unit_test`, e `terminal_task` executavel via code action com logs em tempo real.

## Contrato de paridade

- O contrato formal de paridade entre LazyVim, VS Code e Zed fica em `scripts/editor_parity_contract.js`.
- `npm run validate:editors` agora valida esse contrato e reprova qualquer regressao de capacidade obrigatoria entre os editores.

## Como funciona

- O runtime principal continua em `realtime_dev_agent.js`.
- O plugin Vim chama o runtime em modo `vim` e aplica correcoes diretamente no buffer, em arquivos de teste ou no terminal visivel do editor.
- A extensao VS Code chama o mesmo runtime em modo `json`, publica diagnosticos no editor e executa `terminal_task` no terminal integrado quando habilitado.

## Estrutura principal

- `realtime_dev_agent.js`: CLI do agente
- `lib/`: analise, geracao e suporte
- `vim/`: implementacao original do plugin Vim
- `plugin/` e `autoload/`: wrappers para instalacao direta por GitHub no Vim
- `vscode/`: extensao VS Code
- `.github/workflows/vscode-package.yml`: empacotamento e release da extensao
