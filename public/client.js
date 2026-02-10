(async () => {

    const me = await fetch("/me");
    const data = await me.json();

    if (!data.user) {
        location.href = "/login.html";
        return;
    }

    const socket = io(window.location.origin, {
        transports: ["websocket"]
    });

    const channel = "general";
    socket.emit("join", channel);

    const form = document.getElementById("sendForm");
    const input = document.getElementById("msg");
    const chat = document.getElementById("chat");

    form.onsubmit = e => {
        e.preventDefault();

        if (!input.value) return;

        socket.emit("message", {
            channel: channel,
            text: input.value
        });

        input.value = "";
    };

    socket.on("message", m => {
        const div = document.createElement("div");
        div.textContent = `${m.user}: ${m.text}`;
        chat.appendChild(div);
    });

})();
