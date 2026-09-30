// services/api-gateway/src/proxy/azure.ts
import { Router, type Router as ExpressRouter } from "express";
import { getSpeechToken } from "../utils/azureSpeech.js"; // <-- add .js

const router: ExpressRouter = Router(); // <-- explicit type fixes TS2742

router.get("/speech-token", async (req, res) => {
  try {
    // ?fresh=1 → a brand-new token (the client's last one was rejected)
    const { token, region, expiresAt } = await getSpeechToken({ fresh: req.query.fresh === "1" });
    // never cached by the browser: a cached response once handed out an already-expired token
    res.set("Cache-Control", "no-store");
    res.json({ token, region, expiresAt });
  } catch (err: any) {
    res.status(500).json({ error: "token_error", message: err?.message ?? "Unknown" });
  }
});

export default router;
