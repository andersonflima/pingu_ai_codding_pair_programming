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

if !exists('g:realtime_dev_agent_auto_fix_kinds')
  " Pair mode: revisar e corrigir boas praticas automaticamente sem pausa.
  let g:realtime_dev_agent_auto_fix_kinds = [
        \ 'moduledoc',
        \ 'function_spec',
        \ 'function_doc',
        \ 'missing_dependency',
        \ 'functional_reassignment',
        \ 'trailing_whitespace',
        \ 'tabs',
        \ 'undefined_variable',
        \ 'debug_output',
        \ 'comment_task',
        \ 'markdown_title',
        \ 'terraform_required_version',
        \ 'dockerfile_workdir'
        \ ]
endif

if !exists('g:realtime_dev_agent_auto_fix_max_per_check')
  " 0 ou negativo significa sem limite por ciclo.
  let g:realtime_dev_agent_auto_fix_max_per_check = 0
endif

if !exists('g:realtime_dev_agent_auto_fix_cursor_only')
  " 1: aplica apenas no cursor atual; 0: aplica no arquivo atual.
  let g:realtime_dev_agent_auto_fix_cursor_only = 0
endif

let s:internal_script = fnamemodify(resolve(expand('<sfile>:p')), ':h:h') . '/autoload/realtime_dev_agent/internal.vim'
if filereadable(s:internal_script)
  execute 'source ' . fnameescape(s:internal_script)
endif
unlet s:internal_script
