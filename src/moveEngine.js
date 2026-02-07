async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "discord-control-bot" } });
  if (!res.ok) throw new Error(`Config-Download fehlgeschlagen (${res.status})`);
  return res.json();
}

async function moveChest({ apiKey, apiUrl, loadChunks }, from, to) {
  const params = new URLSearchParams({
    key: apiKey,
    fromX: from.x,
    fromY: from.y,
    fromZ: from.z,
    toX: to.x,
    toY: to.y,
    toZ: to.z,
    loadChunks: loadChunks ? "true" : "false"
  });

  const url = `${apiUrl}?${params.toString()}`;
  const res = await fetch(url);
  return res.json();
}

async function runConfigFromGithub(configName) {
  const apiKey = process.env.API_KEY;
  const base = (process.env.GITHUB_CONFIG_BASE || "").trim();
  const defaultApiUrl =
    process.env.API_URL || "https://api.germanminer.de/v2/world/move/content";

  if (!apiKey) throw new Error("API_KEY fehlt");
  if (!base) throw new Error("GITHUB_CONFIG_BASE fehlt oder ist leer");

  const cleanBase = base.replace(/\/+$/, "");
  const configUrl = `${cleanBase}/${configName}.json`;

  console.log("CONFIG URL:", configUrl);

  const config = await fetchJson(configUrl);

  const apiUrl = config.apiUrl || defaultApiUrl;
  const loadChunks =
    typeof config.loadChunks === "boolean" ? config.loadChunks : true;

  const moves = Array.isArray(config.moves) ? config.moves : [];

  let okCount = 0;
  const errors = [];

  for (let i = 0; i < moves.length; i++) {
    const { from, to } = moves[i];
    try {
      const result = await moveChest({ apiKey, apiUrl, loadChunks }, from, to);
      if (result && result.success) okCount++;
      else errors.push(`Step ${i + 1}: ${result?.error || "Unbekannt"}`);
    } catch (e) {
      errors.push(`Step ${i + 1}: ${e.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    total: moves.length,
    okCount,
    failCount: errors.length,
    errors: errors.slice(0, 8)
  };
}


module.exports = { runConfigFromGithub };
