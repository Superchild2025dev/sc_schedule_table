(function(){
  let _auth = null;
  let _readyPromise = null;
  let _readyResolve = null;
  let _currentUser = null;
  let _loginReady = false;

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
  }

  function showLogin(){
    const screen = document.getElementById('staff-auth-screen');
    if(screen) screen.style.display = 'flex';
  }

  function hideLogin(){
    const screen = document.getElementById('staff-auth-screen');
    if(screen) screen.style.display = 'none';
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
        '<h1>관리자 로그인</h1>',
        '<p>선생님 이메일 계정으로 접속해주세요</p>',
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
            hideLogin();
            if(_readyResolve){
              _readyResolve(_currentUser);
              _readyResolve = null;
            }
          });
        }else{
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
    currentUser: function(){ return _currentUser; }
  };
})();
