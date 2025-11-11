// services/api-gateway/src/proxy/azure.ts
import { Router, type Router as ExpressRouter } from "express";
import { getSpeechToken } from "../utils/azureSpeech.js"; // <-- add .js

const router: ExpressRouter = Router(); // <-- explicit type fixes TS2742

router.get("/speech-token", async (_req, res) => {
  try {
    const { token, region } = await getSpeechToken();
    res.set("Cache-Control", "private, max-age=480");
    res.json({ token, region });
  } catch (err: any) {
    res.status(500).json({ error: "token_error", message: err?.message ?? "Unknown" });
  }
});

export default router;
