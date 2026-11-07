// The parameters panel: one row per entry of the program's `export const params`,
// labelled with its `name` and `description`, each with a control that fits its value — a number field, a switch, a colour, a
// text field, or JSON for arrays and objects. Changing one sends the whole set of
// values that differ from the code (the overrides) through onChange.
//
// The server is the truth: every model frame carries the declared params ({ value, name, description }) and the
// overrides it ran with, and the panel follows them, except for the field being
// typed in and while its own change is still on the way.

const HEX = /^#[0-9a-f]{6}$/i;

/** Key-order-independent JSON, to compare sets of values. */
const stable = (value) =>
  JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

const same = (a, b) => stable(a) === stable(b);

/** What a value is edited as. */
function kindOf(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return HEX.test(value) ? 'color' : 'text';
  return 'json';
}

/** The arrow-key step of a number field: 1 for whole numbers, else one unit of its last decimal. */
function stepOf(value) {
  const decimals = String(value).split('.')[1]?.length ?? 0;
  return decimals === 0 ? 1 : 10 ** -Math.min(decimals, 4);
}

/**
 * @param {{ form: HTMLFormElement, resetAll: HTMLButtonElement, onChange: (overrides: Record<string, unknown>) => void }} options
 * @returns {{ show: (specs: Record<string, { value: unknown, name: string, description: string }>, overrides: Record<string, unknown>) => void }}
 */
