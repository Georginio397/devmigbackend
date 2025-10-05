// backend/monitor-service.js
import { Connection, PublicKey } from "@solana/web3.js";
import { exec } from "child_process";
import os from "os";
import fs from "fs";
import player from "play-sound";
import fetch from "node-fetch";
import { MongoClient } from "mongodb";

// === CONFIGURARE ===
const HELIUS_RPC_URL = "https://rpc.helius.xyz/?api-key=5ae82747-7ad8-42ee-9a9c-cdeb0b5b3a4f";
const MONGO_URI = "mongodb+srv://PumpBot:WZZTZdwnzRuontvu@thepillz.e3ck3os.mongodb.net/pumpfun?retryWrites=true&w=majority";
const PUMP_FUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const connection = new Connection(HELIUS_RPC_URL, "confirmed");
const client = new MongoClient(MONGO_URI);
const play = player();
const openedPools = new Set();

const walletCategoryMap = new Map();

// === Redare sunet ===
function playSound(owner) {
  const category = walletCategoryMap.get(owner) || "default";
  const soundPath = `./sunete/${category}/basic.wav`;

  if (fs.existsSync(soundPath)) {
    exec(`powershell -c (New-Object Media.SoundPlayer '${soundPath}').PlaySync();`, (err) => {
      if (err) console.error(`⚠️ Eroare la redarea sunetului pentru ${owner}:`, err.message);
    });
  } else {
    console.log(`🔇 Sunet lipsă pentru categoria '${category}' (${soundPath})`);
  }
}

// === Deschidere link în browser ===
function openInExplorer(link) {
  if (os.platform() === "win32") {
    exec(`start iexplore "${link}"`, (err) => {
      if (err) console.error("❌ Nu s-a putut deschide în IE:", err.message);
    });
  } else {
    console.log("🔗 Sistem non-Windows – funcția openInExplorer nu este compatibilă.");
  }
}

// === Procesare tranzacție ===
async function handleTransaction(signature, wallet) {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    if (!tx || !tx.meta) return;

    const post = tx.meta.postTokenBalances || [];
    const pre = tx.meta.preTokenBalances || [];

    for (let i = 0; i < post.length; i++) {
      const token = post[i];
      const preToken = pre.find(p => p.accountIndex === token.accountIndex);
      const postAmount = token.uiTokenAmount.uiAmount;
      const preAmount = preToken?.uiTokenAmount?.uiAmount ?? 0;
      const owner = token.owner;
      const mint = token.mint;

      if (owner === wallet && postAmount > preAmount) {
        let bondingCurveAddress = "necunoscut";

        if (mint.endsWith("bonk")) {
          try {
            const innerInstructions = tx.meta.innerInstructions || [];
            for (const inner of innerInstructions) {
              for (const ix of inner.instructions || []) {
                if (ix.parsed?.info?.poolState) {
                  bondingCurveAddress = ix.parsed.info.poolState;
                  break;
                }
              }
              if (bondingCurveAddress !== "necunoscut") break;
            }
          } catch (e) {
            console.error("⚠️ Eroare la extragerea poolState:", e.message);
          }
        } else {
          try {
            const [pda] = PublicKey.findProgramAddressSync(
              [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
              PUMP_FUN_PROGRAM_ID
            );
            bondingCurveAddress = pda.toBase58();
          } catch (e) {
            console.error("⚠️ Eroare la derivarea bonding curve:", e.message);
          }
        }

        const link = `https://axiom.trade/meme/${bondingCurveAddress}`;
        console.log(`\n🪙 SPL Token primit`);
        console.log(`Wallet: ${owner}`);
        console.log(`Mint: ${mint}`);
        console.log(`Pool: ${bondingCurveAddress}`);
        console.log(`🔗 ${link}`);

        if (!openedPools.has(bondingCurveAddress)) {
          openedPools.add(bondingCurveAddress);
          openInExplorer(link);
        } else {
          console.log("⏩ Pool deja deschis anterior.");
        }
        playSound(owner);
      }
    }
  } catch (err) {
    console.error(`Eroare în procesarea ${signature}:`, err.message);
  }
}

// === Subscriere la wallet ===
async function subscribeWallet(wallet) {
  try {
    const pubkey = new PublicKey(wallet);
    connection.onLogs(pubkey, async (logInfo) => {
      const { signature } = logInfo;
      await handleTransaction(signature, wallet);
    });
    console.log(`✅ Monitorizare activă pentru ${wallet}`);
  } catch (err) {
    console.error(`❌ Eroare la subscrierea ${wallet}:`, err.message);
  }
}

// === Pornire serviciu ===
async function main() {
  await client.connect();
  console.log("✅ Conectat la MongoDB.");

  const db = client.db("pumpfun");
  const walletsCol = db.collection("monitored_wallets");

  const wallets = await walletsCol.find().toArray();
  if (wallets.length === 0) {
    console.log("⚠️ Niciun wallet în DB. Adaugă unul din interfața web.");
  }

  for (const { wallet, category = "default" } of wallets) {
    walletCategoryMap.set(wallet, category);
    await subscribeWallet(wallet);
  }

  console.log("🚀 Serviciu de monitorizare Solana activ.");
}

main().catch(console.error);
