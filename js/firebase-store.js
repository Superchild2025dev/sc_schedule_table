/* Firestore-backed key/value store with Realtime Database fallback.
 * The existing app stores each top-level schedule map as a JSON string under
 * keys such as swim_students, swim_mark, and swim_requests. This adapter keeps
 * the same API shape the app already uses while moving each key into a
 * Firestore document:
 *
 *   scheduleStores/{branchId}/kv/{encodedKey}
 *
 * Realtime Database is kept as a fallback and transition mirror so deployment
 * can be rolled out without losing the older data path.
 */
(function(){
  const DEFAULT_BACKEND = 'rtdb';
  const RECOVERABLE_CODES = {
    'failed-precondition': true,
    'permission-denied': true,
    'unavailable': true,
    'unimplemented': true,
  };
  const CHUNK_THRESHOLD = 650000;
  const CHUNK_SIZE = 600000;
  const DEFERRED_ROOT_KEYS = {
    swim_audit_log: true,
    swim_restore_points: true,
  };
  const DEFERRED_ROOT_PREFIXES = [
    'swim_restore_point_',
  ];

  function backend(){
    return String(window.SC_DATA_BACKEND || DEFAULT_BACKEND).toLowerCase();
  }
  function useFirestore(){
    return backend() === 'firestore';
  }
  function boolFlag(name, fallback){
    return window[name] === undefined ? fallback : !!window[name];
  }
  function branchId(branch){
    const raw = branch && (branch.firestoreId || branch.id || branch.fbPath) || 'schedule';
    return String(raw).replace(/[^\w-]/g, '_') || 'schedule';
  }
  function encodeKey(key){
    return encodeURIComponent(String(key)).replace(/\./g, '%2E');
  }
  function decodeKey(id){
    try{return decodeURIComponent(String(id).replace(/%2E/g, '.'));}catch(e){return id;}
  }
  function sameValue(a,b){
    if(a === b) return true;
    try{return JSON.stringify(a) === JSON.stringify(b);}catch(e){return false;}
  }
  function recoverable(error){
    return !!(error && RECOVERABLE_CODES[error.code]);
  }
  function deferredRootKey(key){
    key = String(key || '');
    if(DEFERRED_ROOT_KEYS[key]) return true;
    return DEFERRED_ROOT_PREFIXES.some(prefix=>key.startsWith(prefix));
  }
  function filterRootData(data, includeDeferred){
    if(includeDeferred) return data || {};
    const out = {};
    Object.entries(data || {}).forEach(([key,value])=>{
      if(!deferredRootKey(key)) out[key] = value;
    });
    return out;
  }
  function chunkId(i){
    return String(i).padStart(4, '0');
  }
  function splitChunks(text){
    const chunks = [];
    for(let i=0;i<text.length;i+=CHUNK_SIZE) chunks.push(text.slice(i, i + CHUNK_SIZE));
    return chunks.length ? chunks : [''];
  }
  function encodeStoredValue(value){
    const isString = typeof value === 'string';
    const text = isString ? value : JSON.stringify(value);
    return {
      isString,
      text: text === undefined ? 'null' : text,
    };
  }
  function decodeStoredValue(text, isString){
    if(isString) return text;
    try{return JSON.parse(text);}catch(e){return null;}
  }

  function StoreSnapshot(key, value){
    this.key = key || null;
    this._value = value;
  }
  StoreSnapshot.prototype.val = function(){ return this._value; };

  function FirestoreKVRoot(branch){
    this.branch = branch;
    this.branchId = branchId(branch);
    this.db = firebase.firestore();
    this.col = this.db.collection('scheduleStores').doc(this.branchId).collection('kv');
    this.fallback = firebase.database().ref(branch.fbPath);
    this.fallbackEnabled = boolFlag('SC_FIRESTORE_RTDDB_FALLBACK', true);
    this.mirrorRTDB = boolFlag('SC_FIRESTORE_MIRROR_RTDB', true);
    this.syncRTDBOnLoad = boolFlag('SC_FIRESTORE_SYNC_RTDB_ON_LOAD', true);
    this.disabled = false;
    this.muteRTDB = {};
  }

  FirestoreKVRoot.prototype._doc = function(key){
    return this.col.doc(encodeKey(key));
  };
  FirestoreKVRoot.prototype._chunkDoc = function(key, i){
    return this._doc(key).collection('chunks').doc(chunkId(i));
  };
  FirestoreKVRoot.prototype._knownChunkCount = function(item){
    if(!item || !item.chunked) return 0;
    return Math.max(0, Number(item.chunkCount || 0) || 0);
  };
  FirestoreKVRoot.prototype._deleteChunkRange = function(writer, key, from, to){
    const start = Math.max(0, Number(from || 0) || 0);
    const end = Math.max(start, Number(to || 0) || 0);
    for(let i=start;i<end;i++) writer.delete(this._chunkDoc(key, i));
  };
  FirestoreKVRoot.prototype._deleteKnownChunks = function(writer, key, item){
    this._deleteChunkRange(writer, key, 0, this._knownChunkCount(item));
  };
  FirestoreKVRoot.prototype._deleteKeyValue = function(writer, key, item){
    writer.delete(this._doc(key));
    this._deleteKnownChunks(writer, key, item);
  };
  FirestoreKVRoot.prototype._disable = function(reason){
    if(this.disabled) return;
    this.disabled = true;
    console.warn('[SCFirebaseStore] Firestore disabled, using Realtime Database fallback.', reason || '');
  };
  FirestoreKVRoot.prototype._list = function(opts){
    opts = opts || {};
    return this.col.get().then(qs=>{
      const reads = [];
      qs.forEach(doc=>{
        const item = doc.data() || {};
        const key = item.key || decodeKey(doc.id);
        if(!opts.includeDeferred && deferredRootKey(key)) return;
        reads.push(this._readStoredValue(key, item).then(value=>({key,value})));
      });
      return Promise.all(reads).then(items=>{
        const data = {};
        items.forEach(item=>{ data[item.key] = item.value; });
        return data;
      });
    });
  };
  FirestoreKVRoot.prototype._listKeys = function(opts){
    opts = opts || {};
    return this.col.get().then(qs=>{
      const keys = [];
      qs.forEach(doc=>{
        const item = doc.data() || {};
        const key = item.key || decodeKey(doc.id);
        if(!opts.includeDeferred && deferredRootKey(key)) return;
        keys.push(key);
      });
      return keys;
    });
  };
  FirestoreKVRoot.prototype._setFirestore = function(key, value){
    return this._doc(key).get().then(doc=>{
      const item = doc.exists ? (doc.data() || {}) : null;
      const batch = this.db.batch();
      if(value === undefined) this._deleteKeyValue(batch, key, item);
      else this._writeStoredValue(batch, key, value, item);
      return batch.commit();
    });
  };
  FirestoreKVRoot.prototype._readStoredValue = function(key, item){
    if(!item || !item.chunked) return Promise.resolve(item ? item.value : null);
    const reads = [];
    const count = Number(item.chunkCount || 0);
    for(let i=0;i<count;i++) reads.push(this._chunkDoc(key, i).get());
    return Promise.all(reads).then(snaps=>{
      const text = snaps.map(s=>((s.data() || {}).text || '')).join('');
      return decodeStoredValue(text, item.valueType !== 'json');
    });
  };
  FirestoreKVRoot.prototype._readStoredValueTx = function(tx, key, item){
    if(!item || !item.chunked) return Promise.resolve(item ? item.value : null);
    const reads = [];
    const count = Number(item.chunkCount || 0);
    for(let i=0;i<count;i++) reads.push(tx.get(this._chunkDoc(key, i)));
    return Promise.all(reads).then(snaps=>{
      const text = snaps.map(s=>((s.data() || {}).text || '')).join('');
      return decodeStoredValue(text, item.valueType !== 'json');
    });
  };
  FirestoreKVRoot.prototype._writeStoredValue = function(writer, key, value, previousItem){
    const encoded = encodeStoredValue(value);
    const previousCount = this._knownChunkCount(previousItem);
    if(encoded.text.length > CHUNK_THRESHOLD){
      const chunks = splitChunks(encoded.text);
      writer.set(this._doc(key), {
        key,
        chunked: true,
        chunkCount: chunks.length,
        valueType: encoded.isString ? 'string' : 'json',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, {merge:false});
      chunks.forEach((text, i)=>{
        writer.set(this._chunkDoc(key, i), {text}, {merge:false});
      });
      if(previousCount > chunks.length){
        this._deleteChunkRange(writer, key, chunks.length, previousCount);
      }
      return;
    }
    writer.set(this._doc(key), {
      key,
      value,
      chunked: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, {merge:false});
    this._deleteKnownChunks(writer, key, previousItem);
  };
  FirestoreKVRoot.prototype._mirrorSet = function(key, value){
    if(!this.mirrorRTDB || !this.fallbackEnabled) return Promise.resolve();
    this.muteRTDB[key] = value;
    return this.fallback.child(key).set(value).catch(error=>{
      console.warn('[SCFirebaseStore] RTDB mirror write failed:', key, error);
    });
  };
  FirestoreKVRoot.prototype._mirrorRemove = function(key){
    if(!this.mirrorRTDB || !this.fallbackEnabled) return Promise.resolve();
    this.muteRTDB[key] = null;
    return this.fallback.child(key).remove().catch(error=>{
      console.warn('[SCFirebaseStore] RTDB mirror remove failed:', key, error);
    });
  };
  FirestoreKVRoot.prototype._copyRTDBIntoFirestore = function(data, opts){
    opts = opts || {};
    const entries = Object.entries(filterRootData(data, !!opts.includeDeferred));
    if(!entries.length) return Promise.resolve();
    let chain = Promise.resolve();
    entries.forEach(([key,value])=>{
      chain = chain.then(()=>this._setFirestore(key, value));
    });
    return chain.then(()=>{
      console.log('[SCFirebaseStore] RTDB data migrated to Firestore:', this.branchId, entries.length);
    });
  };
  FirestoreKVRoot.prototype._backfillMissingRTDBKeys = function(firestoreData, fallbackData, opts){
    opts = opts || {};
    fallbackData = filterRootData(fallbackData, !!opts.includeDeferred);
    const updates = {};
    Object.entries(fallbackData || {}).forEach(([key,value])=>{
      const exists = Object.prototype.hasOwnProperty.call(firestoreData, key);
      if(!exists || (this.syncRTDBOnLoad && !sameValue(firestoreData[key], value))){
        updates[key] = value;
      }
    });
    const count = Object.keys(updates).length;
    const merged = this.syncRTDBOnLoad
      ? Object.assign({}, firestoreData, fallbackData)
      : Object.assign({}, fallbackData, firestoreData);
    if(!count) return Promise.resolve(merged);
    return this._copyRTDBIntoFirestore(updates, opts).then(()=>{
      console.log('[SCFirebaseStore] RTDB keys synced into Firestore:', this.branchId, count);
      return merged;
    });
  };
  FirestoreKVRoot.prototype._readFallbackRoot = function(opts){
    opts = opts || {};
    return this.fallback.once('value').then(snap=>filterRootData(snap.val() || {}, !!opts.includeDeferred));
  };
  FirestoreKVRoot.prototype.once = function(event){
    if(event !== 'value') return Promise.reject(new Error('Unsupported event: '+event));
    if(this.disabled){
      return this.fallback.once('value').then(snap=>{
        return new StoreSnapshot(null, filterRootData(snap.val() || {}, false));
      });
    }
    return this._list().then(data=>{
      if(!this.fallbackEnabled) return new StoreSnapshot(null, data);
      return this._readFallbackRoot().then(fallbackData=>{
        if(!Object.keys(fallbackData).length) return new StoreSnapshot(null, data);
        if(!Object.keys(data).length){
          return this._copyRTDBIntoFirestore(fallbackData).catch(error=>{
            if(recoverable(error)) this._disable(error);
            console.warn('[SCFirebaseStore] Initial migration failed:', error);
          }).then(()=>new StoreSnapshot(null, fallbackData));
        }
        return this._backfillMissingRTDBKeys(data, fallbackData).catch(error=>{
          if(recoverable(error)) this._disable(error);
          console.warn('[SCFirebaseStore] Missing-key backfill failed:', error);
          return Object.assign({}, fallbackData, data);
        }).then(merged=>new StoreSnapshot(null, merged));
      });
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.fallback.once('value').then(snap=>{
          return new StoreSnapshot(null, filterRootData(snap.val() || {}, false));
        });
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype.child = function(key){
    return new FirestoreKVChild(this, key);
  };
  FirestoreKVRoot.prototype._setKey = function(key, value, opts){
    opts = opts || {};
    if(this.disabled) return this.fallback.child(key).set(value);
    return this._setFirestore(key, value).then(()=>{
      if(!opts.skipMirror) return this._mirrorSet(key, value);
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.fallback.child(key).set(value);
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype._removeKey = function(key, opts){
    opts = opts || {};
    if(this.disabled) return this.fallback.child(key).remove();
    return this._setFirestore(key, undefined).then(()=>{
      if(!opts.skipMirror) return this._mirrorRemove(key);
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.fallback.child(key).remove();
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype._transactionKey = function(key, updateFn){
    if(this.disabled) return this.fallback.child(key).transaction(updateFn);
    let committed = false;
    let nextValue;
    return this.db.runTransaction(tx=>{
      const ref = this._doc(key);
      return tx.get(ref).then(doc=>{
        const item = doc.exists ? (doc.data() || {}) : null;
        return this._readStoredValueTx(tx, key, item).then(raw=>{
          const next = updateFn(raw);
          if(next === undefined){
            committed = false;
            return;
          }
          committed = true;
          nextValue = next;
          this._writeStoredValue(tx, key, next, item);
        });
      });
    }).then(()=>{
      if(!committed) return {committed:false, snapshot:new StoreSnapshot(key, null)};
      return this._mirrorSet(key, nextValue).then(()=>({
        committed:true,
        snapshot:new StoreSnapshot(key, nextValue),
      }));
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.fallback.child(key).transaction(updateFn);
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype.transaction = function(updateFn){
    if(this.disabled) return this.fallback.transaction(updateFn);
    let committed = false;
    let resultRoot = null;
    let changed = {};
    return this._listKeys().then(keys=>{
      return this.db.runTransaction(tx=>{
        const refs = {};
        const root = {};
        const items = {};
        keys.forEach(key=>{ refs[key] = this._doc(key); });
        let chain = Promise.resolve();
        keys.forEach(key=>{
          chain = chain.then(()=>tx.get(refs[key]).then(doc=>{
            const item = doc.exists ? (doc.data() || {}) : null;
            items[key] = item;
            return this._readStoredValueTx(tx, key, item).then(value=>{
              if(doc.exists) root[key] = value;
            });
          }));
        });
        return chain.then(()=>{
          const before = Object.assign({}, root);
          const next = updateFn(root);
          if(next === undefined){
            committed = false;
            return;
          }
          const nextRoot = next || root;
          const allKeys = {};
          Object.keys(before).forEach(k=>{ allKeys[k] = true; });
          Object.keys(nextRoot).forEach(k=>{ allKeys[k] = true; });
          Object.keys(allKeys).forEach(key=>{
            const value = nextRoot[key];
            if(value === undefined || value === null){
              if(before[key] !== undefined){
                this._deleteKeyValue(tx, key, items[key]);
                changed[key] = null;
              }
            } else if(!sameValue(before[key], value)){
              this._writeStoredValue(tx, key, value, items[key]);
              changed[key] = value;
            }
          });
          committed = true;
          resultRoot = nextRoot;
        });
      });
    }).then(()=>{
      if(!committed) return {committed:false, snapshot:new StoreSnapshot(null, null)};
      const mirrors = Object.entries(changed).map(([key,value])=>{
        return value === null ? this._mirrorRemove(key) : this._mirrorSet(key, value);
      });
      return Promise.all(mirrors).then(()=>({
        committed:true,
        snapshot:new StoreSnapshot(null, resultRoot || {}),
      }));
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.fallback.transaction(updateFn);
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype.transactionKeys = function(keys, updateFn){
    keys = [...new Set((keys || []).filter(Boolean))];
    if(!keys.length) return Promise.resolve({committed:false, snapshot:new StoreSnapshot(null, {})});
    if(this.disabled){
      return this.fallback.transaction(root=>{
        root = root || {};
        const partial = {};
        keys.forEach(key=>{ if(root[key] !== undefined) partial[key] = root[key]; });
        const next = updateFn(partial);
        if(next === undefined) return;
        const nextRoot = next || partial;
        keys.forEach(key=>{
          if(nextRoot[key] === undefined || nextRoot[key] === null) delete root[key];
          else root[key] = nextRoot[key];
        });
        return root;
      });
    }
    let committed = false;
    let resultRoot = null;
    let changed = {};
    return this.db.runTransaction(tx=>{
      const refs = {};
      const root = {};
      const items = {};
      keys.forEach(key=>{ refs[key] = this._doc(key); });
      let chain = Promise.resolve();
      keys.forEach(key=>{
        chain = chain.then(()=>tx.get(refs[key]).then(doc=>{
          const item = doc.exists ? (doc.data() || {}) : null;
          items[key] = item;
          return this._readStoredValueTx(tx, key, item).then(value=>{
            if(doc.exists) root[key] = value;
          });
        }));
      });
      return chain.then(()=>{
        const before = Object.assign({}, root);
        const next = updateFn(root);
        if(next === undefined){
          committed = false;
          return;
        }
        const nextRoot = next || root;
        keys.forEach(key=>{
          const value = nextRoot[key];
          if(value === undefined || value === null){
            if(before[key] !== undefined){
              this._deleteKeyValue(tx, key, items[key]);
              changed[key] = null;
            }
          } else if(!sameValue(before[key], value)){
            this._writeStoredValue(tx, key, value, items[key]);
            changed[key] = value;
          }
        });
        committed = true;
        resultRoot = nextRoot;
      });
    }).then(()=>{
      if(!committed) return {committed:false, snapshot:new StoreSnapshot(null, null)};
      const mirrors = Object.entries(changed).map(([key,value])=>{
        return value === null ? this._mirrorRemove(key) : this._mirrorSet(key, value);
      });
      return Promise.all(mirrors).then(()=>({
        committed:true,
        snapshot:new StoreSnapshot(null, resultRoot || {}),
      }));
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.transactionKeys(keys, updateFn);
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype.remove = function(){
    if(this.disabled) return this.fallback.remove();
    return this.col.get().then(qs=>{
      const refs = [];
      qs.forEach(doc=>{
        const item = doc.data() || {};
        const key = item.key || decodeKey(doc.id);
        refs.push(this._doc(key));
        const count = this._knownChunkCount(item);
        for(let i=0;i<count;i++) refs.push(this._chunkDoc(key, i));
      });
      const chunks = [];
      for(let i=0;i<refs.length;i+=400) chunks.push(refs.slice(i,i+400));
      let chain = Promise.resolve();
      chunks.forEach(chunk=>{
        chain = chain.then(()=>{
          const batch = this.db.batch();
          chunk.forEach(ref=>batch.delete(ref));
          return batch.commit();
        });
      });
      return chain.then(()=>this.mirrorRTDB ? this.fallback.remove() : undefined);
    }).catch(error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
        return this.fallback.remove();
      }
      throw error;
    });
  };
  FirestoreKVRoot.prototype._listenFirestore = function(event, cb){
    let initialized = false;
    return this.col.onSnapshot(qs=>{
      qs.docChanges().forEach(change=>{
        const item = change.doc.data() || {};
        const key = item.key || decodeKey(change.doc.id);
        if(deferredRootKey(key)) return;
        if(!initialized) return;
        if(event === 'child_removed' && change.type === 'removed'){
          cb(new StoreSnapshot(key, null));
        } else if(event === 'child_changed' && change.type !== 'removed'){
          this._readStoredValue(key, item).then(value=>{
            cb(new StoreSnapshot(key, value));
          }).catch(error=>{
            console.warn('[SCFirebaseStore] Firestore listener value read failed:', key, error);
          });
        }
      });
      initialized = true;
    }, error=>{
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
      } else {
        console.error('[SCFirebaseStore] Firestore listener failed:', error);
      }
    });
  };
  FirestoreKVRoot.prototype._listenFallbackMirror = function(event, cb){
    if(!this.fallbackEnabled || !this.mirrorRTDB) return null;
    const type = event === 'child_removed' ? 'child_removed' : 'child_changed';
    const handler = snap=>{
      const key = snap.key;
      const value = snap.val();
      if(deferredRootKey(key)) return;
      if(sameValue(this.muteRTDB[key], value)){
        delete this.muteRTDB[key];
        return;
      }
      if(this.disabled){
        cb(new StoreSnapshot(key, value));
        return;
      }
      const mirror = type === 'child_removed'
        ? this._removeKey(key, {skipMirror:true})
        : this._setKey(key, value, {skipMirror:true});
      mirror.catch(error=>{
        console.warn('[SCFirebaseStore] RTDB to Firestore mirror failed:', key, error);
        cb(new StoreSnapshot(key, value));
      });
    };
    this.fallback.on(type, handler);
    return ()=>this.fallback.off(type, handler);
  };
  FirestoreKVRoot.prototype.on = function(event, cb){
    if(this.disabled) return this.fallback.on(event, cb);
    const unsubs = [];
    if(event === 'child_changed' || event === 'child_removed'){
      unsubs.push(this._listenFirestore(event, cb));
      const fallbackUnsub = this._listenFallbackMirror(event, cb);
      if(fallbackUnsub) unsubs.push(fallbackUnsub);
      return function(){ unsubs.forEach(fn=>{ if(typeof fn === 'function') fn(); }); };
    }
    return this.fallback.on(event, cb);
  };

  function FirestoreKVChild(root, key){
    this.root = root;
    this.key = key;
  }
  FirestoreKVChild.prototype.set = function(value){ return this.root._setKey(this.key, value); };
  FirestoreKVChild.prototype.remove = function(){ return this.root._removeKey(this.key); };
  FirestoreKVChild.prototype.transaction = function(updateFn){ return this.root._transactionKey(this.key, updateFn); };
  FirestoreKVChild.prototype.once = function(event){
    if(event !== 'value') return Promise.reject(new Error('Unsupported event: '+event));
    if(this.root.disabled) return this.root.fallback.child(this.key).once('value');
    return this.root._doc(this.key).get().then(doc=>{
      const item = doc.exists ? (doc.data() || {}) : null;
      return this.root._readStoredValue(this.key, item);
    }).then(value=>{
      return new StoreSnapshot(this.key, value);
    }).catch(error=>{
      if(recoverable(error) && this.root.fallbackEnabled){
        this.root._disable(error);
        return this.root.fallback.child(this.key).once('value');
      }
      throw error;
    });
  };

  function createBranchRef(branch){
    if(!branch) throw new Error('branch is required');
    if(!useFirestore() || !firebase.firestore){
      return firebase.database().ref(branch.fbPath);
    }
    return new FirestoreKVRoot(branch);
  }
  function inspectBranch(branch){
    if(!branch) throw new Error('branch is required');
    const root = new FirestoreKVRoot(branch);
    return Promise.all([
      root._readFallbackRoot({includeDeferred:true}),
      root._list({includeDeferred:true}),
      root.col.get(),
    ]).then(([rtdbData, firestoreData, qs])=>{
      const firestoreKeys = [];
      const chunkedKeys = [];
      qs.forEach(doc=>{
        const item = doc.data() || {};
        const key = item.key || decodeKey(doc.id);
        firestoreKeys.push(key);
        if(item.chunked) chunkedKeys.push(key);
      });
      const rtdbKeys = Object.keys(rtdbData || {});
      const fsSet = new Set(firestoreKeys);
      const rtdbSet = new Set(rtdbKeys);
      return {
        branchId: root.branchId,
        rtdbKeyCount: rtdbKeys.length,
        firestoreKeyCount: firestoreKeys.length,
        chunkedKeyCount: chunkedKeys.length,
        chunkedKeys,
        missingInFirestore: rtdbKeys.filter(key=>!fsSet.has(key)),
        differentInFirestore: rtdbKeys.filter(key=>fsSet.has(key) && !sameValue((rtdbData || {})[key], firestoreData[key])),
        extraInFirestore: firestoreKeys.filter(key=>!rtdbSet.has(key)),
      };
    });
  }
  function backfillBranch(branch){
    const root = new FirestoreKVRoot(branch);
    return root.once('value').then(()=>inspectBranch(branch));
  }

  window.SCFirebaseStore = {
    createBranchRef,
    inspectBranch,
    backfillBranch,
    useFirestore,
    branchId,
  };
})();
