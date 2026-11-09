const PVP_BOT_IDS = new Set(['bot_ember', 'bot_bastion', 'bot_gale', 'bot_relic']);

export function isKnownPvpBotId(id: string): boolean {
  return PVP_BOT_IDS.has(String(id || ''));
}
