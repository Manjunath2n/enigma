
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, addDoc,
  query, where, onSnapshot, deleteDoc, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


const firebaseConfig = window.firebaseEnv;


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);


const displayNameInput = document.getElementById('displayName');
const createBtn = document.getElementById('createBtn');
const recoverPass = document.getElementById('recoverPass');
const recoverBtn = document.getElementById('recoverBtn');

const myInfoDiv = document.getElementById('myInfo');

const friendKeyInput = document.getElementById('friendKey');
const addContactBtn = document.getElementById('addContactBtn');
const addResult = document.getElementById('addResult');

const contactsDiv = document.getElementById('contacts');

const chatHeader = document.getElementById('chatHeader');
const chatDiv = document.getElementById('chat');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const clearChatBtn = document.getElementById('clearChatBtn');


let me = null;
let contacts = {}; 
let activeFriend = null; 
let inboxUnsub = null;
let messagesToDelete = []; 


function randBase36(len = 20) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}

function genPublicKey() {
  return 'pk_' + randBase36(5);
}
function genPasscode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function saveLocalAccount(acc) {
  localStorage.setItem('enigma_account', JSON.stringify(acc));
}
function loadLocalAccount() {
  try { return JSON.parse(localStorage.getItem('enigma_account')); } catch { return null; }
}
function clearLocalAccount() { localStorage.removeItem('enigma_account'); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function showMyInfo() {
  if (!me) {
    myInfoDiv.style.display = 'none';
    document.getElementById('signupSection').style.display = '';
    return;
  }
  document.getElementById('signupSection').style.display = 'none';
  myInfoDiv.style.display = '';
  myInfoDiv.innerHTML = `
    <div><b>${escapeHtml(me.displayName)}</b></div>
    <div class="small">Public key: <span class="key">${me.pubkey}</span><button id="copyPK">Copy</button></div>
    <div class="small">Recovery passcode: <span class="key">${me.passcode}</span> <button id="copyPass">Copy</button></div>
    <div style="margin-top:6px;"><button id="logoutBtn">Forget account (local)</button></div>
  `;
  document.getElementById('copyPass').onclick = () => {
    navigator.clipboard.writeText(me.passcode);
    alertCustom('Passcode copied to clipboard');
  };
  document.getElementById('copyPK').onclick = () => {
    navigator.clipboard.writeText(me.pubkey);
    alertCustom('Public key copied to clipboard');
  };
  document.getElementById('logoutBtn').onclick = () => {
    confirmCustom('This will forget your local session (you can recover using passcode). Continue?',function(res) {
	if (res) {
      clearLocalAccount();
      location.reload();
    }
	});
  };
}


(async function init() {
  const acc = loadLocalAccount();
  if (acc) {
    me = acc;
    showMyInfo();
    await loadContacts();
  } else {
    showMyInfo();
  }

 
  try { await cleanupOldMessages(); } catch (e) { console.warn('Cleanup failed', e); }

  
  setInterval(() => cleanupOldMessages().catch(e=>console.warn('cleanup',e)), 1000*60*60);
})();


createBtn.onclick = async () => {
  const displayName = (displayNameInput.value || '').trim();
  if (!displayName) return alertCustom('Enter display name');

  const pubkey = genPublicKey();
  const passcode = genPasscode();

 
  await setDoc(doc(db, 'users', pubkey), {
    displayName,
    passcode,
    createdAt: Date.now()
  });

  me = { pubkey, passcode, displayName };
  saveLocalAccount(me);
  showMyInfo();
  await loadContacts();
  alertCustom('Account created. Share your public key with friends to be found.');
};


recoverBtn.onclick = async () => {
  const code = (recoverPass.value || '').trim().toUpperCase();
  if (!code) return alertCustom('Enter passcode to recover');

  const q = query(collection(db, 'users'), where('passcode', '==', code));
  const snap = await getDocs(q);
  if (snap.empty) return alertCustom('No account found with that passcode');

  const docSnap = snap.docs[0];
  const data = docSnap.data();
  const pubkey = docSnap.id;
  me = { pubkey, passcode: code, displayName: data.displayName || 'Unknown' };
  saveLocalAccount(me);
  showMyInfo();
  await loadContacts();
  alertCustom('Account recovered locally.');
};


addContactBtn.onclick = async () => {
  if (!me) return alertCustom('Create or recover an account first');
  const friendKey = (friendKeyInput.value || '').trim();
  if (!friendKey) return alertCustom('Paste friend public key');
  if (friendKey === me.pubkey) return alertCustom("You can't add yourself");

 
  const friendDoc = await getDoc(doc(db, 'users', friendKey));
  if (!friendDoc.exists()) {
    addResult.innerText = 'No user found with that public key';
    return;
  }

 
  await setDoc(doc(db, 'users', me.pubkey, 'contacts', friendKey), {
    friendUid: friendKey,
    displayNameSnapshot: friendDoc.data().displayName || '',
    addedAt: Date.now()
  });

  addResult.innerText = 'Added to contacts';
  friendKeyInput.value = '';
  setTimeout(() => addResult.innerText = '', 2000);
  await loadContacts();
};


async function loadContacts() {
  contactsDiv.innerText = '(loading...)';
  const contactsCol = collection(db, 'users', me.pubkey, 'contacts');

  if (contactsDiv._unsub) contactsDiv._unsub();

  contactsDiv._unsub = onSnapshot(contactsCol, async (snap) => {
    contacts = {};
    contactsDiv.innerHTML = '';
    if (snap.empty) { contactsDiv.innerText = '(no contacts)'; return; }

    for (const c of snap.docs) {
      const friendUid = c.id;
      const d = c.data();
      const friendDoc = await getDoc(doc(db, 'users', friendUid));
      const friendData = friendDoc.exists() ? friendDoc.data() : d;
      contacts[friendUid] = { pubkey: friendUid, displayName: friendData.displayName || d.displayNameSnapshot || 'Unknown' };

      const el = document.createElement('div');
      el.className = 'contact';
      el.textContent = contacts[friendUid].displayName;

      const sub = document.createElement('div');
      sub.className = 'small';
      sub.textContent = friendUid;

      const right = document.createElement('div');
      el.appendChild(sub);
      el.appendChild(right);

      
      const inboxCol = collection(db, 'users', me.pubkey, 'inbox');
      const q = query(inboxCol, where('from', '==', friendUid));
      onSnapshot(q, (snapMsgs) => {
        right.innerHTML = "";
        if (!snapMsgs.empty) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          right.appendChild(badge);
        }
      });

      el.onclick = () => openChatWith(friendUid);
      contactsDiv.appendChild(el);
    }
  });
}


