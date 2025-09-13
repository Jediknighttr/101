(function(){
  const socket = io();

  let myId = null;
  let mySeat = null;
  let room = null;
  let myHand = [];
  let selectedTileId = null;
  let turnSeconds = 30;
  let timerInterval = null;

  const byId = (id) => document.getElementById(id);
  const joinPanel = byId('joinPanel');
  const hostPanel = byId('hostPanel');
  const tablePanel = byId('tablePanel');
  const nameInput = byId('nameInput');
  const joinBtn = byId('joinBtn');
  const linkOut = byId('linkOut');
  const roomInfo = byId('roomInfo');
  const modeSelect = byId('modeSelect');
  const botSelect = byId('botSelect');
  const turnSecondsInput = byId('turnSeconds');
  const applySettings = byId('applySettings');
  const fillStart = byId('fillStart');

  const gostergeOut = byId('gostergeOut');
  const okeyOut = byId('okeyOut');
  const turnOut = byId('turnOut');
  const discardOut = byId('discardOut');

  const handArea = byId('handArea');
  const drawDeck = byId('drawDeck');
  const drawDiscard = byId('drawDiscard');
  const discardBtn = byId('discardBtn');
  const discardTop = byId('discardTop');
  const timerEl = byId('timer');

  const chatLog = byId('chatLog');
  const chatBtns = document.querySelectorAll('.preset');

  function colorClass(renk) {
    return ['kirmizi','siyah','mavi','yesil','sahte'].includes(renk) ? renk : 'kirmizi';
  }
  function tileHtml(t) {
    const cls = `tile small ${colorClass(t.renk)} selectable ${selectedTileId===t.id?'selected':''}`;
    const star = t.okey ? '<div class="star">★</div>' : '';
    return `<div class="${cls}" data-id="${t.id}" title="${t.renk} ${t.sayi===0?'Sahte':t.sayi}">
      ${t.sayi===0?'•':t.sayi}${star}
    </div>`;
  }
  function showHand() {
    handArea.innerHTML = myHand.map(tileHtml).join('');
    handArea.querySelectorAll('.tile').forEach(el => {
      el.addEventListener('click', () => {
        selectedTileId = el.getAttribute('data-id');
        showHand();
      });
    });
  }
  function setDiscardTop(card) {
    if (!card) { discardTop.innerHTML=''; discardOut.textContent='-'; return; }
    discardTop.className = `tile ${colorClass(card.renk)}`;
    discardTop.innerHTML = card.sayi===0?'•':card.sayi;
    discardOut.textContent = `${card.renk} ${card.sayi}`;
  }
  function setIndicator(g, okey) {
    gostergeOut.textContent = g ? `${g.renk} ${g.sayi}` : '-';
    okeyOut.textContent = okey ? `${okey.renk} ${okey.sayi}` : '-';
  }
  function setTurnLabel(seat) {
    turnOut.textContent = seat || '-';
  }
  function restartTimer() {
    clearInterval(timerInterval);
    let left = turnSeconds;
    timerEl.textContent = left;
    timerInterval = setInterval(()=>{
      left--;
      if (left <= 0) {
        timerEl.textContent = '⏰';
        clearInterval(timerInterval);
      } else {
        timerEl.textContent = left;
      }
    }, 1000);
  }

  socket.on('hello', ({roomId, summary}) => {
    linkOut.textContent = window.location.href;
    roomInfo.textContent = `Masa: ${roomId}`;
    updateState(summary);
  });

  socket.on('state', (summary) => {
    updateState(summary);
  });

  socket.on('yourHand', (hand) => {
    myHand = hand;
    showHand();
  });

  socket.on('chat', ({from, text}) => {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    div.textContent = `[${time}] ${from}: ${text}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  });

  socket.on('errorMsg', (m) => alert(m));

  function updateState(summary) {
    room = summary;
    if (!myId) myId = socket.id;
    const player = room.players[myId];
    mySeat = player ? player.seat : null;

    if (!player) {
      joinPanel.classList.remove('hidden');
      tablePanel.classList.add('hidden');
      hostPanel.classList.add('hidden');
    } else {
      joinPanel.classList.add('hidden');
      tablePanel.classList.remove('hidden');
      hostPanel.classList.toggle('hidden', room.hostId !== myId);
    }

    if (room.settings) {
      modeSelect.value = room.settings.mode;
      botSelect.value = room.settings.bot;
      turnSeconds = room.settings.turnSeconds || 30;
    }

    setIndicator(room.gosterge, room.okey);
    setDiscardTop(room.discardTop);
    setTurnLabel(room.turn);
    if (room.turn && mySeat && room.turn === mySeat) restartTimer();

    // ask my hand
    socket.emit('requestHand');

    const myTurn = room.turn === mySeat;
    drawDeck.disabled = !myTurn;
    drawDiscard.disabled = !myTurn || !room.discardTop;
    discardBtn.disabled = !myTurn || !selectedTileId;
  }

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Oyuncu';
    socket.emit('join', {name});
  });

  applySettings.addEventListener('click', () => {
    socket.emit('chooseSettings', {
      mode: modeSelect.value,
      bot: botSelect.value,
      turnSeconds: Number(turnSecondsInput.value)||30
    });
  });

  fillStart.addEventListener('click', () => {
    socket.emit('startOrFill');
  });

  drawDeck.addEventListener('click', () => {
    socket.emit('draw', {from:'deck'});
  });
  drawDiscard.addEventListener('click', () => {
    socket.emit('draw', {from:'discard'});
  });
  discardBtn.addEventListener('click', () => {
    if (!selectedTileId) return;
    socket.emit('discard', {tileId: selectedTileId});
    selectedTileId = null;
  });

  chatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('chatPreset', {text: btn.textContent});
    });
  });

})();