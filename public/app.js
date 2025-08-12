// app.js - Enigma Session-lite with "delete-on-leave" behavior (no encryption)
// Firebase Web SDK v10 (modular)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, collection, addDoc,
  query, where, onSnapshot, deleteDoc, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ---------- FIREBASE CONFIG: REPLACE WITH YOURS ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyAhrs1yabw3uOq2kk-KZET_Egx85oCH0Yc",
  authDomain: "enigma-90c65.firebaseapp.com",
  projectId: "enigma-90c65",
  storageBucket: "enigma-90c65.firebasestorage.app",
  messagingSenderId: "954143085438",
  appId: "1:954143085438:web:4c78f82dcb478df558992f",
  measurementId: "G-2J01KTBFMY"

};
/* -------------------------------------------------------- */

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ---------- UI elements ---------- */
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

/* ---------- App state ---------- */
// Local account stored in localStorage under 'enigma_account'
// { pubkey, passcode, displayName }
let me = null;
let contacts = {}; // map pubkey -> { pubkey, displayName }
let activeFriend = null; // pubkey string
let inboxUnsub = null;
let messagesToDelete = []; // message IDs currently displayed in the open chat

/* ---------- Utilities ---------- */
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

/* ---------- Show account info ---------- */
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
    <div class="small">Public key: <span class="key">${me.pubkey}</span></div>
    <div class="small">Recovery passcode: <span class="key">${me.passcode}</span> <button id="copyPass">Copy</button></div>
    <div style="margin-top:6px;"><button id="logoutBtn">Forget account (local)</button></div>
  `;
  document.getElementById('copyPass').onclick = () => {
    navigator.clipboard.writeText(me.passcode);
    alert('Passcode copied to clipboard');
  };
  document.getElementById('logoutBtn').onclick = () => {
    if (confirm('This will forget your local session (you can recover using passcode). Continue?')) {
      clearLocalAccount();
      location.reload();
    }
  };
}

/* ---------- Startup: load local account if exists ---------- */
(function init() {
  const acc = loadLocalAccount();
  if (acc) {
    me = acc;
    showMyInfo();
    loadContacts();
  } else {
    showMyInfo();
  }
})();

/* ---------- Create account ---------- */
createBtn.onclick = async () => {
  const displayName = (displayNameInput.value || '').trim();
  if (!displayName) return alert('Enter display name');

  const pubkey = genPublicKey();
  const passcode = genPasscode();

  // create a Firestore user doc keyed by pubkey
  await setDoc(doc(db, 'users', pubkey), {
    displayName,
    passcode,
    createdAt: Date.now()
  });

  me = { pubkey, passcode, displayName };
  saveLocalAccount(me);
  showMyInfo();
  loadContacts();
  alert('Account created. Share your public key with friends to be found.');
};

/* ---------- Recover by passcode ---------- */
recoverBtn.onclick = async () => {
  const code = (recoverPass.value || '').trim().toUpperCase();
  if (!code) return alert('Enter passcode to recover');

  const q = query(collection(db, 'users'), where('passcode', '==', code));
  const snap = await getDocs(q);
  if (snap.empty) return alert('No account found with that passcode');

  const docSnap = snap.docs[0];
  const data = docSnap.data();
  const pubkey = docSnap.id;
  me = { pubkey, passcode: code, displayName: data.displayName || 'Unknown' };
  saveLocalAccount(me);
  showMyInfo();
  loadContacts();
  alert('Account recovered locally.');
};

/* ---------- Add contact (by public key) ---------- */
addContactBtn.onclick = async () => {
  if (!me) return alert('Create or recover an account first');
  const friendKey = (friendKeyInput.value || '').trim();
  if (!friendKey) return alert('Paste friend public key');
  if (friendKey === me.pubkey) return alert("You can't add yourself");

  // check that user exists
  const friendDoc = await getDoc(doc(db, 'users', friendKey));
  if (!friendDoc.exists()) {
    addResult.innerText = 'No user found with that public key';
    return;
  }

  // store under users/{me.pubkey}/contacts/{friendKey}
  await setDoc(doc(db, 'users', me.pubkey, 'contacts', friendKey), {
    friendUid: friendKey,
    displayNameSnapshot: friendDoc.data().displayName || '',
    addedAt: Date.now()
  });

  addResult.innerText = 'Added to contacts';
  friendKeyInput.value = '';
  setTimeout(() => addResult.innerText = '', 2000);
  loadContacts();
};

/* ---------- Load contacts (live) ---------- */
function loadContacts() {
  contactsDiv.innerText = '(loading...)';
  const contactsCol = collection(db, 'users', me.pubkey, 'contacts');

  // unsubscribe existing
  if (contactsDiv._unsub) contactsDiv._unsub();

  contactsDiv._unsub = onSnapshot(contactsCol, async (snap) => {
    contacts = {};
    contactsDiv.innerHTML = '';
    if (snap.empty) { contactsDiv.innerText = '(no contacts)'; return; }

    // iterate and render
    for (const c of snap.docs) {
      const friendUid = c.id;
      const d = c.data();
      // fetch latest profile
      const friendDoc = await getDoc(doc(db, 'users', friendUid));
      const friendData = friendDoc.exists() ? friendDoc.data() : d;
      contacts[friendUid] = { pubkey: friendUid, displayName: friendData.displayName || d.displayNameSnapshot || 'Unknown' };

      const el = document.createElement('div');
      el.className = 'contact';
      el.textContent = `${contacts[friendUid].displayName} — ${contacts[friendUid].pubkey}`;
      el.onclick = () => openChatWith(friendUid);
      contactsDiv.appendChild(el);
    }
  });
}

/* ---------- Open chat: listen for messages FROM friend TO me ---------- */
async function openChatWith(friendPubKey) {
  if (!me) return alert('Create/recover account first');
  if (!contacts[friendPubKey]) return alert('Contact not loaded yet');

  // If switching from another chat: delete previously displayed messages
  await clearDisplayedMessages();

  activeFriend = contacts[friendPubKey];
  chatHeader.innerHTML = `<b>Chat with ${escapeHtml(activeFriend.displayName)}</b>`;
  chatDiv.innerText = '(listening...)';
  messagesToDelete = [];

  // unsubscribe previous listener if any
  if (inboxUnsub) inboxUnsub();

  // listen to our inbox for messages from this friend
  const inboxCol = collection(db, 'users', me.pubkey, 'inbox');
  const q = query(inboxCol, where('from', '==', friendPubKey), orderBy('createdAt'));
  inboxUnsub = onSnapshot(q, (snap) => {
    if (snap.empty) {
      chatDiv.innerText = '(no messages)';
      messagesToDelete = [];
      return;
    }
    // render all messages from snapshot (they remain visible)
    chatDiv.innerText = '';
    messagesToDelete = [];
    for (const docSnap of snap.docs) {
      const msg = docSnap.data();
      const mid = docSnap.id;
      chatDiv.innerText += `\n${activeFriend.displayName}: ${msg.content}`;
      messagesToDelete.push(mid);
    }
    // scroll to bottom
    chatDiv.scrollTop = chatDiv.scrollHeight;
  });
}

/* ---------- Send message: add to recipient's inbox ---------- */
sendBtn.onclick = async () => {
  if (!me) return alert('Create or recover an account first');
  if (!activeFriend) return alert('Open a contact to send');
  const text = (msgInput.value || '').trim();
  if (!text) return;
  // write to users/{recipientPub}/inbox
  await addDoc(collection(db, 'users', activeFriend.pubkey, 'inbox'), {
    from: me.pubkey,
    content: text,
    createdAt: Date.now()
  });
  chatDiv.innerText += `\nMe: ${text}`;
  msgInput.value = '';
  chatDiv.scrollTop = chatDiv.scrollHeight;
};

/* ---------- Clear displayed messages: delete message docs whose IDs are in messagesToDelete ---------- */
async function clearDisplayedMessages() {
  if (!me) return;
  if (!messagesToDelete || messagesToDelete.length === 0) return;
  const deletes = messagesToDelete.map(mid => deleteDoc(doc(db, 'users', me.pubkey, 'inbox', mid)).catch(e => console.warn('Delete failed', e)));
  // perform deletes in parallel
  await Promise.all(deletes);
  messagesToDelete = [];
}

/* ---------- When user navigates away from chat (open another contact or close tab) delete displayed messages ---------- */
window.addEventListener('beforeunload', (e) => {
  // synchronous deletion is not reliable — attempt best-effort via navigator.sendBeacon fallback
  if (me && messagesToDelete && messagesToDelete.length) {
    try {
      // Best-effort: call REST endpoint to delete (not implemented here) or rely on client-side async deletes.
      // We'll attempt to delete asynchronously (may not finish); this is a best-effort behavior in browsers.
      clearDisplayedMessages();
    } catch (err) {
      console.warn('Unload delete attempt failed', err);
    }
  }
});


