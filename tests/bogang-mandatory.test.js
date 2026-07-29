const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dataSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'popup-stu.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function loadBogangHelpers(){
  const start = dataSource.indexOf('function bogangSchedulePrefix');
  const end = dataSource.indexOf('/* ═', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {};
  vm.createContext(context);
  vm.runInContext(dataSource.slice(start, end), context);
  return context;
}

test('mandatory makeup stays independent from regular and bangteuk labels', () => {
  const helpers = loadBogangHelpers();

  assert.equal(helpers.bogangSchedulePrefix({studentScheduleType:'regular', mandatoryMakeup:true}), '(정)');
  assert.equal(helpers.bogangSchedulePrefix({studentScheduleType:'bangteuk', mandatoryMakeup:true}), '(방)');
  assert.equal(helpers.isMandatoryBogang({type:'bogang', mandatoryMakeup:true}), true);
  assert.equal(helpers.isMandatoryBogang({type:'bogang', mandatoryMakeup:false}), false);
  assert.equal(helpers.isMandatoryBogang({type:'sample', mandatoryMakeup:true}), false);
});

test('bogang form saves an independent mandatory makeup checkbox', () => {
  assert.match(popupSource, /id="sp-bogang-mandatory"/);
  assert.match(popupSource, /subObj\.mandatoryMakeup=true/);
  assert.match(styleSource, /\.cb-mandatory-bogang\{background:#7CFF4F/);
});
