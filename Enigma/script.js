/*
 Enigma MVP client
 - Anonymous identity persisted locally
 - Rooms with AES-GCM end-to-end encryption
 - Invite links with key in URL hash (#k=base64url)
 - QR share
 - Realtime via Firebase Realtime Database if configured; falls back to localStorage transport
*/

const chatList = document.getElementById("chatList");
const messagesEl = document.getElementById("messages");
const chatTitle = document.getElementById("chatTitle");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const newRoomBtn = document.getElementById("newRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const settingsBtn = document.getElementById("settingsBtn");

const newRoomModal = byId("newRoomModal");
const joinModal = byId("joinModal");
const shareModal = byId("shareModal");
const settingsModal = byId("settingsModal");

const newRoomName = byId("newRoomName");
const inviteExpiryHours = byId("inviteExpiryHours");
const createRoomConfirm = byId("createRoomConfirm");

const joinInput = byId("joinInput");
const joinConfirm = byId("joinConfirm");

const qrContainer = byId("qrContainer");
const inviteLinkEl = byId("inviteLink");
const copyInviteBtn = byId("copyInviteBtn");

const displayNameInput = byId("displayNameInput");
const userIdLabel = byId("userIdLabel");
const saveSettingsBtn = byId("saveSettingsBtn");
const themeToggle = byId("themeToggle");

let currentRoom = null; // {roomId, name, keyB64}
let unsubscribe = null;

// State: identity and rooms
const identity = ensureIdentity();
userIdLabel.textContent = identity.userId;
displayNameInput.value = identity.displayName || "";

const storedRooms = loadRooms();
renderRoomList(storedRooms);

// Transport abstraction: uses Firebase if available, otherwise localStorage
const transport = createTransport();

// Modal wiring
wireModal(newRoomModal);
wireModal(joinModal);
wireModal(shareModal);
wireModal(settingsModal);

newRoomBtn.addEventListener("click", () => openModal(newRoomModal));
joinRoomBtn.addEventListener("click", () => openModal(joinModal));
settingsBtn.addEventListener("click", () => openModal(settingsModal));

createRoomConfirm.addEventListener("click", async () => {
  const roomName = (newRoomName.value || "Untitled Room").slice(0, 60);
  const roomId = generateRoomId();
  const { keyB64url } = await generateRoomKey();
  const room = { roomId, name: roomName, keyB64url };
  saveRoom(room);
  renderRoomList(loadRooms());
  closeModal(newRoomModal);
  // Show share UI
  const expiry = parseInt(inviteExpiryHours.value, 10);
  const invite = buildInviteLink(room, Number.isFinite(expiry) && expiry > 0 ? expiry : null);
  openShare(invite);
  // Auto-join
  joinRoom(room);
});

joinConfirm.addEventListener("click", () => {
  const raw = joinInput.value.trim();
  const parsed = parseInvite(raw);
  if (!parsed) return;
  saveRoom(parsed);
  renderRoomList(loadRooms());
  closeModal(joinModal);
  joinRoom(parsed);
});

copyInviteBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLinkEl.value);
    copyInviteBtn.textContent = "Copied";
    setTimeout(() => (copyInviteBtn.textContent = "Copy"), 1200);
  } catch {}
});

saveSettingsBtn.addEventListener("click", () => {
  const nextName = displayNameInput.value.trim().slice(0, 40) || identity.displayName;
  identity.displayName = nextName;
  persistIdentity(identity);
  closeModal(settingsModal);
});

themeToggle.addEventListener("change", () => {
  localStorage.setItem("enigma_theme_dark", themeToggle.checked ? "1" : "0");
  document.documentElement.dataset.theme = themeToggle.checked ? "dark" : "light";
});
themeToggle.checked = localStorage.getItem("enigma_theme_dark") !== "0";
document.documentElement.dataset.theme = themeToggle.checked ? "dark" : "light";

// Chat send
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

