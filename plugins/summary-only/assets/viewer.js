(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('diff-data').textContent);
  var app = document.getElementById('app');
  var STATUS = { added: 'Added', deleted: 'Deleted', modified: 'Modified' };
  var LETTER = { added: 'A', deleted: 'D', modified: 'M' };
  var KIND = { important: 'Important', risk: 'Risk', info: 'Info' };

  var prefs = load();
  var state = {
    view: prefs.view === 'split' ? 'split' : 'unified',
    context: prefs.context === undefined ? 3 : prefs.context,
    notes: prefs.notes !== false
  };
  var files = data.files.map(function (file, index) {
    var entry = { file: file, index: index, rows: toRows(file.ops), forced: {} };
    anchorNotes(entry);
    return entry;
  });
  var noteTotal = files.reduce(function (sum, entry) { return sum + (entry.file.notes || []).length; }, 0);

  function load() {
    try {
      return JSON.parse(localStorage.getItem('diff-html-prefs') || '{}');
    } catch (err) {
      return {};
    }
  }

  function save() {
    try {
      localStorage.setItem('diff-html-prefs', JSON.stringify({ view: state.view, context: state.context, notes: state.notes }));
    } catch (err) {}
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function prose(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function toRows(ops) {
    var rows = [];
    var a = 1;
    var b = 1;
    ops.forEach(function (op) {
      if (op[0] === '~') {
        rows.push({ t: '~', i: rows.length, count: op[1] });
        a += op[1];
        b += op[1];
        return;
      }
      op[1].forEach(function (text) {
        if (op[0] === '=') rows.push({ t: '=', i: rows.length, a: a++, b: b++, text: text });
        else if (op[0] === '-') rows.push({ t: '-', i: rows.length, a: a++, text: text });
        else rows.push({ t: '+', i: rows.length, b: b++, text: text });
      });
    });
    return rows;
  }

  function anchorNotes(entry) {
    entry.noteAt = {};
    entry.loose = [];
    (entry.file.notes || []).forEach(function (note) {
      var found = -1;
      for (var i = 0; i < entry.rows.length && found < 0; i++) {
        var row = entry.rows[i];
        var isOld = note.side === 'old' && (row.t === '=' || row.t === '-') && row.a === note.line;
        var isNew = note.side !== 'old' && (row.t === '=' || row.t === '+') && row.b === note.line;
        if (isOld || isNew) found = i;
      }
      if (found < 0) entry.loose.push(note);
      else (entry.noteAt[found] = entry.noteAt[found] || []).push(note);
    });
  }

  function isChange(row) {
    return row.t === '-' || row.t === '+';
  }

  function isAnchor(entry, i) {
    return isChange(entry.rows[i]) || (state.notes && entry.noteAt[i] !== undefined);
  }

  function visibility(entry) {
    var rows = entry.rows;
    var ctx = state.context < 0 ? Infinity : state.context;
    var vis = new Array(rows.length);
    var last = -Infinity;
    var i;
    for (i = 0; i < rows.length; i++) {
      if (isAnchor(entry, i)) last = i;
      vis[i] = rows[i].t === '~' || i - last <= ctx || entry.forced[i] === true;
    }
    var next = Infinity;
    for (i = rows.length - 1; i >= 0; i--) {
      if (isAnchor(entry, i)) next = i;
      if (next - i <= ctx) vis[i] = true;
    }
    return vis;
  }

  function segments(entry) {
    var rows = entry.rows;
    var vis = visibility(entry);
    var out = [];
    var i = 0;
    while (i < rows.length) {
      if (!vis[i]) {
        var start = i;
        while (i < rows.length && !vis[i]) i++;
        out.push({ gap: true, start: start, end: i });
        continue;
      }
      if (rows[i].t === '~') {
        out.push({ skip: rows[i].count });
        i++;
        continue;
      }
      if (rows[i].t === '=') {
        out.push({ eq: rows[i] });
        i++;
        continue;
      }
      var dels = [];
      var adds = [];
      while (i < rows.length && vis[i] && isChange(rows[i])) {
        if (rows[i].t === '-') dels.push(rows[i]);
        else adds.push(rows[i]);
        i++;
      }
      out.push({ dels: dels, adds: adds });
    }
    return out;
  }

  function wrap(text, from, to, cls) {
    if (from >= to) return esc(text);
    return esc(text.slice(0, from)) + '<span class="' + cls + '">' + esc(text.slice(from, to)) + '</span>' + esc(text.slice(to));
  }

  function pairHighlight(oldText, newText) {
    var max = Math.min(oldText.length, newText.length);
    var p = 0;
    while (p < max && oldText.charAt(p) === newText.charAt(p)) p++;
    var s = 0;
    while (s < max - p && oldText.charAt(oldText.length - 1 - s) === newText.charAt(newText.length - 1 - s)) s++;
    if (p + s === 0) return [esc(oldText), esc(newText)];
    return [
      wrap(oldText, p, oldText.length - s, 'hl-del'),
      wrap(newText, p, newText.length - s, 'hl-add')
    ];
  }

  function changeHtml(seg) {
    var delHtml = seg.dels.map(function (row) { return esc(row.text); });
    var addHtml = seg.adds.map(function (row) { return esc(row.text); });
    var pairs = Math.min(seg.dels.length, seg.adds.length);
    for (var i = 0; i < pairs; i++) {
      var pair = pairHighlight(seg.dels[i].text, seg.adds[i].text);
      delHtml[i] = pair[0];
      addHtml[i] = pair[1];
    }
    return { dels: delHtml, adds: addHtml };
  }

  function noteCard(note) {
    var kind = KIND[note.kind] ? note.kind : 'info';
    var where = note.line > 0 ? '<span class="note-line">' + (note.side === 'old' ? 'old ' : '') + 'line ' + note.line + '</span>' : '';
    return '<div class="note ' + kind + '"><span class="note-kind">' + KIND[kind] + '</span>' + where +
      '<span class="note-text">' + prose(note.text) + '</span></div>';
  }

  function noteRows(entry, rows, cols) {
    if (!state.notes) return '';
    var cards = [];
    rows.forEach(function (row) {
      if (row && entry.noteAt[row.i]) cards = cards.concat(entry.noteAt[row.i].map(noteCard));
    });
    return cards.length === 0 ? '' : '<tr class="note-row"><td colspan="' + cols + '">' + cards.join('') + '</td></tr>';
  }

  function gapRow(seg, cols) {
    if (seg.skip !== undefined) {
      return '<tr class="gap skip"><td colspan="' + cols + '">⋯ ' + seg.skip +
        (seg.skip === 1 ? ' unchanged line' : ' unchanged lines') + ' left out to keep the report small</td></tr>';
    }
    var count = seg.end - seg.start;
    return '<tr class="gap" data-start="' + seg.start + '" data-end="' + seg.end + '"><td colspan="' + cols + '">⋯ ' +
      count + (count === 1 ? ' unchanged line' : ' unchanged lines') + ' hidden · click to show</td></tr>';
  }

  function unifiedTable(entry) {
    var html = ['<table class="diff"><colgroup><col class="num"><col class="num"><col class="sign"><col></colgroup><tbody>'];
    segments(entry).forEach(function (seg) {
      if (seg.gap || seg.skip !== undefined) {
        html.push(gapRow(seg, 4));
      } else if (seg.eq) {
        html.push('<tr><td class="num">' + seg.eq.a + '</td><td class="num">' + seg.eq.b +
          '</td><td class="sign"></td><td class="code">' + esc(seg.eq.text) + '</td></tr>');
        html.push(noteRows(entry, [seg.eq], 4));
      } else {
        var parts = changeHtml(seg);
        seg.dels.forEach(function (row, i) {
          html.push('<tr class="del"><td class="num">' + row.a + '</td><td class="num"></td><td class="sign">-</td><td class="code">' +
            parts.dels[i] + '</td></tr>');
          html.push(noteRows(entry, [row], 4));
        });
        seg.adds.forEach(function (row, i) {
          html.push('<tr class="add"><td class="num"></td><td class="num">' + row.b + '</td><td class="sign">+</td><td class="code">' +
            parts.adds[i] + '</td></tr>');
          html.push(noteRows(entry, [row], 4));
        });
      }
    });
    html.push('</tbody></table>');
    return html.join('');
  }

  function splitTable(entry) {
    var html = ['<table class="diff"><colgroup><col class="num"><col><col class="num"><col></colgroup><tbody>'];
    segments(entry).forEach(function (seg) {
      if (seg.gap || seg.skip !== undefined) {
        html.push(gapRow(seg, 4));
      } else if (seg.eq) {
        var code = esc(seg.eq.text);
        html.push('<tr><td class="num">' + seg.eq.a + '</td><td class="code split-left">' + code +
          '</td><td class="num">' + seg.eq.b + '</td><td class="code">' + code + '</td></tr>');
        html.push(noteRows(entry, [seg.eq], 4));
      } else {
        var parts = changeHtml(seg);
        var count = Math.max(seg.dels.length, seg.adds.length);
        for (var i = 0; i < count; i++) {
          var del = seg.dels[i];
          var add = seg.adds[i];
          var left = del
            ? '<td class="num del">' + del.a + '</td><td class="code del split-left">' + parts.dels[i] + '</td>'
            : '<td class="num empty"></td><td class="code empty split-left"></td>';
          var right = add
            ? '<td class="num add">' + add.b + '</td><td class="code add">' + parts.adds[i] + '</td>'
            : '<td class="num empty"></td><td class="code empty"></td>';
          html.push('<tr>' + left + right + '</tr>');
          html.push(noteRows(entry, [del, add], 4));
        }
      }
    });
    html.push('</tbody></table>');
    return html.join('');
  }

  function splitPath(display) {
    var cut = Math.max(display.lastIndexOf('/'), display.lastIndexOf('\\'));
    return { dir: display.slice(0, cut + 1), name: display.slice(cut + 1) };
  }

  function counts(file) {
    return '<span class="plus">+' + file.added + '</span> <span class="minus">−' + file.removed + '</span>';
  }

  function noteChip(file) {
    var count = (file.notes || []).length;
    return count === 0 ? '' : '<span class="note-chip" title="' + count + (count === 1 ? ' note' : ' notes') + '">💬 ' + count + '</span>';
  }

  function renderIntro(entry) {
    var intro = document.querySelector('#f-' + entry.index + ' .file-intro');
    if (!intro) return;
    var parts = [];
    if (entry.file.summary) parts.push('<p class="file-summary">' + prose(entry.file.summary) + '</p>');
    if (state.notes && entry.loose.length > 0) parts.push(entry.loose.map(noteCard).join(''));
    intro.innerHTML = parts.join('');
    intro.classList.toggle('hidden', parts.length === 0);
  }

  function renderBody(entry) {
    var body = document.querySelector('#f-' + entry.index + ' .file-body');
    if (!body) return;
    body.innerHTML = entry.rows.length === 0
      ? '<div class="empty-state">Empty file</div>'
      : state.view === 'split' ? splitTable(entry) : unifiedTable(entry);
  }

  function renderAll() {
    files.forEach(function (entry) {
      renderIntro(entry);
      renderBody(entry);
    });
    document.querySelectorAll('[data-view]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-view') === state.view));
    });
  }

  function reviewPanel() {
    var parts = [];
    if (data.summary) {
      parts.push('<section class="review"><h2>Summary</h2><p>' + prose(data.summary) + '</p>' +
        (noteTotal > 0 ? '<p class="meta">' + noteTotal + (noteTotal === 1 ? ' note' : ' notes') + ' under the diff lines. They were written from the session\'s context; verify them before relying on them.</p>' : '') +
        '</section>');
    }
    if (data.notice) parts.push('<div class="notice">' + esc(data.notice) + '</div>');
    return parts.join('');
  }

  function shell() {
    var added = 0;
    var removed = 0;
    data.files.forEach(function (file) {
      added += file.added;
      removed += file.removed;
    });
    var when = new Date(data.generatedAt).toLocaleString();

    var nav = files.map(function (entry) {
      var file = entry.file;
      return '<li data-filter="' + esc(file.display.toLowerCase()) + '"><a href="#f-' + entry.index + '" title="' + esc(file.path) + '">' +
        '<span class="dot ' + file.status + '">' + LETTER[file.status] + '</span>' +
        '<span class="name">' + esc(file.display) + '</span>' +
        noteChip(file) +
        '<span class="counts">' + counts(file) + '</span></a></li>';
    }).join('');

    var sections = files.map(function (entry) {
      var file = entry.file;
      var parts = splitPath(file.display);
      var eol = file.isEolChanged ? '<span class="badge note-badge">Line endings changed (CRLF ↔ LF)</span>' : '';
      return '<section class="file" id="f-' + entry.index + '" data-filter="' + esc(file.display.toLowerCase()) + '">' +
        '<div class="file-head">' +
        '<button class="toggle" data-toggle="' + entry.index + '" aria-label="Collapse or expand">▾</button>' +
        '<span class="badge ' + file.status + '">' + STATUS[file.status] + '</span>' +
        '<span class="path" title="' + esc(file.path) + '"><span class="dir">' + esc(parts.dir) + '</span><b>' + esc(parts.name) + '</b></span>' +
        eol + noteChip(file) +
        '<span class="counts">' + counts(file) + '</span>' +
        '<button class="btn" data-copy="' + entry.index + '">Copy path</button>' +
        '</div><div class="file-intro hidden"></div><div class="file-body"></div></section>';
    }).join('');

    var contextOptions = [[3, '3 lines'], [10, '10 lines'], [-1, 'Whole file']].map(function (option) {
      return '<option value="' + option[0] + '"' + (option[0] === state.context ? ' selected' : '') + '>' + option[1] + '</option>';
    }).join('');

    var notesToggle = noteTotal > 0
      ? '<label class="meta toggle-notes"><input type="checkbox" id="notes"' + (state.notes ? ' checked' : '') + '> Notes</label>'
      : '';

    app.innerHTML =
      '<header class="top"><div><h1>Changes</h1><div class="meta">' + files.length + (files.length === 1 ? ' file · ' : ' files · ') +
      '<span class="plus">+' + added + '</span> <span class="minus">−' + removed + '</span> · ' + esc(when) +
      (data.root ? ' · ' + esc(data.root) : '') +
      (data.isTrimmed ? ' · <b>long unchanged stretches were left out of the report</b>' : '') + '</div></div>' +
      '<div class="controls">' + notesToggle +
      '<div class="seg" role="group" aria-label="View"><button data-view="unified">Unified</button><button data-view="split">Split</button></div>' +
      '<label class="meta">Context <select id="context">' + contextOptions + '</select></label>' +
      '<button class="btn" id="collapse">Collapse all</button>' +
      '<button class="btn" id="expand">Expand all</button>' +
      '</div></header>' +
      (files.length === 0
        ? '<div class="empty-state">No changes.</div>'
        : '<div class="layout"><nav class="sidebar"><input id="filter" type="search" placeholder="Filter files…"><ul>' + nav + '</ul></nav>' +
          '<main>' + reviewPanel() + sections + '</main></div>');
  }

  function bind() {
    app.addEventListener('click', function (event) {
      var target = event.target.closest('button, tr.gap:not(.skip)');
      if (!target) return;

      if (target.hasAttribute('data-view')) {
        state.view = target.getAttribute('data-view');
        save();
        renderAll();
      } else if (target.hasAttribute('data-toggle')) {
        var section = document.getElementById('f-' + target.getAttribute('data-toggle'));
        section.classList.toggle('collapsed');
        target.textContent = section.classList.contains('collapsed') ? '▸' : '▾';
      } else if (target.hasAttribute('data-copy')) {
        var file = files[Number(target.getAttribute('data-copy'))].file;
        try {
          navigator.clipboard.writeText(file.path).then(function () {
            target.textContent = 'Copied';
            setTimeout(function () { target.textContent = 'Copy path'; }, 1200);
          });
        } catch (err) {}
      } else if (target.id === 'collapse' || target.id === 'expand') {
        var collapse = target.id === 'collapse';
        document.querySelectorAll('.file').forEach(function (section) {
          section.classList.toggle('collapsed', collapse);
          var toggle = section.querySelector('.toggle');
          if (toggle) toggle.textContent = collapse ? '▸' : '▾';
        });
      } else if (target.classList.contains('gap')) {
        var entry = files[Number(target.closest('.file').id.slice(2))];
        var start = Number(target.getAttribute('data-start'));
        var end = Number(target.getAttribute('data-end'));
        for (var i = start; i < end; i++) entry.forced[i] = true;
        renderBody(entry);
      }
    });

    var context = document.getElementById('context');
    context.addEventListener('change', function () {
      state.context = Number(context.value);
      files.forEach(function (entry) { entry.forced = {}; });
      save();
      renderAll();
    });

    var notes = document.getElementById('notes');
    if (notes) {
      notes.addEventListener('change', function () {
        state.notes = notes.checked;
        save();
        renderAll();
      });
    }

    var filter = document.getElementById('filter');
    if (filter) {
      filter.addEventListener('input', function () {
        var query = filter.value.trim().toLowerCase();
        document.querySelectorAll('[data-filter]').forEach(function (node) {
          node.classList.toggle('hidden', query !== '' && node.getAttribute('data-filter').indexOf(query) < 0);
        });
      });
    }
  }

  function measureTop() {
    var top = document.querySelector('.top');
    if (top) document.documentElement.style.setProperty('--top', top.offsetHeight + 'px');
  }

  shell();
  bind();
  renderAll();
  measureTop();
  window.addEventListener('resize', measureTop);
})();
