// client.js
(async () => {

  // 1. auth check
  const meResp = await fetch("/me");
  const meData = await meResp.json();
  if (!meData.user) {
    location.href = "/login.html";
    return;
  }
  const username = meData.user;
  document.getElementById("userLabel").textContent = username;

  // 2. connect socket.io
  const socket = io(window.location.origin, { transports: ["websocket"] });

  // UI references
  const messagesEl = document.getElementById("messages");
  const msgForm = document.getElementById("msgForm");
  const msgBox = document.getElementById("msgBox");
  const channelTitle = document.getElementById("channelTitle");
  const memberList = document.getElementById("memberList");
  const voiceMembersBox = document.getElementById("voiceMembers");
  const joinVoiceBtn = document.getElementById("joinVoiceBtn");
  const leaveVoiceBtn = document.getElementById("leaveVoiceBtn");
  const muteBtn = document.getElementById("muteBtn");
  const voiceChannelEl = document.getElementById("voiceChannel");

  // state
  let currentChannel = "general";
  let localStream = null;
  let inVoice = false;
  let peers = {};
  let makingOffer = {};
  let politePeers = {};
  let speakingState = false;
  let speakingHold = 0;
  let analyser, speakingInterval;

  const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // render message
  function addMessage(msg) {
    const div = document.createElement("div");
    div.className = "msg " + (msg.user === username ? "own" : "other");

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${msg.user} • ${formatTime(msg.time)}`;

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = msg.text;

    div.appendChild(meta);
    div.appendChild(text);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // initial join channel
  function joinChannel(channel) {
    currentChannel = channel;
    channelTitle.textContent = `# ${channel}`;
    messagesEl.innerHTML = "";
    socket.emit("join", channel);
  }

  // socket handlers
  socket.on("history", msgs => {
    messagesEl.innerHTML = "";
    msgs.forEach(addMessage);
  });

  socket.on("message", addMessage);

  socket.on("system", txt => {
    const el = document.createElement("div");
    el.className = "msg";
    el.textContent = `— ${txt} —`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  // members (sidebar)
  socket.on("sidebar-members", list => {
    memberList.innerHTML = "";
    list.forEach(u => {
      const div = document.createElement("div");
      div.className = "member";
      if (u.id === socket.id) div.style.fontWeight = "700";
      div.id = "member-" + u.id;

      const circle = document.createElement("div");
      circle.className = "circle";
      circle.textContent = u.name[0].toUpperCase();

      const name = document.createElement("div");
      name.textContent = u.name;

      div.appendChild(circle);
      div.appendChild(name);
      memberList.appendChild(div);
    });
  });

  /* ---------- VOICE UI & logic (join, leave, members, speaking) ---------- */

  voiceChannelEl.onclick = () => {
    // quick join
    joinVoice("general");
  };

  joinVoiceBtn.onclick = () => joinVoice("general");
  leaveVoiceBtn.onclick = () => leaveVoice();
  muteBtn.onclick = () => toggleMute();

  async function joinVoice(room) {
    if (inVoice) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert("Mic permission denied");
      return;
    }

    inVoice = true;
    socket.emit("join-voice", room);

    // speaking detection: analyser
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(localStream);
    analyser = audioCtx.createAnalyser();
    source.connect(analyser);
    analyser.fftSize = 2048;
    const data = new Uint8Array(analyser.fftSize);

    speakingInterval = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms > 12) speakingHold = 6;
      else speakingHold--;
      const newState = speakingHold > 0;
      if (newState !== speakingState) {
        speakingState = newState;
        socket.emit("speaking", speakingState);
      }
    }, 120);

    // prepare to accept new peers (server will tell when user-joined-voice)
    socket.off("user-joined-voice");
    socket.on("user-joined-voice", async (id) => {
      if (peers[id]) return;
      const pc = createPeer(id);
      peers[id] = pc;
      politePeers[id] = socket.id > id;
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      if (!politePeers[id]) {
        makingOffer[id] = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { target: id, sdp: pc.localDescription });
        makingOffer[id] = false;
      }
    });
  }

  function leaveVoice() {
    if (!inVoice) return;
    socket.emit("leave-voice");
    Object.values(peers).forEach(p => p.close());
    peers = {};
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    clearInterval(speakingInterval);
    voiceMembersBox.innerHTML = "";
    inVoice = false;
  }

  function toggleMute() {
    if (!localStream) return;
    const a = localStream.getAudioTracks()[0];
    a.enabled = !a.enabled;
    muteBtn.textContent = a.enabled ? "Mute" : "Unmute";
  }

  // UI updates for voice members
  socket.on("voice-members", list => {
    voiceMembersBox.innerHTML = "";
    list.forEach(u => {
      const item = document.createElement("div");
      item.className = "voiceUser";
      item.id = "voice-" + u.id;

      const dot = document.createElement("div");
      dot.className = "dot";
      item.appendChild(dot);

      const name = document.createElement("div");
      name.textContent = u.name;
      item.appendChild(name);

      voiceMembersBox.appendChild(item);
    });
  });

  socket.on("user-connecting", (id) => {
    // show connecting placeholder
    const item = document.createElement("div");
    item.className = "voiceUser connecting";
    item.id = "voice-" + id;
    item.textContent = "Connecting...";
    voiceMembersBox.appendChild(item);
  });

  socket.on("voice-user-left", (id) => {
    const el = document.getElementById("voice-" + id);
    if (el) el.remove();
    if (peers[id]) {
      peers[id].close();
      delete peers[id];
    }
  });

  // speaking indicator
  socket.on("speaking", ({ id, state }) => {
    const el = document.getElementById("voice-" + id);
    const mem = document.getElementById("member-" + id);
    if (el) {
      if (state) el.classList.add("speaking"); else el.classList.remove("speaking");
    }
    if (mem) {
      if (state) mem.classList.add("speaking"); else mem.classList.remove("speaking");
    }
  });

  /* ---------- WebRTC peer helpers (createPeer + signaling) ---------- */

  function createPeer(id) {
    const pc = new RTCPeerConnection(ICE_CONFIG);

    pc.ontrack = (e) => {
      // create audio element for remote stream
      let audio = document.getElementById("audio-" + id);
      if (!audio) {
        audio = document.createElement("audio");
        audio.id = "audio-" + id;
        audio.autoplay = true;
        audio.controls = false;
        document.body.appendChild(audio);
      }
      audio.srcObject = e.streams[0];
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", { target: id, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        if (peers[id]) {
          peers[id].close();
          delete peers[id];
        }
        const el = document.getElementById("voice-" + id);
        if (el) el.remove();
      }
    };

    return pc;
  }

  socket.on("offer", async ({ sdp, sender }) => {
    let pc = peers[sender];
    if (!pc) {
      pc = createPeer(sender);
      peers[sender] = pc;
      if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    const polite = politePeers[sender];
    const collision = makingOffer[sender] || pc.signalingState !== "stable";
    if (collision && !polite) return;

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { target: sender, sdp: pc.localDescription });
  });

  socket.on("answer", async ({ sdp, sender }) => {
    const pc = peers[sender];
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on("ice-candidate", ({ candidate, sender }) => {
    const pc = peers[sender];
    if (pc && candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
    }
  });

  /* ---------- send message form ---------- */

  msgForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = msgBox.value.trim();
    if (!text) return;
    socket.emit("message", { channel: currentChannel, text });
    msgBox.value = "";
  });

  /* ---------- channel switching (left sidebar) ---------- */

  document.querySelectorAll(".channel").forEach(el => {
    el.addEventListener("click", () => {
      const ch = el.dataset.channel;
      joinChannel(ch);
    });
  });

  // start in general
  joinChannel("general");

})();
