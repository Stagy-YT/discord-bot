const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const https = require('https');

const DISCORD_TOKEN  = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const WORKER_URL     = process.env.WORKER_URL;

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

function formatScore(score) {
  if (score >= 1000) return (score / 1000).toFixed(1) + 'K';
  return String(score);
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Look up a specific player')
      .addStringOption(o =>
        o.setName('name')
         .setDescription('Real name or in-game name')
         .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('list')
      .setDescription('Show all online players')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Slash commands registered');
  } catch (e) {
    console.error('Failed to register commands:', e);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Bot online as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  try {
    const data = await fetchJSON(`${WORKER_URL}/?action=list`);

    if (!data.success) {
      return interaction.editReply('Could not reach the player tracker.');
    }

    if (!data.players || data.players.length === 0) {
      return interaction.editReply('No players online right now.');
    }

    // COMMAND: /list - Show all online players
    if (interaction.commandName === 'list') {
      const playerLines = data.players.map(p => {
        const dot = p.status === 'online' ? '🟢' : '🔴';
        return `${dot} **${p.realName}** (${p.inGameName}) | Server: ${p.serverName} | Team: ${p.teamName} | Score: ${formatScore(p.score)}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0x00c853)
        .setTitle(`Online Players (${data.players.length})`)
        .setDescription(playerLines.join('\n\n'))
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // COMMAND: /info - Search for specific player
    if (interaction.commandName === 'info') {
      const query = interaction.options.getString('name').toLowerCase();

      const player = data.players.find(p =>
        p.realName?.toLowerCase() === query ||
        p.inGameName?.toLowerCase() === query ||
        p.realName?.toLowerCase().includes(query) ||
        p.inGameName?.toLowerCase().includes(query)
      );

      if (!player) {
        return interaction.editReply(`No player found matching ${query}. They may be offline.`);
      }

      const isOnline = player.status === 'online';
      const dot = isOnline ? '🟢' : '🔴';
      const status = isOnline ? 'Online' : 'Offline';

      const line = `${dot} Player: ${player.realName} | Server: ${player.serverName} | Username: ${player.inGameName} | Team: ${player.teamName} | Score: ${formatScore(player.score)}`;

      const embed = new EmbedBuilder()
        .setColor(isOnline ? 0x00c853 : 0xff1744)
        .setDescription(line)
        .setFooter({ text: `Status: ${status}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(err);
    await interaction.editReply('Error fetching player data: ' + err.message);
  }
});

client.login(DISCORD_TOKEN);
