// server.js (çalıştığı bilinen sade sürüm)
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));

// Sağlık kontrolü (Render bazen ister)
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// --- Basit oyun durumu (sadece iskelet; çökmesin diye sade) ---
const COLORS = ['kirmizi','siyah','mavi','yesil'];
const SEATS = ['S','W','N','E'];
function createDeck(){
  const d=[]; for(const c of COLORS){ for(let n=1;n<=13;n++){ d.push({sayi:n,renk:c,id:`${c}-${n}-a`}); d.push({sayi:n,renk:c,id:`${c}-${n}-b`}); } }
  d.push({sayi:0,renk:'sahte',id:'sahte-a'}); d.push({sayi:0,renk:'sahte',id:'sahte-b'}); return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function okeyFromGosterge(g){ const next=g.sayi===13?1:g.sayi+1; return {sayi:next,renk:g.renk}; }
function nextSeat(s){ return SEATS[(SEATS.indexOf(s)+1)%SEATS.length]; }

const rooms = {};
function getRoom(id){
