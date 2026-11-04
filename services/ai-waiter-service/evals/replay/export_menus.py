"""Restaurants' menus in the replay's menus.json shape, read exactly as the waiter reads them (server.py) — restaurant
data only, no guests. Run inside the waiter's container (it has the database):

  docker exec -i qravy-ai-waiter-service-1 python - sholoaanabangali cafe-aylanto < evals/replay/export_menus.py > menus.json

(prints the JSON on stdout; everything else goes to stderr)
"""
import contextlib
import json
import os
import sys

sys.path.insert(0, os.getcwd())


def export(subdomains):
    with contextlib.redirect_stdout(sys.stderr):  # (the server's own prints never mix into the JSON)
        import server

        out = {}
        for sub in subdomains:
            snap = server.fetch_menu_snapshot(sub, limit=400, check_orderable=False)
            prof = server.fetch_restaurant_profile(sub)
            out[sub] = {
                "name": prof.get("name") or sub,
                "tz": prof.get("tz"),
                "opening": prof.get("opening") or [],
                "periods": snap.get("periods") or [],
                "items": [
                    {
                        "name": it.get("name"),
                        "price": it.get("price"),
                        "category": it.get("category") or "",
                        "periods": it.get("periods"),
                        "variations": [v.get("name") for v in it.get("variations") or [] if isinstance(v, dict) and v.get("name")],
                        # (sold out / switched off for good — never "not at this hour": the replay works the hours out
                        # itself from the periods; a restaurant switching categories by hand still has their usual hours)
                        "off": bool(it.get("offline")),
                        "description": it.get("description") or "",
                    }
                    for it in snap.get("items") or []
                ],
            }
            print(f"{sub}: {len(out[sub]['items'])} dishes", file=sys.stderr)
    return out


if __name__ == "__main__":
    json.dump(export(sys.argv[1:]), sys.stdout, ensure_ascii=False, indent=1)
