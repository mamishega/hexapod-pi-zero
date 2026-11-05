// Follow-the-teacher mode, lesson cards and quick questions (the page side).
// The teacher logs in with the code from the Pi's service log, then leads: every student device
// follows to the same page, camera view and lesson step. Answers are anonymous. Nothing here can move
// the robot.
import {LESSONS, lessonById} from './lessons.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch {} },
  del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch {} },
};
function clientId() {
  let id = store.get('hexapod-client');
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id || '')) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); store.set('hexapod-client', id); }
  return id;
}
const postJSON = (url, body, token) => fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {'X-Teacher-Token': token} : {})}, body: JSON.stringify(body)});

export function createClassroomUI({$, showPage, setView, current}) {
  let follow = null, tally = null, token = store.get('hexapod-teacher', true), following = true, applying = false, myAnswer = {};
  // This device is the one leading (remembered for this tab, so a reload does not turn the teacher into a follower).
  let leader = store.get('hexapod-leading', true) === '1';
  const lead = on => { leader = on; if (on) store.set('hexapod-leading', '1', true); else store.del('hexapod-leading', true); };
  const step = () => { const l = lessonById(follow?.lesson); return l ? {lesson: l, index: follow.step, step: l.steps[follow.step]} : null; };

  // ---------------------------------------------------------------- teacher dialog
  const dialog = $('teach');
  function renderDialog() {
    const body = $('teach-body');
    if (!token) {
      body.innerHTML = `<p class="caption">Lead the class: every device follows your page, camera view and lesson. The teacher code is in the robot’s service log: run <code>journalctl -u hexapod-drive | grep "teacher code"</code> on the Pi.</p>
        <form id="teach-form" class="teach-form"><label>Teacher code <input id="teach-code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required></label><button class="primary" type="submit">Start</button></form><p class="teach-error" id="teach-error" hidden></p>`;
      $('teach-form').addEventListener('submit', async e => {
        e.preventDefault();
        const res = await postJSON('teacher/login', {code: $('teach-code').value.trim()}).catch(() => null);
        if (!res?.ok) { $('teach-error').hidden = false; $('teach-error').textContent = res?.status === 429 ? 'Too many tries: wait a few seconds.' : 'That code is not right.'; return; }
        token = (await res.json()).token; store.set('hexapod-teacher', token, true); renderDialog();
      });
      return;
    }
    const active = !!follow?.active && leader;
    body.innerHTML = `<div class="teach-row"><div><b>${active ? 'You are leading the class' : 'Not leading'}</b><p class="caption">${active ? 'Students follow your page, view and lesson step.' : 'Start leading to bring every device to your page.'}</p></div>
        <button class="${active ? '' : 'primary'}" type="button" id="teach-lead">${active ? 'Stop leading' : 'Start leading'}</button></div>
      <label class="teach-lesson">Lesson <select id="teach-select"><option value="">No lesson: just follow my page</option>${LESSONS.map(l => `<option value="${l.id}"${follow?.lesson === l.id ? ' selected' : ''}>${esc(l.title)} (${l.steps.length} steps)</option>`).join('')}</select></label>
      <p class="caption">Tip: the lesson card has <b>Back</b>, <b>Next</b> and <b>Show answer</b>. Put this screen on the projector: the class results appear on it.</p>
      <button class="link" type="button" id="teach-logout">Log out of teaching on this device</button>`;
    $('teach-lead').addEventListener('click', () => { lead(!active); send({active: !active, ...here()}); });
    $('teach-select').addEventListener('change', e => { lead(true); send({active: true, lesson: e.target.value || null, step: 0, question: null, ...lessonView(e.target.value, 0)}); });
    $('teach-logout').addEventListener('click', () => { if (active) send({active: false}); token = null; lead(false); store.del('hexapod-teacher', true); renderDialog(); });
  }
  const here = () => ({page: current().page, view: current().view});
  const lessonView = (id, i) => { const s = lessonById(id)?.steps[i]; return s ? {page: s.page, ...(s.view ? {view: s.view} : {}), question: s.question?.id ?? null} : {question: null}; };
  async function send(patch) {
    const res = await postJSON('teacher/follow', patch, token).catch(() => null);
    if (res && res.status === 403) { token = null; lead(false); store.del('hexapod-teacher', true); renderDialog(); }
  }
  $('teach-open').addEventListener('click', () => { renderDialog(); dialog.showModal(); });
  $('teach-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  // ---------------------------------------------------------------- following
  function go() {
    applying = true;
    try { if (current().page !== follow.page) showPage(follow.page); if (current().view !== follow.view) setView(follow.view); } finally { applying = false; }
  }
  function apply() { if (follow?.active && !leader && following) go(); }
  function renderPill() {
    const pill = $('follow-pill'), on = !!follow?.active;
    pill.hidden = !on;
    if (!on) return;
    if (leader) { pill.dataset.state = 'lead'; pill.innerHTML = '<span>Leading the class</span>'; return; }
    pill.dataset.state = following ? 'on' : 'off';
    pill.innerHTML = following ? '<span>Following the teacher</span><button type="button" data-leave>Explore</button>' : '<span>Exploring on your own</span><button type="button" data-rejoin>Rejoin</button>';
    pill.querySelector('[data-rejoin]')?.addEventListener('click', () => { following = true; apply(); renderPill(); renderCard(); });
    pill.querySelector('[data-leave]')?.addEventListener('click', () => { following = false; renderPill(); });
  }

  // ---------------------------------------------------------------- lesson card
  function renderCard() {
    const card = $('lesson-card'), s = step();
    card.hidden = !follow?.active || !s || (!following && !leader);
    if (card.hidden) return;
    const q = s.step.question, revealed = !!follow.reveal && follow.question === q?.id;
    const counts = tally?.question === q?.id ? tally.counts : [], total = tally?.question === q?.id ? tally.total : 0;
    let question = '';
    if (q) {
      question = `<p class="lesson-q">${esc(q.text)}</p><div class="lesson-options">${q.options.map((o, i) => {
        const pct = total ? Math.round(100 * (counts[i] || 0) / total) : 0, mine = myAnswer[q.id] === i, right = revealed && i === q.answer;
        return `<button type="button" data-choice="${i}" class="${mine ? 'mine' : ''} ${right ? 'right' : ''}"${leader ? ' disabled' : ''}><span>${esc(o)}</span>${leader || revealed ? `<i style="width:${pct}%"></i><b>${counts[i] || 0}</b>` : ''}</button>`;
      }).join('')}</div>
      <p class="lesson-foot">${leader || revealed ? `${total} answer${total === 1 ? '' : 's'}` : myAnswer[q.id] !== undefined ? 'Answer sent. You can change it.' : 'Tap an answer: it is anonymous.'}</p>
      ${revealed ? `<p class="lesson-why"><b>Answer: ${esc(q.options[q.answer])}.</b> ${esc(q.why)}</p>` : ''}`;
    }
    const small = store.get('hexapod-card-small') === '1';
    card.classList.toggle('small', small);
    card.innerHTML = `<header><span class="lesson-step">${esc(s.lesson.title)} · step ${s.index + 1} of ${s.lesson.steps.length}</span><button type="button" class="lesson-size" data-size aria-label="${small ? 'Show the lesson card' : 'Make the lesson card smaller'}">${small ? '▴' : '▾'}</button></header>
      <h3>${esc(s.step.title)}</h3><p>${esc(s.step.text)}</p>${question}
      ${leader ? `<div class="lesson-controls"><button type="button" data-step="-1"${s.index === 0 ? ' disabled' : ''}>Back</button>${q ? `<button type="button" data-reveal>${revealed ? 'Hide answer' : 'Show answer'}</button><button type="button" data-clear>Clear answers</button>` : ''}<button type="button" class="primary" data-step="1"${s.index >= s.lesson.steps.length - 1 ? ' disabled' : ''}>Next</button></div>` : ''}`;
    card.querySelector('[data-size]').addEventListener('click', () => { store.set('hexapod-card-small', small ? '0' : '1'); renderCard(); });
    card.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', async () => {
      const choice = Number(b.dataset.choice); myAnswer[q.id] = choice; renderCard();
      await postJSON('answer', {client: clientId(), question: q.id, choice}).catch(() => null);
    }));
    card.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => { const i = s.index + Number(b.dataset.step); send({step: i, ...lessonView(s.lesson.id, i), reveal: false}); }));
    card.querySelector('[data-reveal]')?.addEventListener('click', () => send({reveal: !revealed}));
    card.querySelector('[data-clear]')?.addEventListener('click', () => postJSON('teacher/clear', {question: q.id}, token).catch(() => null));
  }

  return {
    onFollow(state) {
      const before = follow; follow = state;
      if (!state?.active) lead(false);
      if (state?.active && !before?.active) following = true; // a new lesson: everyone joins
      // The teacher's own device also moves to each new lesson step's page and view.
      if (leader && state?.active && state.lesson && (before?.lesson !== state.lesson || before?.step !== state.step)) go();
      apply(); renderPill(); renderCard(); if (dialog.open) renderDialog();
    },
    onAnswers(t) { tally = t; renderCard(); },
    // The page or camera view changed on this device.
    localChange() {
      if (applying || !follow?.active) return;
      if (leader) { send(here()); return; }
      if (following && (current().page !== follow.page || current().view !== follow.view)) { following = false; renderPill(); renderCard(); }
    },
  };
}
