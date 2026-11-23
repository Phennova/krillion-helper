// Krillion Helper: watches the page for the current prompt and shows answers
// in a floating panel that never takes keyboard focus away from the game.
(() => {
  'use strict';
  if (window.__krillionHelper) return;
  window.__krillionHelper = true;

  // Where Krillion puts things (from its own page code):
  //  - the live prompt is `.ds-card .prompt` in every mode
  //  - party mode shows a placeholder card (.pf-newcat) and marks finished
  //    cards .cleared / .gone
  //  - answers already said in a party round sit in `.pf-say.rest` chips
  const PROMPT_SEL = '.ds-card:not(.pf-newcat):not(.cleared):not(.gone) .prompt';
  const USED_SEL = '.pf-say.rest';

  const state = {
    question: '',
    answers: [],
    used: new Set(),
    tried: new Set(),  // answers the auto-typer submitted that didn't work
    current: '',       // answer the auto-typer submitted last
    typing: false,
    status: 'waiting for a question…',
    loading: false,
    sort: 'easy',   // 'easy' | 'rare'
    side: 'right',  // 'right' | 'left'
    collapsed: false,
  };

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  // Lower = easier to type. Plain letters are cheap; spaces, digits,
  // punctuation and accents cost more.
  function typeCost(text) {
    let cost = 0;
    for (const ch of text) {
      if (/[a-z]/.test(ch)) cost += 1;
      else if (ch === ' ') cost += 1.3;
      else if (/[0-9]/.test(ch)) cost += 1.6;
      else if (ch.charCodeAt(0) > 127) cost += 3;
      else cost += 2.2;
    }
    return cost;
  }

  // ---------- panel ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .panel{position:fixed;top:72px;width:250px;max-height:calc(100vh - 96px);display:flex;flex-direction:column;
        background:rgba(6,12,24,.94);color:#e6f1ff;border:1px solid #2b4a78;border-radius:10px;
        font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 8px 28px rgba(0,0,0,.55);
        user-select:none;-webkit-user-select:none;overflow:hidden}
      .panel.right{right:10px}.panel.left{left:10px}
      .bar{display:flex;align-items:center;gap:6px;padding:7px 9px;background:#0d1c36;border-bottom:1px solid #2b4a78}
      .bar b{flex:1;font-size:11px;letter-spacing:.12em;color:#7fd6ff}
      button{all:unset;cursor:pointer;padding:2px 7px;border:1px solid #2b4a78;border-radius:5px;font:11px ui-monospace,Menlo,monospace;color:#b9d2f5}
      button:hover{background:#17305a}
      .q{padding:8px 10px 6px;font-size:13px;color:#fff;border-bottom:1px solid #18294a;word-break:break-word}
      .status{padding:3px 10px 6px;font-size:10px;color:#7f97bd}
      .status.err{color:#ff8f8f}
      ol{list-style:none;margin:0;padding:2px 0 8px;overflow-y:auto}
      li{display:flex;align-items:center;gap:8px;padding:3px 10px;font-size:15px}
      li:nth-child(-n+3){font-size:17px;color:#fff}
      li span.t{flex:1;word-break:break-word}
      li i{font-style:normal;font-size:9px;letter-spacing:1px;color:#48638f}
      li i.r3{color:#5fd0a0}li i.r4{color:#f0c060}li i.r5{color:#ff8ad0}
      li.used{opacity:.35;text-decoration:line-through}
      li.tried{opacity:.45;text-decoration:line-through;color:#ff8f8f}
      li.cur{background:#17305a;color:#fff}
      .auto{display:flex;gap:6px;padding:7px 9px;border-bottom:1px solid #18294a}
      .auto button{flex:1;text-align:center;padding:6px 4px;font-size:12px;color:#fff}
      .auto .go{background:#1d4f8f;border-color:#3a7bd0}
      .auto .ok{background:#1c6b4a;border-color:#38a877}
      .collapsed .q,.collapsed .status,.collapsed ol,.collapsed .auto{display:none}
      .collapsed{width:auto}
    </style>
    <div class="panel right">
      <div class="bar"><b>KRILL HELPER</b>
        <button data-act="sort" title="Switch sort order"></button>
        <button data-act="side" title="Move to the other side">⇄</button>
        <button data-act="collapse" title="Hide / show">–</button>
      </div>
      <div class="q"></div>
      <div class="auto">
        <button class="go" data-act="next"></button>
        <button class="ok" data-act="worked">worked ✓</button>
      </div>
      <div class="status"></div><ol></ol>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const panel = $('.panel');

  // Clicking the panel must never pull focus out of the game's answer box.
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    if (act === 'next') return typeNext();
    if (act === 'worked') return markWorked();
    if (act === 'sort') state.sort = state.sort === 'easy' ? 'rare' : 'easy';
    if (act === 'side') state.side = state.side === 'right' ? 'left' : 'right';
    if (act === 'collapse') state.collapsed = !state.collapsed;
    chrome.storage?.local.set({ kh: { sort: state.sort, side: state.side, collapsed: state.collapsed } });
    render();
  });

  // Answers in display order: live ones first, then tried/used at the bottom.
  function sortedRows() {
    const rows = state.answers.map((a) => {
      const key = norm(a.text);
      return { ...a, cost: typeCost(a.text), used: state.used.has(key), tried: state.tried.has(key) && a.text !== state.current };
    });
    rows.sort((a, b) =>
      ((a.used || a.tried) - (b.used || b.tried)) ||
      (!!b.known - !!a.known) || // answers Krillion has accepted before go first
      (state.sort === 'rare' ? b.rarity - a.rarity : 0) ||
      (a.cost - b.cost) || a.text.localeCompare(b.text));
    return rows;
  }

  // ---------- auto-typer ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

  // The game's box is a React input: set the value through the native setter
  // and fire an input event so the game sees it as typing.
  function setValue(input, value, data) {
    setNative.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data, inputType: data ? 'insertText' : 'deleteContentBackward' }));
  }

  async function typeNext() {
    if (state.typing) return;
    const input = document.querySelector('input[aria-label="Your answer"]');
    if (!input || input.disabled) { state.status = 'no answer box right now'; state.error = true; return render(); }
    readUsed();
    // Whatever we submitted last didn't work, or we wouldn't be here.
    if (state.current) state.tried.add(norm(state.current));
    const next = sortedRows().find((r) => !r.used && !state.tried.has(norm(r.text)));
    if (!next) { state.current = ''; state.status = 'out of answers'; state.error = true; return render(); }

    state.typing = true;
    state.current = next.text;
    state.error = false;
    state.status = `typing “${next.text}”…`;
    render();
    const question = state.question;
    input.focus();
    setValue(input, '', null);
    for (let i = 1; i <= next.text.length; i++) {
      if (state.question !== question) break; // category changed mid-word
      setValue(input, next.text.slice(0, i), next.text[i - 1]);
      await sleep(22);
    }
    await sleep(60); // let the game pick up the final value
    if (state.question === question) {
      if (input.form) input.form.requestSubmit();
      else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      state.status = `sent “${next.text}”. worked?`;
    }
    state.typing = false;
    render();
  }

  function markWorked() {
    if (!state.current) return;
    state.used.add(norm(state.current));
    learnAccepted(state.current, 0);
    state.status = `“${state.current}” locked in`;
    state.current = '';
    render();
  }

  function render() {
    panel.className = `panel ${state.side}${state.collapsed ? ' collapsed' : ''}`;
    $('[data-act=next]').textContent = state.current ? 'try again ↻' : 'type answer ▶';
    $('[data-act=sort]').textContent = state.sort === 'easy' ? 'easy first' : 'rare first';
    $('[data-act=collapse]').textContent = state.collapsed ? '+' : '–';
    $('.q').textContent = state.question || '—';
    const st = $('.status');
    st.textContent = state.status;
    st.className = 'status' + (state.error ? ' err' : '');

    const rows = sortedRows();
    const ol = $('ol');
    ol.textContent = '';
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = r.text === state.current ? 'cur' : r.used ? 'used' : r.tried ? 'tried' : '';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = r.text + (r.known ? ' ✓' : '');
      if (r.known) t.title = 'Krillion has accepted this before';
      const pip = document.createElement('i');
      pip.className = `r${r.rarity}`;
      pip.textContent = '●'.repeat(r.rarity);
      pip.title = `rarity ${r.rarity}/5`;
      li.append(t, pip);
      ol.append(li);
    }
  }

  // ---------- question detection ----------
  function readQuestion() {
    const nodes = document.querySelectorAll(PROMPT_SEL);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const text = nodes[i].textContent.replace(/\s+/g, ' ').trim();
      if (text && text.toLowerCase() !== 'new category') return text;
    }
    return '';
  }

  // ---------- learning from the game's own verdicts ----------
  const TIER_RARITY = { plankton: 1, tooclever: 1, schooler: 2, rare: 3, deepcut: 4, krillion: 5 };
  const tierOf = (el, prop) => TIER_RARITY[(el.style.getPropertyValue(prop).match(/--tier-([a-z]+)/) || [])[1]] || 0;
  const seenEls = new WeakSet();
  const stale = new WeakMap(); // seat chip -> text it showed when the category changed
  let learnedKeys = new Set();
  let queue = { accepted: [], rejected: [] };
  let flushTimer = null;

  function flushLearned() {
    flushTimer = null;
    if (!state.question || (!queue.accepted.length && !queue.rejected.length)) return;
    chrome.runtime.sendMessage({ type: 'learn', question: state.question, ...queue }, () => void chrome.runtime.lastError);
    queue = { accepted: [], rejected: [] };
  }

  function learnAccepted(text, rarity) {
    const key = norm(text);
    if (!key || learnedKeys.has('a:' + key)) return false;
    learnedKeys.add('a:' + key);
    queue.accepted.push({ text, rarity });
    const row = state.answers.find((a) => norm(a.text) === key);
    if (row) { row.known = true; if (rarity) row.rarity = rarity; }
    else state.answers.push({ text, rarity: rarity || 3, known: true });
    flushTimer ||= setTimeout(flushLearned, 400);
    return true;
  }

  function learnRejected(text) {
    const key = norm(text);
    if (!key || learnedKeys.has('a:' + key) || learnedKeys.has('r:' + key)) return false;
    learnedKeys.add('r:' + key);
    queue.rejected.push(text);
    state.tried.add(key);
    flushTimer ||= setTimeout(flushLearned, 400);
    return true;
  }

  // Reads what the game is showing: answers it accepted (from anyone at the
  // table), and why it bounced ours. Returns true if the panel needs redrawing.
  function readUsed() {
    let changed = false;
    // Party: accepted answers sit on each player's seat, coloured by tier.
    for (const el of document.querySelectorAll('.pf-say.ok, ' + USED_SEL)) {
      const text = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      const key = norm(text);
      if (!key || stale.get(el) === text) continue; // left over from the last category
      if (!state.used.has(key)) { state.used.add(key); changed = true; }
      if (learnAccepted(text, tierOf(el, '--cc'))) changed = true;
    }
    // Solo: the result card for the round that just landed.
    for (const el of document.querySelectorAll('.ds-landed:not(.miss)')) {
      if (seenEls.has(el)) continue;
      seenEls.add(el);
      const text = (el.querySelector('.tans')?.textContent || '').replace(/[“”"]/g, '').trim().toLowerCase();
      if (text && text !== '—' && learnAccepted(text, tierOf(el, '--tc'))) changed = true;
    }
    // Our own bounced answer. "already said" means it was valid, just taken.
    for (const el of document.querySelectorAll('.ds-reject')) {
      if (seenEls.has(el)) continue;
      seenEls.add(el);
      const msg = el.textContent;
      if (/signal lost/i.test(msg)) continue;
      const quoted = (msg.match(/“(.+?)”/) || [])[1];
      const text = (quoted || document.querySelector('input[aria-label="Your answer"]')?.value || '').trim().toLowerCase();
      if (!text) continue;
      if (/already said/i.test(msg)) { state.used.add(norm(text)); changed = true; }
      else if (learnRejected(text)) changed = true;
    }
    return changed;
  }

  function fetchAnswers(question) {
    clearTimeout(flushTimer);
    flushLearned(); // send anything learned for the previous question first
    learnedKeys = new Set();
    // Chips still showing answers from the previous category don't count here.
    for (const el of document.querySelectorAll('.pf-say')) stale.set(el, el.textContent.replace(/\s+/g, ' ').trim().toLowerCase());
    state.question = question;
    state.answers = [];
    state.used = new Set();
    state.tried = new Set();
    state.current = '';
    state.error = false;
    state.loading = true;
    state.status = 'asking claude…';
    render();
    const started = performance.now();
    chrome.runtime.sendMessage({ type: 'answers', question }, (res) => {
      if (state.question !== question) return; // a newer question took over
      state.loading = false;
      if (chrome.runtime.lastError || !res || res.error) {
        state.error = true;
        state.status = res?.error || 'Extension was reloaded. Refresh this page.';
      } else {
        // Keep anything learned from the table while Claude was still thinking.
        const fresh = res.answers || [];
        const have = new Set(fresh.map((a) => norm(a.text)));
        state.answers = fresh.concat(state.answers.filter((a) => !have.has(norm(a.text))));
        for (const a of fresh) if (a.known) learnedKeys.add('a:' + norm(a.text));
        const secs = ((performance.now() - started) / 1000).toFixed(1);
        state.status = `${state.answers.length} answers · ${res.cached ? 'cached' : secs + 's'}`;
      }
      readUsed();
      render();
    });
  }

  function tick() {
    const q = readQuestion();
    if (q && q !== state.question) return fetchAnswers(q);
    if (state.question && readUsed()) render();
  }

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; tick(); }, 60);
  };

  function start() {
    document.documentElement.append(host);
    render();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    setInterval(tick, 1000); // safety net
    tick();
  }

  if (chrome.storage?.local) {
    chrome.storage.local.get('kh', ({ kh }) => { Object.assign(state, kh || {}); start(); });
  } else start();
})();
