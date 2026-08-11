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
    swim_day_snapshot: true,
    zz_swim_audit_index: true,
    zz_swim_restore_index: true,
    zz_swim_student_delete_index: true,
  };
  const DEFERRED_ROOT_PREFIXES = [
    'swim_restore_point_',
    'swim_snap_',
    'swim_bt_day_snapshot_',
    'zz_swim_day_snapshot__',
    'zz_swim_audit_entry__',
    'zz_swim_restore_point__',
    'zz_swim_student_delete__',
  ];
  const LAZY_DOC_ID_PREFIX = 'zz_';

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
  function liveCollectionQuery(col){
    try{
      const fieldPath=firebase.firestore.FieldPath&&firebase.firestore.FieldPath.documentId();
      if(fieldPath&&col&&typeof col.where==='function'){
        return col.where(fieldPath, '<', LAZY_DOC_ID_PREFIX);
      }
    }catch(e){
      console.warn('[SCFirebaseStore] Lazy-key query unavailable; using full collection.', e);
    }
    return col;
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
    try{return JSON.parse(text);}catch(e){
      const error = new Error('Stored JSON chunks are incomplete or invalid');
      error.code = 'invalid-chunked-value';
      error.cause = e;
      throw error;
    }
  }
  function timestampVersion(value){
    if(!value) return '';
    const seconds = value.seconds !== undefined ? value.seconds : value._seconds;
    const nanoseconds = value.nanoseconds !== undefined ? value.nanoseconds : value._nanoseconds;
    if(seconds !== undefined){
      return String(seconds) + ':' + String(nanoseconds || 0);
    }
    if(typeof value.toMillis === 'function'){
      try{return 'ms:' + String(value.toMillis());}catch(e){}
    }
    return '';
  }
  function storedItemVersion(item){
    if(!item) return '';
    const updatedAt = timestampVersion(item.updatedAt);
    if(updatedAt) return 'ts:' + updatedAt;
    if(item.chunked) return '';
    try{return 'legacy:' + JSON.stringify(item.value);}catch(e){return '';}
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
    this.liveCol = liveCollectionQuery(this.col);
    this.fallback = firebase.database().ref(branch.fbPath);
    this.fallbackEnabled = boolFlag('SC_FIRESTORE_RTDDB_FALLBACK', true);
    this.mirrorRTDB = boolFlag('SC_FIRESTORE_MIRROR_RTDB', true);
    this.syncRTDBOnLoad = boolFlag('SC_FIRESTORE_SYNC_RTDB_ON_LOAD', true);
    this.disabled = false;
    this.muteRTDB = {};
    this.firestoreCallbacks = {
      child_changed: new Set(),
      child_removed: new Set(),
    };
    this.firestoreUnsubscribe = null;
    this.firestoreInitialized = false;
    this.firestoreVersions = new Map();
    this.firestoreListenerQueue = Promise.resolve();
    this.firestoreBatchUnsubscribe = null;
    this.firestoreBatchSubscribers = new Set();
    this.firestoreBatchInitialized = false;
    this.firestoreBatchRevision = 0;
    this.firestoreBatchListenerQueue = Promise.resolve();
    this.firestoreBatchFallbackUnsubscribers = [];
    this.firestoreBatchFallbackPending = {};
    this.firestoreBatchFallbackTimer = null;
    this.firestoreBatchFallbackQueue = Promise.resolve();
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
    const source=opts.includeDeferred?this.col:this.liveCol;
    return source.get().then(qs=>{
      const reads = [];
      const versions = new Map();
      qs.forEach(doc=>{
        const item = doc.data() || {};
        const key = item.key || decodeKey(doc.id);
        if(!opts.includeDeferred && deferredRootKey(key)) return;
        versions.set(key, storedItemVersion(item));
        reads.push(this._readStoredValue(key, item).then(value=>({key,value})));
      });
      return Promise.all(reads).then(items=>{
        const data = {};
        items.forEach(item=>{ data[item.key] = item.value; });
        if(!opts.includeDeferred) this.firestoreVersions = versions;
        return data;
      });
    });
  };
  FirestoreKVRoot.prototype._listKeys = function(opts){
    opts = opts || {};
    const source=opts.includeDeferred?this.col:this.liveCol;
    return source.get().then(qs=>{
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
      if(snaps.some(snap=>snap && snap.exists === false)){
        const error = new Error('Stored value chunk is missing: '+key);
        error.code = 'missing-chunk';
        throw error;
      }
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
      if(snaps.some(snap=>snap && snap.exists === false)){
        const error = new Error('Stored value chunk is missing in transaction: '+key);
        error.code = 'missing-chunk';
        throw error;
      }
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
  FirestoreKVRoot.prototype._prepareInitialBatchValues = function(firestoreData){
    firestoreData=firestoreData||{};
    if(!this.fallbackEnabled) return Promise.resolve(firestoreData);
    return this._readFallbackRoot().then(fallbackData=>{
      if(!Object.keys(fallbackData).length) return firestoreData;
      if(!Object.keys(firestoreData).length){
        return this._copyRTDBIntoFirestore(fallbackData).catch(error=>{
          if(recoverable(error)) this._disable(error);
          console.warn('[SCFirebaseStore] Initial batch migration failed:',error);
        }).then(()=>fallbackData);
      }
      return this._backfillMissingRTDBKeys(firestoreData,fallbackData).catch(error=>{
        if(recoverable(error)) this._disable(error);
        console.warn('[SCFirebaseStore] Initial batch backfill failed:',error);
        return Object.assign({},fallbackData,firestoreData);
      });
    });
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
        committed:true,snapshot:new StoreSnapshot(key, nextValue)
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
        committed:true,snapshot:new StoreSnapshot(null, resultRoot || {})
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
        committed:true,snapshot:new StoreSnapshot(null, resultRoot || {})
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
  FirestoreKVRoot.prototype._emitFirestore = function(event, snapshot){
    const callbacks = this.firestoreCallbacks[event];
    if(!callbacks || !callbacks.size) return;
    [...callbacks].forEach(cb=>{
      try{ cb(snapshot); }
      catch(error){ console.error('[SCFirebaseStore] Firestore listener callback failed:', event, error); }
    });
  };
  FirestoreKVRoot.prototype._stopFirestoreListenerIfIdle = function(){
    const active = Object.values(this.firestoreCallbacks).some(callbacks=>callbacks.size);
    if(active || !this.firestoreUnsubscribe) return;
    this.firestoreUnsubscribe();
    this.firestoreUnsubscribe = null;
    this.firestoreInitialized = false;
  };
  FirestoreKVRoot.prototype._ensureFirestoreListener = function(){
    if(this.firestoreUnsubscribe) return;
    this.firestoreInitialized = false;
    this.firestoreListenerQueue = Promise.resolve();
    this.firestoreUnsubscribe = this.liveCol.onSnapshot(qs=>{
      const initialSnapshot = !this.firestoreInitialized;
      this.firestoreInitialized = true;
      this.firestoreListenerQueue = this.firestoreListenerQueue.then(()=>{
        const knownBefore = initialSnapshot ? new Map(this.firestoreVersions) : null;
        const currentKeys = new Set();
        if(initialSnapshot){
          qs.forEach(doc=>{
            const item = doc.data() || {};
            const key = item.key || decodeKey(doc.id);
            if(!deferredRootKey(key)) currentKeys.add(key);
          });
        }
        const reads=qs.docChanges().map(change=>{
          const item = change.doc.data() || {};
          const key = item.key || decodeKey(change.doc.id);
          if(deferredRootKey(key)) return Promise.resolve(null);
          if(change.type === 'removed'){
            this.firestoreVersions.delete(key);
            return Promise.resolve({event:'child_removed',snapshot:new StoreSnapshot(key,null)});
          }
          const version = storedItemVersion(item);
          const previousVersion = initialSnapshot
            ? (knownBefore && knownBefore.get(key))
            : this.firestoreVersions.get(key);
          if(previousVersion && version && previousVersion === version){
            this.firestoreVersions.set(key, version);
            return Promise.resolve(null);
          }
          return this._readStoredValue(key,item).then(value=>{
            this.firestoreVersions.set(key, version);
            return {event:'child_changed',snapshot:new StoreSnapshot(key,value)};
          }).catch(error=>{
            console.warn('[SCFirebaseStore] Firestore listener value read failed:',key,error);
            return null;
          });
        });
        if(initialSnapshot){
          knownBefore.forEach((version,key)=>{
            if(currentKeys.has(key)) return;
            this.firestoreVersions.delete(key);
            reads.push(Promise.resolve({
              event:'child_removed',
              snapshot:new StoreSnapshot(key,null),
            }));
          });
        }
        // 한 Firestore 커밋에서 바뀐 문서를 모두 읽은 뒤 함께 전달한다.
        // 학생 문서와 등록/제외 문서가 서로 다른 시점의 화면으로 섞이는 것을 막는다.
        return Promise.all(reads).then(events=>{
          const validEvents=events.filter(Boolean);
          validEvents.forEach(event=>{
            this._emitFirestore(event.event,event.snapshot);
          });
        });
      }).catch(error=>{
        console.warn('[SCFirebaseStore] Firestore listener batch failed:',error);
      });
    }, error=>{
      this.firestoreUnsubscribe = null;
      this.firestoreInitialized = false;
      if(recoverable(error) && this.fallbackEnabled){
        this._disable(error);
      } else {
        console.error('[SCFirebaseStore] Firestore listener failed:', error);
      }
    });
  };
  FirestoreKVRoot.prototype._listenFirestore = function(event, cb){
    const callbacks = this.firestoreCallbacks[event];
    if(!callbacks || typeof cb !== 'function') return function(){};
    callbacks.add(cb);
    this._ensureFirestoreListener();
    let active = true;
    return ()=>{
      if(!active) return;
      active = false;
      callbacks.delete(cb);
      this._stopFirestoreListenerIfIdle();
    };
  };
  FirestoreKVRoot.prototype._emitFirestoreBatch = function(batch){
    [...this.firestoreBatchSubscribers].forEach(handlers=>{
      if(!handlers || typeof handlers.next !== 'function') return;
      try{ handlers.next(batch); }
      catch(error){ console.error('[SCFirebaseStore] Firestore batch callback failed:', error); }
    });
  };
  FirestoreKVRoot.prototype._emitFirestoreBatchError = function(error){
    [...this.firestoreBatchSubscribers].forEach(handlers=>{
      if(!handlers || typeof handlers.error !== 'function') return;
      try{ handlers.error(error); }
      catch(callbackError){ console.error('[SCFirebaseStore] Firestore batch error callback failed:', callbackError); }
    });
  };
  FirestoreKVRoot.prototype._ensureFirestoreBatchListener = function(){
    if(this.firestoreBatchUnsubscribe) return;
    this.firestoreBatchInitialized = false;
    this.firestoreBatchListenerQueue = Promise.resolve();
    this.firestoreBatchUnsubscribe = this.liveCol.onSnapshot(qs=>{
      const initialSnapshot=!this.firestoreBatchInitialized;
      this.firestoreBatchInitialized=true;
      this.firestoreBatchListenerQueue=this.firestoreBatchListenerQueue.then(()=>{
        const sourceChanges=[];
        const currentKeys=new Set();
        if(initialSnapshot){
          qs.forEach(doc=>{
            const item=doc.data()||{};
            const key=item.key||decodeKey(doc.id);
            if(deferredRootKey(key)) return;
            currentKeys.add(key);
            sourceChanges.push({type:'added',doc});
          });
        }else{
          qs.docChanges().forEach(change=>sourceChanges.push(change));
        }

        const pendingVersions=[];
        const removedKeys=[];
        const readErrors=[];
        const reads=sourceChanges.map(change=>{
          const item=change.doc.data()||{};
          const key=item.key||decodeKey(change.doc.id);
          if(deferredRootKey(key)) return Promise.resolve(null);
          if(change.type==='removed'){
            removedKeys.push(key);
            return Promise.resolve(null);
          }
          const version=storedItemVersion(item);
          if(!initialSnapshot){
            const previousVersion=this.firestoreVersions.get(key);
            if(previousVersion&&version&&previousVersion===version) return Promise.resolve(null);
          }
          return this._readStoredValue(key,item).then(value=>{
            pendingVersions.push([key,version]);
            return {key,value};
          }).catch(error=>{
            readErrors.push({key,error});
            return null;
          });
        });

        if(initialSnapshot){
          this.firestoreVersions.forEach((version,key)=>{
            if(!currentKeys.has(key)&&!deferredRootKey(key)) removedKeys.push(key);
          });
        }

        return Promise.all(reads).then(items=>{
          const values={};
          items.filter(Boolean).forEach(item=>{ values[item.key]=item.value; });
          const prepared=initialSnapshot
            ?this._prepareInitialBatchValues(values)
            :Promise.resolve(values);
          return prepared.then(preparedValues=>{
            pendingVersions.forEach(([key,version])=>this.firestoreVersions.set(key,version));
            removedKeys.forEach(key=>this.firestoreVersions.delete(key));
            const changedKeys=[...new Set(Object.keys(preparedValues).concat(removedKeys))];
            readErrors.forEach(item=>{
              const error=item.error instanceof Error?item.error:new Error(String(item.error||'read failed'));
              error.scheduleKey=item.key;
              this._emitFirestoreBatchError(error);
            });
            if(initialSnapshot||changedKeys.length){
              const batch={
                initial:initialSnapshot,
                revision:++this.firestoreBatchRevision,
                values:preparedValues,
                removedKeys:[...new Set(removedKeys)],
                changedKeys,
              };
              this._emitFirestoreBatch(batch);
            }
          });
        });
      }).catch(error=>{
        console.warn('[SCFirebaseStore] Firestore batch listener failed:',error);
        this._emitFirestoreBatchError(error);
      });
    },error=>{
      this.firestoreBatchUnsubscribe=null;
      this.firestoreBatchInitialized=false;
      if(recoverable(error)&&this.fallbackEnabled) this._disable(error);
      this._emitFirestoreBatchError(error);
    });
  };
  FirestoreKVRoot.prototype.subscribeSelectedBatches = function(options){
    options=options&&typeof options==='object'?options:{};
    if(typeof options.next!=='function') throw new TypeError('batch next callback is required');
    if(this.disabled) return subscribeSelectedRTDB(this.fallback,options);

    const root=this;
    const state={
      stopped:false,
      initialDone:false,
      revision:0,
      activeGeneration:0,
      baseKeys:new Set(normalizeSelectedKeys(options.baseKeys)),
      activeKeys:new Set(),
      auxiliaryKeys:new Map(),
      auxiliaryGenerations:new Map(),
      listeners:new Map(),
      pendingKeys:new Set(),
      pendingTimer:null,
    };

    function normalizeSelectedKeys(keys){
      return [...new Set((keys||[]).map(key=>String(key||'').trim()).filter(key=>key&&!deferredRootKey(key)))];
    }
    function sameKeySet(left,right){
      if(left.size!==right.size) return false;
      for(const key of left) if(!right.has(key)) return false;
      return true;
    }
    function report(error){
      if(state.stopped||typeof options.error!=='function') return;
      try{ options.error(error); }
      catch(callbackError){ console.error('[SCFirebaseStore] Selected listener error callback failed:',callbackError); }
    }
    function emit(initial,keys){
      if(state.stopped) return;
      const values={};
      const removedKeys=[];
      normalizeSelectedKeys(keys).forEach(key=>{
        const entry=state.listeners.get(key);
        if(!entry||!entry.hasFirst) return;
        if(entry.present) values[key]=entry.value;
        else removedKeys.push(key);
      });
      const changedKeys=[...new Set(Object.keys(values).concat(removedKeys))];
      if(!initial&&!changedKeys.length) return;
      options.next({
        initial:!!initial,
        revision:++state.revision,
        values,
        removedKeys,
        changedKeys,
      });
    }
    function flushPending(){
      state.pendingTimer=null;
      if(state.stopped||!state.initialDone) return;
      const keys=[...state.pendingKeys];
      state.pendingKeys.clear();
      emit(false,keys);
    }
    function queueChanged(key){
      if(state.stopped||!state.initialDone) return;
      state.pendingKeys.add(key);
      if(state.pendingTimer) return;
      state.pendingTimer=setTimeout(flushPending,0);
    }
    function isReferenced(key){
      if(state.baseKeys.has(key)||state.activeKeys.has(key)) return true;
      for(const keys of state.auxiliaryKeys.values()) if(keys.has(key)) return true;
      const entry=state.listeners.get(key);
      return !!(entry&&entry.holds.size);
    }
    function cleanupKey(key){
      if(isReferenced(key)) return;
      const entry=state.listeners.get(key);
      if(!entry) return;
      entry.closed=true;
      if(typeof entry.unsubscribe==='function') entry.unsubscribe();
      state.listeners.delete(key);
      state.pendingKeys.delete(key);
    }
    function releaseHold(keys,token){
      normalizeSelectedKeys(keys).forEach(key=>{
        const entry=state.listeners.get(key);
        if(entry) entry.holds.delete(token);
        cleanupKey(key);
      });
    }
    function ensureListener(key,token){
      let entry=state.listeners.get(key);
      if(entry){
        if(token) entry.holds.add(token);
        return entry.ready;
      }
      let resolveReady;
      let rejectReady;
      entry={
        key,
        unsubscribe:null,
        closed:false,
        hasFirst:false,
        present:false,
        value:undefined,
        version:'',
        sequence:0,
        holds:new Set(token?[token]:[]),
        ready:null,
      };
      entry.ready=new Promise((resolve,reject)=>{
        resolveReady=resolve;
        rejectReady=reject;
      });
      state.listeners.set(key,entry);

      function fail(error){
        if(state.stopped||entry.closed) return;
        const normalized=error instanceof Error?error:new Error(String(error||'selected listener failed'));
        normalized.scheduleKey=key;
        report(normalized);
        if(!entry.hasFirst){
          entry.closed=true;
          if(typeof entry.unsubscribe==='function') entry.unsubscribe();
          rejectReady(normalized);
        }
      }
      function applyValue(sequence,present,value,version){
        if(state.stopped||entry.closed||sequence!==entry.sequence) return;
        const first=!entry.hasFirst;
        const changed=first||entry.present!==present||(present&&!sameValue(entry.value,value));
        entry.hasFirst=true;
        entry.present=present;
        entry.value=present?value:undefined;
        entry.version=version||'';
        if(first) resolveReady(entry);
        if(!first&&changed&&!entry.holds.size) queueChanged(key);
      }
      entry.unsubscribe=root._doc(key).onSnapshot(snapshot=>{
        const sequence=++entry.sequence;
        if(!snapshot||!snapshot.exists){
          applyValue(sequence,false,undefined,'');
          return;
        }
        const item=snapshot.data()||{};
        const version=storedItemVersion(item);
        if(entry.hasFirst&&version&&entry.version===version) return;
        Promise.resolve(root._readStoredValue(key,item)).then(value=>{
          applyValue(sequence,true,value,version);
        }).catch(fail);
      },fail);
      return entry.ready;
    }
    function waitForKeys(keys,token){
      return Promise.all(normalizeSelectedKeys(keys).map(key=>ensureListener(key,token)));
    }
    function cleanupCandidates(keys){
      normalizeSelectedKeys(keys).forEach(cleanupKey);
    }

    const initialBaseToken={type:'initial-base'};
    const initialActiveToken={type:'initial-active'};
    const initialPromise=waitForKeys([...state.baseKeys],initialBaseToken).then(()=>{
      if(state.stopped) return {stale:true};
      const baseValues={};
      state.baseKeys.forEach(key=>{
        const entry=state.listeners.get(key);
        if(entry&&entry.hasFirst&&entry.present) baseValues[key]=entry.value;
      });
      const resolver=typeof options.resolveInitialActiveKeys==='function'
        ?options.resolveInitialActiveKeys
        :function(){ return []; };
      const keys=normalizeSelectedKeys(resolver(baseValues)||[]);
      state.activeKeys=new Set(keys);
      return waitForKeys(keys,initialActiveToken).then(()=>{
        if(state.stopped) return {stale:true};
        emit(true,[...state.baseKeys,...state.activeKeys]);
        state.initialDone=true;
        releaseHold([...state.baseKeys],initialBaseToken);
        releaseHold([...state.activeKeys],initialActiveToken);
        return {stale:false};
      });
    }).catch(error=>{
      releaseHold([...state.baseKeys],initialBaseToken);
      releaseHold([...state.activeKeys],initialActiveToken);
      throw error;
    });
    // The controller exposes readiness so callers can gate rendering and writes.
    initialPromise.catch(()=>{});

    function beginActiveReplacement(target){
        if(state.stopped) return {stale:true};
        const generation=++state.activeGeneration;
        if(sameKeySet(target,state.activeKeys)) return {stale:false};
        const token={type:'active',generation};
        const oldKeys=[...state.activeKeys];
        return waitForKeys([...target],token).then(()=>{
          if(state.stopped||generation!==state.activeGeneration){
            releaseHold([...target],token);
            cleanupCandidates([...target]);
            return {stale:true};
          }
          state.activeKeys=target;
          emit(false,[...target]);
          releaseHold([...target],token);
          cleanupCandidates(oldKeys);
          return {stale:false};
        }).catch(error=>{
          releaseHold([...target],token);
          cleanupCandidates([...target]);
          throw error;
        });
    }
    function setActiveKeys(keys){
      const target=new Set(normalizeSelectedKeys(keys));
      if(state.initialDone) return Promise.resolve(beginActiveReplacement(target));
      return initialPromise.then(()=>beginActiveReplacement(target));
    }
    function beginAuxiliaryReplacement(owner,target){
        if(state.stopped) return {stale:true};
        const current=state.auxiliaryKeys.get(owner)||new Set();
        const generation=(state.auxiliaryGenerations.get(owner)||0)+1;
        state.auxiliaryGenerations.set(owner,generation);
        if(sameKeySet(target,current)) return {stale:false};
        const token={type:'auxiliary',owner,generation};
        const oldKeys=[...current];
        return waitForKeys([...target],token).then(()=>{
          if(state.stopped||state.auxiliaryGenerations.get(owner)!==generation){
            releaseHold([...target],token);
            cleanupCandidates([...target]);
            return {stale:true};
          }
          state.auxiliaryKeys.set(owner,target);
          emit(false,[...target]);
          releaseHold([...target],token);
          cleanupCandidates(oldKeys);
          return {stale:false};
        }).catch(error=>{
          releaseHold([...target],token);
          cleanupCandidates([...target]);
          throw error;
        });
    }
    function setAuxiliaryKeys(owner,keys){
      owner=String(owner||'').trim();
      if(!owner) return Promise.reject(new Error('auxiliary owner is required'));
      const target=new Set(normalizeSelectedKeys(keys));
      if(state.initialDone) return Promise.resolve(beginAuxiliaryReplacement(owner,target));
      return initialPromise.then(()=>beginAuxiliaryReplacement(owner,target));
    }
    function releaseAuxiliaryKeys(owner){
      owner=String(owner||'').trim();
      if(!owner) return;
      state.auxiliaryGenerations.set(owner,(state.auxiliaryGenerations.get(owner)||0)+1);
      const oldKeys=[...(state.auxiliaryKeys.get(owner)||[])];
      state.auxiliaryKeys.delete(owner);
      cleanupCandidates(oldKeys);
    }
    function waitForActive(keys){
      return initialPromise.then(()=>waitForKeys(normalizeSelectedKeys(keys),null)).then(()=>({stale:false}));
    }
    function stop(){
      if(state.stopped) return;
      state.stopped=true;
      if(state.pendingTimer){
        clearTimeout(state.pendingTimer);
        state.pendingTimer=null;
      }
      state.listeners.forEach(entry=>{
        entry.closed=true;
        if(typeof entry.unsubscribe==='function') entry.unsubscribe();
      });
      state.listeners.clear();
      state.pendingKeys.clear();
      state.auxiliaryKeys.clear();
    }

    return {
      ready:initialPromise,
      setActiveKeys,
      setAuxiliaryKeys,
      releaseAuxiliaryKeys,
      waitForActive,
      stop,
    };
  };
  FirestoreKVRoot.prototype.subscribeBatches = function(handlers){
    const subscriber=handlers&&typeof handlers==='object'?handlers:{};
    if(typeof subscriber.next!=='function') throw new TypeError('batch next callback is required');
    const firstSubscriber=this.firestoreBatchSubscribers.size===0;
    this.firestoreBatchSubscribers.add(subscriber);
    this._ensureFirestoreBatchListener();
    if(firstSubscriber){
      this.firestoreBatchFallbackUnsubscribers=this._listenFallbackBatchMirror();
    }
    let active=true;
    return ()=>{
      if(!active) return;
      active=false;
      this.firestoreBatchSubscribers.delete(subscriber);
      if(this.firestoreBatchSubscribers.size) return;
      this.firestoreBatchFallbackUnsubscribers.splice(0).forEach(fn=>fn());
      if(this.firestoreBatchFallbackTimer){
        clearTimeout(this.firestoreBatchFallbackTimer);
        this.firestoreBatchFallbackTimer=null;
      }
      this.firestoreBatchFallbackPending={};
      if(this.firestoreBatchUnsubscribe){
        this.firestoreBatchUnsubscribe();
        this.firestoreBatchUnsubscribe=null;
      }
      this.firestoreBatchInitialized=false;
    };
  };
  FirestoreKVRoot.prototype._emitFallbackBatch = function(changes){
    const values={};
    const removedKeys=[];
    Object.entries(changes||{}).forEach(([key,value])=>{
      if(value===null||value===undefined) removedKeys.push(key);
      else values[key]=value;
    });
    const changedKeys=[...new Set(Object.keys(values).concat(removedKeys))];
    if(!changedKeys.length) return;
    this._emitFirestoreBatch({
      initial:false,
      revision:++this.firestoreBatchRevision,
      values,
      removedKeys,
      changedKeys,
    });
  };
  FirestoreKVRoot.prototype._applyFallbackBatchToFirestore = function(changes){
    const keys=Object.keys(changes||{}).filter(key=>!deferredRootKey(key));
    if(!keys.length) return Promise.resolve();
    return this.db.runTransaction(tx=>{
      return Promise.all(keys.map(key=>tx.get(this._doc(key)))).then(docs=>{
        docs.forEach((doc,index)=>{
          const key=keys[index];
          const item=doc&&doc.exists?(doc.data()||{}):null;
          const value=changes[key];
          if(value===null||value===undefined) this._deleteKeyValue(tx,key,item);
          else this._writeStoredValue(tx,key,value,item);
        });
      });
    });
  };
  FirestoreKVRoot.prototype._flushFallbackBatch = function(){
    this.firestoreBatchFallbackTimer=null;
    const changes=this.firestoreBatchFallbackPending;
    this.firestoreBatchFallbackPending={};
    if(!Object.keys(changes).length) return;
    this.firestoreBatchFallbackQueue=this.firestoreBatchFallbackQueue.then(()=>{
      if(this.disabled){
        this._emitFallbackBatch(changes);
        return;
      }
      if(!this.mirrorRTDB) return;
      return this._applyFallbackBatchToFirestore(changes).catch(error=>{
        console.warn('[SCFirebaseStore] RTDB batch mirror failed:',error);
        if(recoverable(error)&&this.fallbackEnabled) this._disable(error);
        this._emitFirestoreBatchError(error);
        this._emitFallbackBatch(changes);
      });
    });
  };
  FirestoreKVRoot.prototype._queueFallbackBatch = function(key,value){
    if(!key||deferredRootKey(key)) return;
    this.firestoreBatchFallbackPending[key]=value;
    if(this.firestoreBatchFallbackTimer) return;
    this.firestoreBatchFallbackTimer=setTimeout(()=>this._flushFallbackBatch(),0);
  };
  FirestoreKVRoot.prototype._listenFallbackBatchMirror = function(){
    if(!this.fallbackEnabled||!this.fallback||typeof this.fallback.on!=='function') return [];
    const changed=snap=>{
      const key=snap.key;
      const value=snap.val();
      if(sameValue(this.muteRTDB[key],value)){
        delete this.muteRTDB[key];
        return;
      }
      this._queueFallbackBatch(key,value);
    };
    const removed=snap=>{
      const key=snap.key;
      if(sameValue(this.muteRTDB[key],null)){
        delete this.muteRTDB[key];
        return;
      }
      this._queueFallbackBatch(key,null);
    };
    this.fallback.on('child_changed',changed);
    this.fallback.on('child_removed',removed);
    return [
      ()=>this.fallback.off('child_changed',changed),
      ()=>this.fallback.off('child_removed',removed),
    ];
  };
  FirestoreKVRoot.prototype._listenFallbackMirror = function(event, cb){
    if(!this.fallbackEnabled || !this.mirrorRTDB || !this.fallback || typeof this.fallback.on!=='function') return null;
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

  function operationalDomain(key){
    if(!window.SCV2OperationalModel||typeof SCV2OperationalModel.domainForLegacyKey!=='function') return '';
    return SCV2OperationalModel.domainForLegacyKey(String(key||''));
  }
  function requestOperationalPageReload(details){
    const fingerprint=[
      String(details?.branchId||''),String(details?.mode||''),String(details?.generationId||''),
      Math.max(0,Number(details?.epoch)||0),Math.max(0,Number(details?.revision)||0),
    ].join('|');
    const storageKey='sc_operational_reload_fingerprint';
    try{
      if(window.sessionStorage&&sessionStorage.getItem(storageKey)===fingerprint) return;
      if(window.sessionStorage) sessionStorage.setItem(storageKey,fingerprint);
    }catch(e){}
    if(typeof window.SC_OPERATIONAL_RELOAD_HANDLER==='function'){
      window.SC_OPERATIONAL_RELOAD_HANDLER(details);
      return;
    }
    if(window.location&&typeof window.location.reload==='function') window.location.reload();
  }
  function operationalCompatibilityRoot(operationalRoot,legacyRoot,operationalBranchId,requestRecovery){
    if(typeof Proxy!=='function') return operationalRoot;
    function copy(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
    function operationId(meta){
      const supplied=String(meta?.operationId||'').trim();
      if(supplied) return supplied;
      if(window.crypto&&typeof window.crypto.randomUUID==='function') return window.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{
        const value=Math.floor(Math.random()*16);
        return (char==='x'?value:(value&3)|8).toString(16);
      });
    }
    function parseRequests(raw){
      const parsed=typeof raw==='string'?JSON.parse(raw||'{}'):copy(raw||{});
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw Object.assign(new Error('요청 상태를 확인할 수 없습니다.'),{code:'invalid-request-recovery'});
      return parsed;
    }
    function deriveRequestIntents(beforeRaw,afterRaw){
      const before=parseRequests(beforeRaw);
      const after=parseRequests(afterRaw);
      const ids=[...new Set([...Object.keys(before),...Object.keys(after)])];
      const allowed=new Set([
        'status','processedAt','processedBy','supersededBy','cancelledAt','cancelledBy',
        'cancelledRequestId','processingAt','processingBy',
      ]);
      const intents=[];
      ids.forEach(requestId=>{
        const previous=before[requestId];
        const next=after[requestId];
        if(!previous||!next||typeof previous!=='object'||typeof next!=='object'){
          throw Object.assign(new Error('요청 항목 변경 범위를 확인할 수 없습니다.'),{code:'invalid-request-recovery'});
        }
        const changed=[...new Set([...Object.keys(previous),...Object.keys(next)])]
          .filter(key=>JSON.stringify(previous[key])!==JSON.stringify(next[key]));
        if(!changed.length) return;
        if(changed.some(key=>!allowed.has(key))){
          throw Object.assign(new Error('요청 처리 필드만 함께 저장할 수 있습니다.'),{code:'invalid-request-recovery'});
        }
        const patch={status:String(next.status||'')};
        if(!patch.status) throw Object.assign(new Error('요청 처리 상태를 확인할 수 없습니다.'),{code:'invalid-request-recovery'});
        ['processedAt','supersededBy','cancelledAt','cancelledBy','cancelledRequestId'].forEach(key=>{
          if(Object.prototype.hasOwnProperty.call(next,key)) patch[key]=String(next[key]||'');
        });
        if((Object.prototype.hasOwnProperty.call(previous,'processingAt')&&!Object.prototype.hasOwnProperty.call(next,'processingAt'))||
            (Object.prototype.hasOwnProperty.call(previous,'processingBy')&&!Object.prototype.hasOwnProperty.call(next,'processingBy'))){
          patch.clearProcessing=true;
        }
        const version=Number.isSafeInteger(previous.requestVersion)?previous.requestVersion:
          (Number.isSafeInteger(previous.version)?previous.version:null);
        intents.push({
          requestId:String(requestId),expectedStatus:String(previous.status||'pending'),
          expectedVersion:version,patch,
        });
      });
      if(!intents.length) throw Object.assign(new Error('요청 처리 변경 내용을 확인할 수 없습니다.'),{code:'invalid-request-recovery'});
      return intents;
    }
    async function callRecovery(command,attempts){
      if(typeof requestRecovery!=='function') throw Object.assign(new Error('요청 복구 서비스를 사용할 수 없습니다.'),{code:'request-recovery-unavailable'});
      let lastError;
      for(let attempt=0;attempt<attempts;attempt+=1){
        try{
          const response=await requestRecovery(copy(command));
          const data=response&&response.data&&typeof response.data==='object'?response.data:response;
          return data&&typeof data==='object'?data:{};
        }catch(error){ lastError=error; }
      }
      throw lastError;
    }
    function drainRequestRecoveries(operationIdValue){
      return callRecovery({
        version:1,action:'drain',branchId:operationalBranchId,operationId:String(operationIdValue||''),
      },1);
    }
    async function transactionMixed(keys,updateFn,meta){
      const tracked=keys.filter(operationalDomain);
      const legacy=keys.filter(key=>!operationalDomain(key));
      const config=await operationalRoot.ready();
      if(!config||!['v2-read','v2'].includes(String(config.mode||''))){
        return legacyRoot.transactionKeys(keys,updateFn);
      }
      if(legacy.length!==1||legacy[0]!=='swim_requests'){
        throw Object.assign(new Error('이 혼합 저장은 지원되지 않습니다.'),{code:'unsupported-mixed-operation'});
      }
      const entries=await Promise.all(keys.map(key=>{
        const owner=operationalDomain(key)?operationalRoot:legacyRoot;
        return owner.child(key).once('value').then(snapshot=>[key,snapshot.val()]);
      }));
      const before={};
      entries.forEach(([key,value])=>{ if(value!==null&&value!==undefined) before[key]=value; });
      const draft=copy(before);
      const returned=await updateFn(draft);
      if(returned===undefined) return {committed:false,snapshot:new StoreSnapshot(null,null)};
      const after=returned&&typeof returned==='object'?returned:draft;
      const stableMeta={...(meta||{}),operationId:operationId(meta),requireOperationManifest:true};
      const stageCommand={
        version:1,action:'stage',branchId:operationalBranchId,
        operationId:stableMeta.operationId,operationType:String(stableMeta.operationType||''),
        intents:deriveRequestIntents(before.swim_requests,after.swim_requests),
      };
      await callRecovery(stageCommand,2);
      const primary=await operationalRoot.transactionKeys(tracked,current=>{
        const next=current&&typeof current==='object'?current:{};
        tracked.forEach(key=>{
          if(Object.prototype.hasOwnProperty.call(after,key)&&after[key]!==undefined&&after[key]!==null) next[key]=after[key];
          else delete next[key];
        });
        return next;
      },stableMeta);
      if(!primary||primary.committed!==true) return primary;
      const recovery=await drainRequestRecoveries(stableMeta.operationId);
      if(!recovery||recovery.state!=='completed'){
        throw Object.assign(new Error('요청 처리 마무리를 기다리고 있습니다.'),{code:String(recovery?.code||'request-recovery-pending')});
      }
      const requestSnapshot=await legacyRoot.child('swim_requests').once('value');
      const merged={};
      const primaryValues=primary.snapshot&&typeof primary.snapshot.val==='function'?primary.snapshot.val()||{}:{};
      tracked.forEach(key=>{
        if(Object.prototype.hasOwnProperty.call(primaryValues,key)) merged[key]=primaryValues[key];
      });
      merged.swim_requests=requestSnapshot.val();
      return Object.assign({},primary,{snapshot:new StoreSnapshot(null,merged)});
    }
    return new Proxy(operationalRoot,{
      get(target,property,receiver){
        if(property==='subscribeSelectedBatches'){
          return options=>{
            Promise.resolve(drainRequestRecoveries('')).catch(()=>undefined);
            return target.subscribeSelectedBatches(options);
          };
        }
        if(property==='child') return key=>operationalDomain(key)?target.child(key):legacyRoot.child(key);
        if(property==='transactionKeys'){
          return (keys,updateFn,meta)=>{
            const selected=[...new Set((keys||[]).map(key=>String(key||'')).filter(Boolean))];
            if(selected.length&&selected.every(operationalDomain)) return target.transactionKeys(selected,updateFn,meta);
            if(selected.every(key=>!operationalDomain(key))) return legacyRoot.transactionKeys(selected,updateFn);
            return transactionMixed(selected,updateFn,meta);
          };
        }
        if(property==='_list'&&typeof legacyRoot._list==='function') return legacyRoot._list.bind(legacyRoot);
        return Reflect.get(target,property,receiver);
      },
    });
  }

  function createBranchRef(branch){
    if(!branch) throw new Error('branch is required');
    const legacyRoot=(!useFirestore() || !firebase.firestore)
      ?firebase.database().ref(branch.fbPath)
      :new FirestoreKVRoot(branch);
    const operationalReady=!!(
      window.SCAuth
      &&firebase.auth
      &&firebase.auth().currentUser
      &&window.SCV2OperationalStore
      &&typeof SCV2OperationalStore.create==='function'
      &&window.SCOperationalSchedule
      &&typeof SCOperationalSchedule.create==='function'
      &&window.SCV2OperationalModel
    );
    if(!operationalReady||typeof firebase.firestore!=='function'||typeof legacyRoot.transactionKeys!=='function'){
      return legacyRoot;
    }
    const id=branchId(branch);
    const db=firebase.firestore();
    const functions=firebase.app().functions('asia-northeast3');
    const v2Store=SCV2OperationalStore.create({db,branchId:id,model:SCV2OperationalModel});
    const operationalRoot=SCOperationalSchedule.create({
      branch,
      branchId:id,
      legacyRoot,
      db,
      v2Store,
      model:SCV2OperationalModel,
      functions,
      defaultTabIds:['regular'],
      getBranchId:()=>String(window.SC_SELECTED_BRANCH||id),
      onReloadRequired:requestOperationalPageReload,
    });
    const requestRecovery=functions.httpsCallable('manageScheduleV2RequestRecovery');
    return operationalCompatibilityRoot(operationalRoot,legacyRoot,id,requestRecovery);
  }
  function subscribeSelectedRTDB(root,options){
    if(!root||typeof root.child!=='function') throw new Error('selected root is required');
    const bridge={
      disabled:false,
      _doc(key){
        const child=root.child(key);
        return {
          onSnapshot(next,error){
            const handler=snapshot=>{
              const value=snapshot&&typeof snapshot.val==='function'?snapshot.val():null;
              const exists=snapshot&&typeof snapshot.exists==='function'
                ?snapshot.exists()
                :value!==null&&value!==undefined;
              next({
                exists,
                data(){ return exists?{key,value}:null; },
              });
            };
            child.on('value',handler,error);
            return ()=>{
              if(typeof child.off==='function') child.off('value',handler);
            };
          },
        };
      },
      _readStoredValue(key,item){
        return Promise.resolve(item?item.value:null);
      },
    };
    return FirestoreKVRoot.prototype.subscribeSelectedBatches.call(bridge,options);
  }
  function subscribeSelectedRootBatches(root,options){
    if(!root) throw new Error('root is required');
    if(typeof root.subscribeSelectedBatches==='function') return root.subscribeSelectedBatches(options);
    return subscribeSelectedRTDB(root,options);
  }
  function subscribeRootBatches(root,handlers){
    if(!root) throw new Error('root is required');
    handlers=handlers&&typeof handlers==='object'?handlers:{};
    if(typeof handlers.next!=='function') throw new TypeError('batch next callback is required');
    if(typeof root.subscribeBatches==='function') return root.subscribeBatches(handlers);

    let active=true;
    let initialPending=true;
    let revision=0;
    let flushScheduled=false;
    const queued=[];
    const pendingValues={};
    const pendingRemovals=new Set();

    function report(error){
      if(active&&typeof handlers.error==='function') handlers.error(error);
    }
    function emit(initial,values,removedKeys){
      if(!active) return;
      const filtered=filterRootData(values||{},false);
      const removed=[...new Set((removedKeys||[]).filter(key=>!deferredRootKey(key)))];
      handlers.next({
        initial:!!initial,
        revision:++revision,
        values:filtered,
        removedKeys:removed,
        changedKeys:[...new Set(Object.keys(filtered).concat(removed))],
      });
    }
    function flush(){
      flushScheduled=false;
      if(!active||initialPending) return;
      const keys=Object.keys(pendingValues);
      const removed=[...pendingRemovals];
      if(!keys.length&&!removed.length) return;
      const values={};
      keys.forEach(key=>{
        values[key]=pendingValues[key];
        delete pendingValues[key];
      });
      pendingRemovals.clear();
      emit(false,values,removed);
    }
    function scheduleFlush(){
      if(flushScheduled||initialPending||!active) return;
      flushScheduled=true;
      Promise.resolve().then(flush);
    }
    function applyEvent(event){
      const key=String(event.key||'');
      if(!key||deferredRootKey(key)) return;
      if(event.type==='child_removed'){
        delete pendingValues[key];
        pendingRemovals.add(key);
      }else{
        pendingRemovals.delete(key);
        pendingValues[key]=event.value;
      }
      scheduleFlush();
    }
    function onChanged(snap){
      const event={type:'child_changed',key:snap&&snap.key,value:snap&&snap.val?snap.val():null};
      if(initialPending) queued.push(event);
      else applyEvent(event);
    }
    function onRemoved(snap){
      const event={type:'child_removed',key:snap&&snap.key,value:null};
      if(initialPending) queued.push(event);
      else applyEvent(event);
    }

    root.on('child_changed',onChanged);
    root.on('child_removed',onRemoved);
    Promise.resolve(root.once('value')).then(snapshot=>{
      if(!active) return;
      emit(true,snapshot&&typeof snapshot.val==='function'?(snapshot.val()||{}):{},[]);
      initialPending=false;
      queued.splice(0).forEach(applyEvent);
      scheduleFlush();
    }).catch(report);

    return ()=>{
      if(!active) return;
      active=false;
      if(typeof root.off==='function'){
        root.off('child_changed',onChanged);
        root.off('child_removed',onRemoved);
      }
      queued.length=0;
      pendingRemovals.clear();
      Object.keys(pendingValues).forEach(key=>delete pendingValues[key]);
    };
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
    subscribeSelectedRootBatches,
    subscribeRootBatches,
    useFirestore,
    branchId,
  };
})();
