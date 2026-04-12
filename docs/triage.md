# Triage de issues do Pingu

Este documento define como operar melhoria continua do Pingu via GitHub Issues.

## Objetivo

- transformar bug e oportunidade de melhoria em backlog acionavel
- reduzir ambiguidade na reproducao
- priorizar por risco real ao codigo e ao editor
- fechar o loop entre issue, correcao, commit e validacao

## Campos obrigatorios por issue

Toda issue deve informar:

- comportamento atual
- comportamento esperado ou desejado
- editor, superficie ou area principal
- linguagem ou stack afetada
- como reproduzir ou caso de uso
- trecho minimo ou contexto
- impacto
- risco de regressao ou implementacao
- criterio de aceite

## Labels sugeridas

Use pelo menos uma label funcional e, quando fizer sentido, uma label de superficie ou risco.
O manifesto versionado destas labels fica em [../.github/labels.json](../.github/labels.json).
Para sincronizar tudo no GitHub de uma vez, rode manualmente o workflow `sync-issue-labels`.

### Funcionais

- `bug`: comportamento incorreto, regressao ou falha
- `improvement`: melhoria de UX, automacao, cobertura ou DX
- `autofix`: problema ou melhoria de aplicacao automatica
- `comments`: comentarios, docstrings, `function_doc`, `class_doc`, `variable_doc`, `flow_comment`
- `imports`: imports, `use`, `require`, includes, aliases
- `performance`: latencia, travamento, consumo excessivo no editor
- `ai`: comportamento ligado a geracao contextual por IA
- `packaging`: npm, instalacao, release

### Superficie

- `lazyvim`: fluxo do Vim, Neovim ou LazyVim

### Risco

- `breaking-risk`: mudanca com alto risco de quebrar runtime, imports ou sintaxe

### Prioridade

- `P0`: quebra codigo, imports, sintaxe, trava editor, corrompe arquivo ou bloqueia publish/install
- `P1`: exige interacao manual demais, comenta mal, autofix fraco, fluxo lento ou inconsistente
- `P2`: polish, refinamento de DX, observabilidade, documentacao e conveniencias

## Prioridade operacional

- use as labels `P0`, `P1` e `P2` para explicitar a prioridade da issue
- priorize `P0` quando houver risco de quebrar codigo, editor ou distribuicao

## Fluxo de triagem

1. confirmar se a issue veio com template completo
2. reproduzir o problema no editor ou stack correta
3. adicionar labels funcionais, de superficie e de risco
4. classificar prioridade entre `P0`, `P1` e `P2`
5. registrar criterio de aceite claro se ainda estiver vago
6. implementar a correcao ou melhoria
7. fechar a issue citando commit, branch ou release

## Regra pratica de tratamento

- issues sem reproducao minima nao entram em execucao
- issues sem label ficam em triagem ate classificacao
- bug que quebra imports ou sintaxe sobe direto para `P0`
- melhoria de automacao que reduz interacao manual tende a `P1`
- melhoria cosmetica sem impacto operacional tende a `P2`

## Fechamento da issue

Ao concluir uma issue, registre:

- o que mudava antes
- o que ficou depois
- o motivo tecnico da mudanca
- o commit ou release que entregou a correcao

## Monitoramento recomendado

Monitore estas visoes no GitHub:

- issues abertas sem label
- issues abertas por editor: `lazyvim`
- issues abertas por natureza: `bug`, `improvement`, `performance`, `imports`, `comments`
- issues com `breaking-risk`
- issues `P0` abertas
- tempo medio entre abertura e fechamento

## Consultas uteis

- bugs de LazyVim: `is:issue is:open label:bug label:lazyvim`
- regressao de import: `is:issue is:open label:imports`
- gargalo de performance: `is:issue is:open label:performance`
- backlog de melhoria: `is:issue is:open label:improvement`
