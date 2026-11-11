// Message inspector: the real messages between the Pi and the Servo 2040, newest first.
const KEEP = 40;
// What each command means, for students reading the list.
export const OPS = {
  status: 'asks for the pose, angles and battery', walk: 'start, steer or change a walk', walk_stop: 'finish this step, then stop',
  pose: 'move every foot to a new position', arm: 'switch the motors on and glide to the stance', off: 'motors off at once',
  hello: 'checks the board program and its version',
};

export function createInspector(list, {showStatus, frozen, counter}) {
  const pending = [];
  let hiddenStatus = 0;
  function render(entry) {
    const li = document.createElement('li');
    li.className = `msg ${entry.dir}`;
    const time = new Date(entry.time).toLocaleTimeString([], {hour12: false}) + `.${String(entry.time % 1000).padStart(3, '0').slice(0, 1)}`;
    const who = entry.dir === 'out' ? 'Pi → board' : 'board → Pi';
    li.innerHTML = '<span class="msg-meta"><b></b><time></time></span><span class="msg-op"></span><code></code>';
    li.querySelector('b').textContent = who;
    li.querySelector('time').textContent = time;
    li.querySelector('.msg-op').textContent = entry.dir === 'out' ? `${entry.op}: ${OPS[entry.op] || 'command'}` : `reply to ${entry.op}`;
    li.querySelector('code').textContent = entry.text;
    return li;
  }
  function add(entries) {
    for (const e of entries) {
      if (e.op === 'status' && !showStatus()) { hiddenStatus++; continue; }
      pending.push(e);
    }
    if (pending.length > KEEP) pending.splice(0, pending.length - KEEP);
    counter(hiddenStatus);
    if (frozen()) return;
    flush();
  }
  function flush() {
    const items = pending.splice(0).reverse().map(render);
    list.prepend(...items);
    while (list.children.length > KEEP) list.lastElementChild.remove();
  }
  return {add, flush, clear() { list.replaceChildren(); pending.length = 0; hiddenStatus = 0; counter(0); }};
}
