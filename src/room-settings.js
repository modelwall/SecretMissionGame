export const ROOM_LIMITS = Object.freeze({
  minPlayers: 2,
  maxPlayers: 24,
  minTeams: 1,
  maxTeams: 8,
  minItemsPerPlayer: 1,
  maxItemsPerPlayer: 6,
  missionBankSize: 72,
  minDrawSize: 1,
});

export function isValidMissionSettings(playerLimit, teamCount, missionsPerPlayer) {
  return Number.isInteger(playerLimit) && playerLimit >= ROOM_LIMITS.minPlayers && playerLimit <= ROOM_LIMITS.maxPlayers &&
    Number.isInteger(teamCount) && teamCount >= ROOM_LIMITS.minTeams && teamCount <= ROOM_LIMITS.maxTeams && teamCount <= playerLimit &&
    Number.isInteger(missionsPerPlayer) && missionsPerPlayer >= ROOM_LIMITS.minItemsPerPlayer && missionsPerPlayer <= ROOM_LIMITS.maxItemsPerPlayer &&
    playerLimit * missionsPerPlayer <= ROOM_LIMITS.missionBankSize;
}

export function isValidSentenceSettings(playerLimit, sentencesPerPlayer, drawSize) {
  return Number.isInteger(playerLimit) && playerLimit >= ROOM_LIMITS.minPlayers && playerLimit <= ROOM_LIMITS.maxPlayers &&
    Number.isInteger(sentencesPerPlayer) && sentencesPerPlayer >= ROOM_LIMITS.minItemsPerPlayer && sentencesPerPlayer <= ROOM_LIMITS.maxItemsPerPlayer &&
    Number.isInteger(drawSize) && drawSize >= ROOM_LIMITS.minDrawSize && drawSize <= playerLimit * sentencesPerPlayer;
}

export function capacityForTeam(playerLimit, teamCount, teamNumber) {
  if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > teamCount) return 0;
  return Math.floor(playerLimit / teamCount) + (teamNumber <= playerLimit % teamCount ? 1 : 0);
}
