'use strict';

function createCommentTaskTools(deps) {
  const {
    analysisExtension,
    buildContextBlueprintTasks,
    buildSnippetDependencyIssues,
    commentTaskAlreadyApplied,
    inferTerminalTaskAction,
    isMermaidExtension,
    normalizeGeneratedTaskResult,
    supportsHashComments,
    supportsSlashComments,
    synthesizeFromCommentTask,
  } = deps;

  function normalizeCommentInstruction(raw) {
    return String(raw || '')
      .trim()
      .replace(/^\s*(?:\\s)?\s*(?:\*\*|[:*])\s*/, '')
      .trim();
  }

  function isActionableCommentTask(instruction) {
    const normalized = String(instruction || '').trim();
    if (normalized.length < 4) {
      return false;
    }
    return !isIncompleteCommentTask(normalized);
  }

  function isIncompleteCommentTask(instruction) {
    const lower = String(instruction || '').toLowerCase().trim();
    if (!lower) {
      return true;
    }

    if (/\b(que|de|do|da|para|com|sem|e|ou|a|o|um|uma|that|to|for|with|from|and|or)\s*$/.test(lower)) {
      return true;
    }

    if (/^(?:funcao|função|function|metodo|método|method)\s*$/.test(lower)) {
      return true;
    }

    if (/^(?:funcao|função|function|metodo|método|method)\s+(?:que|de|do|da|para|com|sem|that|to|for|with)\s*$/.test(lower)) {
      return true;
    }

    if (/^(?:crie|criar|cria|implemente|implementar|implementa|escreva|escrever|faça|faca|adicione|adicionar)\s+(?:uma?\s+)?(?:funcao|função|function|metodo|método|method)\s*$/.test(lower)) {
      return true;
    }

    return false;
  }

  function commentTaskMatchers(ext) {
    const lowerExt = analysisExtension(ext);
    if (supportsHashComments(lowerExt) || ['.tf'].includes(lowerExt)) {
      return [
        { regex: /^\s*#\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (lowerExt === '.md') {
      return [
        { regex: /^\s*<!--\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+?)\s*-->\s*$/ },
      ];
    }
    if (isMermaidExtension(lowerExt)) {
      return [
        { regex: /^\s*%%\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (supportsSlashComments(lowerExt)) {
      return [
        { regex: /^\s*\/\/\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/ },
        { regex: /^\s*\/\*:\s*(.+?)\s*\*\/\s*$/, marker: ':' },
        { regex: /^\s*\/\*:\s*(.+)$/, marker: ':' },
        { regex: /^\s*\/\*\s+(\*\*|[:*])\s*(.+?)\s*\*\/\s*$/ },
        { regex: /^\s*\/\*\s+(\*\*|[:*])\s*(.+)$/, allowOpenBlock: true },
        { regex: /^\s*\/\*\s*((?:funcao|função|function|metodo|método|method|crie|cria|criar|implemente|implementar|implementa|escreva|escrever|gera|gerar|monta|montar|adiciona|adicionar|faça|faca)\b.+?)\s*\*\/\s*$/i, marker: ':' },
        { regex: /^\s*\/\*\s*((?:funcao|função|function|metodo|método|method|crie|cria|criar|implemente|implementar|implementa|escreva|escrever|gera|gerar|monta|montar|adiciona|adicionar|faça|faca)\b.+)$/i, marker: ':', allowOpenBlock: true },
      ];
    }
    if (lowerExt === '.lua') {
      return [
        { regex: /^\s*--\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/ },
      ];
    }
    if (lowerExt === '.vim') {
      return [
        { regex: /^\s*"\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/ },
      ];
    }
    return [
      { regex: /^\s*(?:#|\/\/|--|")\s*(?:\\s)?\s*(\*\*|[:*])\s*(.+)$/ },
    ];
  }

  function matchCommentTask(line, ext) {
    const matchers = commentTaskMatchers(ext);
    return matchers.reduce((resolved, matcher) => {
      if (resolved) {
        return resolved;
      }

      const match = String(line || '').match(matcher.regex);
      if (!match) {
        return null;
      }

      if (matcher.marker) {
        return {
          marker: matcher.marker,
          instruction: String(match[1] || '').trim(),
        };
      }

      return {
        marker: String(match[1] || '').trim(),
        instruction: String(match[2] || '').trim(),
      };
    }, null);
  }

  function buildTerminalTask(file, lineNumber, instruction) {
    const action = inferTerminalTaskAction(file, instruction);
    if (!action || !action.command) {
      return null;
    }

    return {
      file,
      line: lineNumber,
      severity: 'info',
      kind: 'terminal_task',
      message: 'Acao de terminal solicitada no comentario',
      suggestion: `Executar no terminal: ${action.description}`,
      action: {
        ...action,
        op: 'run_command',
        remove_trigger: true,
      },
    };
  }

  function checkCommentTask(lines, file) {
    const ext = analysisExtension(file);
    const issues = [];

    lines.forEach((line, idx) => {
      const match = matchCommentTask(line, ext);
      if (!match) {
        return;
      }

      const marker = match.marker;
      const instruction = normalizeCommentInstruction(match.instruction);
      if (!isActionableCommentTask(instruction)) {
        return;
      }

      if (marker === '*') {
        const terminalTask = buildTerminalTask(file, idx + 1, instruction);
        if (terminalTask) {
          issues.push(terminalTask);
        }
        return;
      }
      if (marker === '**') {
        issues.push(...buildContextBlueprintTasks(lines, file, idx + 1, instruction));
        return;
      }

      const generatedTask = normalizeGeneratedTaskResult(
        synthesizeFromCommentTask(instruction, ext, lines, file),
        ext,
      );
      if (!generatedTask.snippet) {
        return;
      }
      if (commentTaskAlreadyApplied(lines, idx, generatedTask, ext)) {
        return;
      }

      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'comment_task',
        message: 'Tarefa solicitada no comentario',
        suggestion: `Implementacao sugerida para: ${instruction}`,
        snippet: generatedTask.snippet,
      });

      issues.push(
        ...buildSnippetDependencyIssues(
          lines,
          file,
          idx + 1,
          generatedTask.snippet,
          instruction,
          ext,
          generatedTask.dependencies,
        ),
      );
    });

    return issues;
  }

  return {
    checkCommentTask,
  };
}

module.exports = {
  createCommentTaskTools,
};
