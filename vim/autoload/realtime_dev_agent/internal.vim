if exists('g:loaded_realtime_dev_agent_internal')
  finish
endif
let g:loaded_realtime_dev_agent_internal = 1

let s:realtime_dev_agent_realtime_timer = -1
let s:realtime_dev_agent_realtime_pending_buf = -1
let s:realtime_dev_agent_last_qf = []
let s:realtime_dev_agent_pending_issue = {}
let s:realtime_dev_agent_pending_auto_fixes = []
let s:realtime_dev_agent_auto_fix_busy = v:false
let s:realtime_dev_agent_is_realtime_check = v:false
let s:realtime_dev_agent_file_ticks = {}
let s:realtime_dev_agent_fix_guard = {}
let s:realtime_dev_agent_window_source_winid = -1
let s:realtime_dev_agent_started = v:false
let s:realtime_dev_agent_visual_batch_context = {}

function! s:issue_kind_entry(kind) abort
  let l:registry = get(g:, 'realtime_dev_agent_issue_kind_registry', {})
  if type(l:registry) != v:t_dict || empty(l:registry)
    return {}
  endif
  return get(l:registry, a:kind, {})
endfunction

function! s:realtime_dev_agent_script_runner() abort
  if !executable('node')
    return ''
  endif

  let l:script = expand(g:realtime_dev_agent_script)
  if empty(l:script)
    return ''
  endif

  if !filereadable(l:script)
    let l:script = fnamemodify(l:script, ':p')
  endif

  if l:script =~? '\.exs$'
    let l:script = substitute(l:script, '\.exs$', '.js', '')
  endif

  if l:script =~? '\.js$' && filereadable(l:script)
    let g:realtime_dev_agent_script = l:script
    return 'node'
  endif

  let l:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  let l:candidates = [
        \ fnamemodify(l:plugin_dir . '/../../realtime_dev_agent.js', ':p'),
        \ fnamemodify(l:plugin_dir . '/../realtime_dev_agent.js', ':p'),
        \ fnamemodify(l:plugin_dir . '/../../../realtime_dev_agent.js', ':p')
        \ ]
  for l:candidate in l:candidates
    if filereadable(l:candidate)
      let g:realtime_dev_agent_script = l:candidate
      return 'node'
    endif
  endfor

  let l:local_script = fnamemodify('realtime_dev_agent.js', ':p')
  if filereadable(l:local_script)
    let g:realtime_dev_agent_script = l:local_script
    return 'node'
  endif

  return ''
endfunction

function! s:realtime_dev_agent_script_label() abort
  return 'Node.js'
endfunction

function! s:realtime_dev_agent_guard_cli_path() abort
  let l:script = fnamemodify(expand(g:realtime_dev_agent_script), ':p')
  if empty(l:script) || !filereadable(l:script)
    return ''
  endif

  let l:guard_script = fnamemodify(l:script, ':h') . '/scripts/autofix_guard_cli.js'
  let l:guard_script = fnamemodify(l:guard_script, ':p')
  return filereadable(l:guard_script) ? l:guard_script : ''
endfunction

function! s:sh_binary() abort
  return executable('sh') ? exepath('sh') : 'sh'
endfunction

function! s:shell_escape_list(argv) abort
  return join(map(copy(a:argv), {_, val -> shellescape('' . val)}), ' ')
endfunction

function! s:project_command_argv(argv, cwd) abort
  let l:inner = s:shell_escape_list(a:argv)
  if !empty(a:cwd)
    let l:inner = 'cd ' . shellescape(a:cwd) . ' && ' . l:inner
  endif
  return [s:sh_binary(), '-lc', l:inner]
endfunction

function! s:run_systemlist(argv, cwd, ...) abort
  let l:command = s:project_command_argv(a:argv, a:cwd)
  try
    if a:0 > 0
      return systemlist(l:command, a:1)
    endif
    return systemlist(l:command)
  catch
    let l:fallback = s:shell_escape_list(l:command)
    if a:0 > 0
      return systemlist(l:fallback, a:1)
    endif
    return systemlist(l:fallback)
  endtry
endfunction

function! s:run_shell_systemlist(command, cwd, ...) abort
  let l:inner = !empty(a:cwd)
        \ ? 'cd ' . shellescape(a:cwd) . ' && ' . a:command
        \ : a:command
  let l:command_argv = [s:sh_binary(), '-lc', l:inner]
  try
    if a:0 > 0
      return systemlist(l:command_argv, a:1)
    endif
    return systemlist(l:command_argv)
  catch
    let l:fallback = s:shell_escape_list(l:command_argv)
    if a:0 > 0
      return systemlist(l:fallback, a:1)
    endif
    return systemlist(l:fallback)
  endtry
endfunction

function! s:project_root(file) abort
  " Usa a raiz do git como raiz do projeto para evitar comando no diretorio errado.
  let l:dir = fnamemodify(a:file, ':p:h')
  let l:git_dir = finddir('.git', l:dir . ';')
  if empty(l:git_dir)
    return l:dir
  endif
  return fnamemodify(l:git_dir . '/../', ':p:h')
endfunction

function! s:file_type_token(file) abort
  let l:basename = tolower(fnamemodify(a:file, ':t'))
  if l:basename ==# 'dockerfile' || l:basename =~# '^dockerfile\.'
    return '.dockerfile'
  endif

  let l:ext = fnamemodify(a:file, ':e')
  if empty(l:ext)
    return ''
  endif
  return '.' . l:ext
endfunction
function! s:should_check_file(file) abort
  " Regras basicas para decidir se o buffer atual entra no fluxo do agente.
  " Se extensao estiver em branco, aceita qualquer arquivo de texto rastreavel.
  if empty(a:file) || !filereadable(a:file)
    return v:false
  endif

  let l:file_normalized = fnamemodify(a:file, ':p')
  let l:file_normalized = substitute(l:file_normalized, '\\', '/', 'g')
  for l:ignored in g:realtime_dev_agent_ignore_patterns
    if empty(l:ignored)
      continue
    endif
    let l:pattern = substitute(l:ignored, '\\', '/', 'g')
    if stridx(l:file_normalized, l:pattern) != -1
      return v:false
    endif
  endfor

  let l:ext = s:file_type_token(a:file)
  if g:realtime_dev_agent_strict_code_only
    if index(g:realtime_dev_agent_code_extensions, l:ext) == -1
      return v:false
    endif
    if empty(g:realtime_dev_agent_extensions)
      return v:true
    endif
    return index(g:realtime_dev_agent_extensions, l:ext) >= 0
  endif

  if empty(g:realtime_dev_agent_extensions)
    return v:true
  endif

  return index(g:realtime_dev_agent_extensions, l:ext) >= 0
endfunction

function! s:buffer_line_count(bufnr) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return 0
  endif

  if exists('*getbufinfo')
    let l:info = getbufinfo(a:bufnr)
    if type(l:info) == v:t_list && !empty(l:info)
      return get(l:info[0], 'linecount', 0)
    endif
  endif

  return len(getbufline(a:bufnr, 1, '$'))
endfunction

function! s:auto_check_max_lines() abort
  let l:max_lines = get(g:, 'realtime_dev_agent_auto_check_max_lines', 600)
  if type(l:max_lines) != v:t_number
    let l:max_lines = str2nr(string(l:max_lines))
  endif
  return l:max_lines > 0 ? l:max_lines : 0
endfunction

function! s:should_run_auto_check(bufnr) abort
  let l:max_lines = s:auto_check_max_lines()
  if l:max_lines <= 0
    return v:true
  endif
  return s:buffer_line_count(a:bufnr) <= l:max_lines
endfunction

function! s:realtime_dev_agent_open_review() abort
  if s:realtime_dev_agent_start_current_buffer()
    return
  endif

  if !g:realtime_dev_agent_review_on_open
    return
  endif

  let l:bufnr = bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr) || s:realtime_dev_agent_auto_fix_busy
    return
  endif
  if &l:buftype !=# ''
    return
  endif

  let l:file = fnamemodify(bufname(l:bufnr), ':p')
  if empty(l:file) || !s:should_check_file(l:file)
    return
  endif
  if !s:should_run_auto_check(l:bufnr)
    return
  endif

  call s:remember_code_window(win_getid())
  call s:realtime_check_from_buffer(l:bufnr, g:realtime_dev_agent_realtime_open_qf, 0)
endfunction

function! s:realtime_dev_agent_start_current_buffer() abort
  if s:realtime_dev_agent_started
    return v:false
  endif

  if !get(g:, 'realtime_dev_agent_start_on_editor_enter', 0)
    return v:false
  endif

  let l:bufnr = bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr) || s:realtime_dev_agent_auto_fix_busy
    return v:false
  endif

  if &l:buftype !=# ''
    return v:false
  endif

  let l:file = fnamemodify(bufname(l:bufnr), ':p')
  if empty(l:file) || !s:should_check_file(l:file)
    return v:false
  endif
  if !s:should_run_auto_check(l:bufnr)
    return v:false
  endif

  let s:realtime_dev_agent_started = v:true
  call s:remember_code_window(win_getid())

  if get(g:, 'realtime_dev_agent_open_window_on_start', 1)
    let g:realtime_dev_agent_show_window = 1
    call s:window_open()
  endif

  call s:realtime_check_from_buffer(l:bufnr, g:realtime_dev_agent_open_qf, 0)
  return v:true
endfunction

function! s:window_buffer() abort
  return bufnr(g:realtime_dev_agent_window_name, 1)
endfunction

function! s:window_find() abort
  let l:buf = s:window_buffer()
  for l:w in range(1, winnr('$'))
    if winbufnr(l:w) == l:buf
      return l:w
    endif
  endfor
  return -1
endfunction

function! s:is_panel_window(winid) abort
  let l:winnr = win_id2win(a:winid)
  if l:winnr == 0
    return v:false
  endif
  return winbufnr(l:winnr) == s:window_buffer()
endfunction

function! s:is_code_window(winid) abort
  let l:winnr = win_id2win(a:winid)
  if l:winnr == 0 || s:is_panel_window(a:winid)
    return v:false
  endif

  let l:buf = winbufnr(l:winnr)
  if l:buf <= 0 || !bufexists(l:buf)
    return v:false
  endif

  return getbufvar(l:buf, '&buftype') ==# ''
endfunction

function! s:remember_code_window(winid) abort
  if s:is_code_window(a:winid)
    let s:realtime_dev_agent_window_source_winid = a:winid
  endif
endfunction

function! s:focus_code_window() abort
  let l:preferred = get(s:, 'realtime_dev_agent_window_source_winid', -1)
  if s:is_code_window(l:preferred)
    call win_gotoid(l:preferred)
    return v:true
  endif

  let l:current = win_getid()
  if s:is_code_window(l:current)
    call s:remember_code_window(l:current)
    return v:true
  endif

  for l:info in getwininfo()
    if s:is_code_window(l:info.winid)
      call win_gotoid(l:info.winid)
      call s:remember_code_window(l:info.winid)
      return v:true
    endif
  endfor

  execute 'aboveleft split'
  call s:remember_code_window(win_getid())
  return v:true
endfunction

function! s:focus_issue_target_file(file) abort
  if !s:focus_code_window()
    return v:false
  endif

  let l:target_buf = s:issue_target_buffer(a:file)
  if l:target_buf <= 0
    return v:false
  endif

  let l:target_winid = bufwinid(l:target_buf)
  if l:target_winid > 0 && !s:is_panel_window(l:target_winid)
    call win_gotoid(l:target_winid)
    call s:remember_code_window(l:target_winid)
    return v:true
  endif

  if bufnr('%') != l:target_buf
    execute 'silent! keepalt keepjumps buffer ' . l:target_buf
    if bufnr('%') != l:target_buf
      return v:false
    endif
  endif

  call s:remember_code_window(win_getid())
  return v:true
endfunction

function! s:auto_fix_visual_mode() abort
  let l:mode = tolower(trim(string(get(g:, 'realtime_dev_agent_auto_fix_visual_mode', 'preserve'))))
  if index(['preserve', 'step'], l:mode) == -1
    return 'preserve'
  endif
  return l:mode
endfunction

function! s:target_scope() abort
  let l:scope = tolower(trim(string(get(g:, 'realtime_dev_agent_target_scope', 'current_file'))))
  if index(['current_file', 'workspace'], l:scope) == -1
    return 'current_file'
  endif
  return l:scope
endfunction

function! s:issue_targets_active_scope(item, current_file) abort
  let l:current_file = fnamemodify(a:current_file, ':p')
  if empty(l:current_file)
    return v:false
  endif

  let l:issue_file = fnamemodify(get(a:item, 'filename', ''), ':p')
  if l:issue_file !=# l:current_file
    return v:false
  endif

  let l:action = s:issue_effective_action(a:item)
  if get(l:action, 'op', '') !=# 'write_file' || s:target_scope() ==# 'workspace'
    return v:true
  endif

  let l:target_file = trim(get(l:action, 'target_file', ''))
  if empty(l:target_file)
    return v:false
  endif

  return fnamemodify(l:target_file, ':p') ==# l:current_file
