let ws, pc, dataChannel;
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const messages = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

joinBtn.onclick = () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return alert('Enter room ID');

  ws = new WebSocket(`wss://enigma-rla6.onrender.com`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room: roomId }));
    initWebRTC(roomId);
  };

  ws.onmessage = async (event) => {
    const { type, payload } = JSON.parse(event.data);

    if (type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', room: roomId, payload: answer }));
    }

    if (type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload));
    }

    if (type === 'ice') {
      try {
        await pc.addIceCandidate(payload);
      } catch (err) {
        console.error('Error adding ICE:', err);
      }
    }
  };
};

sendBtn.onclick = () => {
  const text = msgInput.value.trim();
  if (text && dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(text);
    appendMessage(`Me: ${text}`);
    msgInput.value = '';
  }
};

function appendMessage(msg) {
  messages.value += msg + '\n';
}

function initWebRTC(roomId) {
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  dataChannel = pc.createDataChannel('chat');
  dataChannel.onmessage = (e) => appendMessage(`Peer: ${e.data}`);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice', room: roomId, payload: event.candidate }));
    }
  };

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    dataChannel.onmessage = (e) => appendMessage(`Peer: ${e.data}`);
  };

  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => {
      ws.send(JSON.stringify({ type: 'offer', room: roomId, payload: pc.localDescription }));
    });
}
