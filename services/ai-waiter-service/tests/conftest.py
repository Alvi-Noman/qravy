import os

# the offer engine's A/B split (offers.arm_for) is off in tests — one arm for everyone; tests opt in explicitly
os.environ.setdefault("UPSELL_AB", "off")

# tests never spend money: no real key, so nothing (the background menu reader included) can reach OpenAI
os.environ["OPENAI_API_KEY"] = ""
os.environ["MENU_PROFILE_AI"] = "0"
