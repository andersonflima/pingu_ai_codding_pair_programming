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

  if !s:focus_code_window()
    return
  endif

  silent! execute 'keepalt keepjumps edit ' . fnameescape(l:issue.filename)
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

  if !s:focus_code_window()
    return
  endif
  execute 'silent! keepalt keepjumps edit ' . fnameescape(l:issue.filename)
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
  if a:kind ==# 'moduledoc'
    return {'op': 'insert_before'}
  endif
  if a:kind ==# 'debug_output' || a:kind ==# 'trailing_whitespace' || a:kind ==# 'tabs'
    return {'op': 'replace_line'}
  endif
  if a:kind ==# 'syntax_missing_quote' || a:kind ==# 'syntax_extra_delimiter' || a:kind ==# 'syntax_missing_comma'
    return {'op': 'replace_line'}
  endif
  if a:kind ==# 'comment_task'
    return {'op': 'replace_line'}
  endif
  if a:kind ==# 'context_file'
    return {'op': 'write_file'}
  endif
  if a:kind ==# 'terminal_task'
    return {'op': 'run_command'}
  endif
  if a:kind ==# 'syntax_missing_delimiter'
    return {'op': 'insert_after', 'dedupeLookahead': 6}
  endif
  if a:kind ==# 'unit_test'
    return {'op': 'write_file'}
  endif
  if a:kind ==# 'undefined_variable' || a:kind ==# 'function_doc' || a:kind ==# 'function_spec'
    return {'op': 'insert_before'}
  endif
  return {'op': 'insert_before'}
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
    if !s:remove_issue_trigger_line(l:issue, v:false)
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

function! s:issue_terminal_status_file() abort
  return tempname()
endfunction

function! s:issue_terminal_shell_command(command, cwd, status_file) abort
  let l:parts = ['{']
  if !empty(a:cwd)
    call add(l:parts, 'cd ' . shellescape(a:cwd) . ' &&')
  endif
  call add(l:parts, a:command . ';')
  call add(l:parts, '}')
  call add(l:parts, ';')
  call add(l:parts, 'rda_status=$?;')
  call add(l:parts, 'printf "%s" "$rda_status" > ' . shellescape(a:status_file) . ';')
  call add(l:parts, 'exit $rda_status')
  return join(l:parts, ' ')
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