export function createParamsPanel({ form, resetAll, onChange }) {
  let specs = {};
  let declared = {}; // name → the value in the code
  let overrides = {};
  let shape = ''; // the keys, kinds and labels the rows were built for
  let sent = null; // overrides sent and not yet seen back in a frame
  const rows = new Map(); // name → { row, set(value), get() → { ok, value } }

  function commit() {
    sent = { ...overrides };
    markChanged();
    onChange({ ...overrides });
  }

  /** Records a row's value: an override when it differs from the code, none when it matches. */
  function change(name, value) {
    if (same(value, declared[name])) delete overrides[name];
    else overrides[name] = value;
    commit();
  }

  function markChanged() {
    for (const [name, { row }] of rows) row.toggleAttribute('data-changed', name in overrides);
    resetAll.hidden = Object.keys(overrides).length === 0;
  }

  // Number fields send while typing, a moment after the last key, so "24" does not build "2" first.
  let typingTimer = 0;
  const later = (fn) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(fn, 250);
  };

  function numberControl(name, row, label) {
    // A text field rather than type=number, which writes the browser's locale (0,72):
    // the value reads as in the code, and a decimal comma is still taken.
    const input = Object.assign(document.createElement('input'), { type: 'text', inputMode: 'decimal', id: `param-${name}`, className: 'number', spellcheck: false });
    // The step follows the value in the code, which can change between frames.
    const step = () => stepOf(declared[name]);
    const round = (n) => Number(n.toFixed(Math.max(0, -Math.floor(Math.log10(step())))));
    const read = () => {
      const value = Number(input.value.trim().replace(',', '.'));
      return { ok: input.value.trim() !== '' && Number.isFinite(value), value };
    };
    const send = () => {
      const { ok, value } = read();
      input.setAttribute('aria-invalid', String(!ok));
      if (ok) change(name, value);
    };
    input.addEventListener('input', () => later(send));
    input.addEventListener('change', () => (clearTimeout(typingTimer), send()));
    // Arrows step by the value's own precision; shift steps ten times as far.
    input.addEventListener('keydown', (event) => {
      const dir = { ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (!dir) return;
      event.preventDefault();
      const next = round((read().ok ? read().value : declared[name]) + dir * step() * (event.shiftKey ? 10 : 1));
      input.value = String(next);
      later(send);
    });

    // Dragging the name sideways scrubs the value: one step per 4 px, shift for ten.
    label.classList.add('scrub');
    label.title = 'Drag sideways to change';
    label.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      label.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const start = read().ok ? read().value : declared[name];
      const move = (e) => {
        input.value = String(round(start + Math.round((e.clientX - startX) / 4) * step() * (e.shiftKey ? 10 : 1)));
        later(send);
      };
      label.addEventListener('pointermove', move);
      label.addEventListener('lostpointercapture', () => label.removeEventListener('pointermove', move), { once: true });
    });

    row.append(input);
    return { set: (v) => (input.value = String(v), input.removeAttribute('aria-invalid')) };
  }

  function booleanControl(name, row) {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', id: `param-${name}`, className: 'switch' });
    input.setAttribute('role', 'switch');
    input.addEventListener('change', () => change(name, input.checked));
    row.append(input);
    return { set: (v) => (input.checked = v) };
  }

  function colorControl(name, row) {
    const wrap = Object.assign(document.createElement('span'), { className: 'color' });
    const swatch = Object.assign(document.createElement('input'), { type: 'color', title: 'Pick a colour' });
    swatch.setAttribute('aria-label', `${name} colour`);
    const text = Object.assign(document.createElement('input'), { type: 'text', id: `param-${name}`, spellcheck: false });
    swatch.addEventListener('input', () => {
      text.value = swatch.value;
      later(() => change(name, swatch.value));
    });
    text.addEventListener('change', () => {
      if (HEX.test(text.value)) swatch.value = text.value;
      change(name, text.value);
    });
    wrap.append(swatch, text);
    row.append(wrap);
    return {
      set: (v) => {
        text.value = v;
        if (HEX.test(v)) swatch.value = v;
      },
    };
  }

  function textControl(name, row) {
    const input = Object.assign(document.createElement('input'), { type: 'text', id: `param-${name}`, spellcheck: false });
    input.addEventListener('change', () => change(name, input.value));
    row.append(input);
    return { set: (v) => (input.value = v) };
  }

  // Arrays and objects as JSON; text that does not parse is marked and not sent.
  function jsonControl(name, row) {
    const input = Object.assign(document.createElement('input'), { type: 'text', id: `param-${name}`, spellcheck: false, className: 'json' });
    input.addEventListener('change', () => {
      let value;
      try {
        value = JSON.parse(input.value);
      } catch {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.setAttribute('aria-invalid', 'false');
      change(name, value);
    });
    row.append(input);
    // On one line with a space after each comma and colon: [4, 6, 8].
    const format = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/([[{]) /g, '$1').replace(/ ([\]}])/g, '$1');
    return { set: (v) => (input.value = format(v), input.removeAttribute('aria-invalid')) };
  }

  const CONTROLS = { number: numberControl, boolean: booleanControl, color: colorControl, text: textControl, json: jsonControl };

  function build() {
    const focused = document.activeElement?.id;
    rows.clear();
    form.replaceChildren(
      ...Object.keys(declared).map((name) => {
        const row = Object.assign(document.createElement('div'), { className: 'param' });
        row.dataset.kind = kindOf(declared[name]);
        const label = Object.assign(document.createElement('label'), { htmlFor: `param-${name}`, textContent: specs[name].name });
        row.append(label);
        const control = CONTROLS[row.dataset.kind](name, row, label);
        const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'reset', title: 'Back to the value in the code' });
        reset.setAttribute('aria-label', `Reset ${name}`);
        reset.innerHTML =
          '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        reset.addEventListener('click', () => {
          control.set(declared[name]);
          change(name, declared[name]);
        });
        const description = Object.assign(document.createElement('p'), { className: 'description', textContent: specs[name].description });
        row.append(reset, description);
        rows.set(name, { row, ...control });
        return row;
      }),
    );
    if (focused) document.getElementById(focused)?.focus();
  }

  /** Puts the values on screen, leaving alone the field being typed in. */
  function fill() {
    for (const [name, { set, row }] of rows) {
      if (row.contains(document.activeElement) && row.dataset.kind !== 'boolean') continue;
      set(name in overrides ? overrides[name] : declared[name]);
    }
    markChanged();
  }

  resetAll.addEventListener('click', () => {
    overrides = {};
    for (const [name, { set }] of rows) set(declared[name]);
    commit();
  });

  form.addEventListener('submit', (event) => event.preventDefault());

  return {
    show(nextSpecs, serverOverrides) {
      specs = nextSpecs;
      declared = Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, spec.value]));
      const nextShape = stable(Object.entries(specs).map(([name, spec]) => [name, kindOf(spec.value), spec.name, spec.description]));
      // Until the server has run with what was sent, its overrides are older than the panel's.
      if (sent) {
        const pending = Object.fromEntries(Object.entries(sent).filter(([name]) => name in declared));
        if (same(pending, serverOverrides)) sent = null;
      }
      if (!sent) overrides = { ...serverOverrides };
      for (const name of Object.keys(overrides)) if (!(name in declared)) delete overrides[name];
      if (nextShape !== shape) {
        shape = nextShape;
        build();
      }
      fill();
    },
  };
}
