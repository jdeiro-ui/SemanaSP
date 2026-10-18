// Backup na nuvem com Firebase (login Google + Firestore). Os dados continuam no
// aparelho (app.js); este módulo envia cada mudança para users/{uid}/expenses e
// aplica o que chega de outros aparelhos. Configuração em firebase-config.js.
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const $ = (sel) => document.querySelector(sel);
const statusEl = $('#cloud-status');
const show = (el, visible) => { el.hidden = !visible; };
const setStatus = (text) => { statusEl.textContent = text; };

async function main() {
  const config = window.FIREBASE_CONFIG;
  if (!config) {
    setStatus('Backup na nuvem ainda não configurado neste app.');
    return;
  }
  let sdk;
  try {
    sdk = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
  } catch (_) {
    setStatus('Sem conexão para carregar o backup na nuvem. Os dados seguem salvos no aparelho.');
    return;
  }
  const [{ initializeApp }, A, F] = sdk;

  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
  });
  // Para testes locais com o emulador do Firebase.
  const emulator = localStorage.getItem('semanasp:emulator');
  if (emulator) {
    A.connectAuthEmulator(auth, `http://${emulator}:9099`, { disableWarnings: true });
    F.connectFirestoreEmulator(db, emulator, 8080);
    // Só nos testes: o emulador aceita uma credencial Google "falsa" em JSON.
    window.semanaspEmulatorSignIn = (claims) =>
      A.signInWithCredential(auth, A.GoogleAuthProvider.credential(JSON.stringify(claims)));
  }

  let user = null;
  let unsubscribe = [];
  let remote = new Map();        // id -> documento remoto (como está na nuvem)
  let remoteSettings = null;
  let serverSeen = false;        // só envia depois de ver a versão do servidor
  let pending = false;
  let lastSync = null;

  function refreshStatus() {
    show($('#cloud-login'), !user);
    show($('#cloud-logout'), !!user);
    show($('#cloud-sync'), !!user);
    if (!user) {
      setStatus('Desconectado. Entre com Google para guardar os dados na nuvem e usar em mais de um aparelho.');
      return;
    }
    const who = `Conectado como ${user.email}.`;
    if (!navigator.onLine) setStatus(`${who} Sem internet: as mudanças sobem quando a conexão voltar.`);
    else if (!serverSeen) setStatus(`${who} Sincronizando…`);
    else if (pending) setStatus(`${who} Enviando mudanças…`);
    else setStatus(`${who} Tudo salvo na nuvem${lastSync ? ` · ${lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.`);
  }

  function upload() {
    if (!user || !serverSeen) return;
    const state = window.SemanaSP.getState();
    const docs = Calc.pendingUploads(state.expenses, state.deleted, remote);
    const col = F.collection(db, 'users', user.uid, 'expenses');
    const writes = docs.map((d) => [F.doc(col, d.id), JSON.parse(JSON.stringify(d))]);
    if ((state.budgetUpdatedAt || 0) > ((remoteSettings && remoteSettings.budgetUpdatedAt) || 0)) {
      remoteSettings = { budget: state.budget || 0, budgetUpdatedAt: state.budgetUpdatedAt };
      writes.push([F.doc(db, 'users', user.uid), remoteSettings]);
    }
    if (!writes.length) return;
    for (const d of docs) remote.set(d.id, d); // evita reenviar antes do retorno do servidor
    pending = true;
    refreshStatus();
    // Lotes de até 450 gravações (limite do Firestore é 500).
    for (let i = 0; i < writes.length; i += 450) {
      const batch = F.writeBatch(db);
      for (const [ref, data] of writes.slice(i, i + 450)) batch.set(ref, data);
      batch.commit().catch((err) => setStatus(`Erro ao enviar para a nuvem: ${err.code || err.message}`));
    }
  }

  function start(u) {
    const col = F.collection(db, 'users', u.uid, 'expenses');
    unsubscribe.push(F.onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
      remote = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      window.SemanaSP.applyRemote([...remote.values()], null);
      if (!snap.metadata.fromCache) serverSeen = true;
      pending = snap.metadata.hasPendingWrites;
      if (serverSeen && !pending) lastSync = new Date();
      upload();
      refreshStatus();
    }, (err) => setStatus(`Erro na nuvem: ${err.code || err.message}`)));
    unsubscribe.push(F.onSnapshot(F.doc(db, 'users', u.uid), (snap) => {
      if (snap.exists()) {
        remoteSettings = snap.data();
        window.SemanaSP.applyRemote([], remoteSettings);
      }
    }));
  }

  A.onAuthStateChanged(auth, (u) => {
    unsubscribe.forEach((fn) => fn());
    unsubscribe = [];
    remote = new Map();
    remoteSettings = null;
    serverSeen = false;
    user = u;
    if (u) start(u);
    refreshStatus();
  });

  window.addEventListener('semanasp:saved', upload);
  window.addEventListener('online', refreshStatus);
  window.addEventListener('offline', refreshStatus);

  $('#cloud-login').addEventListener('click', async () => {
    const provider = new A.GoogleAuthProvider();
    try {
      await A.signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
        await A.signInWithRedirect(auth, provider);
      } else if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setStatus(`Não foi possível entrar: ${err.code || err.message}`);
      }
    }
  });
  $('#cloud-logout').addEventListener('click', async () => {
    if (!confirm('Sair da conta? Os dados continuam neste aparelho, mas param de ir para a nuvem.')) return;
    await A.signOut(auth);
  });
  $('#cloud-sync').addEventListener('click', () => { upload(); refreshStatus(); });
}

main();
