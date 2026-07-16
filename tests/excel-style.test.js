const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadExcelStyle(){
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'table.js'), 'utf8');
  const start = source.indexOf('function _excelRgbFromCss');
  const end = source.indexOf('function _excelAddLine', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = {
    window:{getComputedStyle:true},
    getComputedStyle(element){ return element.computedStyle || {}; },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context, {filename:'table-excel-style.js'});
  return context._excelStyleFromCell;
}

function makeCell(textColor){
  const name = textColor ? {computedStyle:{color:textColor}} : null;
  return {
    tagName:'TD',
    computedStyle:{
      backgroundColor:'rgb(255, 255, 255)',
      color:'rgb(17, 17, 17)',
      fontWeight:'500',
    },
    querySelector(selector){
      return selector === '.stu-bt-new-text' ? name : null;
    },
  };
}

const excelStyleFromCell = loadExcelStyle();

test('vacation-class new student exports with red text', () => {
  const style = excelStyleFromCell(makeCell('rgb(220, 38, 38)'));
  assert.equal(style.font.color.rgb, 'FFDC2626');
});

test('vacation-class regular student exports with black text', () => {
  const style = excelStyleFromCell(makeCell(''));
  assert.equal(style.font.color.rgb, 'FF111111');
});