endfunction

function! s:auto_fix_scope() abort
  if str2nr(string(get(g:, 'realtime_dev_agent_auto_fix_cursor_only', 0))) > 0
    return 'cursor_only'
  endif

  let l:scope = tolower(trim(string(get(g:, 'realtime_dev_agent_auto_fix_scope', 'near_cursor'))))
  if index(['near_cursor', 'file', 'cursor_only'], l:scope) == -1
    return 'near_cursor'
  endif
  return l:scope
endfunction

function! s:auto_fix_near_cursor_radius() abort
  let l:radius = get(g:, 'realtime_dev_agent_auto_fix_near_cursor_radius', 24)
  if type(l:radius) != v:t_number
    let l:radius = str2nr(string(l:radius))
  endif
  if s:is_large_auto_fix_buffer()
    let l:radius = min([l:radius, s:auto_fix_large_file_radius()])
  endif
  return max([0, l:radius])
endfunction

function! s:auto_fix_large_file_line_threshold() abort
  let l:threshold = get(g:, 'realtime_dev_agent_auto_fix_large_file_line_threshold', 260)
  if type(l:threshold) != v:t_number
    let l:threshold = str2nr(string(l:threshold))
  endif
  return max([0, l:threshold])
endfunction

function! s:auto_fix_large_file_radius() abort
  let l:radius = get(g:, 'realtime_dev_agent_auto_fix_large_file_radius', 12)
  if type(l:radius) != v:t_number
    let l:radius = str2nr(string(l:radius))
  endif
  return max([0, l:radius])
endfunction

function! s:auto_fix_cluster_gap() abort
  let l:gap = get(g:, 'realtime_dev_agent_auto_fix_cluster_gap', 8)
  if type(l:gap) != v:t_number
    let l:gap = str2nr(string(l:gap))
  endif
  return max([1, l:gap])
endfunction

function! s:auto_fix_doc_max_per_check() abort
  let l:limit = get(g:, 'realtime_dev_agent_auto_fix_doc_max_per_check', 0)
  if type(l:limit) != v:t_number
    let l:limit = str2nr(string(l:limit))
  endif
  return max([0, l:limit])
endfunction

function! s:auto_fix_doc_max_per_check_large_file() abort
  let l:limit = get(g:, 'realtime_dev_agent_auto_fix_doc_max_per_check_large_file', 4)
  if type(l:limit) != v:t_number
    let l:limit = str2nr(string(l:limit))
  endif
  return max([0, l:limit])
endfunction

function! s:is_large_auto_fix_buffer() abort
  let l:threshold = s:auto_fix_large_file_line_threshold()
  if l:threshold <= 0
    return v:false
  endif
  return line('$') > l:threshold
endfunction

function! s:is_documentation_issue(item) abort
  let l:kind = get(a:item, 'kind', '')
  return index(['class_doc', 'flow_comment', 'function_comment', 'function_doc', 'moduledoc', 'variable_doc'], l:kind) != -1
endfunction

function! s:limit_documentation_candidates(items) abort
  let l:limit = s:auto_fix_doc_max_per_check()
  if s:is_large_auto_fix_buffer()
    let l:large_limit = s:auto_fix_doc_max_per_check_large_file()
    if l:limit <= 0 || (l:large_limit > 0 && l:large_limit < l:limit)
      let l:limit = l:large_limit
    endif
  endif

  if l:limit <= 0
    return a:items
  endif

  let l:selected = []
  let l:doc_count = 0
  for l:item in a:items
    if s:is_documentation_issue(l:item)
      if l:doc_count >= l:limit
        continue
      endif
      let l:doc_count += 1
    endif
    call add(l:selected, l:item)
  endfor
  return l:selected
endfunction

function! s:compare_issue_line_asc(entry_a, entry_b) abort
  let l:line_a = get(a:entry_a, 'lnum', 0)
  let l:line_b = get(a:entry_b, 'lnum', 0)
  if l:line_a == l:line_b
    return s:compare_fix_order(a:entry_a, a:entry_b)
  endif
  return l:line_a < l:line_b ? -1 : 1
endfunction

function! s:build_auto_fix_clusters(items) abort
  let l:ordered = copy(a:items)
  call sort(l:ordered, function('s:compare_issue_line_asc'))

  let l:clusters = []
  let l:cluster = []
  let l:last_line = -1
  let l:gap = s:auto_fix_cluster_gap()
  for l:item in l:ordered
    let l:item_line = max([1, get(l:item, 'lnum', 1)])
    if empty(l:cluster) || (l:item_line - l:last_line) <= l:gap
      call add(l:cluster, l:item)
    else
      call add(l:clusters, l:cluster)
      let l:cluster = [l:item]
    endif
    let l:last_line = l:item_line
  endfor

  if !empty(l:cluster)
    call add(l:clusters, l:cluster)
  endif
  return l:clusters
endfunction

function! s:cluster_distance_to_cursor(cluster, cursor_line) abort
  if empty(a:cluster)
    return 999999
  endif

  let l:start_line = get(a:cluster[0], 'lnum', a:cursor_line)
  let l:end_line = get(a:cluster[-1], 'lnum', a:cursor_line)
  if a:cursor_line < l:start_line
    return l:start_line - a:cursor_line
  endif
  if a:cursor_line > l:end_line
    return a:cursor_line - l:end_line
  endif
  return 0
endfunction

function! s:select_auto_fix_candidates_by_scope(items) abort
  let l:scope = s:auto_fix_scope()
  if l:scope ==# 'file'
    return a:items
  endif

  let l:cursor_line = line('.')
  if l:scope ==# 'cursor_only'
    return filter(copy(a:items), {_, item -> abs(get(item, 'lnum', 0) - l:cursor_line) <= 1})
  endif

  let l:radius = s:auto_fix_near_cursor_radius()
  let l:clusters = s:build_auto_fix_clusters(a:items)
  let l:best_cluster = []
  let l:best_distance = -1
  let l:best_span = -1

  for l:cluster in l:clusters
    let l:distance = s:cluster_distance_to_cursor(l:cluster, l:cursor_line)
    if l:distance > l:radius
      continue
    endif

    let l:start_line = get(l:cluster[0], 'lnum', l:cursor_line)
    let l:end_line = get(l:cluster[-1], 'lnum', l:cursor_line)
    let l:span = max([0, l:end_line - l:start_line])
    if empty(l:best_cluster)
          \ || l:distance < l:best_distance
          \ || (l:distance == l:best_distance && l:span < l:best_span)
      let l:best_cluster = l:cluster
      let l:best_distance = l:distance
      let l:best_span = l:span
    endif
  endfor

  return l:best_cluster
endfunction

function! s:is_auto_fix_visual_batch_active() abort
  return get(s:realtime_dev_agent_visual_batch_context, 'active', v:false)
endfunction

function! s:start_auto_fix_visual_batch(bufnr) abort
  let l:context = {'active': v:false}
  if s:auto_fix_visual_mode() !=# 'preserve'
    return l:context
  endif

  let l:current_winid = win_getid()
  let l:current_buf = winbufnr(l:current_winid)
  let l:view = {}
  if l:current_buf == a:bufnr
    let l:view = winsaveview()
  endif

  let l:context = {
        \ 'active': v:true,
        \ 'winid': l:current_winid,
        \ 'bufnr': l:current_buf,
        \ 'view': l:view,
        \ 'lazyredraw': &lazyredraw,
        \ }
  let &lazyredraw = 1
  let s:realtime_dev_agent_visual_batch_context = l:context
  return l:context
endfunction

function! s:end_auto_fix_visual_batch(context) abort
  let l:context = type(a:context) == v:t_dict ? a:context : {}
  let s:realtime_dev_agent_visual_batch_context = {}
  if !get(l:context, 'active', v:false)
    return
  endif

  let &lazyredraw = get(l:context, 'lazyredraw', 0)
  let l:target_winid = get(l:context, 'winid', -1)
  if l:target_winid > 0
    call win_gotoid(l:target_winid)
  endif

  let l:view = get(l:context, 'view', {})
  if type(l:view) == v:t_dict && !empty(l:view) && get(l:context, 'bufnr', -1) == bufnr('%')
    call winrestview(l:view)
  endif
  redraw
endfunction

function! s:window_open() abort
  call s:remember_code_window(win_getid())
  let l:win = s:window_find()
  if l:win != -1
    call s:window_set_buffer_keymaps()
    return l:win
  endif

  let l:curr = winnr()
  execute 'botright ' . g:realtime_dev_agent_window_height . 'split'
  let l:win = winnr()
  execute 'buffer ' . s:window_buffer()
  setlocal buftype=nofile
  setlocal bufhidden=hide
  setlocal noswapfile
  setlocal nobuflisted
  setlocal nonumber
  setlocal norelativenumber
  setlocal nomodified
  setlocal nowrap
  setlocal nospell
  setlocal filetype=plaintext
  setlocal nomodifiable
  setlocal modifiable
  call s:window_set_buffer_keymaps()
  execute l:curr . 'wincmd w'
  return l:win
endfunction

function! s:window_set_buffer_keymaps() abort
  let l:buf = s:window_buffer()
  if !bufexists(l:buf)
    return
  endif

  let l:current = bufnr('%')
  execute 'buffer ' . l:buf
  nnoremap <buffer> <silent> <CR> :call <SID>window_jumpto_issue()<CR>
  nnoremap <buffer> <silent> r :RealtimeDevAgentWindowCheck<CR>
  nnoremap <buffer> <silent> q :RealtimeDevAgentWindowClose<CR>
  nnoremap <buffer> <silent> a :call <SID>window_apply_suggestion()<CR>
  nnoremap <buffer> <silent> i :call <SID>window_apply_suggestion()<CR>
  nnoremap <buffer> <silent> f :call <SID>window_insert_followup()<CR>
  nnoremap <buffer> <silent> <Tab> :call <SID>window_apply_suggestion()<CR>
  execute 'buffer ' . l:current
endfunction

function! s:set_code_buffer_tab_accept() abort
  if &buftype !=# ''
    return
  endif

  if g:realtime_dev_agent_auto_fix_enabled
    inoremap <buffer> <silent> <expr> <Tab> "\<Tab>"
  else
    inoremap <buffer> <silent> <expr> <Tab> <SID>realtime_dev_agent_accept_snippet_or_tab()
  endif
endfunction

function! s:realtime_dev_agent_accept_snippet_or_tab() abort
  if mode() !=# 'i'
    return "\<Tab>"
  endif

  let l:issue = s:get_buffer_issue_at_cursor()
  if empty(l:issue)
    return "\<Tab>"
  endif
  if empty(get(l:issue, 'snippet', ''))
    return "\<Tab>"
  endif

  let s:realtime_dev_agent_pending_issue = copy(l:issue)
  return "\<C-o>:call <SID>realtime_dev_agent_apply_pending_snippet_now()\<CR>"
endfunction

function! s:realtime_dev_agent_apply_pending_snippet_now() abort
  let l:issue = get(s:, 'realtime_dev_agent_pending_issue', {})
  let s:realtime_dev_agent_pending_issue = {}

  if empty(l:issue)
    return
  endif

  if s:realtime_dev_agent_auto_fix_busy
    return
  endif

  call s:apply_issue_snippet(l:issue, v:false)
endfunction

function! s:realtime_dev_agent_can_apply_auto_fixes() abort
  if s:realtime_dev_agent_auto_fix_busy
    return v:false
  endif

  if !&l:modifiable || &l:readonly
    return v:false
  endif

  return v:true
endfunction

function! s:realtime_dev_agent_restore_show_window(previous) abort
  if a:previous && s:window_find() != -1
    let g:realtime_dev_agent_show_window = 1
  else
    let g:realtime_dev_agent_show_window = 0
  endif
endfunction

function! s:window_jumpto_issue() abort
  let l:line = getline('.')
  let l:match = matchlist(l:line, '^\s*\[\(\d\+\)\]')
  if empty(l:match)
    return
  endif

  let l:index = str2nr(l:match[1])
  if l:index < 1
    return
  endif

  let l:issue = get(s:realtime_dev_agent_last_qf, l:index - 1, {})
  if empty(l:issue)
    return
  endif

  if !s:focus_issue_target_file(l:issue.filename)
    return
  endif
  call cursor(l:issue.lnum, max([1, l:issue.col]))
  normal! zz
  redraw
endfunction

