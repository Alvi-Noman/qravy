# Virtual waiter conversation eval

69 real guest conversations (item questions, allergies, prices, recommendations, ordering,
service requests, Bangla/Banglish, and multi-turn "advanced" flows) run against the live
tenant menu. Each case checks the reply, the resulting cart (replayed exactly like the
storefront's `voice-cart.ts`), order confirmation, language, and an LLM-judge score (≥4/5 to pass).

```bash
# copy the service into the running container and run (needs Mongo + OPENAI_API_KEY there)
docker cp services/ai-waiter-service/. qravy-ai-waiter-service-1:/tmp/waiter
docker exec -w /tmp/waiter qravy-ai-waiter-service-1 python evals/run_eval.py --tenant burger-house --concurrency 2

# subsets
... python evals/run_eval.py --group advanced
... python evals/run_eval.py --only order-qty,adv-swap
```

Results are printed per case and saved to `evals/results-<label>.json`.
Offline unit tests for the deterministic layer: `python tests/test_waiter_brain.py`.

Add a case to `cases.py` whenever a guest conversation goes wrong in production — that's how
the waiter keeps getting better without regressions.
