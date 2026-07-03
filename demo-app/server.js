// Tiny demo app with a planted bug for the agent to catch.
// Happy path works. But: emails containing "+" make the API throw a 500…
// and the frontend never checks the response, so the UI says "success" anyway.
import express from "express";

const app = express();
app.use(express.json());
app.use(express.static(new URL("./public", import.meta.url).pathname));

const signups = [];

app.post("/api/signup", (req, res) => {
  const { name, email } = req.body ?? {};
  if (!name || !email) {
    return res.status(400).json({ error: "name and email are required" });
  }

  signups.push({ name, email, at: Date.now() });
  res.json({ ok: true });
});

app.get("/api/signups", (_req, res) => res.json(signups));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`demo app on http://localhost:${port}`));
