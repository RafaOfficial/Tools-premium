import express from "express";
import fs from "fs";
import pino from "pino";
import {
  makeWASocket, useMultiFileAuthState, DisconnectReason,
  fetchLatestBaileysVersion, Browsers
} from "@whiskeysockets/baileys";

const app = express();
app.use(express.json());
const ALLOWED = [
  "https://www.rafaofficial.my.id",
  "https://rafaofficial.my.id",
  ...(process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean)
];
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (ALLOWED.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/", (req, res) => res.send("Backend aktif"));

const sessions = new Map(); // nomor -> { sock, connected }
const NUM_RE = /^[1-9]\d{8,14}$/;
const LINK_RE = /^https:\/\/whatsapp\.com\/channel\/[A-Za-z0-9]+(\/\d+)?\/?$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function start(number) {
  const { state, saveCreds } = await useMultiFileAuthState(`sessions/${number}`);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    printQRInTerminal: false
  });
  const s = { sock, connected: false };
  sessions.set(number, s);

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") s.connected = true;
    if (connection === "close") {
      s.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        sessions.delete(number);
        fs.rmSync(`sessions/${number}`, { recursive: true, force: true });
      } else {
        start(number).catch(console.error); // reconnect (termasuk restart setelah pairing)
      }
    }
  });
  return s;
}

// 1) Minta kode pairing
app.post("/api/pair", async (req, res) => {
  try {
    const number = String(req.body.number || "").replace(/\D/g, "");
    if (!NUM_RE.test(number)) return res.status(400).json({ error: "Nomor tidak valid" });

    let s = sessions.get(number);
    if (s?.connected) return res.json({ connected: true });
    if (!s) s = await start(number);

    if (s.sock.authState.creds.registered) return res.json({ connected: s.connected });
    await sleep(3000);
    const code = await s.sock.requestPairingCode(number);
    res.json({ code: code.match(/.{1,4}/g).join("-") });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal membuat kode pairing" });
  }
});

// 2) Cek status koneksi
app.get("/api/status", (req, res) => {
  const number = String(req.query.number || "").replace(/\D/g, "");
  res.json({ connected: !!sessions.get(number)?.connected });
});

// 3) Kirim kedua format (.react & .react2) ke chat sendiri
app.post("/api/react", async (req, res) => {
  try {
    const number = String(req.body.number || "").replace(/\D/g, "");
    const link = String(req.body.link || "").trim();
    const emojis = String(req.body.emojis || "").trim();
    const s = sessions.get(number);

    if (!s?.connected) return res.status(409).json({ error: "Perangkat belum terhubung" });
    if (!LINK_RE.test(link)) return res.status(400).json({ error: "Link channel tidak valid" });

    const jid = `${number}@s.whatsapp.net`;
    const tail = `${link}${emojis ? " " + emojis : ""}`;
    await s.sock.sendMessage(jid, { text: `.react ${tail}` });
    await sleep(1200);
    await s.sock.sendMessage(jid, { text: `.react2 ${tail}` });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Gagal mengirim format" });
  }
});

// 4) Putuskan perangkat
app.post("/api/logout", async (req, res) => {
  const number = String(req.body.number || "").replace(/\D/g, "");
  const s = sessions.get(number);
  try { await s?.sock.logout(); } catch {}
  sessions.delete(number);
  fs.rmSync(`sessions/${number}`, { recursive: true, force: true });
  res.json({ ok: true });
});

// Pulihkan sesi tersimpan saat server restart
if (fs.existsSync("sessions")) {
  for (const n of fs.readdirSync("sessions")) start(n).catch(console.error);
}

app.listen(process.env.PORT || 3000, () => console.log("Server jalan"));
