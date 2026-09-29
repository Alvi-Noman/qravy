"""Offline tests for Bangla-script dish names — run: python tests/test_bn_translit.py"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bn_translit import to_bangla_script, word_to_bn  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_the_live_reply():
    live = ("আমাদের মেনুতে বিভিন্ন ধরনের খাবার আছে, যেমন Crispy Rice Soup, Beef with Red Curry, French Fry, "
            "Special Fried Prawn এবং আরও অনেক কিছু। আপনি Set Menu A-03 নিতে পারেন।")
    out = to_bangla_script(live)
    assert "ক্রিস্পি রাইস স্যুপ" in out and "বিফ উইথ রেড কারি" in out and "ফ্রেঞ্চ ফ্রাই" in out
    assert "স্পেশাল ফ্রাইড প্রন" in out and "সেট মেনু এ-3" in out
    assert not re.search(r"[A-Za-z]", out)


def test_quantities_prices_and_tables():
    out = to_bangla_script("টেবিল 12-এর অর্ডার: 2 × Special Fried Prawn — ৳760। মোট ৳1600 (+5% ভ্যাট)")
    assert "2টা স্পেশাল ফ্রাইড প্রন — ৳760" in out and "৳1600" in out and "টেবিল 12" in out
    assert to_bangla_script("Chicken Chili Onion") == "চিকেন চিলি অনিয়ন"
    assert to_bangla_script("Szu-Chuan Chicken") == "সেচুয়ান চিকেন"
    assert to_bangla_script("Mineral Water (small)") == "মিনারেল ওয়াটার (স্মল)"
    assert to_bangla_script("টেবিল E1") == "টেবিল E1"  # codes with digits stay as they are
    assert to_bangla_script("") == "" and to_bangla_script("শুধু বাংলা") == "শুধু বাংলা"


def test_every_menu_word_has_a_bangla_form():
    fx = json.load(open(os.path.join(HERE, "evals", "fixtures", "dhaka_kitchen.json"), encoding="utf-8"))
    names = [i["name"] for i in fx["items"]]
    for n in names:
        out = to_bangla_script(n)
        assert not re.search(r"[A-Za-z]", out), (n, out)
    assert to_bangla_script("Kacchi Biryani (Half)") == "কাচ্চি বিরিয়ানি (হাফ)"
    assert to_bangla_script("Borhani") == "বোরহানি"


def test_menu_codes_and_spoken_prices():
    # "Set Menu A-01" is never "এ শূন্য এক"
    assert to_bangla_script("Set Menu A-01", drop_code_letter=True) == "সেট মেনু 1"
    assert to_bangla_script("Set Menu A-01", spoken=True, drop_code_letter=True) == "সেট মেনু এক"
    assert to_bangla_script("Set Menu A-03") == "সেট মেনু এ-3"                 # several letters on the menu
    assert to_bangla_script("সেট মেনু এ -01 নিন", spoken=True, drop_code_letter=True) == "সেট মেনু এক নিন"
    # the voice says "টাকা", not the ৳ sign; the "&" is said as a word
    assert to_bangla_script("Chicken Sizzling ৳400", spoken=True) == "চিকেন সিজলিং চারশো টাকা"
    assert to_bangla_script("চিকেন সিজলিং (৳চারশ)", spoken=True) == "চিকেন সিজলিং (চারশ টাকা)"
    assert "অ্যান্ড" in to_bangla_script("Fried Rice & Vegetable") and "&" not in to_bangla_script("Fried Rice & Vegetable")
    assert to_bangla_script("টেবিল E1", spoken=True) == "টেবিল E1"


def test_spoken_numbers_are_correct_bangla():
    from bn_translit import bn_number

    # the live bug: "পঁইশ" for 25, "পঁইত্রিশ" for 35
    assert bn_number(25) == "পঁচিশ" and bn_number(35) == "পঁয়ত্রিশ" and bn_number(15) == "পনেরো"
    assert bn_number(99) == "নিরানব্বই" and bn_number(100) == "একশো" and bn_number(350) == "তিনশো পঞ্চাশ"
    assert bn_number(1600) == "এক হাজার ছয়শো" and bn_number(125000) == "এক লাখ পঁচিশ হাজার"
    live = "ছোট Mineral Water এর দাম ৳15 এবং বড় Mineral Water এর দাম ৳25।"
    assert to_bangla_script(live, spoken=True) == "ছোট মিনারেল ওয়াটার এর দাম পনেরো টাকা এবং বড় মিনারেল ওয়াটার এর দাম পঁচিশ টাকা।"
    spoken = to_bangla_script("অর্ডার #17: 2 × Spring Roll — মোট ৳1600 (+5% ভ্যাট), টেবিল 12", spoken=True)
    assert spoken == "অর্ডার সতেরো নম্বর: দুইটা স্প্রিং রোল — মোট এক হাজার ছয়শো টাকা (পাঁচ শতাংশ ভ্যাট), টেবিল বারো"
    # the on-screen text keeps digits
    assert to_bangla_script("দাম ৳25") == "দাম ৳25"


def test_unknown_words_still_become_bangla():
    for w in ["Tenderloin", "Quesadilla", "Zinger", "Crunchy"]:
        out = word_to_bn(w)
        assert out and not re.search(r"[A-Za-z]", out), (w, out)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