async function openChatWith(friendPubKey) {
  if (!me) return alertCustom('Create/recover account first');
  if (!contacts[friendPubKey]) return alertCustom('Contact not loaded yet');

  await clearDisplayedMessages();

  activeFriend = contacts[friendPubKey];
  chatHeader.innerHTML = `<b>Chat with ${escapeHtml(activeFriend.displayName)}</b>`;
  chatDiv.innerText = '(loading...)';
  messagesToDelete = [];

  if (inboxUnsub) inboxUnsub();

  
  const incomingQ = query(
    collection(db, 'users', me.pubkey, 'inbox'),
    where('from', '==', friendPubKey),
    orderBy('createdAt')
  );
  const outgoingQ = query(
    collection(db, 'users', friendPubKey, 'inbox'),
    where('from', '==', me.pubkey),
    orderBy('createdAt')
  );

  
  const renderChat = async () => {
    const incomingSnap = await getDocs(incomingQ);
    const outgoingSnap = await getDocs(outgoingQ);

    const msgs = [];
    incomingSnap.forEach(d => msgs.push({ ...d.data(), id: d.id, who: 'them' }));
    outgoingSnap.forEach(d => msgs.push({ ...d.data(), id: d.id, who: 'me' }));

    msgs.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

    chatDiv.innerText = '';
    messagesToDelete = [];

    for (const m of msgs) {
      if (m.who === 'them') {
        chatDiv.innerText += `\n${activeFriend.displayName}: ${m.content}`;
        messagesToDelete.push(m.id);
      } else {
        chatDiv.innerText += `\nMe: ${m.content}`;
      }
    }
    chatDiv.scrollTop = chatDiv.scrollHeight;
  };

  
  const unsubIn = onSnapshot(incomingQ, renderChat);
  const unsubOut = onSnapshot(outgoingQ, renderChat);
  inboxUnsub = () => { unsubIn(); unsubOut(); };
  renderChat();
}


