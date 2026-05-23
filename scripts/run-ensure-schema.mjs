import { config } from "dotenv";
import { ensureSchema } from "../dist/db/ensureSchema.js";

config();

ensureSchema()
  .then(() => {
    console.log("ensureSchema complete");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
