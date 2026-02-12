const socket = io(window.location.origin, {
  transports: ["websocket", "polling"]
});


/* DOM ELEMENTS */
const loginScreen = document.getElementById("loginScreen");
const app = document.getElementById("app");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const loginStatus = document.getElementById("loginStatus");

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const connectionState = document.getElementById("connectionState");


let username = null;

/* ---------- LOGIN ---------- */

async function login(type){
  const u = usernameInput.value.trim();
  const p = passwordInput.value.trim();

  if(!u || !p){
    loginStatus.innerText="Enter username and password";
    return;
  }

  loginStatus.innerText="Connecting...";

  try{
    const res = await fetch(window.location.origin + "/" + type,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:u,password:p})
    });

    const text = await res.text();

    if(res.ok){
      username=u;
      loginScreen.classList.add("hidden");
      app.classList.remove("hidden");
      connectChat();
    }else{
      loginStatus.innerText=text;
    }

  }catch(e){
    loginStatus.innerText="Server unreachable";
    console.error(e);
  }
}


loginBtn.onclick=()=>login("login");
registerBtn.onclick=()=>login("register");

/* ---------- CONNECT CHAT ---------- */

function connectChat(){

  connectionState.style.display="block";

  socket.emit("join",{username,channel:"general"});

  socket.on("connect",()=>{
    connectionState.style.display="none";
  });
}

/* ---------- CHAT ---------- */

sendBtn.onclick=sendMessage;
messageInput.onkeypress=e=>{
  if(e.key==="Enter") sendMessage();
};

function sendMessage(){
  if(!messageInput.value) return;
  socket.emit("message",messageInput.value);
  messageInput.value="";
}

socket.on("history",msgs=>{
  messages.innerHTML="";
  msgs.forEach(addMessage);
  scrollBottom();
});

socket.on("message",msg=>{
  addMessage(msg);
  scrollBottom();
});

socket.on("system",txt=>{
  const div=document.createElement("div");
  div.className="msg";
  div.style.color="gray";
  div.innerText=txt;
  messages.appendChild(div);
  scrollBottom();
});

function addMessage(msg){
  const div=document.createElement("div");
  div.className="msg";

  div.innerHTML=
    `<span class="username">${msg.user}</span>
     <span class="time">${msg.time}</span><br>
     ${msg.text}`;

  messages.appendChild(div);
}

function scrollBottom(){
  messages.scrollTop=messages.scrollHeight;
}
