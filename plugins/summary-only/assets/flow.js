(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('flow-data').textContent);
  var app = document.getElementById('app');
  var isDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var STATUS = { added: 'Added', deleted: 'Deleted', modified: 'Modified' };
  var CLASSES = isDark
    ? [
        'classDef new fill:#12261e,stroke:#3fb950,stroke-width:2px,color:#e6edf3',
        'classDef changed fill:#2b2111,stroke:#d29922,stroke-width:2px,color:#e6edf3',
        'classDef removed fill:#2d1416,stroke:#f85149,stroke-width:2px,stroke-dasharray:5 4,color:#e6edf3'
      ]
    : [
        'classDef new fill:#dafbe1,stroke:#1a7f37,stroke-width:2px,color:#0d3b1e',
        'classDef changed fill:#fff8c5,stroke:#9a6700,stroke-width:2px,color:#3b2300',
        'classDef removed fill:#ffebe9,stroke:#cf222e,stroke-width:2px,stroke-dasharray:5 4,color:#5c0a0f'
      ];
  var zoom = data.diagrams.map(function () { return 0; });

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

  function withClasses(code) {
    return /^\s*(flowchart|graph)\b/.test(code) ? code + '\n' + CLASSES.join('\n') : code;
  }

  function diagramCard(diagram, i) {
    return '<section class="diagram" id="d-' + i + '">' +
      '<div class="diagram-head"><h2>' + esc(diagram.title) + '</h2>' +
      '<div class="tools">' +
      '<button class="btn" data-zoom="-1" data-i="' + i + '" aria-label="Zoom out">−</button>' +
      '<button class="btn" data-zoom="0" data-i="' + i + '">Fit</button>' +
      '<button class="btn" data-zoom="1" data-i="' + i + '" aria-label="Zoom in">+</button>' +
      '<button class="btn" data-download="' + i + '">Download SVG</button>' +
      '</div></div>' +
      (diagram.caption ? '<p class="caption">' + prose(diagram.caption) + '</p>' : '') +
      '<div class="canvas" id="c-' + i + '"><div class="loading">Rendering…</div></div>' +
      '<details id="s-' + i + '"><summary>Mermaid source</summary>' +
      '<button class="btn copy" data-copy="' + i + '">Copy</button>' +
      '<pre><code>' + esc(diagram.mermaid) + '</code></pre></details>' +
      '</section>';
  }

  function shell() {
    var when = new Date(data.generatedAt).toLocaleString();
    var legend =
      '<div class="legend">' +
      '<span><i class="swatch new"></i>New</span>' +
      '<span><i class="swatch changed"></i>Changed</span>' +
      '<span><i class="swatch removed"></i>Removed</span>' +
      '<span><i class="swatch existing"></i>Existing context</span>' +
      '</div>';
    var steps = data.steps.length === 0 ? '' :
      '<section class="review steps"><h2>Flow steps</h2><ol>' +
      data.steps.map(function (step) { return '<li>' + prose(step) + '</li>'; }).join('') +
      '</ol></section>';
    var files = data.files.length === 0 ? '' :
      '<section class="review files"><h2>Changed files</h2><ul>' +
      data.files.map(function (file) {
        return '<li><span class="badge ' + file.status + '">' + STATUS[file.status] + '</span> <code>' + esc(file.display) +
          '</code> <span class="plus">+' + file.added + '</span> <span class="minus">−' + file.removed + '</span></li>';
      }).join('') +
      '</ul></section>';

    app.innerHTML =
      '<header class="top"><div><h1>' + esc(data.title || 'Flow diagram') + '</h1><div class="meta">' +
      data.diagrams.length + (data.diagrams.length === 1 ? ' diagram · ' : ' diagrams · ') + data.files.length + (data.files.length === 1 ? ' file · ' : ' files · ') + esc(when) +
      (data.root ? ' · ' + esc(data.root) : '') + '</div></div>' + legend + '</header>' +
      '<main class="flow">' +
      (data.summary ? '<section class="review"><h2>Summary</h2><p>' + prose(data.summary) + '</p>' +
        '<p class="meta">The diagrams were drawn from the session\'s context; verify them before relying on them.</p></section>' : '') +
      (window.mermaid ? '' : '<div class="notice">The Mermaid library could not be loaded (it needs an internet connection). The diagram sources are below; you can also paste them into mermaid.live.</div>') +
      data.diagrams.map(diagramCard).join('') +
      steps + files +
      '</main>';
  }

  function svgOf(i) {
    return document.querySelector('#c-' + i + ' svg');
  }

  function naturalWidth(svg) {
    var box = svg.viewBox && svg.viewBox.baseVal;
    return box && box.width ? box.width : svg.getBoundingClientRect().width;
  }

  function applyZoom(i) {
    var svg = svgOf(i);
    if (!svg) return;
    if (zoom[i] === 0) {
      svg.style.width = '100%';
      svg.style.maxWidth = Math.round(naturalWidth(svg)) + 'px';
      svg.style.height = 'auto';
      return;
    }
    svg.style.maxWidth = 'none';
    svg.style.height = 'auto';
    svg.style.width = Math.round(naturalWidth(svg) * zoom[i]) + 'px';
  }

  function dropStray(id) {
    ['d' + id, id].forEach(function (stray) {
      var node = document.getElementById(stray);
      if (node && node.parentElement === document.body) node.remove();
    });
  }

  function renderOne(i) {
    var canvas = document.getElementById('c-' + i);
    var id = 'mermaid-' + i;
    var code = data.diagrams[i].mermaid;
    return window.mermaid.parse(code).then(function () {
      return window.mermaid.render(id, withClasses(code));
    }).then(function (result) {
      canvas.innerHTML = result.svg;
      applyZoom(i);
    }).catch(function (error) {
      dropStray(id);
      canvas.innerHTML = '<div class="notice">The diagram could not be drawn: ' + esc(error && error.message ? error.message : error) +
        '<br>Its source is open below; you can fix it and try it on mermaid.live.</div>';
      document.getElementById('s-' + i).open = true;
    });
  }

  function renderAll() {
    if (!window.mermaid) {
      data.diagrams.forEach(function (diagram, i) {
        document.getElementById('c-' + i).innerHTML = '';
        document.getElementById('s-' + i).open = true;
      });
      return;
    }
    window.mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'Segoe UI, system-ui, sans-serif',
      flowchart: { curve: 'basis', padding: 12 }
    });
    data.diagrams.reduce(function (chain, diagram, i) {
      return chain.then(function () { return renderOne(i); });
    }, Promise.resolve());
  }

  function download(i) {
    var svg = svgOf(i);
    if (!svg) return;
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    var blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = (data.diagrams[i].title || 'diagram').replace(/[^\p{L}\p{N}_-]+/gu, '-') + '.svg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function bind() {
    app.addEventListener('click', function (event) {
      var target = event.target.closest('button');
      if (!target) return;
      if (target.hasAttribute('data-zoom')) {
        var i = Number(target.getAttribute('data-i'));
        var step = Number(target.getAttribute('data-zoom'));
        var current = zoom[i] === 0 ? 1 : zoom[i];
        zoom[i] = step === 0 ? 0 : Math.min(4, Math.max(0.25, current * (step > 0 ? 1.25 : 0.8)));
        applyZoom(i);
      } else if (target.hasAttribute('data-download')) {
        download(Number(target.getAttribute('data-download')));
      } else if (target.hasAttribute('data-copy')) {
        var code = data.diagrams[Number(target.getAttribute('data-copy'))].mermaid;
        try {
          navigator.clipboard.writeText(code).then(function () {
            target.textContent = 'Copied';
            setTimeout(function () { target.textContent = 'Copy'; }, 1200);
          });
        } catch (err) {}
      }
    });
  }

  shell();
  bind();
  renderAll();
})();
