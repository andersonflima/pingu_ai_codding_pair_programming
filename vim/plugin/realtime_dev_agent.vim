if exists('g:loaded_realtime_dev_agent')
  finish
endif
let g:loaded_realtime_dev_agent = 1

if !exists('g:realtime_dev_agent_script')
  " Mantem o caminho do script de agente automaticamente para os cenarios
  " de repo local ou plugin instalado no packpath.
  let s:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  let s:candidates = [
    \ fnamemodify(s:plugin_dir . '/../../realtime_dev_agent.js', ':p'),
    \ fnamemodify(s:plugin_dir . '/../realtime_dev_agent.js', ':p'),
    \ fnamemodify(s:plugin_dir . '/../../../realtime_dev_agent.js', ':p')
  \ ]
  let s:found = ''
  for s:candidate in s:candidates
    if filereadable(s:candidate)
      let s:found = s:candidate
      break
    endif
  endfor

  if s:found !=# ''
    let g:realtime_dev_agent_script = s:found
  else
    let g:realtime_dev_agent_script = 'realtime_dev_agent.js'
  endif

  unlet s:plugin_dir s:candidates s:found s:candidate
endif

let s:js_candidate = substitute(g:realtime_dev_agent_script, '\.exs$', '.js', '')
if g:realtime_dev_agent_script =~? '\.exs$' && filereadable(s:js_candidate)
  let g:realtime_dev_agent_script = s:js_candidate
elseif g:realtime_dev_agent_script =~? '\.js$'
  if !filereadable(expand(g:realtime_dev_agent_script))
    let g:realtime_dev_agent_script = 'realtime_dev_agent.js'
  endif
elseif !executable('node')
  let g:realtime_dev_agent_script = 'realtime_dev_agent.js'
endif
unlet s:js_candidate

function! s:issue_kind_registry_file() abort
  let l:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  let l:candidates = [
        \ fnamemodify(l:plugin_dir . '/../../config/issue-kinds.json', ':p'),
        \ fnamemodify(l:plugin_dir . '/../config/issue-kinds.json', ':p'),
        \ fnamemodify(l:plugin_dir . '/../../../config/issue-kinds.json', ':p')
        \ ]
  for l:candidate in l:candidates
    if filereadable(l:candidate)
      return l:candidate
    endif
  endfor
  return ''
endfunction

function! s:read_issue_kind_registry() abort
  let l:file = s:issue_kind_registry_file()
  if empty(l:file) || !exists('*json_decode')
    return {}
  endif

  try
    let l:payload = join(readfile(l:file), "\n")
    let l:decoded = json_decode(l:payload)
    return type(l:decoded) == v:t_dict ? l:decoded : {}
  catch
    return {}
  endtry
endfunction