function renderRoomList(rooms){
  chatList.innerHTML = "";
  rooms.forEach(r => {
    const li = document.createElement("li");
    li.textContent = r.name || r.roomId;
    li.title = r.roomId;
    li.addEventListener("click", () => joinRoom(r));
    chatList.appendChild(li);
  });
}

async function joinRoom(room){
  currentRoom = room;
  chatTitle.textContent = room.name || room.roomId;
  messagesEl.innerHTML = "";

  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  const key = await importAesKeyFromBase64url(room.keyB64url);
  unsubscribe = transport.subscribe(room.roomId, async (msg) => {
    // Expect {cipher, iv, senderId, ts}
    try{
      const text = await decryptMessage(key, msg.cipher, msg.iv);
      displayMessage({
        author: msg.senderId === identity.userId ? identity.displayName : truncateId(msg.senderId),
        text,
        mine: msg.senderId === identity.userId,
        ts: msg.ts
      });
    }catch{}
  });
}

async function sendMessage(){
  const text = messageInput.value.trim();
  if (!text || !currentRoom) return;
  messageInput.value = "";
  const key = await importAesKeyFromBase64url(currentRoom.keyB64url);
  const { cipherB64, ivB64 } = await encryptMessage(key, text);
  const payload = {
    cipher: cipherB64,
    iv: ivB64,
    senderId: identity.userId,
    ts: Date.now()
  };
  transport.send(currentRoom.roomId, payload);
}

