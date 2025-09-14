(function () {
  const socket = io(window.location.origin, { transports: ["websocket"] });

  // Hata bandı
  const errEl = document.getElementById("errorBanner");
  function showError(msg){ if(errEl){ errEl.textContent = msg; errEl.classList.remove("hidden"); } console.error("[UI ERROR]", msg); }
  function hideError(){ if(errEl){ errEl.classList.add("hidden"); } }

  console.log("client.js yüklendi");

  let myId = null, mySeat = null, room = null;
  let myHand = [], selectedTileId = null, turnSeconds = 30, timerInterval = null;

  const $ = (id) => document.getElementById(id);
  const joinPanel = $("joinPanel"), hostPanel = $("hostPanel"), tablePanel = $("tablePanel");
  const nameInput = $("nameInput"), joinBtn = $("joinBtn"), linkOut = $("linkOut"), roomInfo = $("roomInfo");
  const modeSelect = $("modeSelect"), botSelect = $("botSelect"), turnSecondsInput = $("turnSeconds");
  const applySettings = $("applySettings"), fillStart = $("fillStart"), restartBtn = $("restartBtn"), restartHint = $("restartHint");
  const gostergeOut = $("gostergeOut"), okeyOut = $("okeyOut"), turnOut = $("turnOut"), discardOut = $("discardOut");
  const handArea = $("handArea"), drawDeck = $("drawDeck"), drawDiscard = $("drawDiscard"), discardBtn = $("discardBtn"), discardTop = $("discardTop"), timerEl = $("timer");
  const chatLog = $("chatLog"); const chatBtns = document.querySelectorAll(".preset");

  function colorClass(renk){ return ["kirmizi","siyah","mavi","yesil","sahte"].includes(renk) ? renk : "kirmizi"; }
  function tileHtml(t){
    const cls = `tile small ${colorClass(t.renk)} selectable ${selectedTileId===t.id?"selected":""}`;
    const star = t.okey ? '<div class="star">★</div>' : "";
    return `<div class="${cls}" data-id="${t.id}" title="${t.renk} ${t.sayi===0?"Sahte":t.sayi}">${t.sayi===0?"•":t.sayi}${star}</div>`;
  }
  function showHand(){
    handArea.innerHTML = myHand.map(tileHtml).join("");
    handArea.querySelectorAll(".tile").forEach(el=>{
      el.addEventListener("click", ()=>{
        selectedTileId = el.getAttribute("data-id");
        showHand(); syncActionButtons();
      });
    });
  }
  function setDiscardTop(card){
    if(!card){ discardTop.innerHTML=""; discardOut.textContent="-"; return; }
    discardTop.className = `tile ${colorClass(card.renk)}`;
    discardTop.innerHTML = card.sayi===0?"•":card.sayi;
    discardOut.textContent = `${card.renk} ${card.sayi}`;
  }
  function setIndicator(g,okey){
    gostergeOut.textContent = g ? `${g.renk} ${g.sayi}` : "-";
    okeyOut.textContent = okey ? `${okey.renk} ${okey.sayi}` : "-";
  }
  function setTurnLabel(seat){ turnOut.textContent = seat || "-"; }
  function restartTimer(){
    clearInterval(timerInterval);
    let left = turnSeconds; timerEl.textContent = left;
    timerInterval = setInterval(()=>{
      left--; timerEl.textContent = left<=0 ? "⏰" : left;
      if(left<=0) clearInterval(timerInterval);
    }, 1000);
  }
  function syncPanels(player){
    if(!player){ joinPanel.classList.remove("hidden"); tablePanel.classList.add("hidden"); hostPanel.classList.add("hidden"); }
    else { joinPanel.classList.add("hidden"); tablePanel.classList.remove("hidden"); hostPanel.classList.toggle("hidden", room.hostId !== myId); }
  }
  function syncActionButtons(){
    const myTurn = room && mySeat && room.turn === mySeat;
    drawDeck.disabled = !myTurn;
    drawDiscard.disabled = !myTurn || !room?.discardTop;
    discardBtn.disabled = !myTurn || !selectedTileId;
  }

  // Bağlantı olayları
  socket.on("connect", ()=>{ hideError(); if(linkOut) linkOut.textContent = window.location.href; console.log("socket CONNECTED:", socket.id); });
  socket.on("connect_error", (err)=>{ showError("Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin."); console.error("connect_error:", err); });
  socket.on("disconnect", (reason)=>{ showError("Bağlantı koptu: " + reason); });

  socket.on("hello", ({roomId, summary})=>{ if(roomInfo) roomInfo.textContent = `Masa: ${roomId}`; updateState(summary); });
  socket.on("state", (summary)=>{ updateState(summary); });
  socket.on("yourHand", (hand)=>{ myHand = hand || []; showHand(); });
  socket.on("chat", ({from, text})=>{
    const div=document.createElement("div"); const time=new Date().toLocaleTimeString();
    div.textContent=`[${time}] ${from}: ${text}`; chatLog.appendChild(div); chatLog.scrollTop=chatLog.scrollHeight;
  });
  socket.on("errorMsg", (m)=>{ showError(m); alert(m); });

  function updateState(summary){
    room = summary || {}; if(!myId) myId = socket.id;
    const player = room.players ? room.players[myId] : null; mySeat = player ? player.seat : null;

    syncPanels(player);

    if(room.settings){
      modeSelect.value = room.settings.mode || "tekli";
      botSelect.value  = room.settings.bot  || "kolay";
      turnSeconds      = room.settings.turnSeconds || 30;
    }

    // Host'a restart göstergesi: oyun başladı + needsRestart true + ben hostum
    const iAmHost = (room.hostId === myId);
    const showRestart = !!(room.started && room.needsRestart && iAmHost);
    restartBtn.classList.toggle("hidden", !showRestart);
    restartHint.classList.toggle("hidden", !showRestart);

    setIndicator(room.gosterge, room.okey);
    setDiscardTop(room.discardTop);
    setTurnLabel(room.turn);

    if (room.turn && mySeat && room.turn === mySeat) restartTimer();

    socket.emit("requestHand");
    syncActionButtons();
  }

  // UI olayları
  joinBtn.addEventListener("click", ()=>{
    const name = nameInput.value.trim() || "Oyuncu";
    socket.emit("join", { name });
  });
  applySettings.addEventListener("click", ()=>{
    socket.emit("chooseSettings", {
      mode: modeSelect.value,
      bot: botSelect.value,
      turnSeconds: Number(turnSecondsInput.value)||30
    });
  });
  fillStart.addEventListener("click", ()=>{ socket.emit("startOrFill"); });
  restartBtn.addEventListener("click", ()=>{
    if(confirm("Oyunu yeniden başlatmak istiyor musun? (Tüm dağıtım sıfırlanır)")){
      socket.emit("restartGame");
    }
  });

  drawDeck.addEventListener("click", ()=> socket.emit("draw", {from:"deck"}));
  drawDiscard.addEventListener("click", ()=> socket.emit("draw", {from:"discard"}));
  discardBtn.addEventListener("click", ()=>{
    if(!selectedTileId) return;
    socket.emit("discard", { tileId: selectedTileId });
    selectedTileId = null; syncActionButtons();
  });

  chatBtns.forEach(btn=> btn.addEventListener("click", ()=> socket.emit("chatPreset", {text: btn.textContent})));
})();
