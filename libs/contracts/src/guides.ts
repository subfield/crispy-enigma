import type { GameSlug } from "./games";

export interface GameGuide {
  slug: GameSlug;
  name: string;
  headline: string;
  summary: string;
  howTo: string[];
  payout: string;
  tips: string[];
}

export const GAME_GUIDES: Record<GameSlug, GameGuide> = {
  dice: {
    slug: "dice",
    name: "Dice",
    headline: "Pick a number. Roll over it, or under it.",
    summary:
      "A single roll from 0.00 to 99.99. You set the target and the direction, which also sets your odds and payout.",
    howTo: [
      "Choose a target between 2 and 98.",
      "Bet that the roll lands under that target, or over it.",
      "A lower win chance pays a higher multiplier. The house edge is taken from every payout.",
      "The result is decided on the server before you see it. The board only plays it back.",
    ],
    payout: "Payout = stake × (1 − house edge) / win chance.",
    tips: [
      "Rolling under 50 is close to even money.",
      "Targets near 2 or 98 pay a lot, and lose a lot.",
    ],
  },
  mines: {
    slug: "mines",
    name: "Mines",
    headline: "Open tiles. Cash out before you hit a mine.",
    summary:
      "A 5×5 grid hides a number of mines you choose. Each safe tile raises the multiplier. Cash out whenever you like — or keep going until the board is clear.",
    howTo: [
      "Pick how many mines to hide (1 to 24) and your stake.",
      "Tap tiles one at a time. Gems are safe. A mine ends the round and you lose the stake.",
      "Cash out after any gem to lock in the current multiplier.",
      "Clearing every safe tile cashes out automatically.",
    ],
    payout: "Each extra gem multiplies the fair odds of surviving that many picks, minus house edge.",
    tips: [
      "More mines mean faster multipliers and a much easier way to bust.",
      "You can leave and come back — an open round stays locked until you finish it.",
    ],
  },
  "coin-flip": {
    slug: "coin-flip",
    name: "Coin Flip",
    headline: "Heads or tails. One tap.",
    summary: "A 50/50 call. The house edge is taken from the even-money payout, so a win pays just under 2×.",
    howTo: [
      "Pick heads or tails.",
      "Set your stake and flip.",
      "The coin is decided on the server. The spin you see is only the reveal.",
    ],
    payout: "A win pays (1 − house edge) / 0.5, which is 1.96× at a 2% edge.",
    tips: ["There is no streak. Each flip is independent of the last."],
  },
  wheel: {
    slug: "wheel",
    name: "Wheel",
    headline: "Spin a ring of multipliers. Pick how wild it gets.",
    summary:
      "Twelve segments, three risk profiles. Low is frequent small pays. High is mostly zeros with a few large hits.",
    howTo: [
      "Choose Low, Medium, or High risk. That changes the segment table.",
      "Set a stake and spin.",
      "Landing on a blank segment is a loss. Anything else pays that multiplier.",
    ],
    payout: "Each risk table is fixed. High risk includes a 50× segment and many zeros.",
    tips: [
      "Low risk is the one to learn the game on.",
      "High risk can return 50×. Most spins on that table pay nothing.",
    ],
  },
  limbo: {
    slug: "limbo",
    name: "Limbo",
    headline: "Name a multiplier. Win if the crash lands at or above it.",
    summary:
      "The server draws a result from a 1/x curve. You win if that number reaches the target you set, and you are paid that target — not the crash itself.",
    howTo: [
      "Set a target of 1.01× or higher.",
      "The higher the target, the rarer the win and the larger the payout.",
      "You are paid your target on a hit, even if the crash went higher.",
    ],
    payout: "Win chance is roughly (1 − house edge) / target. A 2× target is about a 49% hit at a 2% edge.",
    tips: [
      "2× is a good first target.",
      "Very high targets (50×, 100×) will lose many times in a row. That is the math, not a streak.",
    ],
  },
  plinko: {
    slug: "plinko",
    name: "Plinko",
    headline: "Drop a ball. The bucket it lands in is the payout.",
    summary:
      "The ball bounces left or right at every peg. More rows and higher risk push the big multipliers out to the edges — and fill the middle with tiny ones.",
    howTo: [
      "Pick Low, Medium, or High risk, and 8, 12, or 16 rows.",
      "Set a stake and drop.",
      "Each bounce is decided on the server. The fall you see is the reveal.",
    ],
    payout: "Each risk table is fixed. High risk 16-row edges pay up to 1000×.",
    tips: [
      "Low risk with 8 rows is the one to learn the board on.",
      "The middle buckets pay under 1× on higher risk. Most drops land there.",
    ],
  },
  towers: {
    slug: "towers",
    name: "Towers",
    headline: "Climb a row at a time. Cash out before you hit a trap.",
    summary:
      "Each floor hides traps. Pick one tile, climb, and the multiplier rises. Cash out whenever you like — or keep going until the top.",
    howTo: [
      "Pick a difficulty. Easy has four tiles. Most floors are three safe and one trap; some floors hide two or three traps. Medium and Expert have three tiles and two traps.",
      "Tap a tile on the current floor. A safe pick climbs you one level.",
      "A trap ends the round and you lose the stake.",
      "Cash out after any safe pick to lock in the current multiplier.",
    ],
    payout: "Each floor multiplies the fair odds of picking a safe tile, minus house edge.",
    tips: [
      "Hard and Expert climb fast. They also bust fast.",
      "Traps shuffle on every climb. You can leave and come back — an open climb stays locked until you finish it.",
    ],
  },
  keno: {
    slug: "keno",
    name: "Keno",
    headline: "Pick your numbers. Match the draw.",
    summary:
      "Choose 1 to 10 spots from 1–50. Ten numbers are drawn. You are paid from a table based on how many of yours hit — not from a live odds slider.",
    howTo: [
      "Tap 1 to 10 numbers on the board.",
      "Set a stake and draw.",
      "Matching enough of your picks pays the table for that pick count. Missing them all is a loss.",
    ],
    payout: "The paytable is fixed per pick count. Ten-spot all-hits is the top prize, and it is rare.",
    tips: [
      "Fewer picks hit more often and pay less.",
      "Ten spots can return a huge multiplier. Most ten-spot draws pay nothing.",
    ],
  },
};
