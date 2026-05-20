(function(){
  let _auth = null;
  let _readyPromise = null;
  let _readyResolve = null;
  let _currentUser = null;
  let _currentProfile = null;
  let _loginReady = false;

  const SUPER_ADMIN_EMAILS = ['2025superchild@gmail.com'];
  const STAFF_EMAIL_PROFILES = {
    'gagyeong.desk@scswim.local': {name:'가경점 데스크', role:'desk', branchIds:['gagyeong'], teacherName:''},
    'gagyeong.son@scswim.local': {name:'손용곤', role:'teacher', branchIds:['gagyeong'], teacherName:'손용곤'},
    'gagyeong.park@scswim.local': {name:'박형진', role:'teacher', branchIds:['gagyeong'], teacherName:'박형진'},
    'gagyeong.lee1@scswim.local': {name:'이수성', role:'teacher', branchIds:['gagyeong'], teacherName:'이수성'},
    'gagyeong.kimjy@scswim.local': {name:'김재용', role:'teacher', branchIds:['gagyeong'], teacherName:'김재용'},
    'gagyeong.kimms@scswim.local': {name:'김민승', role:'teacher', branchIds:['gagyeong'], teacherName:'김민승'},
    'gagyeong.yoo@scswim.local': {name:'유정희', role:'teacher', branchIds:['gagyeong'], teacherName:'유정희'},
    'yongam.desk@scswim.local': {name:'용암점 데스크', role:'desk', branchIds:['yongam'], teacherName:''},
    'yongam.lee1@scswim.local': {name:'이수재', role:'teacher', branchIds:['yongam'], teacherName:'이수재'},
    'yongam.jung@scswim.local': {name:'정연재', role:'teacher', branchIds:['yongam'], teacherName:'정연재'},
    'yongam.kimsh@scswim.local': {name:'김성현', role:'teacher', branchIds:['yongam'], teacherName:'김성현'},
    'yongam.kimey@scswim.local': {name:'김은영', role:'teacher', branchIds:['yongam'], teacherName:'김은영'},
    'yongam.kimjs@scswim.local': {name:'김지수', role:'teacher', branchIds:['yongam'], teacherName:'김지수'},
    'yongam.lee2@scswim.local': {name:'이시종', role:'teacher', branchIds:['yongam'], teacherName:'이시종'},
  };
  const ROLE_PERMISSIONS = {
    superAdmin: ['*'],
    desk: [
      'viewSchedule',
      'editSchedule',
      'teacherRequests',
      'attendanceCheck',
      'manageCalendar',
      'manageRecords',
      'manageTeachers',
      'exportData',
    ],
    teacher: [
      'viewSchedule',
    ],
  };

  function normalizeEmail(email){
    return String(email||'').trim().toLowerCase();
  }

  function roleLabel(role){
    if(role === 'superAdmin') return '최고관리자';
    if(role === 'desk') return '데스크';
    if(role === 'teacher') return '선생님';
    return '미설정';
  }

  function normalizeRole(role){
    const v = String(role||'').trim();
    if(v === 'superAdmin' || v === 'superadmin' || v === '최고관리자') return 'superAdmin';
    if(v === 'desk' || v === 'admin' || v === 'manager' || v === '데스크' || v === '관리자') return 'desk';
    if(v === 'teacher' || v === '선생님' || v === '강사') return 'teacher';
    return '';
  }

  function inferStaffProfileByEmail(email){
    email = normalizeEmail(email);
    if(STAFF_EMAIL_PROFILES[email]) return STAFF_EMAIL_PROFILES[email];
    const branchIds = [];
    if(email.includes('gagyeong') || email.includes('gagyung') || email.includes('가경')) branchIds.push('gagyeong');
    if(email.includes('yongam') || email.includes('용암')) branchIds.push('yongam');
    if(email.includes('desk') || email.includes('admin') || email.includes('manager')){
      return {
        name: branchIds.includes('yongam') ? '용암점 데스크' : '가경점 데스크',
        role: 'desk',
        branchIds: branchIds.length ? branchIds : ['gagyeong','yongam'],
        teacherName: '',
      };
    }
    return null;
  }

  function defaultProfile(user){
    const email = normalizeEmail(user && user.email);
    const isSuper = SUPER_ADMIN_EMAILS.includes(email);
    const fallback = isSuper ? null : inferStaffProfileByEmail(email);
    return Object.assign({
      uid: user && user.uid || '',
      email,
      name: user && (user.displayName || user.email) || '',
      role: isSuper ? 'superAdmin' : 'teacher',
      branchIds: isSuper ? ['gagyeong','yongam'] : [],
      teacherName: '',
      active: true,
      missingProfile: !isSuper && !fallback,
      fallbackProfile: !!fallback,
    }, fallback || {});
  }

  function normalizeBranchId(branchId){
    const v = String(branchId||'').trim();
    if(!v || /^\d+$/.test(v)) return '';
    if(v === '가경점' || v === '가경동' || v === 'gagyeong') return 'gagyeong';
    if(v === '용암점' || v === '용암동' || v === 'yongam') return 'yongam';
    return v;
  }

  function normalizeBranchIds(branchIds){
    if(Array.isArray(branchIds)){
      return branchIds.map(normalizeBranchId).filter(Boolean);
    }
    if(typeof branchIds === 'string'){
      return branchIds.split(/[,\s]+/).map(normalizeBranchId).filter(Boolean);
    }
    if(branchIds && typeof branchIds === 'object'){
      return Object.keys(branchIds).map(function(k){
        const v = branchIds[k];
        if(v === true) return normalizeBranchId(k);
        if(typeof v === 'string') return normalizeBranchId(v);
        if(v && typeof v === 'object') return normalizeBranchId(v.id || v.branchId || v.name);
        return '';
      }).filter(Boolean);
    }
    return [];
  }

  function normalizeProfile(raw,user){
    const base = defaultProfile(user);
    if(!raw || typeof raw !== 'object') return base;
    const email = normalizeEmail(raw.email || user && user.email);
    const fallback = inferStaffProfileByEmail(email);
    const role = fallback && fallback.role === 'desk'
      ? 'desk'
      : (normalizeRole(raw.role) || base.role);
    return Object.assign({}, base, raw, {
      uid: user && user.uid || raw.uid || '',
      email,
      role,
      branchIds: normalizeBranchIds(Object.prototype.hasOwnProperty.call(raw, 'branchIds') ? raw.branchIds : base.branchIds),
      active: raw.active !== false,
      missingProfile: false,
      fallbackProfile: false,
    });
  }

  function loadStaffProfile(user){
    if(!user) return Promise.resolve(null);
    try{
      ensureFirebaseApp();
      return Promise.resolve(defaultProfile(user));
    }catch(e){
      console.warn('[AUTH] staff profile init failed', e);
      return Promise.resolve(defaultProfile(user));
    }
  }

  function ensureFirebaseApp(){
    if(!window.firebase) throw new Error('Firebase SDK가 로드되지 않았습니다');
    const config = window.SC_FIREBASE_CONFIG;
    if(!config || !config.apiKey) throw new Error('Firebase 설정이 없습니다');
    if(!firebase.apps.length) firebase.initializeApp(config);
    return firebase.app();
  }

  function ensureAuth(){
    ensureFirebaseApp();
    if(!_auth){
      if(!firebase.auth) throw new Error('Firebase Auth SDK가 로드되지 않았습니다');
      _auth = firebase.auth();
      _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(e){
        console.warn('[AUTH] persistence failed', e);
      });
    }
    return _auth;
  }

  function authErrorMessage(error){
    const code = error && error.code ? error.code : '';
    if(code === 'auth/invalid-email') return '이메일 형식을 확인해주세요';
    if(code === 'auth/user-disabled') return '비활성화된 계정입니다';
    if(code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') return '이메일 또는 비밀번호가 맞지 않습니다';
    if(code === 'auth/too-many-requests') return '시도가 너무 많습니다. 잠시 후 다시 시도해주세요';
    if(code === 'auth/operation-not-allowed') return 'Firebase Console에서 Email/Password 로그인을 먼저 켜주세요';
    if(code === 'auth/network-request-failed') return '네트워크 연결을 확인해주세요';
    return '로그인에 실패했습니다';
  }

  function setError(msg){
    const el = document.getElementById('staff-auth-error');
    if(!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  function setBusy(isBusy){
    const btn = document.getElementById('staff-auth-submit');
    if(btn){
      btn.disabled = !!isBusy;
      btn.textContent = isBusy ? '확인 중...' : '로그인';
    }
  }

  function updateEmailLabels(user){
    document.querySelectorAll('[data-auth-email]').forEach(function(el){
      el.textContent = user && user.email ? user.email : '';
    });
    document.querySelectorAll('[data-auth-role]').forEach(function(el){
      el.textContent = _currentProfile ? roleLabel(_currentProfile.role) : '';
    });
  }

  function showLogin(){
    const screen = document.getElementById('staff-auth-screen');
    if(screen) screen.style.display = 'flex';
  }

  function hideLogin(){
    const screen = document.getElementById('staff-auth-screen');
    if(screen) screen.style.display = 'none';
  }

  function currentBranchId(){
    try{return localStorage.getItem('selected_branch') || '';}catch(e){return '';}
  }

  function canAccessBranch(branchId){
    const p = _currentProfile;
    if(!p || p.role === 'superAdmin') return true;
    const allowed = normalizeBranchIds(p.branchIds);
    if(!allowed.length || !branchId) return true;
    return allowed.includes(branchId);
  }

  function hasPermission(permission){
    const p = _currentProfile;
    if(!p || p.active === false) return false;
    if(permission === 'viewSchedule') return true;
    if(p.missingProfile) return false;
    const role = p.role || 'teacher';
    const list = ROLE_PERMISSIONS[role] || [];
    return list.includes('*') || list.includes(permission);
  }

  function canWriteKey(key){
    if(!_currentUser || !_currentProfile) return true;
    if(_currentProfile.active === false) return false;
    if(hasPermission('*') || _currentProfile.role === 'superAdmin') return true;
    key = String(key||'');
    if(!key) return true;

    if(key === 'swim_mark' || key === 'swim_requests' || key === 'swim_attendance' ||
       key === 'swim_att_guests' || key === 'swim_day_snapshot'){
      return hasPermission('teacherRequests') || hasPermission('attendanceCheck');
    }
    if(key === 'swim_closed' || key === 'swim_periods') return hasPermission('manageCalendar');
    if(key === 'swim_audit_log' || key === 'swim_restore_points' || key === 'swim_retire_history'){
      return hasPermission('manageRecords');
    }
    if(key === 'swim_teachers') return hasPermission('manageTeachers');
    if(key === 'swim_tab_list' || key === 'swim_tab_folders' || key === 'swim_students' ||
       key === 'swim_inst' || key === 'swim_retire' || key === 'swim_enroll' ||
       key === 'swim_disabled' || key === 'swim_reserve' || key === 'swim_hyuwon' ||
       key === 'swim_move' || key === 'swim_age_year' ||
       /^swim_stu_/.test(key) || /^swim_inst_/.test(key) || /^swim_bt_.+_(stu|inst)$/.test(key)){
      return hasPermission('editSchedule');
    }
    if(/^staff_users\//.test(key)) return _currentProfile.role === 'superAdmin';
    return hasPermission('editSchedule');
  }

  function denyMessage(label){
    return (label || '이 기능') + ' 권한이 없습니다';
  }

  function requirePermission(permission,label){
    if(hasPermission(permission)) return true;
    if(typeof toast === 'function') toast(denyMessage(label),'err');
    else alert(denyMessage(label));
    return false;
  }

  function requireWriteKey(key,label){
    if(canWriteKey(key)) return true;
    if(typeof toast === 'function') toast(denyMessage(label || '저장'),'err');
    else alert(denyMessage(label || '저장'));
    return false;
  }

  function applyPagePermissions(root){
    root = root || document;
    if(document.body){
      document.body.dataset.staffRole = _currentProfile ? (_currentProfile.role || '') : '';
      document.body.classList.toggle('staff-profile-missing', !!(_currentProfile && _currentProfile.missingProfile));
    }
    root.querySelectorAll('[data-perm]').forEach(function(el){
      const perms = String(el.getAttribute('data-perm')||'').split(/\s+/).filter(Boolean);
      const ok = !perms.length || perms.some(hasPermission);
      el.hidden = false;
      if('disabled' in el) el.disabled = !ok;
      el.setAttribute('aria-disabled', ok ? 'false' : 'true');
      el.classList.toggle('perm-hidden', false);
      el.classList.toggle('perm-disabled', !ok);
    });
    root.querySelectorAll('[data-auth-role]').forEach(function(el){
      el.textContent = _currentProfile ? roleLabel(_currentProfile.role) : '';
    });
    root.querySelectorAll('[data-auth-name]').forEach(function(el){
      el.textContent = _currentProfile ? (_currentProfile.name || _currentProfile.teacherName || '') : '';
    });
  }

  function injectLoginScreen(){
    if(_loginReady || document.getElementById('staff-auth-screen')) return;
    _loginReady = true;
    const screen = document.createElement('div');
    screen.id = 'staff-auth-screen';
    screen.className = 'staff-auth-screen';
    screen.innerHTML = [
      '<form class="staff-auth-box" id="staff-auth-form">',
        '<div class="staff-auth-logo">SC</div>',
        '<h1>직원 로그인</h1>',
        '<p>발급받은 이메일 계정으로 접속해주세요</p>',
        '<label for="staff-auth-email">이메일</label>',
        '<input id="staff-auth-email" type="email" inputmode="email" autocomplete="username" required>',
        '<label for="staff-auth-password">비밀번호</label>',
        '<input id="staff-auth-password" type="password" autocomplete="current-password" required>',
        '<button id="staff-auth-submit" type="submit">로그인</button>',
        '<button id="staff-auth-reset" type="button">비밀번호 재설정 메일 보내기</button>',
        '<div id="staff-auth-error" class="staff-auth-error" style="display:none"></div>',
      '</form>'
    ].join('');
    document.body.appendChild(screen);

    const form = document.getElementById('staff-auth-form');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      setError('');
      setBusy(true);
      const email = document.getElementById('staff-auth-email').value.trim();
      const password = document.getElementById('staff-auth-password').value;
      ensureAuth().signInWithEmailAndPassword(email, password).catch(function(error){
        setError(authErrorMessage(error));
      }).finally(function(){
        setBusy(false);
      });
    });

    document.getElementById('staff-auth-reset').addEventListener('click', function(){
      const email = document.getElementById('staff-auth-email').value.trim();
      if(!email){
        setError('비밀번호 재설정을 받을 이메일을 입력해주세요');
        return;
      }
      setError('');
      ensureAuth().sendPasswordResetEmail(email).then(function(){
        setError('비밀번호 재설정 메일을 보냈습니다');
      }).catch(function(error){
        setError(authErrorMessage(error));
      });
    });
  }

  function requireAuth(){
    if(_currentUser) return Promise.resolve(_currentUser);
    if(_readyPromise) return _readyPromise;

    _readyPromise = new Promise(function(resolve){
      _readyResolve = resolve;
    });

    try{
      const auth = ensureAuth();
      injectLoginScreen();
      showLogin();
      auth.onAuthStateChanged(function(user){
        _currentUser = user || null;
        updateEmailLabels(_currentUser);
        if(_currentUser){
          _currentUser.getIdToken().catch(function(e){
            console.warn('[AUTH] token read failed', e);
          }).then(function(){
            return loadStaffProfile(_currentUser);
          }).then(function(profile){
            _currentProfile = profile;
            if(_currentProfile && _currentProfile.active === false){
              setError('비활성화된 직원 계정입니다');
              showLogin();
              return;
            }
            updateEmailLabels(_currentUser);
            hideLogin();
            applyPagePermissions(document);
            if(_readyResolve){
              _readyResolve(_currentUser);
              _readyResolve = null;
            }
          });
        }else{
          _currentProfile = null;
          showLogin();
        }
      }, function(error){
        injectLoginScreen();
        showLogin();
        setError(authErrorMessage(error));
      });
    }catch(error){
      injectLoginScreen();
      showLogin();
      setError(error.message || '로그인 준비에 실패했습니다');
    }

    return _readyPromise;
  }

  function signOut(){
    try{
      return ensureAuth().signOut().finally(function(){ location.reload(); });
    }catch(e){
      location.reload();
      return Promise.resolve();
    }
  }

  window.SCAuth = {
    requireAuth: requireAuth,
    signOut: signOut,
    currentUser: function(){ return _currentUser; },
    profile: function(){ return _currentProfile; },
    role: function(){ return _currentProfile && _currentProfile.role || ''; },
    roleLabel: function(){ return roleLabel(_currentProfile && _currentProfile.role); },
    teacherName: function(){ return _currentProfile && _currentProfile.teacherName || ''; },
    can: hasPermission,
    canWriteKey: canWriteKey,
    requirePermission: requirePermission,
    requireWriteKey: requireWriteKey,
    applyPagePermissions: applyPagePermissions,
    canAccessBranch: canAccessBranch,
    profilePath: function(){
      const user = _currentUser;
      return user ? 'staff_users/'+user.uid : '';
    },
  };
})();
