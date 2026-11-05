// Follow-the-teacher mode, lesson cards and quick questions for the Live View.
// None of this touches the robot: it only shares which page, view and lesson step the teacher is on,
// and counts anonymous answers. Leading needs the teacher code, which is kept in a file on the Pi and
// printed only in the service's own log (journalctl), never on the web page.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TOKEN_HOURS = 12;
const PAGES = ['live', 'controller', 'how', 'servos', 'health', 'care', 'sessions', 'messages'];
const VIEWS = ['angled', 'top', 'front', 'side'];

// The teacher code: HEXAPOD_TEACHER_CODE, else the saved file, else a new random 6-digit code saved there.
export function teacherCode({code = process.env.HEXAPOD_TEACHER_CODE, file = null, fsModule = fs} = {}) {
  if (code && /^\d{4,12}$/.test(String(code))) return String(code);
  if (file) {
    try { const saved = fsModule.readFileSync(file, 'utf8').trim(); if (/^\d{4,12}$/.test(saved)) return saved; } catch {}
  }
  const fresh = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  if (file) try { fsModule.mkdirSync(path.dirname(file), {recursive: true}); fsModule.writeFileSync(file, `${fresh}\n`, {mode: 0o600}); } catch {}
  return fresh;
}

export function createClassroom({code, now = Date.now} = {}) {
  const tokens = new Map(); // token -> expiry
  let follow = {active: false, page: 'live', view: 'angled', lesson: null, step: 0, question: null, reveal: false, t: 0};
  const answers = new Map(); // question id -> Map(client -> choice)
  const listeners = new Set();
  const changed = type => { for (const fn of listeners) fn(type); };
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  return {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    login(attempt) {
      const text = String(attempt ?? '');
      if (!code || !same(text, code)) return null;
      const token = crypto.randomBytes(18).toString('base64url');
      tokens.set(token, now() + TOKEN_HOURS * 3600e3);
      return token;
    },
    isTeacher(token) {
      const exp = tokens.get(String(token || ''));
      if (!exp) return false;
      if (exp < now()) { tokens.delete(token); return false; }
      return true;
    },
    // The teacher's view: page, camera, lesson step and the question on show. Unknown values are refused.
    setFollow(token, next = {}) {
      if (!this.isTeacher(token)) return false;
      const page = PAGES.includes(next.page) ? next.page : follow.page, view = VIEWS.includes(next.view) ? next.view : follow.view;
      const lesson = typeof next.lesson === 'string' && /^[a-z0-9-]{1,40}$/.test(next.lesson) ? next.lesson : next.lesson === null ? null : follow.lesson;
      const step = Number.isInteger(next.step) && next.step >= 0 && next.step < 100 ? next.step : follow.step;
      const question = typeof next.question === 'string' && /^[a-z0-9-]{1,60}$/.test(next.question) ? next.question : next.question === null ? null : follow.question;
      const reveal = question !== follow.question ? !!next.reveal : next.reveal === undefined ? follow.reveal : !!next.reveal; // a new question starts hidden
      follow = {active: next.active === undefined ? follow.active : !!next.active, page, view, lesson, step, question, reveal, t: now()};
      changed('follow');
      return true;
    },
    get follow() { return follow; },
    // One anonymous answer per device per question (a device may change its mind).
    answer(client, question, choice) {
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(String(client || '')) || !/^[a-z0-9-]{1,60}$/.test(String(question || '')) || !Number.isInteger(choice) || choice < 0 || choice > 7) return false;
      if (follow.question !== question) return false; // only the question on show
      const map = answers.get(question) || new Map();
      if (!answers.has(question) && answers.size >= 50) answers.delete(answers.keys().next().value);
      if (map.size >= 200 && !map.has(client)) return false;
      map.set(client, choice); answers.set(question, map);
      changed('answers');
      return true;
    },
    tally(question = follow.question) {
      const counts = new Array(8).fill(0), map = answers.get(question);
      if (map) for (const c of map.values()) counts[c]++;
      return {question, counts, total: map ? map.size : 0};
    },
    clearAnswers(token, question) {
      if (!this.isTeacher(token)) return false;
      answers.delete(question); changed('answers'); return true;
    },
  };
}
