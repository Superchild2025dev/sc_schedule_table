const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const policyPath=path.join(__dirname,'..','js','schedule-key-selection.js');

test('schedule key policy module is available',()=>{
  assert.equal(fs.existsSync(policyPath),true);
});

test('regular and vacation tabs resolve only their own payload keys',()=>{
  const policy=require(policyPath);
  assert.deepEqual(policy.tabKeys({id:'regular',type:'regular'}),[
    'swim_students',
    'swim_inst',
  ]);
  assert.deepEqual(policy.tabKeys({id:'june',type:'regular'}),[
    'swim_stu_june',
    'swim_inst_june',
  ]);
  assert.deepEqual(policy.tabKeys({
    id:'summer',
    type:'bangteuk',
    stuKey:'custom_students',
    instKey:'custom_inst',
  }),[
    'custom_students',
    'custom_inst',
  ]);
  assert.deepEqual(policy.tabKeys({id:'snap1',type:'snapshot'}),[]);
});

test('attendance payload keys are selected only when the attendance view opens',()=>{
  const policy=require(policyPath);
  assert.deepEqual(policy.attendanceKeys({id:'regular',type:'regular'}),[
    'swim_attendance',
    'swim_att_guests',
  ]);
  assert.deepEqual(policy.attendanceKeys({id:'summer',type:'bangteuk'}),[
    'swim_bt_attendance_summer',
    'swim_bt_att_guests_summer',
  ]);
  assert.deepEqual(policy.attendanceKeys({id:'snap1',type:'snapshot'}),[]);
});

test('initial base keys contain only explicit bootstrap and common keys',()=>{
  const policy=require(policyPath);
  const bootstrap=policy.bootstrapKeys();
  const common=policy.commonKeys();
  const initial=policy.initialBaseKeys();

  assert.deepEqual(initial,[...new Set([...bootstrap,...common])]);
  assert.equal(initial.includes('swim_attendance'),false);
  assert.equal(initial.includes('swim_att_guests'),false);
  [
    'swim_students',
    'swim_inst',
    'swim_stu_june',
    'swim_inst_june',
    'swim_bt_summer_stu',
    'swim_bt_summer_inst',
    'swim_bt_attendance_summer',
    'swim_bt_att_guests_summer',
    'swim_audit_log',
    'swim_restore_points',
    'swim_day_snapshot',
    'swim_snap_old',
    'swim_aligo_settings',
    'swim_parent_feedback',
  ].forEach(key=>assert.equal(initial.includes(key),false,key));
  assert.equal(new Set(initial).size,initial.length);
});

test('tab-owned key detection excludes shared regular attendance',()=>{
  const policy=require(policyPath);
  [
    'swim_students',
    'swim_inst',
    'swim_stu_june',
    'swim_inst_june',
    'swim_bt_summer_stu',
    'swim_bt_summer_inst',
    'swim_bt_attendance_summer',
    'swim_bt_att_guests_summer',
  ].forEach(key=>assert.equal(policy.isTabOwnedKey(key),true,key));
  assert.equal(policy.isTabOwnedKey('swim_attendance'),false);
  assert.equal(policy.isTabOwnedKey('swim_att_guests'),false);
  assert.equal(policy.isTabOwnedKey('swim_mark'),false);
});

test('remote tab metadata selects a live main tab safely',()=>{
  const policy=require(policyPath);
  const tabs=[
    {id:'snap',type:'snapshot',name:'스냅샷'},
    {id:'june',type:'regular',name:'6월'},
    {id:'summer',type:'bangteuk',name:'여름방특'},
  ];
  const selected=policy.resolveMainTab({
    swim_tab_list:JSON.stringify(tabs),
    swim_main_tab:JSON.stringify({tabId:'summer'}),
  },'june');
  assert.equal(selected.id,'summer');

  const snapshotMain=policy.resolveMainTab({
    swim_tab_list:JSON.stringify(tabs),
    swim_main_tab:JSON.stringify({tabId:'snap'}),
  },'june');
  assert.equal(snapshotMain.id,'june');

  const invalid=policy.resolveMainTab({
    swim_tab_list:'not json',
    swim_main_tab:'{}',
  },'regular');
  assert.equal(invalid.id,'regular');
  assert.equal(invalid.type,'regular');
});

test('main page loads key selection after Firebase store and before core',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const store=html.indexOf("scJs('js/firebase-store.js')");
  const selection=html.indexOf("scJs('js/schedule-key-selection.js')");
  const core=html.indexOf("scJs('js/core.js')");
  assert.ok(store>=0);
  assert.ok(selection>store);
  assert.ok(core>selection);
});
