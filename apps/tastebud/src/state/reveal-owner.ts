// apps/tastebud/src/state/reveal-owner.ts
// Exactly ONE component writes the waiter's spoken words into the live text (word-by-word reveal).
// Several listen to the same voice (the waiter page, mic bars in the tray/suggestions pop-ups, the menu
// page's bar); if two of them append, every word shows twice ("চিকেন চিকেন সিজলিং সিজলিং").
// The most recently mounted claimant owns it; mic bars inside pop-ups never claim.

const stack: symbol[] = [];

export function claimReveal(id: symbol): () => void {
  stack.push(id);
  return () => {
    const i = stack.lastIndexOf(id);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function ownsReveal(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}