function displayMessage({author, text, mine, ts}){
  const row = document.createElement("div");
  row.className = mine ? "row me" : "row";
  const bubbleWrap = document.createElement("div");
  bubbleWrap.className = mine ? "message me" : "message";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${author} · ${formatTime(ts)}`;
  bubbleWrap.appendChild(bubble);
  bubbleWrap.appendChild(meta);
  row.appendChild(bubbleWrap);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Share modal for current room invite
function openShare(invite){
  inviteLinkEl.value = invite;
  qrContainer.innerHTML = "";
  // eslint-disable-next-line no-undef
  new QRCode(qrContainer, { text: invite, width: 192, height: 192 });
  openModal(shareModal);
}

// Identity
function ensureIdentity(){
  const raw = localStorage.getItem("enigma_identity");
  if (raw){
    try { return JSON.parse(raw); } catch {}
  }
  const userId = generateUserId();
  const displayName = `User-${userId.slice(-6)}`;
  const id = { userId, displayName };
  persistIdentity(id);
  return id;
}
function persistIdentity(id){
  localStorage.setItem("enigma_identity", JSON.stringify(id));
}

// Rooms persistence
function loadRooms(){
  try{ return JSON.parse(localStorage.getItem("enigma_rooms") || "[]"); }catch{ return []; }
}
function saveRoom(room){
  const list = loadRooms();
  const idx = list.findIndex(r => r.roomId === room.roomId);
  if (idx >= 0) list[idx] = room; else list.unshift(room);
  localStorage.setItem("enigma_rooms", JSON.stringify(list.slice(0, 50)));
}

// Transport
function createTransport(){
  if (window.db){
    // Firebase Realtime Database
    return {
      subscribe(roomId, cb){
        const ref = db.ref(`rooms/${roomId}/messages`);
        const handler = ref.on("child_added", snap => cb(snap.val()));
        return () => ref.off("child_added", handler);
      },
      send(roomId, payload){
        db.ref(`rooms/${roomId}/messages`).push(payload);
      }
    };
  }
  // LocalStorage fallback
  return {
    subscribe(roomId, cb){
      const key = `room:${roomId}`;
      const seen = new Set();
      function emitAll(){
        const arr = readArr(key);
        arr.forEach(o => { if (!seen.has(o._id)){ seen.add(o._id); cb(o); } });
      }
      emitAll();
      function onStorage(e){ if (e.key === key) emitAll(); }
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },
    send(roomId, payload){
      const key = `room:${roomId}`;
      const arr = readArr(key);
      const withId = { ...payload, _id: cryptoRandomId() };
      arr.push(withId);
      localStorage.setItem(key, JSON.stringify(arr.slice(-500)));
      // emit locally as storage does not fire in same tab
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }
  };
}

function readArr(key){
  try { return JSON.parse(localStorage.getItem(key) || "[]") || []; } catch { return []; }
}

// Crypto helpers
async function generateRoomKey(){
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const keyB64url = toBase64url(raw);
  return { key, keyB64url };
}
async function importAesKeyFromBase64url(b64){
  const raw = fromBase64url(b64);
  return crypto.subtle.importKey("raw", raw, { name:"AES-GCM" }, false, ["encrypt","decrypt"]);
}
async function encryptMessage(key, plaintext){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, enc);
  return { cipherB64: toBase64url(new Uint8Array(cipherBuf)), ivB64: toBase64url(iv) };
}
async function decryptMessage(key, cipherB64, ivB64){
  const cipher = fromBase64url(cipherB64);
  const iv = fromBase64url(ivB64);
  const buf = await crypto.subtle.decrypt({ name:"AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(new Uint8Array(buf));
}

// Encoding utils (base64url)
function toBase64url(bytes){
  let binary = ""; bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(b64url){
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 2 ? "==" : b64.length % 4 === 3 ? "=" : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

// IDs & formatting
function generateUserId(){
  return `user_${cryptoRandomId().slice(0,16)}`;
}
function generateRoomId(){
  return `r_${cryptoRandomId().slice(0,10)}`;
}
function cryptoRandomId(){
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (let i=0;i<bytes.length;i++) out += (bytes[i] & 15).toString(16);
  return out;
}
function truncateId(id){ return id.length > 10 ? id.slice(0,4) + "…" + id.slice(-4) : id; }
function formatTime(ts){ try{ return new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}); }catch{ return ""; } }

// Invite links
function buildInviteLink(room, expiryHours){
  const url = new URL(location.href);
  url.searchParams.set("room", room.roomId);
  if (room.name) url.searchParams.set("name", room.name);
  if (expiryHours) url.searchParams.set("exp", String(expiryHours));
  url.hash = `k=${room.keyB64url}`;
  return url.toString();
}
function parseInvite(raw){
  try{
    // URL form
    const url = new URL(raw);
    const roomId = url.searchParams.get("room");
    const name = url.searchParams.get("name") || "Room";
    const hash = new URLSearchParams(url.hash.startsWith("#")? url.hash.slice(1): url.hash);
    const keyB64url = hash.get("k");
    if (roomId && keyB64url) return { roomId, name, keyB64url };
  }catch{}
  // Code form ROOMID|KEY
  if (raw.includes("|")){
    const [roomId, keyB64url] = raw.split("|");
    if (roomId && keyB64url) return { roomId, name: roomId, keyB64url };
  }
  return null;
}

// Generic modal helpers
function byId(id){ return document.getElementById(id); }
function openModal(el){ el.setAttribute("aria-hidden", "false"); }
function closeModal(el){ el.setAttribute("aria-hidden", "true"); }
function wireModal(root){
  root.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sel = btn.getAttribute("data-close");
      const m = sel ? document.querySelector(sel) : root;
      if (m) closeModal(m);
    });
  });
}

// Auto-join from URL
(function autoJoinFromUrl(){
  try{
    const url = new URL(location.href);
    const roomId = url.searchParams.get("room");
    const name = url.searchParams.get("name") || roomId;
    const hash = new URLSearchParams(url.hash.startsWith("#")? url.hash.slice(1): url.hash);
    const keyB64url = hash.get("k");
    if (roomId && keyB64url){
      const room = { roomId, name, keyB64url };
      saveRoom(room);
      renderRoomList(loadRooms());
      joinRoom(room);
    }
  }catch{}
})();

