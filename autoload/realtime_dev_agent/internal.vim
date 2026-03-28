if exists('g:loaded_realtime_dev_agent_root_internal_wrapper')
  finish
endif
let g:loaded_realtime_dev_agent_root_internal_wrapper = 1

let s:delegate = fnamemodify(resolve(expand('<sfile>:p')), ':h:h:h') . '/vim/autoload/realtime_dev_agent/internal.vim'
if filereadable(s:delegate)
  execute 'source ' . fnameescape(s:delegate)
endif
unlet s:delegate
