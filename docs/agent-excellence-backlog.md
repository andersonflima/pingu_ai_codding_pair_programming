# Barra de Excelencia do Agente

Este documento transforma a ideia de "agente excelente" em um contrato objetivo para o Pingu.
Ele serve para orientar implementacao, revisao, validacao e priorizacao do backlog.

## Objetivo

O Pingu deve agir como um par tecnico operacional dentro do editor:

- conservador para nao quebrar codigo
- agressivo para eliminar trabalho repetitivo de alto custo
- contextual para comentar, corrigir e scaffolding sem cair em texto generico
- leve para nao degradar o fluxo de edicao

## Definicao de Excelente

Um lote automatico do agente so e excelente quando entrega os 5 resultados abaixo ao mesmo tempo:

- mantem o codigo valido e preserva contrato, imports, `use`, aliases e indentacao
- opera no arquivo atual por padrao e respeita proximidade do cursor
- comenta e corrige com contexto real do codigo, preferencialmente com IA quando a heuristica nao basta
- reanalisa, valida e reverte sozinho se piorar o estado do arquivo
- quase nao tem custo perceptivel no loop de edicao

## P0

Itens bloqueadores. Sem isso o agente ainda atrapalha mais do que ajuda.

- `done`: preservar imports, `require`, `use`, aliases e bindings multiline em JavaScript, Python e Elixir
- `done`: limitar analise e auto-fix ao arquivo atual por padrao com `target_scope = current_file`
- `done`: bloquear renomeacao generica de import quando a origem nao foi validada
- `done`: manter rollback automatico quando um lote altera o codigo e piora o estado final
- `in_progress`: garantir comentario contextual para funcao, metodo, classe e variavel relevante nas linguagens principais
- `in_progress`: usar formato idiomatico de documentacao por linguagem em vez de comentario generico
- `pending`: validar preservacao de import/use/include em todas as linguagens ativas, nao so nas ja cobertas
- `pending`: fazer o editor reaplicar lote com ancora estavel quando multiplas issues concorrem na mesma regiao
- `pending`: reduzir falsos positivos em variaveis temporarias, campos triviais e comentarios redundantes

## P1

Itens de alto impacto para qualidade percebida e fluidez de pareamento.

- `pending`: hierarquia de prioridade por severidade real: sintaxe, import, contrato, comentario importante, teste, scaffold
- `pending`: comentario contextual por semantica de dominio, nao so por heuristica textual de nome
- `pending`: cobertura forte de assinatura multiline, decorators, dataclass, class fields, methods e overload-like declarations
- `pending`: politicas de no-op explicitas para quando o agente nao tiver prova suficiente para corrigir
- `pending`: smoke representativo por linguagem nos tres editores com casos de comentario, import preservado e rollback
- `pending`: reduzir custo em tempo real por tamanho de arquivo, distancia do cursor e tipo de issue
- `pending`: follow-up contextual melhor para continuar o pareamento sem sair do arquivo

## P2

Itens de maturidade. Nao bloqueiam utilidade basica, mas elevam consistencia e confianca.

- `pending`: ranking semantico de comentarios para priorizar responsabilidade de dominio sobre ruido local
- `pending`: memoria local de padroes arquiteturais do repo para ajustar snippet, docs e testes
- `pending`: guardas especificas por linguagem para lotes puramente documentais versus lotes estruturais
- `pending`: contratos de qualidade por stack com metas objetivas de falso positivo, rollback e latencia
- `pending`: relatorio consolidado de confianca por kind e por linguagem

## Criterios de Aceite

Toda melhoria relevante no agente deve obedecer a estes criterios:

- incluir regressao real em script de validacao ou smoke de editor
- preservar comportamento existente que o usuario ja aprovou
- nao ampliar escopo para `workspace` sem opt-in explicito
- nao introduzir rename especulativo de simbolo importado
- nao substituir comentario contextual por texto generico quando houver contexto suficiente
- explicar no changelog o antes, depois, motivo e comportamento alterado

## Qualidade Minima por Kind

### `function_doc`

- precisa usar formato idiomatico da linguagem
- precisa respeitar assinatura multiline e indentacao real do bloco
- nao pode quebrar sintaxe do arquivo

### `class_doc`

- precisa deixar clara a responsabilidade principal da classe
- nao pode entrar em conflito com docstring ja existente

### `variable_doc`

- deve focar alias, atributos, campos e variaveis relevantes
- nao deve comentar import, binding temporario banal ou ruido local

### `undefined_variable`

- so pode renomear quando houver evidencia suficiente
- em import/use/include precisa validar a origem antes de alterar

### `flow_comment`

- deve explicar a intencao do passo
- nao deve duplicar comentario equivalente que ja exista

## Gates de Validacao

Os gates minimos para sustentar esta barra sao:

- `node scripts/validate_python_real_code_checkup.js`
- `node scripts/validate_node_real_code_checkup.js`
- `node scripts/validate_elixir_real_code_checkup.js`
- `node scripts/nvim_functional_smoke.js`
- `node scripts/validate_vscode_autofix_guard.js`
- `node scripts/editor_parity_contract.js`

## Proxima Ordem de Execucao Recomendada

1. Fechar preservacao de imports/use/include nas linguagens ativas ainda sem regressao dedicada.
2. Melhorar comentario contextual com IA para reduzir texto mecanico em `function_doc`, `class_doc`, `variable_doc` e `flow_comment`.
3. Diminuir falso positivo de `variable_doc` e refinar priorizacao de lote no editor.
4. Levar os mesmos casos representativos para `VS Code` e `Zed`.
