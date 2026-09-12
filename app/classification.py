from __future__ import annotations

from typing import Any

from .rules_loader import load_rules


def classify_purpose(purpose: str, budget_impact: bool | None = None) -> dict[str, Any]:
    """Deterministic classification from plain-language purpose."""
    rules = load_rules()
    matches = [c for c in rules["classification"] if c["purpose"] == purpose]
    if not matches:
        raise ValueError(f"Unknown purpose: {purpose}")

    if purpose == "undangan":
        if budget_impact is None:
            return {
                "purpose": purpose,
                "needs_budget_question": True,
                "result_type": None,
                "label": None,
                "explanation": "Apakah undangan ini menimbulkan pembebanan anggaran kedinasan?",
                "rule_id": None,
            }
        for item in matches:
            if item.get("budget_impact") is bool(budget_impact):
                return {
                    "purpose": purpose,
                    "needs_budget_question": False,
                    "result_type": item["result_type"],
                    "label": item["label"],
                    "explanation": item["explanation"],
                    "rule_id": item["id"],
                    "budget_impact": bool(budget_impact),
                }
        raise ValueError("No undangan classification matched budget_impact")

    item = matches[0]
    return {
        "purpose": purpose,
        "needs_budget_question": False,
        "result_type": item["result_type"],
        "label": item["label"],
        "explanation": item["explanation"],
        "rule_id": item["id"],
        "budget_impact": None,
    }


def expected_type_for(purpose: str, budget_impact: bool | None) -> str | None:
    result = classify_purpose(purpose, budget_impact)
    return result.get("result_type")