function! s:default_auto_fix_kinds_from_registry(registry) abort
  if type(a:registry) != v:t_dict || empty(a:registry)
    return []
  endif

  let l:kinds = []
  for l:kind in sort(keys(a:registry))
    let l:entry = get(a:registry, l:kind, {})
    if type(l:entry) != v:t_dict || !get(l:entry, 'autoFixDefault', v:false)
      continue
    endif
    call add(l:kinds, [get(l:entry, 'autoFixPriority', 999), l:kind])
  endfor
  call sort(l:kinds, {left, right -> left[0] == right[0] ? (left[1] ># right[1] ? 1 : -1) : (left[0] > right[0] ? 1 : -1)})
  return map(l:kinds, 'v:val[1]')
endfunction

if !exists('g:realtime_dev_agent_issue_kind_registry')
  let g:realtime_dev_agent_issue_kind_registry = s:read_issue_kind_registry()
endif

if !exists('g:realtime_dev_agent_extensions')
  " Lista de extensoes em branco significa qualquer arquivo rastreavel.
  " Exemplo: ['.ex', '.exs', '.js', '.tsx']
  let g:realtime_dev_agent_extensions = []
endif

if !exists('g:realtime_dev_agent_strict_code_only')
  " Ativa filtro estrito para somente arquivos de codigo de extensoes conhecidas.
  " 0 (padrao): respeita a regra existente de g:realtime_dev_agent_extensions.
  " 1: analisa somente extensoes em g:realtime_dev_agent_code_extensions.
  let g:realtime_dev_agent_strict_code_only = 0
endif

if !exists('g:realtime_dev_agent_code_extensions')
  " Lista base para modo estrito de produtividade.
  let g:realtime_dev_agent_code_extensions = [
    \ '.c',
    \ '.clj',
    \ '.cpp',
    \ '.cs',
    \ '.ex',
    \ '.exs',
    \ '.go',
    \ '.gohtml',
    \ '.h',
    \ '.hpp',
    \ '.java',
    \ '.js',
    \ '.jsx',
    \ '.kt',
    \ '.lua',
    \ '.md',
    \ '.mjs',
    \ '.php',
    \ '.pl',
    \ '.py',
    \ '.rb',
    \ '.rs',
    \ '.scala',
    \ '.sh',
    \ '.swift',
    \ '.tf',
    \ '.ts',
    \ '.tsx',
    \ '.vim',
    \ '.yaml',
    \ '.yml',
    \ '.dockerfile',
    \ '.vue'
  \ ]
endif

if !exists('g:realtime_dev_agent_ignore_patterns')
  " Lista de trechos de caminho para ignorar no fluxo do agente.
  " Ex.: ['.git/', 'node_modules/', 'dist/', 'build/', '.next/', 'coverage/']
  let g:realtime_dev_agent_ignore_patterns = [
    \ '.git/',
    \ '.hg/',
    \ '.svn/',
    \ 'node_modules/',
    \ 'vendor/',
    \ 'dist/',
    \ 'build/',
    \ 'coverage/',
    \ '.next/',
    \ '.nuxt/',
    \ '.cache/',
    \ '.turbo/',
    \ 'tmp/',
    \ 'temp/',
    \ 'log/'
  \ ]
endif

if !exists('g:realtime_dev_agent_auto_on_save')
  " Controle de execucao automatica no BufWritePost.
  " O padrao 0 evita impacto imediato para quem ainda esta ajustando a rotina.
  let g:realtime_dev_agent_auto_on_save = 0
endif

if !exists('g:realtime_dev_agent_realtime_on_change')
  " Executa analise automaticamente durante digitacao (com debounce).
  " 1 ativa, 0 desativa.
  let g:realtime_dev_agent_realtime_on_change = 1
endif

if !exists('g:realtime_dev_agent_review_on_open')
  " Executa uma primeira revisao imediatamente ao abrir arquivos do projeto.
  let g:realtime_dev_agent_review_on_open = 1
endif

if !exists('g:realtime_dev_agent_start_on_editor_enter')
  " Inicia o agente automaticamente no primeiro buffer suportado da sessao.
  let g:realtime_dev_agent_start_on_editor_enter = 1
endif

if !exists('g:realtime_dev_agent_open_window_on_start')
  " Abre o painel junto do startup automatico do agente.
  let g:realtime_dev_agent_open_window_on_start = 1
endif

if !exists('g:realtime_dev_agent_realtime_delay')
  " Milisegundos de espera apos a ultima mudanca para disparar a checagem.
  let g:realtime_dev_agent_realtime_delay = 1200
endif

if !exists('g:realtime_dev_agent_realtime_open_qf')
  " Mantem quickfix fechado no fluxo em tempo real para evitar ruido.
  let g:realtime_dev_agent_realtime_open_qf = 0
endif

if !exists('g:realtime_dev_agent_open_qf')
  " No fluxo de janela (pairing), manter quickfix fechado.
  let g:realtime_dev_agent_open_qf = 0
endif

if !exists('g:realtime_dev_agent_map_key')
  " Atalho de analise rapida do arquivo atual: <leader>i.
  let g:realtime_dev_agent_map_key = '<leader>i'
endif

if !exists('g:realtime_dev_agent_window_key')
  " Mapeamento para abrir e fechar a janela de interacao em tempo real.
  let g:realtime_dev_agent_window_key = '<leader>ia'
endif

if !exists('g:realtime_dev_agent_show_window')
  " Mantem a janela visivel apenas quando o usuario pede modo painel.
  let g:realtime_dev_agent_show_window = 0
endif

if !exists('g:realtime_dev_agent_window_height')
  let g:realtime_dev_agent_window_height = 12
endif

if !exists('g:realtime_dev_agent_window_name')
  let g:realtime_dev_agent_window_name = '__Realtime Dev Agent__'
endif

if !exists('g:realtime_dev_agent_auto_fix_enabled')
  " 1 aplica snippets automaticamente; 0 exige aceitação com <Tab>.
  let g:realtime_dev_agent_auto_fix_enabled = 1
endif

if !exists('g:realtime_dev_agent_terminal_actions_enabled')
  " 1 permite executar acoes de terminal inferidas a partir de comentarios com *.
  let g:realtime_dev_agent_terminal_actions_enabled = 1
endif

if !exists('g:realtime_dev_agent_terminal_risk_mode')
  " safe: somente leitura; workspace_write: permite escrita local; all: libera tudo.
  let g:realtime_dev_agent_terminal_risk_mode = 'workspace_write'
endif

if !exists('g:realtime_dev_agent_terminal_height')
  " Altura da split usada para exibir a execucao de comandos do terminal.
  let g:realtime_dev_agent_terminal_height = 12
endif

if !exists('g:realtime_dev_agent_terminal_strategy')
  " auto: VS Code terminal em vscode-neovim, ToggleTerm quando houver TermExec, terminal nativa como fallback.
  " background: abre o terminal, inicia a execucao e devolve o foco ao codigo mantendo o output visivel em tempo real.
  let g:realtime_dev_agent_terminal_strategy = 'auto'
endif

if !exists('g:realtime_dev_agent_auto_fix_kinds')
  " Pair mode: revisar e corrigir boas praticas automaticamente sem pausa.
  let s:registry_auto_fix_kinds = s:default_auto_fix_kinds_from_registry(g:realtime_dev_agent_issue_kind_registry)
  if !empty(s:registry_auto_fix_kinds)
    let g:realtime_dev_agent_auto_fix_kinds = s:registry_auto_fix_kinds
  else
    let g:realtime_dev_agent_auto_fix_kinds = [
          \ 'syntax_missing_quote',
          \ 'syntax_extra_delimiter',
          \ 'syntax_missing_delimiter',
          \ 'syntax_missing_comma',
          \ 'undefined_variable',
          \ 'comment_task',
          \ 'moduledoc',
          \ 'function_spec',
          \ 'function_doc',
          \ 'class_doc',
          \ 'flow_comment',
          \ 'functional_reassignment',
          \ 'debug_output',
          \ 'missing_dependency',
          \ 'context_file',
          \ 'unit_test',
          \ 'terminal_task',
          \ 'trailing_whitespace',
          \ 'tabs',
          \ 'markdown_title',
          \ 'terraform_required_version',
          \ 'dockerfile_workdir'
          \ ]
  endif
  unlet! s:registry_auto_fix_kinds
endif

if !exists('g:realtime_dev_agent_auto_fix_max_per_check')
  " 0 ou negativo significa sem limite por ciclo.
  let g:realtime_dev_agent_auto_fix_max_per_check = 0
endif

if !exists('g:realtime_dev_agent_auto_fix_cursor_only')
  " Compatibilidade: 1 forca modo cursor_only; 0 respeita realtime_dev_agent_auto_fix_scope.
  let g:realtime_dev_agent_auto_fix_cursor_only = 0
endif

if !exists('g:realtime_dev_agent_auto_fix_scope')
  " near_cursor: aplica apenas o trecho mais proximo do cursor; file: aplica o arquivo inteiro; cursor_only: aplica somente no cursor.
  let g:realtime_dev_agent_auto_fix_scope = 'near_cursor'
endif

if !exists('g:realtime_dev_agent_auto_fix_near_cursor_radius')
  " Numero maximo de linhas entre o cursor e o bloco elegivel para auto-fix.
  let g:realtime_dev_agent_auto_fix_near_cursor_radius = 24
endif

if !exists('g:realtime_dev_agent_auto_fix_cluster_gap')
  " Distancia maxima entre issues consecutivos para pertencerem ao mesmo trecho.
  let g:realtime_dev_agent_auto_fix_cluster_gap = 8
endif

if !exists('g:realtime_dev_agent_auto_fix_visual_mode')
  " preserve: aplica o lote inteiro e redesenha uma vez ao final; step: mantem atualizacao incremental.
  let g:realtime_dev_agent_auto_fix_visual_mode = 'preserve'
endif

let s:internal_script = fnamemodify(resolve(expand('<sfile>:p')), ':h:h') . '/autoload/realtime_dev_agent/internal.vim'
if filereadable(s:internal_script)
  execute 'source ' . fnameescape(s:internal_script)
endif
unlet s:internal_script
