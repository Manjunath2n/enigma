import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/config.js", (req, res) => {
  const configPath = "/etc/secrets/firebase-config.js"; 
  res.setHeader("Content-Type", "application/javascript");

  try {
    const configContent = fs.readFileSync(configPath, "utf8");
    res.send(configContent);
  } catch (err) {
    console.error("Could not read Firebase config:", err);
    res.status(500).send("// Firebase config not found");
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
