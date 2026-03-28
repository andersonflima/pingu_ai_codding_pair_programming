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

## Instalacao via GitHub no Vim

O repositorio agora expõe `plugin/` e `autoload/` na raiz, entao pode ser instalado direto por URL do GitHub em gerenciadores comuns.

### lazy.nvim

```lua
{
  "andersonflima/pingo_ai_codding_pair_programming",
  config = function()
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

## Como funciona

- O runtime principal continua em `realtime_dev_agent.js`.
- O plugin Vim chama o runtime em modo `vim` e aplica correcoes diretamente no buffer ou em arquivos de teste.
- A extensao VS Code chama o mesmo runtime em modo `json` e publica diagnosticos no editor.

## Estrutura principal

- `realtime_dev_agent.js`: CLI do agente
- `lib/`: analise, geracao e suporte
- `vim/`: implementacao original do plugin Vim
- `plugin/` e `autoload/`: wrappers para instalacao direta por GitHub no Vim
- `vscode/`: extensao VS Code
- `.github/workflows/vscode-package.yml`: empacotamento e release da extensao
