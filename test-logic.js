const fs = require('fs');
const vm = require('vm');

function makeEl() {
  return {
    textContent: '', innerHTML: '', className: '', hidden: false, value: '', type: '',
    classList: { add() {}, remove() {} },
    children: [],
    appendChild(c) { this.children.push(c); },
    append(...a) { this.children.push(...a); },
    addEventListener(ev, fn) { this.listener = fn; },
    reset() {},
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || makeEl()),
  createElement: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener() {},
};
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
};
let confirms = 0;
global.confirm = () => { confirms++; return true; };
global.navigator = {};
global.location = { protocol: 'http:', origin: 'http://localhost' };

vm.runInThisContext(fs.readFileSync('E:\\myprojects\\iNeedMoney\\app.js', 'utf8'));

const state = () => JSON.parse(localStorage.getItem('inneedmoney.v1'));
const assert = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } console.log('ok: ' + m); };
const submit = id => els[id].listener({ preventDefault() {}, target: els[id] });
const inp = id => document.getElementById(id);

inp('ein-betrag').value = '100'; submit('form-einzahlung');
assert(state().saldo === 10000, 'Einzahlung 100 -> Saldo 10000 Cent');

inp('post-name').value = 'Strom'; inp('post-betrag').value = '56'; inp('post-tag').value = '28';
submit('form-posten');
assert(state().posten.length === 1 && state().posten[0].betrag === 5600, 'Posten Strom 56 am 28. angelegt');
assert(state().saldo === 10000, 'kein Abzug (Tag 28 in Zukunft)');

const c0 = confirms;
// Regel: Warnung, wenn Betrag > floor(summeOffenerPosten / 3) = floor(5600/3) = 1866 Cent (18,66 €)
inp('aus-betrag').value = '20'; inp('aus-notiz').value = 'Kaffee';
submit('form-ausgabe');
assert(confirms === c0 + 1, 'Ausgabe 20 > 18,66 (1/3 von 56) -> Warnung (confirm)');
assert(state().saldo === 8000, 'Saldo nach Ausgabe 20 = 8000 Cent');

inp('aus-betrag').value = '10';
submit('form-ausgabe');
assert(confirms === c0 + 1, 'Ausgabe 10 <= 18,66 -> keine Warnung');
assert(state().saldo === 7000, 'Saldo nach Ausgabe 10 = 7000 Cent');

inp('aus-betrag').value = '20';
submit('form-ausgabe');
assert(confirms === c0 + 2, 'Ausgabe 20 > 18,66 -> Warnung (confirm)');
assert(state().saldo === 5000, 'Saldo nach Ausgabe 20 = 5000 Cent');

inp('post-name').value = 'Miete'; inp('post-betrag').value = '50'; inp('post-tag').value = '1';
submit('form-posten');
assert(state().saldo === 0, 'Posten Miete am Tag 1 -> sofort abgezogen (Saldo 0)');
assert(state().transaktionen.some(t => t.typ === 'posten' && t.name === 'Miete'), 'Abzug in Historie');
console.log('ALLE TESTS OK');