function! s:window_insert_followup() abort
  let l:line = getline('.')
  let l:match = matchlist(l:line, '^\s*\[\(\d\+\)\]')
  if empty(l:match)
    return
  endif

  let l:index = str2nr(l:match[1])
  let l:issue = get(s:realtime_dev_agent_last_qf, l:index - 1, {})
  if empty(l:issue)
    return
  endif

  let l:instruction = s:build_followup_instruction(l:issue)
  let l:snippet = s:build_followup_comment(l:issue.filename, l:instruction)
  if empty(l:snippet)
    return
  endif

  if !s:focus_issue_target_file(l:issue.filename)
    return
  endif
  call cursor(l:issue.lnum, 1)
  normal! o
  call append('.', l:snippet)
  write
  call cursor(l:issue.lnum + 1, 1)
  redraw
  if g:realtime_dev_agent_realtime_on_change
    call s:realtime_check_from_buffer(bufnr(l:issue.filename), g:realtime_dev_agent_realtime_open_qf, 0)
  else
    call s:realtime_dev_agent_window_check()
  endif
endfunction

function! s:window_apply_suggestion() abort
  let l:issue = s:get_current_panel_issue()
  if empty(l:issue)
    return
  endif

  call s:apply_issue_snippet(l:issue, v:true)
endfunction

function! s:get_current_panel_issue() abort
  let l:line = getline('.')
  let l:match = matchlist(l:line, '^\s*\[\(\d\+\)\]')
  if empty(l:match)
    return {}
  endif

  let l:index = str2nr(l:match[1])
  let l:issue = get(s:realtime_dev_agent_last_qf, l:index - 1, {})
  if empty(l:issue)
    return {}
  endif

  return l:issue
endfunction

function! s:get_buffer_issue_at_cursor() abort
  let l:file = fnamemodify(bufname('%'), ':p')
  let l:current_line = line('.')
  let l:exact_match = {}
  let l:closest = {}
  let l:closest_distance = 1000000

  for l:item in s:realtime_dev_agent_last_qf
    if get(l:item, 'filename', '') !=# l:file
      continue
    endif
    let l:line = get(l:item, 'lnum', 0)
    if l:line == l:current_line
      let l:exact_match = l:item
      break
    endif
  endfor

  if !empty(l:exact_match)
    return l:exact_match
  endif

  for l:item in s:realtime_dev_agent_last_qf
    if get(l:item, 'filename', '') !=# l:file
      continue
    endif
    let l:line = get(l:item, 'lnum', 0)
    let l:dist = abs(l:line - l:current_line)
    if l:dist <= 2 && l:dist < l:closest_distance
      let l:closest_distance = l:dist
      let l:closest = l:item
    endif
  endfor

  if l:closest_distance <= 2
    return l:closest
  endif

  return {}
endfunction

function! s:issue_default_action(kind) abort
  let l:entry = s:issue_kind_entry(a:kind)
  let l:action = get(l:entry, 'defaultAction', {})
  if type(l:action) == v:t_dict && !empty(l:action) && has_key(l:action, 'op') && !empty(get(l:action, 'op', ''))
    return copy(l:action)
  endif
  return {'op': 'insert_before'}
endfunction

function! s:issue_fix_priority(kind) abort
  let l:entry = s:issue_kind_entry(a:kind)
  return get(l:entry, 'autoFixPriority', 999)
endfunction

function! s:issue_confidence_score(item) abort
  let l:confidence = get(a:item, 'confidence', {})
  if type(l:confidence) == v:t_dict && has_key(l:confidence, 'score')
    return float2nr(get(l:confidence, 'score', 0.0) * 100)
  endif
  return 0
endfunction

function! s:issue_auto_fix_noop_reason(item) abort
  let l:kind = get(a:item, 'kind', '')
  let l:action = s:issue_effective_action(a:item)
  let l:score = s:issue_confidence_score(a:item)

  if l:kind ==# 'ai_required'
    return 'IA obrigatoria ainda indisponivel para este fluxo'
  endif
  if l:kind ==# 'large_file'
    return 'diagnostico consultivo sem auto-fix'
  endif
  if get(l:action, 'op', '') ==# 'run_command' && l:kind !=# 'terminal_task'
    return 'execucao de terminal exige confirmacao explicita'
  endif
  if l:kind ==# 'undefined_variable' && l:score > 0 && l:score < 80
    return 'evidencia insuficiente para renomear simbolo automaticamente'
  endif
  if index(['class_doc', 'flow_comment', 'function_comment', 'function_doc', 'moduledoc', 'variable_doc'], l:kind) != -1 && l:score > 0 && l:score < 55
    return 'contexto insuficiente para comentario automatico confiavel'
  endif
  if index(['context_contract', 'functional_reassignment', 'nested_condition'], l:kind) != -1 && l:score > 0 && l:score < 70
    return 'refactor semantico com confianca insuficiente para auto-fix'
  endif
  if index(['comment_task', 'context_file', 'unit_test'], l:kind) != -1 && l:score > 0 && l:score < 65
    return 'geracao estrutural com confianca insuficiente para aplicar automaticamente'
  endif
  return ''
endfunction

function! s:issue_effective_action(item) abort
  let l:kind = get(a:item, 'kind', '')
  let l:action = get(a:item, 'action', {})
  if type(l:action) == v:t_dict && !empty(l:action) && has_key(l:action, 'op') && !empty(l:action.op)
    return l:action
  endif
  return s:issue_default_action(l:kind)
endfunction

function! s:extract_extra_delimiter_char(text) abort
  let l:match = matchlist(a:text, "Delimitador '\\(.\\)' sem abertura correspondente")
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:issue_action_identity(item) abort
  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  if l:op ==# 'write_file'
    let l:target_file = trim(get(l:action, 'target_file', ''))
    if empty(l:target_file)
      return ''
    endif
    return fnamemodify(l:target_file, ':p')
  endif
  if l:op ==# 'run_command'
    return get(l:action, 'command', '')
  endif
  return get(a:item, 'text', '')
endfunction

function! s:apply_issue_write_file(issue, snippet_lines) abort
  let l:issue = copy(a:issue)
  let l:action = s:issue_effective_action(a:issue)
  let l:target_file = trim(get(l:action, 'target_file', ''))
  if empty(l:target_file)
    return v:false
  endif
  let l:target_file = fnamemodify(l:target_file, ':p')
  let l:issue._trigger_line = s:issue_trigger_line_text(a:issue)

  let l:target_dir = fnamemodify(l:target_file, ':h')
  if get(l:action, 'mkdir_p', v:false) && !isdirectory(l:target_dir)
    call mkdir(l:target_dir, 'p')
  endif

  call writefile(copy(a:snippet_lines), l:target_file, 'b')
  if get(l:action, 'remove_trigger', v:false)
    if !s:remove_issue_trigger_line(l:issue, v:false) && empty(get(l:issue, '_trigger_line', ''))
      call s:clear_issue_line(get(l:issue, 'filename', ''), get(l:issue, 'lnum', 1))
    endif
  endif
  return v:true
endfunction

function! s:issue_target_buffer(file) abort
  let l:target_file = fnamemodify(a:file, ':p')
  if empty(l:target_file)
    return -1
  endif

  let l:target_buf = bufnr(l:target_file)
  if l:target_buf <= 0
    let l:target_buf = bufadd(l:target_file)
  endif
  if l:target_buf <= 0
    return -1
  endif

  call bufload(l:target_buf)
  if !bufloaded(l:target_buf)
    return -1
  endif

  return l:target_buf
endfunction

function! s:collect_affected_files(file, items) abort
  let l:affected = {}
  let l:current_file = fnamemodify(a:file, ':p')
  if !empty(l:current_file)
    let l:affected[l:current_file] = 1
  endif

  if s:target_scope() !=# 'workspace'
    return keys(l:affected)
  endif

  for l:item in a:items
    let l:action = s:issue_effective_action(l:item)
    if get(l:action, 'op', '') !=# 'write_file'
      continue
    endif
    let l:target_file = trim(get(l:action, 'target_file', ''))
    if empty(l:target_file)
      continue
    endif
    let l:affected[fnamemodify(l:target_file, ':p')] = 1
  endfor

  return keys(l:affected)
endfunction

function! s:file_lines_for_guard(file) abort
  let l:target_file = fnamemodify(a:file, ':p')
  if empty(l:target_file)
    return []
  endif

  let l:target_buf = bufnr(l:target_file)
  if l:target_buf > 0 && bufloaded(l:target_buf)
    return getbufline(l:target_buf, 1, '$')
  endif

  if filereadable(l:target_file)
    return readfile(l:target_file, 'b')
  endif

  return []
endfunction

function! s:capture_file_snapshot(file_paths) abort
  let l:snapshot = {}
  for l:file in a:file_paths
    let l:target_file = fnamemodify(l:file, ':p')
    if empty(l:target_file) || has_key(l:snapshot, l:target_file)
      continue
    endif

    let l:target_buf = bufnr(l:target_file)
    let l:buf_loaded = l:target_buf > 0 && bufloaded(l:target_buf)
    let l:exists = filereadable(l:target_file)
    let l:lines = l:buf_loaded
          \ ? getbufline(l:target_buf, 1, '$')
          \ : (l:exists ? readfile(l:target_file, 'b') : [])
    let l:snapshot[l:target_file] = {
          \ 'bufnr': l:target_buf,
          \ 'exists': l:exists,
          \ 'lines': copy(l:lines),
          \ }
  endfor

  return l:snapshot
endfunction

function! s:restore_buffer_lines(bufnr, lines) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return
  endif
  if !getbufvar(a:bufnr, '&modifiable', 0)
    return
  endif

  let l:existing = len(getbufline(a:bufnr, 1, '$'))
  if l:existing > 0
    noautocmd call deletebufline(a:bufnr, 1, '$')
  endif

  let l:lines = empty(a:lines) ? [''] : copy(a:lines)
  noautocmd call setbufline(a:bufnr, 1, l:lines[0])
  if len(l:lines) > 1
    noautocmd call appendbufline(a:bufnr, 1, l:lines[1:])
  endif
  call setbufvar(a:bufnr, '&modified', 1)
endfunction

function! s:restore_file_snapshot(snapshot) abort
  for [l:file, l:state] in items(a:snapshot)
    let l:bufnr = get(l:state, 'bufnr', -1)
    if l:bufnr > 0
      call s:restore_buffer_lines(l:bufnr, get(l:state, 'lines', []))
    endif

    if get(l:state, 'exists', v:false)
      call mkdir(fnamemodify(l:file, ':h'), 'p')
      call writefile(copy(get(l:state, 'lines', [])), l:file, 'b')
    else
      silent! call delete(l:file)
    endif
  endfor
endfunction

function! s:build_guard_file_entries(file_paths) abort
  let l:entries = []
  for l:file in a:file_paths
    call add(l:entries, {
          \ 'path': fnamemodify(l:file, ':p'),
          \ 'contents': join(s:file_lines_for_guard(l:file), "\n"),
          \ })
  endfor
  return l:entries
endfunction

function! s:run_autofix_guard(payload, file) abort
  let l:runner = s:realtime_dev_agent_script_runner()
  let l:guard_script = s:realtime_dev_agent_guard_cli_path()
  if empty(l:runner) || empty(l:guard_script)
    return {'ok': v:false, 'error': 'guard cli nao encontrada'}
  endif

  let l:root = s:project_root(a:file)
  let l:output = s:run_systemlist([l:runner, l:guard_script], l:root, json_encode(a:payload))
  if v:shell_error != 0
    return {
          \ 'ok': v:false,
          \ 'error': join(l:output, "\n"),
          \ }
  endif

  try
    return json_decode(join(l:output, "\n"))
  catch
    return {
          \ 'ok': v:false,
          \ 'error': join(l:output, "\n"),
          \ }
  endtry
endfunction

function! s:format_guard_failure(result) abort
  let l:parts = []
  for l:failure in get(a:result, 'validationFailures', [])
    call add(
          \ l:parts,
          \ printf(
          \   '%s(%d->%d)',
          \   get(l:failure, 'kind', 'issue'),
          \   get(l:failure, 'beforeCount', 0),
          \   get(l:failure, 'afterCount', 0)
          \ ))
  endfor

  for l:failure in get(a:result, 'runtimeFailures', [])
    call add(
          \ l:parts,
          \ printf(
          \   '%s em %s',
          \   get(l:failure, 'command', 'validacao'),
          \   fnamemodify(get(l:failure, 'filePath', ''), ':t')
          \ ))
  endfor

  let l:error = trim(get(a:result, 'error', ''))
  if !empty(l:error)
    call add(l:parts, l:error)
  endif

  return join(l:parts, ' | ')
endfunction

function! s:issue_trigger_line_text(issue) abort
  let l:filename = get(a:issue, 'filename', '')
  let l:lnum = get(a:issue, 'lnum', 1)
  if l:lnum < 1
    return ''
  endif

  let l:target_buf = s:issue_target_buffer(l:filename)
  if l:target_buf <= 0
    return ''
  endif

  return get(getbufline(l:target_buf, l:lnum), 0, '')
