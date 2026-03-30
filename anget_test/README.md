# Agent Validation Suite

Esta pasta serve para validar manualmente e por script as capacidades do Realtime Dev Agent.

Cobertura desta suite:

- comentarios acionaveis simples com `:`
- comentarios acionaveis avancados com `:`
- comentarios com marcador escapado `\s:`, `\s*` e `\s**`
- acoes de terminal com `*`
- criacao de contexto e blueprint com `**`
- geracao automatica de testes quando existir `tests/` ou `test/`
- arquivos estruturados como Dockerfile, compose, Markdown, Mermaid e Terraform
- cenarios de correcao sintatica automatica
- diagnosticos de manutencao, dependencias, documentacao, whitespace e tamanho de arquivo via casos sinteticos da matriz

Estrutura:

- `javascript/`, `typescript/`, `react/`, `python/`, `elixir/`, `go/`, `rust/`, `ruby/`, `c/`, `lua/`, `vim/`, `shell/`, `toml/`
- `docker/`, `compose/`, `markdown/`, `mermaid/`, `terraform/`
- `syntax/` para cenarios de autocorrecao

Como validar:

1. Abra um arquivo de prompt.
2. Aguarde a analise do agente.
3. Verifique se o comentario foi removido e se a acao esperada foi aplicada.
4. Para arquivos de contrato, confirme se o agente gera o teste dentro da pasta `tests/` ou `test/`.
5. Para `*`, confirme se o terminal abre e executa o comando inferido.
6. Para `**`, confirme se o agente cria `.realtime-dev-agent/contexts/` e atualiza `.gitignore`.

Fluxo recomendado no VS Code:

```bash
npm run open:vscode:validation
```

Esse comando abre a workspace de validacao e varios arquivos da suite em uma unica janela do VS Code.

Arquivos de referencia:

- `01_*.{js,ts,tsx,py,ex,go,rs,rb,c,lua,vim,sh}`: prompts simples
- `02_*.{js,ts,tsx,py,ex,go,rs,rb,c,lua,vim,sh}`: prompts avancados, contratos publicos ou acoes operacionais
- `03_*`: terminal, escape de marcador ou blueprint
