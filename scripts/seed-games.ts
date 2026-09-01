import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { games } from "../libs/db/src/schema";

config({ path: ".env" });

const connectionString =
  process.env.CONNECTION_MODE === "local"
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL_NEON;

if (!connectionString) {
  console.error("No database URL found.");
  process.exit(1);
}

const client = postgres(connectionString);
const db = drizzle(client);

const catalogue = [
  { slug: "dice", name: "Dice", tagline: "Roll over or under. Set your own odds.", category: "instant" as const, thumbnail: "/games/dice.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "49", position: 1 },
  { slug: "mines", name: "Mines", tagline: "Uncover gems, dodge the bombs, cash out.", category: "grid" as const, thumbnail: "/games/mines.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "1000", position: 2 },
  { slug: "coin-flip", name: "Coin Flip", tagline: "Heads or tails. One tap, one result.", category: "instant" as const, thumbnail: "/games/coin-flip.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "1.96", position: 3 },
  { slug: "wheel", name: "Wheel", tagline: "Spin for a multiplier. Pick your risk.", category: "wheel" as const, thumbnail: "/games/wheel.jpg", minBet: "1", maxBet: "500", houseEdge: "0.03", maxMultiplier: "50", position: 4 },
  { slug: "limbo", name: "Limbo", tagline: "Name your multiplier and see if it lands.", category: "instant" as const, thumbnail: "/games/limbo.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "1000", position: 5 },
  { slug: "plinko", name: "Plinko", tagline: "Drop a ball. The bucket is the payout.", category: "instant" as const, thumbnail: "/games/plinko.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "1000", position: 6 },
  { slug: "towers", name: "Towers", tagline: "Climb the floors. Cash out before a trap.", category: "grid" as const, thumbnail: "/games/towers.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "1000", position: 7 },
  { slug: "keno", name: "Keno", tagline: "Pick your numbers. Match the draw.", category: "instant" as const, thumbnail: "/games/keno.jpg", minBet: "1", maxBet: "1000", houseEdge: "0.02", maxMultiplier: "1000", position: 8 },
];

async function main() {
  for (const game of catalogue) {
    await db
      .insert(games)
      .values(game)
      .onConflictDoUpdate({
        target: games.slug,
        // Difficulty is owned by admin. Never reset it from seed.
        set: {
          name: game.name,
          tagline: game.tagline,
          category: game.category,
          thumbnail: game.thumbnail,
          minBet: game.minBet,
          maxBet: game.maxBet,
          houseEdge: game.houseEdge,
          maxMultiplier: game.maxMultiplier,
          position: game.position,
          updatedAt: new Date(),
        },
      });
    console.log(`Seeded ${game.name}`);
  }
  await client.end();
}

main().catch(async (error) => {
  console.error(error);
  await client.end();
  process.exit(1);
});
