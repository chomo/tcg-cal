# tcg-cal

TCG probability calculator.

Multiple card types, mulligan (4 modes), cards outside the deck, combined
conditions (AND inside a combination, OR between combinations, max 31),
and a 15-turn probability graph. The initial counts (deck / hand / outside /
copies / needed) can be configured as saved defaults in localStorage.
The default title on a fresh load is Yu-Gi-Oh! Duel Links (deck 20, hand 4,
no mulligan); deck 20 is the minimum and the common build size. Saved
defaults take precedence over this default when they exist.

## Usage

Open `index.html` in a browser, or serve the directory with any static
server. No build step, no network required.

## Tests

```sh
node --test tests/test.js
```

## Spec

See the spec document (DDD / TDD): `~/workspace/your_files/tcg-probability-calculator-spec/tcg-probability-calculator-spec.md`
in the author's workspace. Reference implementation:
https://yazirusis.com/calc/probability.html
