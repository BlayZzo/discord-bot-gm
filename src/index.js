const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const { runConfigFromGithub } = require("./moveEngine");

// =======================
// ROLLENRECHTE
// =======================
function hasPermission(member) {
  const allowed = process.env.ALLOWED_ROLE_IDS;
  if (!allowed) return true; // wenn leer: jeder darf

  const allowedIds = allowed
    .split(",")
    .map(r => r.trim())
    .filter(Boolean);

  if (allowedIds.length === 0) return true;

  return member.roles.cache.some(role =>
    allowedIds.includes(role.id)
  );
}

// =======================
// ENV VARIABLEN
// =======================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// =======================
// SLASH COMMANDS
// =======================
const commands = [
  new SlashCommandBuilder()
    .setName("run")
    .setDescription("Startet ein Programm (lädt Config live aus GitHub)")
    .addStringOption(opt =>
      opt
        .setName("name")
        .setDescription("z.B. lager_1")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(
      DISCORD_CLIENT_ID,
      DISCORD_GUILD_ID
    ),
    { body: commands }
  );
  console.log("✅ Slash Commands registriert");
}

// =======================
// DISCORD CLIENT
// =======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "run") {
    // Rollenprüfung
    if (!hasPermission(interaction.member)) {
      return interaction.reply({
        content: "❌ Du hast keine Berechtigung dafür.",
        ephemeral: true
      });
    }

    const name = interaction.options.getString("name", true);

    await interaction.reply(
      `🚚 Starte **${name}** (Config wird live aus GitHub geladen)…`
    );

    try {
      const result = await runConfigFromGithub(name);

      if (result.total === 0) {
        return interaction.editReply(
          `ℹ️ **${name}** ist leer oder falsch aufgebaut.`
        );
      }

      if (result.ok) {
        return interaction.editReply(
          `✅ Fertig: **${result.okCount}/${result.total}** erfolgreich.`
        );
      } else {
        return interaction.editReply(
          `⚠️ Fertig: **${result.okCount}/${result.total}** ok, ` +
          `**${result.failCount}** Fehler.\n` +
          `Fehler:\n- ${result.errors.join("\n- ")}`
        );
      }
    } catch (err) {
      return interaction.editReply(
        `❌ Fehler: ${err.message}`
      );
    }
  }
});

// =======================
// START
// =======================
(async () => {
  if (
    !DISCORD_TOKEN ||
    !DISCORD_CLIENT_ID ||
    !DISCORD_GUILD_ID
  ) {
    console.error("❌ Discord ENV Variablen fehlen");
    process.exit(1);
  }

  await registerCommands();
  await client.login(DISCORD_TOKEN);
  console.log("🤖 Bot ist online");
})();
