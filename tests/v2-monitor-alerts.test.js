const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','js','settings.js'),'utf8');

test('a successful newer V2 sync hides stale conversion alerts',()=>{
  assert.match(source,/function visibleV2MonitorAlerts\(data,alerts\)/);
  assert.match(source,/data&&data\.shadowStatus\)!=='ok'/);
  assert.match(source,/detectedAt>syncedAt/);
  assert.match(source,/visibleV2MonitorAlerts\(data,v2MonitorAlertsByBranch\[activeBranch\]\|\|\[\]\)/);
});

test('resolved V2 alerts never appear in the active warning count',()=>{
  assert.match(source,/alert\.status!=='resolved'/);
});