function! s:apply_issue_run_command_toggleterm(command, cwd, context) abort
  let l:status_file = s:issue_terminal_status_file()
  let l:wrapped_command = s:issue_terminal_shell_command(a:command, a:cwd, l:status_file)
  let l:payload = {
        \ 'cmd': l:wrapped_command,
        \ 'cwd': a:cwd,
        \ 'display_name': 'Realtime Dev Agent'
        \ }
  let l:ok = luaeval(
        \ '(function(payload)'
        \ . ' local ok, terminal_module = pcall(require, "toggleterm.terminal")'
        \ . ' if not ok or not terminal_module or not terminal_module.Terminal then return false end'
        \ . ' local term = terminal_module.Terminal:new({'
        \ . '   dir = payload.cwd ~= "" and payload.cwd or nil,'
        \ . '   hidden = false,'
        \ . '   close_on_exit = false,'
        \ . '   display_name = payload.display_name'
        \ . ' })'
        \ . ' term:open()'
        \ . ' vim.schedule(function() term:send(payload.cmd, false) end)'
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
  echomsg '[RealtimeDevAgent] Executando no ToggleTerm: ' . a:command
  call s:issue_terminal_schedule_poll(a:context, l:status_file)
  return v:true
endfunction

function! s:apply_issue_run_command_vscode(command, cwd, context) abort
  let l:status_file = s:issue_terminal_status_file()
  let l:wrapped_command = s:issue_terminal_shell_command(a:command, a:cwd, l:status_file)
  call VSCodeNotify('workbench.action.terminal.new')
  call VSCodeNotify('workbench.action.terminal.focus')
  call VSCodeNotify('workbench.action.terminal.sendSequence', {'text': l:wrapped_command . "\n"})
  echomsg '[RealtimeDevAgent] Executando no terminal do VS Code: ' . a:command
  call s:issue_terminal_schedule_poll(a:context, l:status_file)
  return v:true
endfunction

function! s:apply_issue_run_command_hidden(issue, keep_focus_code) abort
  let l:action = s:issue_effective_action(a:issue)
  let l:command = get(l:action, 'command', '')
  let l:cwd = fnamemodify(get(l:action, 'cwd', ''), ':p')
  if empty(l:cwd)
    let l:cwd = s:project_root(get(a:issue, 'filename', ''))
  endif

  let l:system_command = l:command
  if !empty(l:cwd)
    let l:system_command = 'cd ' . shellescape(l:cwd) . ' && ' . l:command
  endif

  let l:output = systemlist(l:system_command)
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

  let l:cwd = fnamemodify(get(l:action, 'cwd', ''), ':p')
  if empty(l:cwd)
    let l:cwd = s:project_root(get(a:issue, 'filename', ''))
  endif

  let l:context = s:issue_terminal_context(a:issue, a:keep_focus_code)
  let l:height = s:issue_terminal_height()
  let l:strategy = s:issue_terminal_strategy()

  if l:strategy ==# 'vscode'
    return s:apply_issue_run_command_vscode(l:command, l:cwd, l:context)
  endif

  if l:strategy ==# 'toggleterm'
    return s:apply_issue_run_command_toggleterm(l:command, l:cwd, l:context)
  endif

  if l:strategy ==# 'native' && has('nvim')
    call s:remember_code_window(win_getid())
    execute 'botright ' . l:height . 'split'
    enew
    call termopen(l:command, {
          \ 'cwd': l:cwd,
          \ 'on_exit': function('s:nvim_terminal_action_exit', [l:context])
          \ })
    startinsert
    echomsg '[RealtimeDevAgent] Executando no terminal: ' . l:command
    return v:true
  endif

  if l:strategy ==# 'native' && exists('*term_start')
    call s:remember_code_window(win_getid())
    execute 'botright ' . l:height . 'split'
    call term_start(l:command, {
          \ 'cwd': l:cwd,
          \ 'curwin': 1,
          \ 'exit_cb': function('s:vim_terminal_action_exit', [l:context])
          \ })
    echomsg '[RealtimeDevAgent] Executando no terminal: ' . l:command
    return v:true
  endif

  return s:apply_issue_run_command_hidden(l:context, a:keep_focus_code)
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
    let l:snippet_lines = split(l:snippet_raw, '\n', 1)
  endif
  if empty(l:snippet_lines)
    return v:false
  endif

  if l:op ==# 'write_file'
    return s:apply_issue_write_file(l:issue, l:snippet_lines)
  endif

  if a:keep_focus_code
    call s:focus_code_window()
  endif

  let l:target_buf = bufnr('%')
  let l:current_file = fnamemodify(bufname('%'), ':p')
  let l:target_file = fnamemodify(l:filename, ':p')
  if !empty(l:target_file) && l:target_file !=# l:current_file
    if a:keep_focus_code
      execute 'silent! keepalt keepjumps edit ' . fnameescape(l:filename)
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

  if !a:keep_focus_code
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
  if empty(l:op)
    let l:op = get(s:issue_default_action(l:kind), 'op', 'insert_before')
  endif

  if l:op ==# 'replace_line'
    let l:normalized_current = substitute(l:line_content, '^\s*', '', '')
    let l:normalized_first = substitute(l:snippet_lines[0], '^\s*', '', '')
    if len(l:snippet_lines) == 1 && (empty(l:snippet_lines[0]) || l:normalized_current ==# l:normalized_first)
      return v:false
    endif
    noautocmd call setbufline(l:target_buf, l:lnum, l:snippet_lines[0])
    if len(l:snippet_lines) > 1
      noautocmd call appendbufline(l:target_buf, l:lnum, l:snippet_lines[1:])
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

    let l:expected_lines = split(l:snippet, '
', 1)
    let l:current_lines = readfile(l:target_file, 'b')
    return join(l:current_lines, "
") !=# join(l:expected_lines, "
")
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

  if l:op ==# 'replace_line'
    let l:snippet_lines = split(get(a:item, 'snippet', ''), '\n')
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
    let l:snippet_lines = split(l:snippet, '\n')
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
      return printf('substitua %s por %s', l:unknown, l:replacement)
    endif
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
  let l:cmd = 'cd ' . shellescape(l:root)
    \ . ' && ' . l:runner . ' ' . shellescape(g:realtime_dev_agent_script)
    \ . ' --analyze ' . shellescape(l:target_file)
    \ . ' --source-path ' . shellescape(l:file)
    \ . ' --vim'

  if g:realtime_dev_agent_show_window && !s:realtime_dev_agent_is_realtime_check
    call s:window_set_busy(l:file)
  endif
  let l:output = systemlist(l:cmd)

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

      call add(l:qf, {
        \ 'filename': l:qf_file,
        \ 'lnum': str2nr(l:match[2]),
        \ 'col': str2nr(l:match[3]),
        \ 'text': l:qf_text,
        \ 'kind': l:qf_kind,
        \ 'snippet': l:qf_snippet,
        \ 'action': l:qf_action
        \ })
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

  if g:realtime_dev_agent_auto_fix_cursor_only
    let l:cursor_line = line('.')
    let l:focus_candidates = []
    for l:item in l:auto_candidates
      if abs(get(l:item, 'lnum', 0) - l:cursor_line) <= 1
        call add(l:focus_candidates, l:item)
      endif
    endfor
    let l:auto_candidates = l:focus_candidates
  endif

  if empty(l:auto_candidates)
    return 0
  endif

  let l:fix_priority = [
        \ 'syntax_missing_quote',
        \ 'syntax_extra_delimiter',
        \ 'syntax_missing_delimiter',
        \ 'syntax_missing_comma',
        \ 'undefined_variable',
        \ 'missing_dependency',
        \ 'moduledoc',
        \ 'function_spec',
        \ 'function_doc',
        \ 'functional_reassignment',
        \ 'debug_output',
        \ 'comment_task',
        \ 'context_file',
        \ 'terminal_task',
        \ 'trailing_whitespace',
        \ 'tabs',
        \ 'todo_fixme',
        \ 'nested_condition',
        \ 'long_line',
        \ 'large_file'
        \ ]
  call sort(l:auto_candidates, {entry_a, entry_b ->
        \ s:compare_fix_order(entry_a, entry_b, l:fix_priority)
        \ })

  if mode() =~# '^i'
    let s:realtime_dev_agent_pending_auto_fixes = l:auto_candidates
    return 0
  endif

  let l:applied = 0
  let l:max_to_apply = get(g:, 'realtime_dev_agent_auto_fix_max_per_check', 0)
  if type(l:max_to_apply) != v:t_number
    let l:max_to_apply = str2nr(string(l:max_to_apply))
  endif
  let l:file_key = fnamemodify(a:file, ':p')
  let l:fix_guard = get(s:realtime_dev_agent_fix_guard, l:file_key, {})
  let l:line_kind_applied = {}
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

      if s:apply_issue_snippet(l:item, v:false)
        let l:applied += 1
      endif
    endfor
    let s:realtime_dev_agent_fix_guard[l:file_key] = l:fix_guard
  finally
    let s:realtime_dev_agent_auto_fix_busy = v:false
  endtry

  if l:applied > 0
    let l:summary = printf('[RealtimeDevAgent] Auto-fix aplicado em %d sugerenca(s)', l:applied)
    echo l:summary
  endif
  return l:applied
endfunction

function! s:compare_fix_order(entry_a, entry_b, priorities) abort
  let l:lnum_a = get(a:entry_a, 'lnum', 0)
  let l:lnum_b = get(a:entry_b, 'lnum', 0)
  if l:lnum_a != l:lnum_b
    return l:lnum_a < l:lnum_b ? 1 : -1
  endif

  let l:kind_a = get(a:entry_a, 'kind', '')
  let l:kind_b = get(a:entry_b, 'kind', '')
  let l:priority_a = index(a:priorities, l:kind_a)
  let l:priority_b = index(a:priorities, l:kind_b)
  if l:priority_a == -1
    let l:priority_a = 999
  endif
  if l:priority_b == -1
    let l:priority_b = 999
  endif

  if l:priority_a == l:priority_b
    return 0
  endif
  return l:priority_a < l:priority_b ? -1 : 1
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
      for l:snippet_line in split(l:item_snippet, '\n')
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
  let l:snippet = substitute(l:snippet, '\\n', "\n", 'g')
  let l:snippet = substitute(l:snippet, '\\\\', '\\', 'g')
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
    autocmd TextChanged,TextChangedI * call s:realtime_dev_agent_schedule_check()
    autocmd InsertLeave * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_drain_pending_auto_fixes() | call s:realtime_dev_agent_schedule_check() | endif
  augroup END
endif

call s:set_code_buffer_tab_accept()
