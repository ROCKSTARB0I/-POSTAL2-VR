// What the Dude says, and when. Every trigger the player can hit has its own
// pool, a cooldown, and a priority so lines don't trample each other.
export const DUDE = {
  dayStart: { cd: 0, pri: 2, lines: [
    'Another list. Another day of standing in other people\'s way.',
    'Right. Errands. Let us get this over with.',
  ] },
  errandNext: { cd: 6, pri: 0, lines: [
    'One down. Several thousand to go.',
    'Next thing on the list.',
  ] },
  queueStart: { cd: 14, pri: 0, lines: [
    'Ah. A line. My favourite part of being alive.',
    'Sure, I will just stand here. Take your time.',
  ] },
  queueWait: { cd: 9, pri: 0, lines: [
    'Any decade now.',
    'I have aged in this line.',
  ] },
  brokeAF: { cd: 10, pri: 1, lines: [
    'Not enough. Story of the week.',
    'I cannot afford this. Obviously.',
  ] },
  hurt: { cd: 3.5, pri: 1, lines: [
    'Ow. Rude.',
    'That is going to bruise.',
  ] },
  lowHealth: { cd: 12, pri: 2, lines: [
    'Bleeding. Great. Add it to the list.',
    'This is not a good amount of blood.',
  ] },
  kill: { cd: 4, pri: 1, lines: [
    'That escalated.',
    'They should not have been standing there.',
  ] },
  killCop: { cd: 5, pri: 2, lines: [
    'That was a cop. That was definitely a cop.',
    'They are going to want to talk about that.',
  ] },
  headshot: { cd: 5, pri: 1, lines: [
    'Right in the thinking parts.',
    'Straight through.',
  ] },
  wanted: { cd: 10, pri: 2, lines: [
    'Sirens. For me? You should not have.',
    'And here comes the town\'s finest.',
  ] },
  copsGone: { cd: 20, pri: 1, lines: [
    'And they are gone. Fickle.',
    'Quiet again. Suspiciously quiet.',
  ] },
  cash: { cd: 6, pri: 0, lines: [
    'Money. Briefly.',
    'This will last me about an hour.',
  ] },
  health: { cd: 8, pri: 0, lines: [
    'That is better.',
    'Patched up. Sort of.',
  ] },
  gotGun: { cd: 4, pri: 2, lines: [
    'Well. That changes the afternoon.',
    'Finders keepers.',
  ] },
  ammo: { cd: 8, pri: 0, lines: [
    'More of these. Fine.',
    'Loaded.',
  ] },
  empty: { cd: 3, pri: 1, lines: [
    'Empty. Perfect timing.',
    'Click. Wonderful.',
  ] },
  relief: { cd: 12, pri: 0, lines: [
    'When you have to go, you have to go.',
    'Nobody is watching. Everybody is watching.',
    'This is technically a public service.',
  ] },
  soaked: { cd: 8, pri: 1, lines: [
    'You were in the way.',
    'That is on you, honestly.',
  ] },
  idle: { cd: 45, pri: 0, lines: [
    'The list is not getting shorter.',
    'Whole town is out here today.',
    'Errands. Always errands.',
  ] },
  died: { cd: 0, pri: 3, lines: [
    'Waking up on my own floor again. Great.',
    'Back at the start. Naturally.',
  ] },
  dayEnd: { cd: 0, pri: 3, lines: [
    'Done. Bed. Do not wake me.',
    'That is the list. See you tomorrow, town.',
  ] },
};

export function pickLine(key, rng) {
  const b = DUDE[key];
  if (!b) return null;
  return b.lines[(rng() * b.lines.length) | 0];
}
