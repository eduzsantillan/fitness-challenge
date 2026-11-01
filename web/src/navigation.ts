/** Only restore a challenge still shared with this account. No private IDs are persisted. */
export function returnChallenge(lastId: string | undefined, challenges: readonly {id:string}[]): string | undefined {
  if (lastId && challenges.some(c => c.id === lastId)) return lastId;
  return challenges.length === 1 ? challenges[0]!.id : undefined;
}
