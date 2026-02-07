require("dotenv").config();

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const { runConfigFromGithub } = require("./moveEngine");

// ===== Status-Speicher (in RAM) =====
const RUN_HISTORY = [];
const MAX_HISTORY = 20;

function addRun(entry) {
  RUN_HISTORY.unshift(entry);
  if (RUN_HISTORY.length > MAX_HISTORY) RUN_HISTORY.pop();
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

// ===== Rollenrechte =====
function hasPermission(member) {
  const allowed = process.env.ALLOWED_ROLE_IDS;
  if (!allowed) return true;

  const allowedIds = allowed.split(",").map(r => r.trim()).filter(Boolean);
  if (allowedIds.length === 0) return true;

  return member.roles.cache.some(role => allowedIds.includes(role.id));
}

// ===== Fehler-Benachrichtigung =====
async function notifyError(client, payload) {
  const channelId = process.env.ERROR_CHANNEL_ID;
  if (!channelId) return;

  const roleId = process.env.ERROR_PING_ROLE_ID;
  const userId = process.env.ERROR_PING_USER_ID;

  const pingParts = [];
  if (roleId) pingParts.push(`<@&${roleId}>`);
  if (userId) pingParts.push(`<@${userId}>`);
  const ping = pingParts.length ? pingParts.join(" ") + " " : "";

  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) return;

    await ch.send(
      `${ping}❌ **Run fehlgeschlagen**\n` +
      `• Programm: **${payload.name}**\n` +
      `• Von: ${payload.userTag}\n` +
      `• Fehler: \`${payload.error}\`\n` +
      (payload.durationMs != null ? `• Dauer: ${fmtMs(payload.durationMs)}\n` : "")
    );
  } catch (e) {
    console.error("notifyError failed:", e);
  }
}

// ===== ENV =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// ===== Slash Commands =====
const commands = [
  new SlashCommandBuilder()
    .setName("run")
    .setDescription("Startet ein Programm (lädt Config live aus GitHub)")
    .addStringOption(opt =>
      opt
        .setName("name")
        .setDescription("z.B. lager_1")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Zeigt die letzten Runs (Erfolg/Fehler, Dauer, wer)")
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log("✅ Slash Commands registriert");
}

// ===== Discord Client =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ===== /status =====
  if (interaction.commandName === "status") {
    if (!hasPermission(interaction.member)) {
      return interaction.reply({ content: "❌ Du hast keine Berechtigung dafür.", ephemeral: true });
    }

    await interaction.reply({ content: "📊 Status wird geladen…", ephemeral: true });

    if (RUN_HISTORY.length === 0) {
      return interaction.editReply("Noch keine Runs gespeichert.");
    }

    const lines = RUN_HISTORY.slice(0, 10).map((r, idx) => {
      const icon = r.ok ? "✅" : "❌";
      const dur = r.durationMs != null ? fmtMs(r.durationMs) : "?";
      const when = new Date(r.ts).toLocaleString("de-DE");
      return `${idx + 1}. ${icon} **${r.name}** • ${dur} • ${when} • ${r.userTag} • ${r.summary}`;
    });

    return interaction.editReply(lines.join("\n"));
  }

  // ===== /run =====
  if (interaction.commandName === "run") {
    if (!hasPermission(interaction.member)) {
      return interaction.reply({ content: "❌ Du hast keine Berechtigung dafür.", ephemeral: true });
    }

    const name = interaction.options.getString("name", true);
    const started = Date.now();
    const userTag = interaction.user.tag || interaction.user.username;

    await interaction.deferReply();
    await interaction.editReply(`🚚 Starte **${name}** (Config wird live aus GitHub geladen)…`);

    try {
      const result = await runConfigFromGithub(name);
      const durationMs = Date.now() - started;

      if (result.total === 0) {
        addRun({
          ts: Date.now(),
          name,
          ok: true,
          durationMs,
          userTag,
          summary: "leer/falsch aufgebaut"
        });
        return interaction.editReply(`ℹ️ **${name}** ist leer oder falsch aufgebaut.`);
      }

      addRun({
        ts: Date.now(),
        name,
        ok: !!result.ok,
        durationMs,
        userTag,
        summary: result.ok
          ? `${result.okCount}/${result.total} ok`
          : `${result.okCount}/${result.total} ok, ${result.failCount} Fehler`
      });

      if (result.ok) {
        return interaction.editReply(`✅ Fertig: **${result.okCount}/${result.total}** erfolgreich.`);
      }

      return interaction.editReply(
        `⚠️ Fertig: **${result.okCount}/${result.total}** ok, **${result.failCount}** Fehler.\n` +
        `Fehler:\n- ${result.errors.join("\n- ")}`
      );
    } catch (err) {
      const durationMs = Date.now() - started;

      addRun({
        ts: Date.now(),
        name,
        ok: false,
        durationMs,
        userTag,
        summary: err.message
      });

      await notifyError(client, {
        name,
        userTag,
        error: err.message,
        durationMs
      });

      return interaction.editReply(`❌ Fehler: ${err.message}`);
    }
  }
});

// ===== Start =====
(async () => {
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    console.error("❌ Discord ENV Variablen fehlen");
    process.exit(1);
  }

  await registerCommands();
  await client.login(DISCORD_TOKEN);
  console.log("🤖 Bot ist online");
})();