endfunction

function! s:delete_issue_line(file, lnum, trigger_line) abort
  if a:lnum < 1
    return v:false
  endif

  let l:target_buf = s:issue_target_buffer(a:file)
  if l:target_buf <= 0
    return v:false
  endif

  if !getbufvar(l:target_buf, '&modifiable', 0)
    return v:false
  endif

  let l:last = len(getbufline(l:target_buf, 1, '$'))
  if l:last < 1
    return v:false
  endif

  if a:lnum <= l:last
    let l:line_at_lnum = get(getbufline(l:target_buf, a:lnum), 0, '')
    if empty(a:trigger_line) || l:line_at_lnum ==# a:trigger_line
      noautocmd call deletebufline(l:target_buf, a:lnum)
      call setbufvar(l:target_buf, '&modified', 1)
      return v:true
    endif
  endif

  if empty(a:trigger_line)
    return v:false
  endif

  let l:buffer_lines = getbufline(l:target_buf, 1, '$')
  let l:index = index(l:buffer_lines, a:trigger_line)
  if l:index < 0
    return v:false
  endif

  noautocmd call deletebufline(l:target_buf, l:index + 1)
  call setbufvar(l:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:remove_issue_trigger_line(issue, keep_focus_code) abort
  if a:keep_focus_code
    call s:focus_code_window()
  endif
  return s:delete_issue_line(
        \ get(a:issue, 'filename', ''),
        \ get(a:issue, 'lnum', 1),
        \ get(a:issue, '_trigger_line', '')
        \ )
endfunction

function! s:remove_issue_trigger_residue(issue, keep_focus_code) abort
  let l:removed = 0
  while s:remove_issue_trigger_line(a:issue, a:keep_focus_code)
    let l:removed += 1
  endwhile
  return l:removed > 0
endfunction

function! s:clear_issue_line(file, lnum) abort
  if a:lnum < 1
    return v:false
  endif

  let l:target_buf = s:issue_target_buffer(a:file)
  if l:target_buf <= 0
    return v:false
  endif

  if !getbufvar(l:target_buf, '&modifiable', 0)
    return v:false
  endif

  let l:last = len(getbufline(l:target_buf, 1, '$'))
  if l:last < 1
    return v:false
  endif

  let l:line_no = min([a:lnum, l:last])
  noautocmd call setbufline(l:target_buf, l:line_no, '')
  call setbufvar(l:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:issue_terminal_height() abort
  let l:height = get(g:, 'realtime_dev_agent_terminal_height', 12)
  if type(l:height) != v:t_number
    let l:height = str2nr(string(l:height))
  endif
  if l:height < 6
    let l:height = 6
  endif
  return l:height
endfunction

function! s:issue_terminal_strategy() abort
  let l:strategy = trim(get(g:, 'realtime_dev_agent_terminal_strategy', 'auto'))
  if empty(l:strategy)
    let l:strategy = 'auto'
  endif
  let l:strategy = tolower(l:strategy)

  if l:strategy !=# 'auto'
    return l:strategy
  endif

  if exists('g:vscode') && get(g:, 'vscode', 0) && exists('*VSCodeNotify')
    return 'vscode'
  endif

  if exists(':TermExec') == 2
    return 'toggleterm'
  endif

  return 'native'
endfunction

function! s:issue_terminal_risk_mode() abort
  let l:mode = trim(get(g:, 'realtime_dev_agent_terminal_risk_mode', 'workspace_write'))
  if empty(l:mode)
    return 'workspace_write'
  endif
  let l:mode = tolower(l:mode)
  if l:mode ==# 'destructive'
    return 'all'
  endif
  if index(['safe', 'workspace_write', 'all'], l:mode) == -1
    return 'workspace_write'
  endif
  return l:mode
endfunction

function! s:issue_terminal_risk_rank(level) abort
  let l:normalized = tolower(trim(a:level))
  if l:normalized ==# 'safe'
    return 0
  endif
  if l:normalized ==# 'workspace_write'
    return 1
  endif
  return 2
endfunction

function! s:issue_terminal_risk(action) abort
  let l:risk = get(a:action, 'risk', {})
  if type(l:risk) != v:t_dict
    return {
          \ 'level': 'workspace_write',
          \ 'summary': 'acao de terminal local sem classificacao explicita'
          \ }
  endif

  let l:level = tolower(trim(get(l:risk, 'level', 'workspace_write')))
  if index(['safe', 'workspace_write', 'destructive'], l:level) == -1
    let l:level = 'workspace_write'
  endif

  return {
        \ 'level': l:level,
        \ 'summary': trim(get(l:risk, 'summary', 'acao de terminal inferida pelo agente'))
        \ }
endfunction

function! s:issue_terminal_refocus_code(winid) abort
  if a:winid > 0 && win_gotoid(a:winid)
    call s:remember_code_window(a:winid)
    return v:true
  endif

  return s:focus_code_window()
endfunction

function! s:issue_terminal_status_file() abort
  return tempname()
endfunction

function! s:issue_terminal_inner_command(command, cwd, status_file) abort
  let l:parts = []
  if !empty(a:cwd)
    call add(l:parts, 'cd ' . shellescape(a:cwd) . ' &&')
  endif
  call add(l:parts, a:command . ';')
  if !empty(a:status_file)
    call add(l:parts, 'rda_status=$?;')
    call add(l:parts, 'printf "%s" "$rda_status" > ' . shellescape(a:status_file) . ';')
    call add(l:parts, 'exit $rda_status')
  endif
  return join(l:parts, ' ')
endfunction

function! s:issue_terminal_shell_command(command, cwd, status_file) abort
  let l:inner = s:issue_terminal_inner_command(a:command, a:cwd, a:status_file)
  if executable('sh')
    return shellescape(exepath('sh')) . ' -lc ' . shellescape(l:inner)
  endif

  let l:shell = !empty(&shell) ? &shell : 'sh'
  let l:flag = !empty(&shellcmdflag) ? &shellcmdflag : '-c'
  return shellescape(l:shell) . ' ' . l:flag . ' ' . shellescape(l:inner)
endfunction

function! s:issue_terminal_hidden_command(command, cwd) abort
  let l:inner = s:issue_terminal_inner_command(a:command, a:cwd, '')
  if executable('sh')
    return shellescape(exepath('sh')) . ' -lc ' . shellescape(l:inner)
  endif

  let l:shell = !empty(&shell) ? &shell : 'sh'
  let l:flag = !empty(&shellcmdflag) ? &shellcmdflag : '-c'
  return shellescape(l:shell) . ' ' . l:flag . ' ' . shellescape(l:inner)
endfunction

function! s:issue_terminal_context(issue, keep_focus_code) abort
  let l:context = copy(a:issue)
  let l:context.keep_focus_code = v:false
  let l:context._trigger_line = s:issue_trigger_line_text(a:issue)
  return l:context
endfunction

function! s:issue_terminal_reanalyze(context) abort
  let l:target_buf = s:issue_target_buffer(get(a:context, 'filename', ''))
  if l:target_buf <= 0
    return
  endif

  call s:realtime_check_from_buffer(l:target_buf, g:realtime_dev_agent_realtime_open_qf, 0)
endfunction

function! s:issue_terminal_finish(context, exit_code) abort
  if a:exit_code != 0
    echohl ErrorMsg
    echomsg printf('[RealtimeDevAgent] Acao de terminal falhou com codigo %d', a:exit_code)
    echohl None
    return
  endif

  if get(get(a:context, 'action', {}), 'remove_trigger', v:false)
    call s:remove_issue_trigger_line(a:context, get(a:context, 'keep_focus_code', v:false))
  endif
  call s:issue_terminal_reanalyze(a:context)
endfunction

function! s:nvim_terminal_action_exit(context, job_id, exit_code, event) abort
  call s:issue_terminal_finish(a:context, a:exit_code)
endfunction

function! s:vim_terminal_action_exit(context, job, status) abort
  call s:issue_terminal_finish(a:context, a:status)
endfunction

function! s:issue_terminal_status_poll(context, timer_id) abort
  let l:status_file = get(a:context, '_status_file', '')
  if empty(l:status_file) || !filereadable(l:status_file)
    return
  endif

  call timer_stop(a:timer_id)
  let l:lines = readfile(l:status_file)
  silent! call delete(l:status_file)
  let l:exit_code = str2nr(trim(join(l:lines, '')))
  call s:issue_terminal_finish(a:context, l:exit_code)
endfunction

function! s:issue_terminal_schedule_poll(context, status_file) abort
  let l:context = copy(a:context)
  let l:context._status_file = a:status_file
  call timer_start(250, function('s:issue_terminal_status_poll', [l:context]), {'repeat': 240})
endfunction

function! s:apply_issue_run_command_toggleterm(command, cwd, context, background) abort
  let l:status_file = s:issue_terminal_status_file()
  let l:wrapped_command = s:issue_terminal_shell_command(a:command, a:cwd, l:status_file)
  let l:payload = {
        \ 'cmd': l:wrapped_command,
        \ 'cwd': a:cwd,
        \ 'height': s:issue_terminal_height(),
        \ 'return_winid': win_getid(),
        \ 'background': a:background ? v:true : v:false
        \ }
  let l:ok = luaeval(
        \ '(function(payload)'
        \ . ' local ok, terminal_module = pcall(require, "toggleterm.terminal")'
        \ . ' if not ok or not terminal_module or not terminal_module.Terminal then return false end'
        \ . ' local term = terminal_module.Terminal:new({'
        \ . '   cmd = payload.cmd,'
        \ . '   dir = payload.cwd ~= "" and payload.cwd or nil,'
        \ . '   hidden = false,'
        \ . '   close_on_exit = false,'
        \ . '   direction = "horizontal",'
        \ . '   size = payload.height,'
        \ . '   on_open = function(_) '
        \ . '     if payload.background and payload.return_winid > 0 then'
        \ . '       vim.defer_fn(function() pcall(vim.fn.win_gotoid, payload.return_winid) end, 80)'
        \ . '     else'
        \ . '       vim.defer_fn(function() pcall(vim.cmd, "startinsert") end, 20)'
        \ . '     end'
        \ . '   end'
        \ . ' })'
        \ . ' term:toggle()'
        \ . ' return true'
        \ . ' end)(_A)',
        \ l:payload
        \ )
  if !l:ok
    echohl ErrorMsg
    echomsg '[RealtimeDevAgent] Falha ao controlar o ToggleTerm'
    echohl None
    return v:false
  endif
  if a:background
    call s:issue_terminal_refocus_code(get(l:payload, 'return_winid', 0))
    echomsg '[RealtimeDevAgent] Executando em background no ToggleTerm: ' . a:command
  else
    echomsg '[RealtimeDevAgent] Executando no ToggleTerm: ' . a:command
  endif
  call s:issue_terminal_schedule_poll(a:context, l:status_file)
  return v:true
endfunction

function! s:apply_issue_run_command_vscode(command, cwd, context, background) abort
  let l:status_file = s:issue_terminal_status_file()
  let l:wrapped_command = s:issue_terminal_shell_command(a:command, a:cwd, l:status_file)
  call VSCodeNotify('workbench.action.terminal.new')
  call VSCodeNotify('workbench.action.terminal.focus')
  call VSCodeNotify('workbench.action.terminal.sendSequence', {'text': l:wrapped_command . "\n"})
  if a:background
    call timer_start(80, {-> VSCodeNotify('workbench.action.focusActiveEditorGroup')})
    echomsg '[RealtimeDevAgent] Executando em background no terminal do VS Code: ' . a:command
  else
    echomsg '[RealtimeDevAgent] Executando no terminal do VS Code: ' . a:command
  endif
  call s:issue_terminal_schedule_poll(a:context, l:status_file)
  return v:true
endfunction

function! s:apply_issue_run_command_native(command, cwd, context, background) abort
  let l:height = s:issue_terminal_height()
  let l:return_winid = win_getid()

  call s:remember_code_window(l:return_winid)

  if has('nvim')
    execute 'botright ' . l:height . 'split'
    enew
    call termopen(a:command, {
          \ 'cwd': a:cwd,
          \ 'on_exit': function('s:nvim_terminal_action_exit', [a:context])
          \ })
    if a:background
      call s:issue_terminal_refocus_code(l:return_winid)
      echomsg '[RealtimeDevAgent] Executando em background no terminal: ' . a:command
    else
      startinsert
      echomsg '[RealtimeDevAgent] Executando no terminal: ' . a:command
    endif
    return v:true
  endif

  if exists('*term_start')
    execute 'botright ' . l:height . 'split'
    call term_start(a:command, {
          \ 'cwd': a:cwd,
          \ 'curwin': 1,
          \ 'exit_cb': function('s:vim_terminal_action_exit', [a:context])
          \ })
    if a:background
      call s:issue_terminal_refocus_code(l:return_winid)
      echomsg '[RealtimeDevAgent] Executando em background no terminal: ' . a:command
    else
      echomsg '[RealtimeDevAgent] Executando no terminal: ' . a:command
    endif
    return v:true
  endif

  return v:false
endfunction

function! s:apply_issue_run_command_hidden(issue, keep_focus_code) abort
  let l:action = s:issue_effective_action(a:issue)
  let l:command = get(l:action, 'command', '')
  let l:cwd = fnamemodify(get(l:action, 'cwd', ''), ':p')
  if empty(l:cwd)
    let l:cwd = s:project_root(get(a:issue, 'filename', ''))
  endif

  let l:output = s:run_shell_systemlist(l:command, l:cwd)
  if v:shell_error != 0
    echohl ErrorMsg
    echomsg '[RealtimeDevAgent] Falha ao executar acao de terminal'
    if !empty(l:output)
      echomsg '[RealtimeDevAgent] ' . trim(get(l:output, -1, ''))
    endif
    echohl None
    return v:false
  endif

  if get(l:action, 'remove_trigger', v:false)
    call s:remove_issue_trigger_line(a:issue, a:keep_focus_code)
  endif

  if !empty(l:output)
    let l:last_output = trim(get(l:output, -1, ''))
    if !empty(l:last_output)
      echomsg '[RealtimeDevAgent] ' . l:last_output
    endif
  endif

  call s:issue_terminal_reanalyze(a:issue)
  return v:true
endfunction

function! s:apply_issue_run_command(issue, keep_focus_code) abort
  if !get(g:, 'realtime_dev_agent_terminal_actions_enabled', 1)
    echomsg '[RealtimeDevAgent] Acoes de terminal estao desligadas'
    return v:false
  endif

  let l:action = s:issue_effective_action(a:issue)
  let l:command = get(l:action, 'command', '')
  if empty(l:command)
    echomsg '[RealtimeDevAgent] Comando de terminal ausente para esta sugestao'
    return v:false
  endif

  let l:risk_mode = s:issue_terminal_risk_mode()
  let l:risk = s:issue_terminal_risk(l:action)
  if s:issue_terminal_risk_rank(l:risk.level) > s:issue_terminal_risk_rank(l:risk_mode)
    echohl WarningMsg
    echomsg printf(
          \ '[RealtimeDevAgent] Comando bloqueado pelo modo de risco "%s": %s (%s - %s)',
          \ l:risk_mode,
          \ l:command,
          \ l:risk.level,
          \ l:risk.summary
          \ )
    echohl None
    return v:false
  endif

  let l:cwd = fnamemodify(get(l:action, 'cwd', ''), ':p')
  if empty(l:cwd)
    let l:cwd = s:project_root(get(a:issue, 'filename', ''))
  endif

  let l:context = s:issue_terminal_context(a:issue, a:keep_focus_code)
  let l:strategy = s:issue_terminal_strategy()
  let l:is_background = l:strategy ==# 'background'

  if l:is_background
    if exists('g:vscode') && get(g:, 'vscode', 0) && exists('*VSCodeNotify')
      return s:apply_issue_run_command_vscode(l:command, l:cwd, l:context, v:true)
    endif

    if exists(':TermExec') == 2
      return s:apply_issue_run_command_toggleterm(l:command, l:cwd, l:context, v:true)
    endif

    if s:apply_issue_run_command_native(l:command, l:cwd, l:context, v:true)
      return v:true
    endif
  endif

  if l:strategy ==# 'vscode'
    return s:apply_issue_run_command_vscode(l:command, l:cwd, l:context, v:false)
  endif

  if l:strategy ==# 'toggleterm'
    return s:apply_issue_run_command_toggleterm(l:command, l:cwd, l:context, v:false)
  endif

  if l:strategy ==# 'native'
    if s:apply_issue_run_command_native(l:command, l:cwd, l:context, v:false)
      return v:true
    endif
  endif

  return s:apply_issue_run_command_hidden(l:context, a:keep_focus_code)
endfunction

function! s:issue_action_range(action) abort
  let l:range = get(a:action, 'range', {})
  if type(l:range) != v:t_dict
    return {}
  endif
  if type(get(l:range, 'start', {})) != v:t_dict || type(get(l:range, 'end', {})) != v:t_dict
    return {}
  endif
  return l:range
endfunction

function! s:apply_issue_range_replacement(target_buf, action, lnum, current_line, fallback_text) abort
  let l:range = s:issue_action_range(a:action)
  if empty(l:range)
    return v:false
  endif

  let l:start_line = get(get(l:range, 'start', {}), 'line', -1)
  let l:end_line = get(get(l:range, 'end', {}), 'line', -1)
  if l:start_line !=# l:end_line || l:start_line !=# (a:lnum - 1)
    return v:false
  endif

  let l:start_col = max([0, get(get(l:range, 'start', {}), 'character', 0)])
  let l:end_col = max([l:start_col, get(get(l:range, 'end', {}), 'character', l:start_col)])
  let l:replacement = has_key(a:action, 'text') ? get(a:action, 'text', '') : a:fallback_text
  let l:new_line = strpart(a:current_line, 0, l:start_col)
        \ . l:replacement
        \ . strpart(a:current_line, l:end_col)
  if l:new_line ==# a:current_line
    return v:false
  endif

  noautocmd call setbufline(a:target_buf, a:lnum, l:new_line)
  call setbufvar(a:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:apply_issue_snippet(issue, keep_focus_code) abort
  let l:issue = a:issue
  let l:filename = get(l:issue, 'filename', '')
  let l:lnum = get(l:issue, 'lnum', 1)
  let l:kind = get(l:issue, 'kind', '')
  let l:action = s:issue_effective_action(l:issue)
  let l:snippet_raw = get(l:issue, 'snippet', '')
  let l:op = get(l:action, 'op', '')
  let l:restore_view = {}
  if !s:issue_targets_active_scope(l:issue, l:filename)
    echomsg '[RealtimeDevAgent] Acao descartada: fora do arquivo atual'
    return v:false
  endif
  if l:op ==# 'run_command'
    return s:apply_issue_run_command(l:issue, a:keep_focus_code)
  endif
  if empty(l:snippet_raw)
    if l:kind ==# 'trailing_whitespace' || l:kind ==# 'syntax_extra_delimiter'
      let l:snippet_lines = ['']
    else
      echohl WarningMsg
      echomsg '[RealtimeDevAgent] Sem snippet para esta sugestao'
      echohl None
      return v:false
    endif
  else
    let l:snippet_lines = split(l:snippet_raw, "\n", 1)
  endif
  if empty(l:snippet_lines)
    return v:false
  endif

  if l:op ==# 'write_file'
    return s:apply_issue_write_file(l:issue, l:snippet_lines)
  endif

  if a:keep_focus_code
    if !s:focus_issue_target_file(l:filename)
      return v:false
    endif
  endif

  let l:target_buf = bufnr('%')
  let l:current_file = fnamemodify(bufname('%'), ':p')
  let l:target_file = fnamemodify(l:filename, ':p')
  if !empty(l:target_file) && l:target_file !=# l:current_file
    if a:keep_focus_code
      let l:target_buf = bufnr('%')
      if !bufexists(l:target_buf) || l:target_buf < 1
        return v:false
      endif
    else
      echomsg '[RealtimeDevAgent] Snippet descartado: issue nao pertence ao buffer atual'
      return v:false
    endif
  endif

  if !bufexists(l:target_buf) || l:target_buf < 1
    return v:false
  endif

  if !getbufvar(l:target_buf, '&modifiable', 0)
    return v:false
  endif

  if !a:keep_focus_code && !s:is_auto_fix_visual_batch_active()
    let l:restore_view = winsaveview()
  endif

  if l:lnum < 1
    let l:lnum = 1
  endif

  let l:last = len(getbufline(l:target_buf, 1, '$'))
  if l:last < 1
    let l:last = 1
  endif
  if l:lnum > l:last
    let l:lnum = l:last
  endif

  let l:line_content = getbufline(l:target_buf, l:lnum)
  if empty(l:line_content)
    let l:line_content = ['']
  endif
  let l:line_content = l:line_content[0]
  if !s:realtime_issue_still_relevant(l:issue, l:target_buf, l:lnum, l:line_content)
    return v:false
  endif

  let l:indent = get(l:action, 'indent', matchstr(l:line_content, '^\s*'))
  let l:snippet_lines = s:normalize_snippet_lines(l:snippet_lines, l:indent)
  let l:snippet_text = join(l:snippet_lines, "\n")
  if empty(l:op)
    let l:op = get(s:issue_default_action(l:kind), 'op', 'insert_before')
  endif

  if l:op ==# 'replace_line'
    if s:apply_issue_range_replacement(l:target_buf, l:action, l:lnum, l:line_content, l:snippet_text)
      if l:kind ==# 'comment_task' && !empty(get(l:issue, '_trigger_line', ''))
        call s:remove_issue_trigger_residue(l:issue, a:keep_focus_code)
      endif
      if !a:keep_focus_code && !empty(l:restore_view)
        call winrestview(l:restore_view)
      endif
      return v:true
    endif
    let l:normalized_current = substitute(l:line_content, '^\s*', '', '')
    let l:normalized_first = substitute(l:snippet_lines[0], '^\s*', '', '')
    if len(l:snippet_lines) == 1 && (empty(l:snippet_lines[0]) || l:normalized_current ==# l:normalized_first)
      return v:false
    endif
    noautocmd call setbufline(l:target_buf, l:lnum, l:snippet_lines[0])
    if len(l:snippet_lines) > 1
      noautocmd call appendbufline(l:target_buf, l:lnum, l:snippet_lines[1:])
    endif
    if l:kind ==# 'comment_task' && !empty(get(l:issue, '_trigger_line', ''))
      call s:remove_issue_trigger_residue(l:issue, a:keep_focus_code)
    endif
  elseif l:op ==# 'insert_after'
    noautocmd call appendbufline(l:target_buf, l:lnum, l:snippet_lines)
  else
    noautocmd call appendbufline(l:target_buf, l:lnum - 1, l:snippet_lines)
  endif

  if !a:keep_focus_code
    if !empty(l:restore_view)
      call winrestview(l:restore_view)
    endif
  endif
  return v:true
endfunction

function! s:normalize_snippet_lines(snippet_lines, indent) abort
  if type(a:snippet_lines) != v:t_list
    return [a:snippet_lines]
  endif

  if empty(a:snippet_lines)
    return ['']
  endif

  let l:min_indent = -1
  for l:snippet_line in a:snippet_lines
    if l:snippet_line =~# '^\s*$'
      continue
    endif
    let l:line_indent = len(matchstr(l:snippet_line, '^\s*'))
    if l:min_indent == -1 || l:line_indent < l:min_indent
      let l:min_indent = l:line_indent
    endif
  endfor

  if l:min_indent == -1
    return map(copy(a:snippet_lines), {_, val -> a:indent . val})
  endif

  return map(copy(a:snippet_lines), {_, val ->
        \ substitute(
        \   val,
        \   '^\s\{'.l:min_indent.'\}',
        \   a:indent,
        \   ''
        \ )})
endfunction

function! s:realtime_issue_still_relevant(item, target_buf, lnum, line_content) abort
  let l:kind = get(a:item, 'kind', '')
  let l:text = get(a:item, 'text', '')
  let l:action = s:issue_effective_action(a:item)
  let l:target_buf = a:target_buf
  let l:line_no = a:lnum
  let l:content = a:line_content
  let l:op = get(l:action, 'op', '')

  if l:op ==# 'write_file'
    let l:target_file = trim(get(l:action, 'target_file', ''))
    if empty(l:target_file)
      return v:false
    endif
    let l:target_file = fnamemodify(l:target_file, ':p')

    let l:snippet = get(a:item, 'snippet', '')
    if empty(l:snippet)
      return v:false
    endif

    if !filereadable(l:target_file)
      return v:true
    endif

    let l:expected_lines = split(l:snippet, "\n", 1)
    let l:current_lines = readfile(l:target_file, 'b')
    return join(l:current_lines, "\n") !=# join(l:expected_lines, "\n")
  endif

  if l:op ==# 'run_command'
    return l:content =~# '^\s*\(#\|//\|--\|"\)\s*\%(\\s\)\?\s*\*\s*.\+$' || l:content =~# '^\s*<!--\s*\%(\\s\)\?\s*\*\s*.\+\s*-->\s*$'
  endif

  if l:line_no < 1
    return v:false
  endif

  if get(a:item, 'snippet', '') ==# ''
    if l:op ==# 'replace_line'
      if l:kind ==# 'syntax_extra_delimiter'
        let l:delimiter = s:extract_extra_delimiter_char(l:text)
        return !empty(l:delimiter) && stridx(l:content, l:delimiter) >= 0
      endif
      return l:content =~# '\s$'
    endif
    return v:false
  endif

  if l:kind ==# 'undefined_variable' && s:is_import_like_line(l:content) && !s:is_validated_import_binding_issue(a:item)
    return v:false
  endif

  if l:op ==# 'replace_line'
    let l:snippet_lines = split(get(a:item, 'snippet', ''), "\n")
    let l:expected = ''
    for l:snippet_line in l:snippet_lines
      let l:trimmed = substitute(l:snippet_line, '^\s*', '', '')
      if !empty(l:trimmed)
        let l:expected = l:trimmed
        break
      endif
    endfor
    if empty(l:expected)
      return v:true
    endif
    return substitute(l:content, '^\s*', '', '') !=# l:expected
  endif

  if l:kind ==# 'undefined_variable'
    return l:content =~# '\b' . escape(l:text, '\\') . '\b'
  endif

  if l:op ==# 'insert_after' || l:op ==# 'insert_before'
    let l:snippet = get(a:item, 'snippet', '')
    if empty(l:snippet)
      return v:true
    endif
    let l:snippet_lines = split(l:snippet, "\n")
    let l:expected = ''
    for l:snippet_line in l:snippet_lines
      let l:trimmed = substitute(l:snippet_line, '^\s*', '', '')
      if !empty(l:trimmed)
        let l:expected = l:trimmed
        break
      endif
    endfor
    if empty(l:expected)
      return v:true
    endif

    let l:lookahead = get(l:action, 'lookahead', get(l:action, 'dedupeLookahead', len(l:snippet_lines) + 4))
    let l:start = l:line_no
    let l:end = l:line_no + l:lookahead
    if l:op ==# 'insert_before'
      let l:lookbehind = get(l:action, 'lookbehind', get(l:action, 'dedupeLookbehind', len(l:snippet_lines) + 4))
      let l:start = max([1, l:line_no - l:lookbehind])
      let l:end = l:line_no
    endif
    let l:scope = getbufline(l:target_buf, l:start, l:end)
    for l:scope_line in l:scope
      if substitute(l:scope_line, '^\s*', '', '') ==# l:expected
        return v:false
      endif
    endfor
    return v:true
  endif

  return v:true
endfunction

function! s:is_import_like_line(line) abort
  let l:content = trim(a:line)
  if empty(l:content)
    return v:false
  endif

  return l:content =~# '^\s*import\>'
        \ || l:content =~# '^\s*export\s\+\%({\|\*\s\+from\>\)'
        \ || l:content =~# '^\s*from\>.\+\s\+import\>'
        \ || l:content =~# '^\s*\%(const\|let\|var\)\>.\+=\s*require\s*('
        \ || l:content =~# '^\s*\%(alias\|use\|require\)\>'
        \ || l:content =~# '^\s*require_relative\>'
        \ || l:content =~# '^\s*#include\>'
endfunction

function! s:is_validated_import_binding_issue(item) abort
  if get(a:item, 'kind', '') !=# 'undefined_variable'
    return v:false
  endif

  let l:parts = s:issue_parse_parts(get(a:item, 'text', ''))
  let l:message = get(l:parts, 1, '')
  let l:message = substitute(l:message, '^undefined_variable:\s*', '', '')
  return l:message =~# "^Import '\\([^']\\+\\)' nao exportado por "
endfunction

function! s:extract_undefined_variable_name(text) abort
  let l:match = matchlist(a:text, "Variavel '\\([^']\\+\\)'")
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:extract_undefined_variable_suggestion(text) abort
  let l:match = matchlist(a:text, "Substitua por '\\([^']\\+\\)'")
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:followup_comment_prefix(file) abort
  let l:ext = s:file_type_token(a:file)
  if l:ext ==# '.md'
    return '<!-- : '
  endif
  if index([
        \ '.c',
        \ '.cpp',
        \ '.cs',
        \ '.go',
        \ '.h',
        \ '.hpp',
        \ '.java',
        \ '.js',
        \ '.jsx',
        \ '.kt',
        \ '.kts',
        \ '.rs',
        \ '.scala',
        \ '.swift',
        \ '.ts',
        \ '.tsx'
        \ ], l:ext) >= 0
    return '// : '
  endif
  if l:ext ==# '.lua'
    return '-- : '
  endif
  if l:ext ==# '.vim'
    return '" : '
  endif
  return '# : '
endfunction

function! s:build_followup_instruction(issue) abort
  let l:parts = s:issue_parse_parts(get(a:issue, 'text', ''))
  let l:message = get(l:parts, 1, '')
  let l:suggestion = get(l:parts, 2, '')
  let l:kind = get(a:issue, 'kind', '')

  if l:kind ==# 'undefined_variable'
    let l:unknown = s:extract_undefined_variable_name(l:message)
    let l:replacement = s:extract_undefined_variable_suggestion(l:suggestion)
    if !empty(l:unknown) && !empty(l:replacement)
      return printf(
            \ 'substitua %s por %s retornando apenas o trecho corrigido sem comentarios explicativos',
            \ l:unknown,
            \ l:replacement
            \ )
    endif
  endif

  if l:kind ==# 'class_doc'
    return 'adicione documentacao curta para a classe mantendo o contrato atual'
  endif

  if !empty(l:suggestion)
    return l:suggestion
  endif

  return l:message
endfunction

function! s:build_followup_comment(file, instruction) abort
  let l:instruction = trim(a:instruction)
  if empty(l:instruction)
    return ''
  endif

  let l:prefix = s:followup_comment_prefix(a:file)
  if l:prefix ==# '<!-- : '
    return l:prefix . l:instruction . ' -->'
  endif
  return l:prefix . l:instruction
endfunction

function! s:window_close() abort
  let l:win = s:window_find()
  if l:win == -1
    return
  endif

  let l:curr = winnr()
  if l:win != l:curr
    execute l:win . 'wincmd w'
    if winnr('$') > 1
      close
    endif
    execute l:curr . 'wincmd w'
  else
    if winnr('$') > 1
      close
    endif
  endif
endfunction

function! s:window_toggle() abort
  if s:window_find() == -1
    let g:realtime_dev_agent_show_window = 1
    call s:window_open()
  else
    let g:realtime_dev_agent_show_window = 0
    call s:window_close()
  endif
endfunction

function! s:window_set_lines(lines) abort
  let l:buf = s:window_buffer()
  if !bufexists(l:buf)
    return
  endif
  if type(a:lines) != v:t_list
    return
  endif

  call setbufvar(l:buf, '&modifiable', 1)
  call deletebufline(l:buf, 1, '$')
  if empty(a:lines)
    call appendbufline(l:buf, 0, '[Realtime Dev Agent] Nenhuma informacao para exibir')
  else
    call appendbufline(l:buf, 0, a:lines)
  endif
  call setbufvar(l:buf, '&modifiable', 0)
endfunction

function! s:window_set_busy(file) abort
  " Feedback imediato enquanto o agente roda no modo interativo.
  if !g:realtime_dev_agent_show_window
    return
  endif

  let l:busy_lines = []
  call add(l:busy_lines, 'Realtime Dev Agent')
  call add(l:busy_lines, 'Arquivo: ' . a:file)
  call add(l:busy_lines, '')
  call add(l:busy_lines, 'Status: analisando...')

  call s:window_open()
  call s:window_set_lines(l:busy_lines)
endfunction

function! s:issue_parse_parts(text) abort
  let l:message = a:text
  let l:suggestion = ''
  let l:parts = matchlist(l:message, '\v^(.*)\s\|\s(.*)$')
  if !empty(l:parts)
    let l:message = l:parts[1]
    let l:suggestion = l:parts[2]
  endif

  let l:severity = ''
  let l:severity_match = matchlist(l:message, '\v^\[([A-Za-z]+)\]\s*(.*)$')
  if !empty(l:severity_match)
    let l:severity = tolower(l:severity_match[1])
    let l:message = l:severity_match[2]
  endif

  return [l:severity, trim(l:message), trim(l:suggestion)]
endfunction

function! s:collect_analysis_for_buffer(bufnr) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return {
          \ 'ok': v:false,
          \ 'file': '',
          \ 'qf': [],
          \ 'error': 'buffer indisponivel para analise',
          \ }
  endif

  let l:file = fnamemodify(bufname(a:bufnr), ':p')
  let l:runner = s:realtime_dev_agent_script_runner()
  if empty(l:runner)
    return {
          \ 'ok': v:false,
          \ 'file': l:file,
          \ 'qf': [],
          \ 'error': 'runtime nao encontrado',
          \ }
  endif

  let l:target_file = l:file
  let l:buffer_dirty_tmp = ''
  if getbufvar(a:bufnr, '&modified')
    let l:buffer_dirty_tmp = tempname()
    call writefile(getbufline(a:bufnr, 1, '$'), l:buffer_dirty_tmp)
    let l:target_file = l:buffer_dirty_tmp
  endif

  let l:root = s:project_root(l:file)
  let l:output = s:run_systemlist([
        \ l:runner,
        \ g:realtime_dev_agent_script,
        \ '--analyze',
        \ l:target_file,
        \ '--source-path',
        \ l:file,
        \ '--vim'
        \ ], l:root)
  if !empty(l:buffer_dirty_tmp)
    silent! call delete(l:buffer_dirty_tmp)
  endif

  if v:shell_error != 0
    return {
          \ 'ok': v:false,
          \ 'file': l:file,
          \ 'qf': [],
          \ 'error': join(l:output, "\n"),
          \ }
  endif

  let l:qf = []
  let l:target_norm = fnamemodify(l:file, ':p')
  for l:line in l:output
    let l:match = matchlist(l:line, '\v^(.*):(\d+):(\d+): (.*)$')
    if empty(l:match)
      continue
    endif
    let l:qf_file = l:match[1]
    let l:qf_raw_text = l:match[4]
    let l:qf_text = s:extract_issue_text(l:qf_raw_text)
    let l:qf_action = s:extract_issue_action(l:qf_raw_text)
    let l:qf_snippet = s:extract_issue_snippet(l:qf_raw_text)
    let l:qf_kind = s:extract_issue_kind(l:qf_text)
    if !empty(l:buffer_dirty_tmp) && l:qf_file ==# l:buffer_dirty_tmp
      let l:qf_file = l:file
    endif
    let l:qf_file = fnamemodify(l:qf_file, ':p')
    if l:qf_file !=# l:target_norm
      continue
    endif

    let l:item = {
          \ 'filename': l:qf_file,
          \ 'lnum': str2nr(l:match[2]),
          \ 'col': str2nr(l:match[3]),
          \ 'text': l:qf_text,
          \ 'kind': l:qf_kind,
          \ 'snippet': l:qf_snippet,
          \ 'action': l:qf_action
          \ }
    if !s:issue_targets_active_scope(l:item, l:file)
      continue
    endif
    call add(l:qf, l:item)
  endfor

  return {
        \ 'ok': v:true,
        \ 'file': l:file,
        \ 'qf': l:qf,
        \ 'error': '',
        \ }
endfunction

function! s:realtime_check_from_buffer(bufnr, open_qf, show_echo) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return
  endif

  let l:file = fnamemodify(bufname(a:bufnr), ':p')
  if !s:should_check_file(l:file)
    return
  endif

  if bufnr('%') == a:bufnr && &buftype ==# ''
    call s:remember_code_window(win_getid())
  endif

  let l:file_tick = getbufvar(a:bufnr, 'changedtick')
  let l:file_key = fnamemodify(l:file, ':p')
  let l:last_file_tick = get(s:realtime_dev_agent_file_ticks, l:file_key, -1)
  if l:last_file_tick !=# l:file_tick
    let s:realtime_dev_agent_file_ticks[l:file_key] = l:file_tick
    let s:realtime_dev_agent_fix_guard[l:file_key] = {}
  endif

  let l:runner = s:realtime_dev_agent_script_runner()
  if empty(l:runner)
    if a:show_echo
      echohl ErrorMsg
      echomsg '[RealtimeDevAgent] Runtime nao encontrado no PATH'
      echohl None
    endif
    if g:realtime_dev_agent_show_window
      let l:missing_runtime_lines = []
      call add(l:missing_runtime_lines, 'Realtime Dev Agent')
      call add(l:missing_runtime_lines, 'Arquivo: ' . l:file)
      call add(l:missing_runtime_lines, '')
      call add(l:missing_runtime_lines, 'Erro: runtime nao encontrado no PATH')
      call add(l:missing_runtime_lines, 'Esperado: ' . s:realtime_dev_agent_script_label())
      call add(l:missing_runtime_lines, 'Ajuste g:realtime_dev_agent_script para um arquivo .js valido')
      call s:window_set_lines(l:missing_runtime_lines)
    endif
    return
  endif

  let l:target_file = l:file
  let l:buffer_dirty_tmp = ''
  let l:buffer_dirty = getbufvar(a:bufnr, '&modified')

  if l:buffer_dirty
    let l:buffer_dirty_tmp = tempname()
    call writefile(getbufline(a:bufnr, 1, '$'), l:buffer_dirty_tmp)
    let l:target_file = l:buffer_dirty_tmp
  endif

  let l:root = s:project_root(l:file)
  if g:realtime_dev_agent_show_window && !s:realtime_dev_agent_is_realtime_check
    call s:window_set_busy(l:file)
  endif
  let l:output = s:run_systemlist([
    \ l:runner,
    \ g:realtime_dev_agent_script,
    \ '--analyze',
    \ l:target_file,
    \ '--source-path',
    \ l:file,
    \ '--vim'
    \ ], l:root)

  let l:target_norm = fnamemodify(l:file, ':p')
  if !empty(l:buffer_dirty_tmp)
    silent! call delete(l:buffer_dirty_tmp)
  endif

  if v:shell_error != 0
    if g:realtime_dev_agent_show_window
      let l:error_lines = []
      call add(l:error_lines, 'Realtime Dev Agent')
      call add(l:error_lines, 'Arquivo: ' . l:file)
      call add(l:error_lines, '')
      call add(l:error_lines, 'Erro: falha ao executar o agente')
      call add(l:error_lines, 'Verifique o caminho do script em g:realtime_dev_agent_script e se o runtime esta no PATH.')
      call s:window_set_lines(l:error_lines)
    endif

    if a:show_echo
      echohl ErrorMsg
      echomsg '[RealtimeDevAgent] Falha ao executar o agente'
      echohl None
    endif
    return
  endif

  let l:qf = []
  for l:line in l:output
    let l:match = matchlist(l:line, '\v^(.*):(\d+):(\d+): (.*)$')
    if !empty(l:match)
    let l:qf_file = l:match[1]
    let l:qf_raw_text = l:match[4]
    let l:qf_text = s:extract_issue_text(l:qf_raw_text)
    let l:qf_action = s:extract_issue_action(l:qf_raw_text)
    let l:qf_snippet = s:extract_issue_snippet(l:qf_raw_text)
    let l:qf_kind = s:extract_issue_kind(l:qf_text)
    if !empty(l:buffer_dirty_tmp) && l:qf_file ==# l:buffer_dirty_tmp
      let l:qf_file = l:file
    endif
      let l:qf_file = fnamemodify(l:qf_file, ':p')
      if l:qf_file !=# l:target_norm
        continue
      endif

      let l:item = {
        \ 'filename': l:qf_file,
        \ 'lnum': str2nr(l:match[2]),
        \ 'col': str2nr(l:match[3]),
        \ 'text': l:qf_text,
        \ 'kind': l:qf_kind,
        \ 'snippet': l:qf_snippet,
        \ 'action': l:qf_action
        \ }
      if !s:issue_targets_active_scope(l:item, l:file)
        continue
      endif
      call add(l:qf, l:item)
    endif
  endfor

  call setqflist([], 'r', {'title': 'Realtime Dev Agent'})
  call setqflist(l:qf, 'a')
  let s:realtime_dev_agent_last_qf = l:qf
  let l:auto_fix_applied = 0
  if g:realtime_dev_agent_auto_fix_enabled
    let l:auto_fix_applied = s:realtime_dev_agent_apply_auto_fixes(l:qf, l:file)
  endif

  if l:auto_fix_applied > 0
    call s:realtime_check_from_buffer(a:bufnr, a:open_qf, a:show_echo)
    return
  endif

  if empty(l:qf)
    if a:open_qf
      cclose
    endif
    call s:window_refresh(l:file, l:qf)
    if a:show_echo
      echo '[RealtimeDevAgent] Nenhuma sugestao encontrada'
    endif
  else
    if a:open_qf
      copen
    endif
    call s:window_refresh(l:file, l:qf)
    if a:show_echo
      echomsg '[RealtimeDevAgent] ' . len(l:qf) . ' sugestao(oes) encontrada(s)'
    endif
  endif
endfunction

function! s:realtime_dev_agent_apply_auto_fixes(qf, file) abort
  if !s:realtime_dev_agent_can_apply_auto_fixes()
    return 0
  endif

  if s:realtime_dev_agent_auto_fix_busy
    return 0
  endif

  if type(a:qf) != v:t_list
    return 0
  endif

  if !g:realtime_dev_agent_auto_fix_enabled
    return 0
  endif

  let l:current_buf = bufnr('%')
  let l:current_file = fnamemodify(bufname(l:current_buf), ':p')
  let l:target_file = fnamemodify(a:file, ':p')
  if l:current_file !=# l:target_file
    return 0
  endif

  let l:kinds = get(g:, 'realtime_dev_agent_auto_fix_kinds', [])
  if type(l:kinds) != v:t_list
    let l:kinds = []
  endif
  let l:apply_all_kinds = empty(l:kinds)
  if l:apply_all_kinds
    " Lista vazia significa 'todos os tipos', com excecao segura de 'todo_fixme' para evitar ciclo.
  endif

  let l:seen = {}
  let l:auto_candidates = []
  for l:item in a:qf
    let l:item_file = get(l:item, 'filename', '')
    if fnamemodify(l:item_file, ':p') !=# fnamemodify(a:file, ':p')
      continue
    endif
    if !s:issue_targets_active_scope(l:item, a:file)
      continue
    endif
    let l:item_kind = get(l:item, 'kind', '')
    if l:item_kind ==# 'todo_fixme' && l:apply_all_kinds
      continue
    endif
    if !l:apply_all_kinds && index(l:kinds, l:item_kind) == -1
      continue
    endif
    let l:item_action = s:issue_effective_action(l:item)
    if empty(get(l:item, 'snippet', '')) && l:item_kind !=# 'trailing_whitespace' && get(l:item_action, 'op', '') !=# 'run_command'
      continue
    endif
    if !empty(s:issue_auto_fix_noop_reason(l:item))
      continue
    endif

    let l:item_key = printf(
          \ '%s|%d|%s|%s',
          \ fnamemodify(l:item_file, ':p'),
          \ get(l:item, 'lnum', 0),
          \ get(l:item, 'kind', ''),
          \ s:issue_action_identity(l:item)
          \ )
    if has_key(l:seen, l:item_key)
      continue
    endif
    let l:seen[l:item_key] = 1
    call add(l:auto_candidates, l:item)
  endfor

  if empty(l:auto_candidates)
    return 0
  endif

  let l:auto_candidates = s:select_auto_fix_candidates_by_scope(l:auto_candidates)

  if empty(l:auto_candidates)
    return 0
  endif

  call sort(l:auto_candidates, {entry_a, entry_b ->
        \ s:compare_fix_order(entry_a, entry_b)
        \ })
  let l:auto_candidates = s:limit_documentation_candidates(l:auto_candidates)

  if empty(l:auto_candidates)
    return 0
  endif

  if mode() =~# '^i'
    let s:realtime_dev_agent_pending_auto_fixes = l:auto_candidates
    return 0
  endif

  let l:affected_files = s:collect_affected_files(a:file, l:auto_candidates)
  let l:file_snapshot = s:capture_file_snapshot(l:affected_files)
  let l:applied = 0
  let l:applied_items = []
  let l:max_to_apply = get(g:, 'realtime_dev_agent_auto_fix_max_per_check', 0)
  if type(l:max_to_apply) != v:t_number
    let l:max_to_apply = str2nr(string(l:max_to_apply))
  endif
  let l:file_key = fnamemodify(a:file, ':p')
  let l:fix_guard = get(s:realtime_dev_agent_fix_guard, l:file_key, {})
  let l:line_kind_applied = {}
  let l:line_adjustments = []
  let l:visual_batch = s:start_auto_fix_visual_batch(l:current_buf)
  let s:realtime_dev_agent_auto_fix_busy = v:true
  try
    for l:item in l:auto_candidates
      if l:max_to_apply > 0 && l:applied >= l:max_to_apply
        break
      endif

      let l:item_line = get(l:item, 'lnum', 0)
      if l:item_line <= 0
        continue
      endif
      let l:item_kind = get(l:item, 'kind', '')
      let l:item_identity = s:issue_action_identity(l:item)
      let l:item_line_key = string(l:item_line)
      let l:line_kinds = get(l:line_kind_applied, l:item_line_key, [])
      if type(l:line_kinds) != v:t_list
        let l:line_kinds = []
      endif
      if index(l:line_kinds, 'undefined_variable') != -1 && l:item_kind ==# 'debug_output'
        continue
      endif
      let l:item_apply_key = l:item_kind
      if !empty(l:item_identity)
        let l:item_apply_key = l:item_kind . '|' . l:item_identity
      endif
      if !empty(l:line_kinds) && index(l:line_kinds, l:item_apply_key) != -1
        continue
      endif

      let l:guard_key = printf(
            \ '%s|%s|%d|%s',
            \ get(l:item, 'filename', ''),
            \ l:item_apply_key,
            \ l:item_line,
            \ l:item_identity
            \ )
      if has_key(l:fix_guard, l:guard_key)
        continue
      endif
      let l:fix_guard[l:guard_key] = 1
      call add(l:line_kinds, l:item_apply_key)
      let l:line_kind_applied[l:item_line_key] = l:line_kinds

      let l:shifted_item = s:shift_issue_for_batch(l:item, s:cumulative_line_shift(l:item_line, l:line_adjustments))
      if s:apply_issue_snippet(l:shifted_item, v:false)
        let l:applied += 1
        call add(l:applied_items, l:shifted_item)
        let l:adjustment = s:issue_shift_adjustment(l:shifted_item)
        if !empty(l:adjustment)
          call add(l:line_adjustments, l:adjustment)
        endif
      endif
    endfor
    let s:realtime_dev_agent_fix_guard[l:file_key] = l:fix_guard
  finally
    call s:end_auto_fix_visual_batch(l:visual_batch)
    let s:realtime_dev_agent_auto_fix_busy = v:false
  endtry

  if l:applied > 0
    let l:analysis = s:collect_analysis_for_buffer(l:current_buf)
    if !get(l:analysis, 'ok', v:false)
      call s:restore_file_snapshot(l:file_snapshot)
      echohl WarningMsg
      echomsg '[RealtimeDevAgent] Auto-fix revertido: falha ao reanalisar o buffer'
      echohl None
      return 0
    endif

    let l:guard_payload = {
          \ 'appliedIssues': l:applied_items,
          \ 'beforeIssues': a:qf,
          \ 'afterIssues': get(l:analysis, 'qf', []),
          \ 'fileEntries': s:build_guard_file_entries(l:affected_files),
          \ }
    let l:guard_result = s:run_autofix_guard(l:guard_payload, a:file)
    if !get(l:guard_result, 'ok', v:false)
      call s:restore_file_snapshot(l:file_snapshot)
      echohl WarningMsg
      echomsg '[RealtimeDevAgent] Auto-fix revertido: ' . s:format_guard_failure(l:guard_result)
      echohl None
      return 0
    endif

    let l:summary = printf('[RealtimeDevAgent] Auto-fix aplicado em %d sugerenca(s)', l:applied)
    echo l:summary
  endif
  return l:applied
endfunction

function! s:shift_issue_for_batch(item, line_shift) abort
  if type(a:item) != v:t_dict || a:line_shift == 0
    return a:item
  endif

  let l:shifted = deepcopy(a:item)
  let l:base_line = get(l:shifted, 'lnum', 0)
  if l:base_line > 0
    let l:shifted.lnum = l:base_line + a:line_shift
  endif

  let l:action = s:issue_effective_action(l:shifted)
  if has_key(l:action, 'range') && type(l:action.range) == v:t_dict
    if has_key(l:action.range, 'start') && type(l:action.range.start) == v:t_dict
      let l:action.range.start.line = get(l:action.range.start, 'line', 0) + a:line_shift
    endif
    if has_key(l:action.range, 'end') && type(l:action.range.end) == v:t_dict
      let l:action.range.end.line = get(l:action.range.end, 'line', 0) + a:line_shift
    endif
  endif
  let l:shifted.action = l:action
  return l:shifted
endfunction

function! s:issue_line_delta(item) abort
  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  if l:op ==# 'write_file' || l:op ==# 'run_command'
    return 0
  endif

  let l:snippet = get(a:item, 'snippet', '')
  let l:snippet_lines = empty(l:snippet) ? [] : split(l:snippet, "\n", 1)
  if l:op ==# 'insert_before' || l:op ==# 'insert_after'
    return len(l:snippet_lines)
  endif

  if l:op ==# 'replace_line'
    let l:replaced_lines = 1
    if has_key(l:action, 'range') && type(l:action.range) == v:t_dict
      let l:start_line = get(get(l:action, 'range', {}), 'start', {})
      let l:end_line = get(get(l:action, 'range', {}), 'end', {})
      if type(l:start_line) == v:t_dict && type(l:end_line) == v:t_dict
        let l:replaced_lines = (get(l:end_line, 'line', 0) - get(l:start_line, 'line', 0)) + 1
      endif
    endif
    return len(l:snippet_lines) - max([1, l:replaced_lines])
  endif

  return 0
endfunction

function! s:issue_shift_adjustment(item) abort
  let l:delta = s:issue_line_delta(a:item)
  if l:delta == 0
    return {}
  endif

  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  return {
        \ 'line': get(a:item, 'lnum', 0),
        \ 'delta': l:delta,
        \ 'inclusive': index(['insert_before', 'replace_line'], l:op) != -1,
        \ }
endfunction

function! s:cumulative_line_shift(origin_line, adjustments) abort
  let l:origin_line = max([0, a:origin_line])
  let l:shift = 0
  for l:adjustment in a:adjustments
    if type(l:adjustment) != v:t_dict
      continue
    endif
    let l:line = get(l:adjustment, 'line', 0)
    if l:origin_line > l:line || (get(l:adjustment, 'inclusive', v:false) && l:origin_line == l:line)
      let l:shift += get(l:adjustment, 'delta', 0)
    endif
  endfor
  return l:shift
endfunction

function! s:compare_fix_order(entry_a, entry_b) abort
  let l:kind_a = get(a:entry_a, 'kind', '')
  let l:kind_b = get(a:entry_b, 'kind', '')
  let l:priority_a = get(a:entry_a, 'autofixPriority', s:issue_fix_priority(l:kind_a))
  let l:priority_b = get(a:entry_b, 'autofixPriority', s:issue_fix_priority(l:kind_b))

  if l:priority_a != l:priority_b
    return l:priority_a < l:priority_b ? -1 : 1
  endif

  let l:lnum_a = get(a:entry_a, 'lnum', 0)
  let l:lnum_b = get(a:entry_b, 'lnum', 0)
  if l:lnum_a != l:lnum_b
    return l:lnum_a < l:lnum_b ? 1 : -1
  endif

  return 0
endfunction

function! s:realtime_dev_agent_drain_pending_auto_fixes() abort
  if mode() =~# '^i'
    return
  endif

  if empty(s:realtime_dev_agent_pending_auto_fixes)
    return
  endif

  let l:items = copy(s:realtime_dev_agent_pending_auto_fixes)
  let s:realtime_dev_agent_pending_auto_fixes = []

  let l:file = fnamemodify(bufname('%'), ':p')
  call s:realtime_dev_agent_apply_auto_fixes(l:items, l:file)
endfunction

function! s:realtime_dev_agent_schedule_check() abort
  if !g:realtime_dev_agent_realtime_on_change || !has('timers')
    return
  endif

  if s:realtime_dev_agent_auto_fix_busy
    return
  endif

  let l:bufnr = bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr)
    return
  endif

  let l:file = fnamemodify(bufname(l:bufnr), ':p')
  if empty(l:file) || !s:should_check_file(l:file)
    return
  endif
  if !s:should_run_auto_check(l:bufnr)
    return
  endif

  let s:realtime_dev_agent_realtime_pending_buf = l:bufnr

  if s:realtime_dev_agent_realtime_timer != -1
    call timer_stop(s:realtime_dev_agent_realtime_timer)
  endif

  let l:delay = g:realtime_dev_agent_realtime_delay
  if type(l:delay) != v:t_number
    let l:delay = str2nr(string(l:delay))
  endif
  if l:delay < 200
    let l:delay = 200
  endif
  let s:realtime_dev_agent_realtime_timer = timer_start(l:delay, function('RealtimeDevAgentRunPendingCheck'))
endfunction

function! RealtimeDevAgentRunPendingCheck(timer_id) abort
  call s:realtime_dev_agent_run_pending_check(a:timer_id)
endfunction

function! s:realtime_dev_agent_run_pending_check(timer_id) abort
  let l:previous_show_window = g:realtime_dev_agent_show_window
  let l:previous_mode = get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
  let s:realtime_dev_agent_is_realtime_check = v:true
  let g:realtime_dev_agent_show_window = 0

  let l:bufnr = s:realtime_dev_agent_realtime_pending_buf
  let s:realtime_dev_agent_realtime_pending_buf = -1
  let s:realtime_dev_agent_realtime_timer = -1

  try
    if l:bufnr <= 0 || !bufloaded(l:bufnr)
      return
    endif
    if !s:should_run_auto_check(l:bufnr)
      return
    endif

    call s:realtime_check_from_buffer(l:bufnr, g:realtime_dev_agent_realtime_open_qf, 0)
  finally
    let s:realtime_dev_agent_is_realtime_check = l:previous_mode
    call s:realtime_dev_agent_restore_show_window(l:previous_show_window)
  endtry
endfunction

function! s:window_refresh(file, qf) abort
  if !g:realtime_dev_agent_show_window
    return
  endif

  call s:window_open()

  let l:lines = []
  if type(l:lines) != v:t_list
    let l:lines = []
  endif
  call add(l:lines, 'Realtime Dev Agent')
  call add(l:lines, 'Arquivo: ' . a:file)
  call add(l:lines, '')

  if empty(a:qf)
    call add(l:lines, '[OK] Sem sugestoes encontradas')
    call s:window_set_lines(l:lines)
    return
  endif

  call add(l:lines, 'Total de sugestoes: ' . len(a:qf))
  call add(l:lines, '')
  let l:index = 0
  for l:item in a:qf
    let l:index = l:index + 1
    let l:qf_parts = s:issue_parse_parts(l:item.text)
    let l:severity = l:qf_parts[0]
    let l:message = l:qf_parts[1]
    let l:suggestion = l:qf_parts[2]
    let l:item_snippet = get(l:item, 'snippet', '')
    let l:qf_line = printf('[%d] %s:%d:%d', l:index, fnamemodify(l:item.filename, ':t'), l:item.lnum, l:item.col)
    call add(l:lines, l:qf_line)
    if !empty(l:severity)
      call add(l:lines, '    Tipo: ' . l:severity)
    endif
    call add(l:lines, '    Problema: ' . l:message)
    if !empty(l:suggestion)
      call add(l:lines, '    Acao: ' . l:suggestion)
    endif
    if !empty(l:item_snippet)
      call add(l:lines, '    Snippet:')
      for l:snippet_line in split(l:item_snippet, "\n")
        call add(l:lines, '        ' . l:snippet_line)
      endfor
    endif
    call add(l:lines, '')
  endfor
  let s:realtime_dev_agent_last_qf = a:qf
  call add(l:lines, '')
  let l:command_line = 'Painel Realtime Dev Agent: ' . g:realtime_dev_agent_window_key . ' para abrir/atualizar'
  let l:command_line = l:command_line . ' | <Tab>/i/a: aplicar | Enter: ir para item | f: follow-up | r: reanalisar | q: fechar'
  call add(l:lines, l:command_line)
  call s:window_set_lines(l:lines)
endfunction

function! s:extract_issue_text(raw) abort
  let l:text = a:raw
  let l:snippet_marker = stridx(l:text, ' || SNIPPET:')
  if l:snippet_marker >= 0
    let l:text = strpart(l:text, 0, l:snippet_marker)
  endif
  let l:action_marker = stridx(l:text, ' || ACTION:')
  if l:action_marker >= 0
    let l:text = strpart(l:text, 0, l:action_marker)
  endif
  return l:text
endfunction

function! s:extract_issue_action(raw) abort
  let l:marker = ' || ACTION:'
  let l:start = stridx(a:raw, l:marker)
  if l:start < 0
    return {}
  endif
  let l:payload = strpart(a:raw, l:start + strlen(l:marker))
  let l:snippet_marker = stridx(l:payload, ' || SNIPPET:')
  if l:snippet_marker >= 0
    let l:payload = strpart(l:payload, 0, l:snippet_marker)
  endif
  try
    return json_decode(trim(l:payload))
  catch
    return {}
  endtry
endfunction

function! s:extract_issue_kind(raw) abort
  let l:match = matchlist(a:raw, '\v^\[[^]]+\]\s+([a-z_]+):')
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:extract_issue_snippet(raw) abort
  let l:match = matchlist(a:raw, '\v^.*\s\|\|\sSNIPPET:(.*)$')
  if empty(l:match)
    return ''
  endif

  let l:snippet = trim(l:match[1])
  let l:snippet = substitute(l:snippet, '\\\\', '__REALTIME_DEV_AGENT_BACKSLASH__', 'g')
  let l:snippet = substitute(l:snippet, '\\n', "\n", 'g')
  let l:snippet = substitute(l:snippet, '__REALTIME_DEV_AGENT_BACKSLASH__', '\\', 'g')
  return l:snippet
endfunction

function! s:realtime_dev_agent_check() abort
  let l:prev_show_window = g:realtime_dev_agent_show_window
  let l:prev_mode = get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
  let g:realtime_dev_agent_show_window = 0
  let s:realtime_dev_agent_is_realtime_check = v:false
  try
    call s:realtime_check_from_buffer(bufnr('%'), g:realtime_dev_agent_open_qf, 1)
  finally
    call s:realtime_dev_agent_restore_show_window(l:prev_show_window)
    let s:realtime_dev_agent_is_realtime_check = l:prev_mode
  endtry
endfunction

function! s:realtime_dev_agent_window_check() abort
  let l:prev_show_window = g:realtime_dev_agent_show_window
  let l:prev_mode = get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
  let g:realtime_dev_agent_show_window = 1
  let s:realtime_dev_agent_is_realtime_check = v:false
  try
    call s:realtime_check_from_buffer(bufnr('%'), 0, 1)
  finally
    call s:realtime_dev_agent_restore_show_window(l:prev_show_window)
    let s:realtime_dev_agent_is_realtime_check = l:prev_mode
  endtry
endfunction

command! RealtimeDevAgentCheck call s:realtime_dev_agent_check()
command! RealtimeDevAgentWindowCheck call s:realtime_dev_agent_window_check()
command! RealtimeDevAgentWindowClose call s:window_close()
command! RealtimeDevAgentWindowToggle call s:window_toggle()
command! RealtimeDevAgentAutoFixEnable let g:realtime_dev_agent_auto_fix_enabled = 1 | echomsg '[RealtimeDevAgent] Auto-fix ligado'
command! RealtimeDevAgentAutoFixDisable let g:realtime_dev_agent_auto_fix_enabled = 0 | echomsg '[RealtimeDevAgent] Auto-fix desligado'

if !empty(g:realtime_dev_agent_map_key)
  " Atalho de analise rapida do arquivo atual.
  execute 'nnoremap <silent> ' . g:realtime_dev_agent_map_key . ' :RealtimeDevAgentCheck<CR>'
endif

if !empty(g:realtime_dev_agent_window_key)
  " Atalho para executar analise no modo janela de interacao em tempo real.
  execute 'nnoremap <silent> ' . g:realtime_dev_agent_window_key . ' :RealtimeDevAgentWindowCheck<CR>'
endif

if g:realtime_dev_agent_start_on_editor_enter
  augroup realtime_dev_agent_startup
    autocmd!
    autocmd VimEnter,BufEnter * call s:realtime_dev_agent_start_current_buffer()
  augroup END
endif

augroup realtime_dev_agent_code_buffer_maps
  autocmd!
  autocmd BufEnter * call s:set_code_buffer_tab_accept()
augroup END

augroup realtime_dev_agent_open_review
  autocmd!
  autocmd BufReadPost,BufNewFile * if g:realtime_dev_agent_review_on_open | call s:realtime_dev_agent_open_review() | endif
augroup END

if g:realtime_dev_agent_auto_on_save
  " Auto check no save para acelerar a captura de problemas de rotina.
  augroup realtime_dev_agent
    autocmd!
    autocmd BufWritePost * call s:realtime_dev_agent_check()
  augroup END
endif

if g:realtime_dev_agent_realtime_on_change
  " Checagem em tempo real com debounce enquanto edita texto.
  augroup realtime_dev_agent_realtime
    autocmd!
    autocmd TextChanged * call s:realtime_dev_agent_schedule_check()
    if get(g:, 'realtime_dev_agent_realtime_insert_mode', 0)
      autocmd TextChangedI * call s:realtime_dev_agent_schedule_check()
    endif
    autocmd InsertLeave * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_drain_pending_auto_fixes() | call s:realtime_dev_agent_schedule_check() | endif
  augroup END
endif

call s:set_code_buffer_tab_accept()
