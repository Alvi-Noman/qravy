import os

# the offer engine's A/B split (offers.arm_for) is off in tests — one arm for everyone; tests opt in explicitly
os.environ.setdefault("UPSELL_AB", "off")
