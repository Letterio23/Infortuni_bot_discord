// Importiamo le librerie necessarie
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');

// Leggiamo i webhook URL dai "secrets" di GitHub
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
const logWebhookUrl = process.env.LOG_WEBHOOK_URL;

const DATA_FILE = 'playerData.json';

// Lista degli URL da controllare
const urls = [
    'https://www.transfermarkt.it/bundesliga/verletztespieler/wettbewerb/L1',
    'https://www.transfermarkt.it/laliga/verletztespieler/wettbewerb/ES1/sort/datum_bis.desc',
    'https://www.transfermarkt.it/premier-league/verletztespieler/wettbewerb/GB1',
    'https://www.transfermarkt.it/serie-a/verletztespieler/wettbewerb/IT1',
    'https://www.transfermarkt.it/major-league-soccer/verletztespieler/wettbewerb/MLS1',
    'https://www.transfermarkt.it/ligue-1/verletztespieler/wettbewerb/FR1'
];

// Funzione di utilità per inviare log
const sendLogMessage = (message) => {
    console.log(message); // Logga anche nella console di GitHub Actions
    axios.post(logWebhookUrl, { content: `[LOG] ${new Date().toLocaleTimeString('it-IT')} - ${message}` }).catch(err => console.error("Errore invio log:", err.message));
};

// Funzione principale asincrona
async function main() {
    await sendLogMessage('Avvio del processo di scraping...');

    // Leggiamo i dati salvati dalla precedente esecuzione
    let previousData = {};
    try {
        if (fs.existsSync(DATA_FILE)) {
            previousData = JSON.parse(fs.readFileSync(DATA_FILE));
        }
    } catch (error) {
        await sendLogMessage(`Errore lettura file dati: ${error.message}. Si parte da zero.`);
    }

    let updatedData = {};
    let hasUpdates = false;

    for (const url of urls) {
        const leagueName = getLeagueFromUrl(url);
        try {
            const newData = await fetchPlayerData(url);
            updatedData[url] = newData;

            const newPlayers = getNewPlayers(previousData[url] || [], newData);
            const updatedPlayers = getUpdatedPlayers(previousData[url] || [], newData);

            if (newPlayers.length > 0 || updatedPlayers.length > 0) {
                hasUpdates = true;
                const message = buildMessage(newPlayers, updatedPlayers, url);
                await axios.post(discordWebhookUrl, { content: message });
                await sendLogMessage(`Dati aggiornati e notificati per ${leagueName}.`);
            } else {
                await sendLogMessage(`Nessun cambiamento nei dati per ${leagueName}.`);
            }
        } catch (error) {
            await sendLogMessage(`Errore elaborazione per ${leagueName}: ${error.message}`);
        }
    }

    // Se ci sono stati aggiornamenti, salviamo i nuovi dati nel file JSON
    if (hasUpdates) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(updatedData, null, 2));
        await sendLogMessage('File playerData.json aggiornato.');
    }

    await sendLogMessage('Processo di scraping completato.');
}

// Funzione di scraping con Puppeteer (il "browser invisibile")
async function fetchPlayerData(url) {
    await sendLogMessage(`Avvio scraping per: ${url}`);
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }); // Argomenti necessari per GitHub Actions
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
    
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    const html = await page.content();
    await browser.close();

    const $ = cheerio.load(html);
    const data = [];
    $('.items tbody tr').each((index, element) => {
        const playerName = $(element).find('td:nth-child(1) .hauptlink a').attr('title');
        const injury = $(element).find('td:nth-child(2)').text().trim();
        const returnDate = $(element).find('td:nth-child(3)').text().trim() || 'incerta';
        const value = $(element).find('td:nth-child(4)').text().trim();
        if (playerName) {
            data.push([playerName, injury, returnDate, value]);
        }
    });
    
    await sendLogMessage(`Estratti ${data.length} giocatori.`);
    return data;
}

// ===== INIZIO BLOCCO FUNZIONI HELPER (definite una sola volta) =====

function getLeagueFromUrl(url) {
  if (url.includes('bundesliga')) return 'Bundesliga 🇩🇪';
  if (url.includes('serie-a')) return 'Serie A 🇮🇹';
  if (url.includes('laliga')) return 'La Liga 🇪🇸';
  if (url.includes('premier-league')) return 'Premier League 🇬🇧';
  if (url.includes('major-league-soccer')) return 'MLS 🇺🇸';
  if (url.includes('ligue-1')) return 'Ligue 1 🇫🇷';
  return 'Lega sconosciuta';
}

function buildMessage(newPlayers, updatedPlayers, url) {
  const leagueName = getLeagueFromUrl(url);
  let message = `🆕 **Aggiornamento Infortuni per ${leagueName}:**\n\n`;
  [...newPlayers, ...updatedPlayers].forEach(player => {
    const [playerName, injury, returnDate, value] = player;
    message += `*Giocatore*: ${playerName} **${value}**\n`;
    message += `🏥 *Infortunio*: ${injury}\n`;
    message += `📅 *Ritorno*: ${returnDate}\n`;
    message += `🔗 [Cercalo al floor su Sorare](https://sorare.com/it/football/market/manager-sales?q=${encodeURIComponent(playerName)})\n`;
    message += `🧭 [Cercalo su SorareData](https://www.soraredata.com/playerSearch/${encodeURIComponent(playerName)})\n`;
    message += `🔍 [Cerca aggiornamenti su Twitter](https://x.com/search?q=${encodeURIComponent(playerName)}&src=typed_query&f=live)\n\n`;
  });
  return message;
}

function getNewPlayers(previousData, newData) {
  return newData.filter(newPlayer => !previousData.some(prevPlayer => prevPlayer[0] === newPlayer[0]));
}

function getUpdatedPlayers(previousData, newData) {
  return newData.filter(newPlayer => {
    const prevPlayer = previousData.find(prev => prev[0] === newPlayer[0]);
    return prevPlayer && (prevPlayer[1] !== newPlayer[1] || prevPlayer[2] !== newPlayer[2] || prevPlayer[3] !== newPlayer[3]);
  });
}

// ===== FINE BLOCCO FUNZIONI HELPER =====

// Avvia la funzione principale
main();