sendBtn.onclick = async () => {
  if (!me) return alertCustom('Create or recover an account first');
  if (!activeFriend) return alertCustom('Open a contact to send');
  const text = (msgInput.value || '').trim();
  if (!text) return;
  
  sendBtn.disabled = true;
  try {
    await addDoc(collection(db, 'users', activeFriend.pubkey, 'inbox'), {
      from: me.pubkey,
      content: text,
      createdAt: Date.now()
    });
  } catch (e) {
    console.error('Send failed', e);
    alertCustom('Failed to send message');
  } finally {
    sendBtn.disabled = false;
  }
  
  msgInput.value = '';
  chatDiv.scrollTop = chatDiv.scrollHeight;
};

async function clearDisplayedMessages() {
  if (!me) return;
  if (!messagesToDelete || messagesToDelete.length === 0) return;
  const deletes = messagesToDelete.map(mid => deleteDoc(doc(db, 'users', me.pubkey, 'inbox', mid)).catch(e => console.warn('Delete failed', e)));
  await Promise.all(deletes);
  messagesToDelete = [];
}


clearChatBtn.onclick = async () => {
  if (!me) return alertCustom('Create/recover account first');
  if (!activeFriend) return alertCustom('Open chat to delete it');

 
  confirmCustom('Delete all messages in this chat (both sides)? This cannot be undone.', async function (res) {
    if (!res) return;

    const friend = activeFriend.pubkey;

    try {
     
      const q1 = query(collection(db, 'users', me.pubkey, 'inbox'), where('from', '==', friend));
      const snap1 = await getDocs(q1);
      const dels1 = snap1.docs.map(d =>
        deleteDoc(doc(db, 'users', me.pubkey, 'inbox', d.id)).catch(() => {})
      );
      await Promise.all(dels1);
    } catch (e) {
      console.warn(e);
    }

    try {
      const q2 = query(collection(db, 'users', friend, 'inbox'), where('from', '==', me.pubkey));
      const snap2 = await getDocs(q2);
      const dels2 = snap2.docs.map(d =>
        deleteDoc(doc(db, 'users', friend, 'inbox', d.id)).catch(() => {})
      );
      await Promise.all(dels2);
    } catch (e) {
      console.warn(e);
    }

    await clearDisplayedMessages();
    chatDiv.innerText = '(no messages)';
    alertCustom('Chat cleared.');
  });
};



window.addEventListener('beforeunload', (e) => {
  if (me && messagesToDelete && messagesToDelete.length) {
    try { clearDisplayedMessages(); } catch (err) { console.warn('Unload delete attempt failed', err); }
  }
});


async function cleanupOldMessages(){
  if (!me) return;
  const inboxCol = collection(db, 'users', me.pubkey, 'inbox');
  const snap = await getDocs(inboxCol);
  const threshold = Date.now() - (24*60*60*1000);
  const dels = [];
  for (const d of snap.docs){
    const data = d.data();
    if (data.createdAt && data.createdAt < threshold){
      dels.push(deleteDoc(doc(db, 'users', me.pubkey, 'inbox', d.id)).catch(()=>{}));
    }
  }
  await Promise.all(dels);
}
