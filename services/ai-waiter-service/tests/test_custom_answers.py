# The waiter's own name and the owner's answers (Settings → AI Waiter) reach the AI with the restaurant's facts.
from waiter_knowledge import render_restaurant


def test_the_waiter_is_told_its_name_pixie_by_default():
    assert "Your name (the virtual waiter): Pixie" in render_restaurant({"name": "Burger House"})
    assert "Your name (the virtual waiter): Mitu" in render_restaurant({"name": "Burger House", "waiterName": "Mitu"})


def test_the_owners_answers_are_listed_for_any_wording_of_the_question():
    text = render_restaurant(
        {
            "name": "Burger House",
            "customAnswers": [
                {"q": "Do you have parking?", "a": "Yes — free parking behind the building."},
                {"q": "", "a": "ignored: no question"},
            ],
        }
    )
    assert "Owner's answers" in text and "any wording" in text
    assert "Q: Do you have parking? → A: Yes — free parking behind the building." in text
    assert "ignored" not in text


def test_no_answers_no_section():
    assert "Owner's answers" not in render_restaurant({"name": "Burger House", "customAnswers": []})
