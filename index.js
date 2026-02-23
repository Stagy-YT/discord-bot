const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const https = require('https');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID     = process.env.CLIENT_ID;
const WORKER_URL    = process.env.WORKER_URL; // e.g. https://playerdata.ratdynast.workers.dev

// ── Helpers ──────────────────────────────────────────────────────────────────────

function formatScore(score) {
  if (score >= 1000000) return (score / 1000000).toFixed(1) + 'M';
  if (score >= 1000)    return (score / 1000).toFixed(1) + 'K';
  return String(score);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Bad JSON: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// ── Command registration ──────────────────────────────────────────────────────

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('list')
      .setDescription('Show all online players'),
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Look up a specific player by real name or in-game name')
      .addStringOption(o =>
        o.setName('name')
         .setDescription('Real name or in-game name')
         .setRequired(true)
      ),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('[Bot] Slash commands registered');
  } catch (e) {
    console.error('[Bot] Failed to register commands:', e);
  }
}

// ── Bot setup ─────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  try {
    // GET request only — no POST
    const data = await fetchJSON(`${WORKER_URL}/?action=list`);

    if (!data.success) {
      return interaction.editReply('❌ Could not reach the player tracker worker.');
    }

    // data.players is an object keyed by sessionId — convert to array
    const playersObj = data.players || {};
    const players    = Object.values(playersObj);

    // ── /list ──────────────────────────────────────────────────────────────────
    if (interaction.commandName === 'list') {
      if (players.length === 0) {
        return interaction.editReply('No players online right now.');
      }

      // Sort alphabetically by real name
      players.sort((a, b) => (a.realName || '').localeCompare(b.realName || ''));

      const lines = players.map(p => {
        const score = p.score ? formatScore(p.score) : '0';
        const team  = p.teamName || 'Solo';
        return `🟢 **${p.realName || 'Unknown'}** — \`${p.inGameName || '?'}\` | Server: ${p.serverName || '?'} | Team: ${team} | Score: ${score}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x00c853)
        .setTitle(`🎮 Online Players (${players.length})`)
        .setDescription(lines.join('\n'))
        .setTimestamp()
        .setFooter({ text: 'Live data from player tracker' });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /info ──────────────────────────────────────────────────────────────────
    if (interaction.commandName === 'info') {
      const query = interaction.options.getString('name').toLowerCase().trim();

      const player = players.find(p =>
        p.realName?.toLowerCase()   === query ||
        p.inGameName?.toLowerCase() === query ||
        p.realName?.toLowerCase().includes(query) ||
        p.inGameName?.toLowerCase().includes(query)
      );

      if (!player) {
        return interaction.editReply(`❌ No online player found matching **${query}**. They may be offline or haven't connected yet.`);
      }

      const embed = new EmbedBuilder()
        .setColor(0x00c853)
        .setTitle(`🟢 ${player.realName || 'Unknown'}`)
        .addFields(
          { name: 'In-Game Name', value: `\`${player.inGameName || '?'}\``,          inline: true },
          { name: 'Server',       value: player.serverName || 'Unknown',               inline: true },
          { name: 'Team',         value: player.teamName   || 'Solo',                  inline: true },
          { name: 'Score',        value: formatScore(player.score || 0),               inline: true },
          { name: 'Session ID',   value: `\`${player.sessionId || '?'}\``,           inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `Last seen: ${player.lastSeen ? new Date(player.lastSeen * 1000).toUTCString() : 'Unknown'}` });

      return interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error('[Bot] Error:', err);
    await interaction.editReply('❌ Error fetching player data: ' + err.message);
  }
});

client.login(DISCORD_TOKEN);
