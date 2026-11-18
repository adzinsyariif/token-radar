// LaunchScope dashboard: renders window.RADAR (written by main.ts as data.js) with no network,
// no framework and no build step. Board mode is the radar; ?view=detail&slug=<slug> is a brief.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R || !app) return;

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    sel: params.get('sel') || '',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtUsd(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function fmtFull(n) { return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtPct(x) {
    if (x == null) return '<span class="flat">—</span>';
    var cls = x > 0.05 ? 'up' : x < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (x > 0 ? '+' : '') + x.toFixed(2) + '%</span>';
  }
  function fmtMult(x) { return x == null ? '—' : x.toFixed(2) + '×'; }
  function fmtAge(days) {
    if (days == null) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function chainsShort(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 2) return esc(chains.join(', '));
    return esc(chains.slice(0, 2).join(', ')) + ' +' + (chains.length - 2);
  }
  function badge(row) {
    return row.watchlist
      ? '<span class="badge wl">WATCHLIST</span>'
      : '<span class="badge early">EARLY</span>';
  }
  function bar(v, lo, hi, cls) {
    var pct = Math.max(3, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    return '<div class="fbar"><i class="' + (cls || '') + '" style="width:' + pct.toFixed(0) + '%"></i></div>';
  }
  function factorRows(row) {
    var peerNote = row.peer_count > 0 ? 'from ' + row.peer_count + ' launched peer' + (row.peer_count === 1 ? '' : 's') : 'global median — no launched peers';
    return (
      '<div class="fk"><span>Category multiple · ' + esc(row.category || 'Uncategorised') + ' (' + peerNote + ')</span><b>' + fmtMult(row.category_multiple) + '</b></div>' + bar(row.category_multiple, 0, 2.5, 'acc') +
      '<div class="fk"><span>Momentum · 7d TVL flow, damped</span><b>' + fmtMult(row.momentum_multiplier) + '</b></div>' + bar(row.momentum_multiplier, 0.7, 1.5) +
      '<div class="fk"><span>Maturity · age ' + fmtAge(row.age_days) + '</span><b>' + fmtMult(row.maturity_multiplier) + '</b></div>' + bar(row.maturity_multiplier, 0.5, 1.05) +
      '<div class="fk"><span>Breadth · ' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + '</span><b>' + fmtMult(row.breadth_multiplier) + '</b></div>' + bar(row.breadth_multiplier, 0.9, 1.3) +
      '<p class="formula">implied = TVL × multiple × momentum × maturity × breadth</p>'
    );
  }
  function figures(row) {
    return (
      '<div class="figures">' +
      '<div class="fig"><div class="k">TVL</div><div class="v">' + fmtUsd(row.tvl_usd) + '</div></div>' +
      '<div class="fig"><div class="k">7d change</div><div class="v">' + fmtPct(row.change_7d) + '</div></div>' +
      '<div class="fig"><div class="k">Tracked since</div><div class="v">' + esc(row.listed_at || '—') + '</div></div>' +
      '<div class="fig"><div class="k">Chains</div><div class="v">' + row.chains.length + '</div></div>' +
      '</div>'
    );
  }
  function stepsList(row) {
    return '<ol class="steps">' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  }

  // ---------- header + footer ----------
  document.getElementById('top-meta').innerHTML =
    'snapshot <b>' + esc(R.as_of) + '</b> · model <b>' + esc(R.model_version) + '</b><br>' + esc(R.source.replace(/^DefiLlama /, ''));
  document.getElementById('foot').innerHTML =
    '<b>LaunchScope</b> prices a launch the snapshot cannot see: implied values are model estimates built from the snapshot\'s own peer market, not predictions and not financial advice. ' +
    'A protocol listed here is one the snapshot records no token for — that is a statement about the data, not a promise that a token will ever exist. ' +
    'Data: ' + esc(R.source) + '.';

  function bySlug(slug) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i];
    return null;
  }

  // ---------- detail page ----------
  function renderDetail(slug) {
    var row = bySlug(slug) || R.rows[0];
    var peer = null;
    for (var i = 0; i < R.peers.length; i++) if (R.peers[i].category === row.category) peer = R.peers[i];
    var ratio = row.tvl_usd > 0 ? row.implied_value_usd / row.tvl_usd : 0;
    app.innerHTML =
      '<p class="crumb"><a href="index.html">← Back to the board</a></p>' +
      '<section class="hero"><div>' +
      '<h2>' + esc(row.name) + badge(row) + '</h2>' +
      '<p class="sub">#' + row.rank + ' of ' + R.board_size + ' · ' + esc(row.category || 'Uncategorised') + ' · ' + esc(row.chains.join(', ') || 'no chains recorded') + '<br>' +
      'The snapshot records no token for ' + esc(row.name) + '; this brief prices the launch it has not had.</p></div>' +
      '<div class="big"><div class="k">Implied launch value</div><div class="v">' + fmtUsd(row.implied_value_usd) + '</div>' +
      '<div class="s">' + fmtFull(row.implied_value_usd) + ' · ' + ratio.toFixed(2) + '× its TVL</div></div></section>' +
      '<div class="detail-grid">' +
      '<section class="card"><h2>Why this price</h2><div class="body">' + figures(row) +
      '<div class="factors">' + factorRows(row) + '</div>' +
      (peer
        ? '<p class="formula">Peer evidence: ' + peer.peers + ' launched ' + esc(peer.category) + ' protocol' + (peer.peers === 1 ? '' : 's') + ', raw median ' + fmtMult(peer.raw_median) + ', shrunk to ' + fmtMult(peer.multiple) + ' against the global median ' + fmtMult(R.global_multiple) + '.</p>'
        : '<p class="formula">No launched peers in this category: priced at the global median multiple ' + fmtMult(R.global_multiple) + '.</p>') +
      '</div></section>' +
      '<section class="card"><h2>Farm plan — positioning for a potential launch</h2><div class="body">' + stepsList(row) + '</div></section>' +
      '</div>';
    app.setAttribute('aria-busy', 'false');
  }

  // ---------- board page ----------
  function filtered() {
    var rows = R.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (state.sort === 'tvl') rows = rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    if (state.sort === 'change') rows = rows.slice().sort(function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); });
    return rows;
  }

  function detailPanel(row) {
    if (!row) return '<section class="card detail"><h2>Protocol brief</h2><div class="body"><p class="sub">No protocol matches the current filters.</p></div></section>';
    return (
      '<section class="card detail"><h2>Protocol brief <span class="hint">#' + row.rank + ' of ' + R.board_size + '</span></h2><div class="body">' +
      '<h3>' + esc(row.name) + badge(row) + '</h3>' +
      '<p class="sub">' + esc(row.category || 'Uncategorised') + ' · ' + esc(row.chains.join(', ') || '—') + '<br>The snapshot records no token for this protocol.</p>' +
      '<div class="impl-big"><div class="k">Implied launch value</div><div class="v">' + fmtUsd(row.implied_value_usd) + '</div></div>' +
      figures(row) +
      '<div class="factors">' + factorRows(row) + '</div>' +
      '<h2 style="border:0;padding:0 0 8px">Farm plan</h2>' + stepsList(row) +
      '<a class="brief-link" href="?view=detail&slug=' + encodeURIComponent(row.slug) + '">Open the full brief →</a>' +
      '</div></section>'
    );
  }

  function renderBoard() {
    var rows = filtered();
    var sel = bySlug(state.sel) || rows[0] || R.rows[0];
    if (sel && rows.indexOf(sel) === -1 && rows.length > 0) sel = rows[0];
    var totalImpl = R.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var cats = {};
    R.rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = (cats[r.category || 'Uncategorised'] || 0) + 1; });
    var catOpts = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    var chainCount = {};
    R.rows.forEach(function (r) { r.chains.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; }); });
    var chainOpts = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a]; });

    var stats =
      '<div class="stat"><div class="k">Protocols swept</div><div class="v">' + R.universe_size + '</div><div class="s">' + R.board_size + ' ranked · ' + R.live_size + ' shown already trading</div></div>' +
      '<div class="stat"><div class="k">Watchlist</div><div class="v"><em>' + R.watchlist_size + '</em></div><div class="s">at or above the ' + fmtUsd(R.floor_usd) + ' floor</div></div>' +
      '<div class="stat"><div class="k">Early finds</div><div class="v">' + R.early_size + '</div><div class="s">credible names below the floor</div></div>' +
      '<div class="stat"><div class="k">Board value</div><div class="v">' + fmtUsd(totalImpl) + '</div><div class="s">summed implied launch value</div></div>' +
      '<div class="stat"><div class="k">Global multiple</div><div class="v">' + fmtMult(R.global_multiple) + '</div><div class="s">median mcap/TVL · ' + R.peer_protocols + ' peers</div></div>';

    var controls =
      '<input type="search" id="f-q" placeholder="Search name or slug…" value="' + esc(state.q) + '">' +
      '<select id="f-cat"><option value="">All categories</option>' + catOpts.map(function (c) { return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + ' (' + cats[c] + ')</option>'; }).join('') + '</select>' +
      '<select id="f-chain"><option value="">All chains</option>' + chainOpts.map(function (c) { return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + ' (' + chainCount[c] + ')</option>'; }).join('') + '</select>' +
      '<select id="f-sort">' +
      '<option value="implied"' + (state.sort === 'implied' ? ' selected' : '') + '>Sort · implied value</option>' +
      '<option value="tvl"' + (state.sort === 'tvl' ? ' selected' : '') + '>Sort · TVL</option>' +
      '<option value="change"' + (state.sort === 'change' ? ' selected' : '') + '>Sort · 7d change</option></select>' +
      '<label class="toggle"><input type="checkbox" id="f-watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + R.board_size + ' rows</span>';

    var shown = rows.slice(0, 80);
    var body = shown.map(function (r) {
      var ratio = r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0;
      return (
        '<tr data-slug="' + esc(r.slug) + '" class="' + (sel && r.slug === sel.slug ? 'sel' : '') + (r.rank <= 3 ? ' top3' : '') + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badge(r) + '<br><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + chainsShort(r.chains) + '</td>' +
        '<td class="r val">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="r val">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="r impl">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="r"><span class="ratio"><span class="num" style="font-size:12px;color:var(--muted)">' + ratio.toFixed(2) + '×</span><span class="bar"><i style="width:' + Math.max(3, Math.min(100, (ratio / 2.5) * 100)).toFixed(0) + '%"></i></span></span></td>' +
        '</tr>'
      );
    }).join('');

    var peersTop = R.peers.slice(0, 14).map(function (p) {
      return '<tr><td>' + esc(p.category) + '</td><td class="r num">' + p.peers + '</td><td class="r num">' + fmtMult(p.raw_median) + '</td><td class="r num">' + fmtMult(p.multiple) + '</td></tr>';
    }).join('');
    var liveTop = R.live.slice(0, 10).map(function (p) {
      var m = p.mcap_usd && p.tvl_usd ? p.mcap_usd / p.tvl_usd : null;
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td><td class="r num">' + fmtUsd(p.mcap_usd) + '</td><td class="r num">' + fmtMult(m) + '</td></tr>';
    }).join('');

    app.innerHTML =
      '<section class="stats">' + stats + '</section>' +
      '<section class="controls">' + controls + '</section>' +
      '<div class="grid">' +
      '<section class="card"><h2>The board <span class="hint">ranked by implied launch value — click a row for its brief</span></h2>' +
      '<table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="r">TVL</th><th class="r">7d</th><th class="r">Implied value</th><th class="r">Impl / TVL</th></tr></thead><tbody>' + body + '</tbody></table>' +
      (rows.length > shown.length ? '<p class="more">Showing the top ' + shown.length + ' of ' + rows.length + ' matching rows — filter or search to narrow the sweep.</p>' : '') +
      '</section>' +
      detailPanel(sel) +
      '</div>' +
      '<div class="below">' +
      '<section class="card"><h2>How LaunchScope prices a launch</h2><div class="prose">' +
      '<div class="formula-box">implied = TVL × category multiple × momentum × maturity × breadth<br>multiple = median mcap/TVL of the category\'s launched peers, winsorised, shrunk to the global median</div>' +
      '<p><b>Priced from the market, not from a constant.</b> The snapshot\'s own launched protocols say what a dollar of TVL is worth in each category: lending peers trade near ' + fmtMult((R.peers.find(function (p) { return p.category === 'Lending'; }) || {}).multiple || R.global_multiple) + ' of TVL, DEX peers near ' + fmtMult((R.peers.find(function (p) { return p.category === 'Dexs'; }) || {}).multiple || R.global_multiple) + '. Each category\'s median is winsorised to [0.005×, 10×] and shrunk toward the global median by its peer count, so a category priced by one protocol leans on the whole market; a category with no launched peers prices at the global median ' + fmtMult(R.global_multiple) + '.</p>' +
      '<p><b>Then three adjustments, all printed per row.</b> Momentum damps the last 7 days of TVL flow (clamped to −50%…+100%, weight 0.4). Maturity pays for survival: a protocol tracked for three years prices at 1.00×, a brand-new one at 0.65×. Breadth adds 3% per extra chain, up to eight, for distribution a launch can reach.</p>' +
      '<p><b>Coverage is the watchlist plus the early radar.</b> All ' + R.watchlist_size + ' watchlist protocols are ranked, and below the ' + fmtUsd(R.floor_usd) + ' floor the board adds ' + R.early_size + ' more that pass the same product test the watchlist uses — no wrapped, staked or bridged products of another protocol, no exchanges, no versioned pools.</p>' +
      '</div></section>' +
      '<div>' +
      '<section class="card" style="margin-bottom:14px"><h2>Peer multiples — the evidence</h2><table class="mini"><thead><tr><th>Category</th><th class="r">Peers</th><th class="r">Raw median</th><th class="r">In force</th></tr></thead><tbody>' + peersTop + '</tbody></table></section>' +
      '<section class="card"><h2>Already launched — the peer set</h2><table class="mini"><thead><tr><th>Protocol</th><th>Category</th><th class="r">Market cap</th><th class="r">Mcap / TVL</th></tr></thead><tbody>' + liveTop + '</tbody></table></section>' +
      '</div></div>';
    app.setAttribute('aria-busy', 'false');

    // wire controls + row selection (re-render board region only by full render; state persists)
    document.getElementById('f-q').addEventListener('input', function (e) { state.q = e.target.value; rerender(false); });
    document.getElementById('f-cat').addEventListener('change', function (e) { state.cat = e.target.value; rerender(true); });
    document.getElementById('f-chain').addEventListener('change', function (e) { state.chain = e.target.value; rerender(true); });
    document.getElementById('f-sort').addEventListener('change', function (e) { state.sort = e.target.value; rerender(true); });
    document.getElementById('f-watch').addEventListener('change', function (e) { state.watch = e.target.checked; rerender(true); });
    wireRows();
  }

  function wireRows() {
    var trs = app.querySelectorAll('table.board tbody tr');
    trs.forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.sel = tr.getAttribute('data-slug');
        var rows = filtered();
        var sel = bySlug(state.sel);
        var panel = app.querySelector('.detail');
        if (panel && sel) {
          var wrap = document.createElement('div');
          wrap.innerHTML = detailPanel(sel);
          panel.replaceWith(wrap.firstChild);
        }
        trs.forEach(function (x) { x.classList.remove('sel'); });
        tr.classList.add('sel');
      });
    });
  }

  function rerender(refocus) {
    var q = document.getElementById('f-q');
    var pos = q ? q.selectionStart : 0;
    renderBoard();
    if (!refocus) {
      var nq = document.getElementById('f-q');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    }
  }

  if (params.get('view') === 'detail') renderDetail(params.get('slug') || '');
  else renderBoard();
})();
