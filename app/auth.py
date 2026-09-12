from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import RedirectResponse

COOKIE_NAME = "mb_session"
MAX_AGE_SEC = 60 * 60 * 24 * 7  # 7 days

# Demo accounts only (prototype). Override secret in production via AUTH_SECRET.
USERS: dict[str, str] = {
    "alaia": "alaia",
    "umum": "umum",
}

PUBLIC_PREFIXES = (
    "/login",
    "/static/",
    "/api/health",
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/me",
)


def _secret() -> bytes:
    return (os.environ.get("AUTH_SECRET") or "bi-memobuilder-dev-secret-change-me").encode("utf-8")


def verify_credentials(username: str, password: str) -> bool:
    u = (username or "").strip().lower()
    p = password or ""
    expected = USERS.get(u)
    return expected is not None and hmac.compare_digest(expected, p)


def create_session_token(username: str) -> str:
    payload = {
        "u": username.strip().lower(),
        "exp": int(time.time()) + MAX_AGE_SEC,
    }
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def read_session_token(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expect = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig):
        return None
    pad = "=" * (-len(body) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
    except (json.JSONDecodeError, ValueError):
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    user = str(payload.get("u") or "")
    if user not in USERS:
        return None
    return {"username": user}


def set_session_cookie(response: Response, username: str) -> None:
    secure = bool(os.environ.get("VERCEL") or os.environ.get("AUTH_SECURE"))
    response.set_cookie(
        COOKIE_NAME,
        create_session_token(username),
        max_age=MAX_AGE_SEC,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def current_user(request: Request) -> dict[str, Any] | None:
    return read_session_token(request.cookies.get(COOKIE_NAME))


def require_user(request: Request) -> dict[str, Any]:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Login diperlukan")
    return user


def _is_public(path: str) -> bool:
    if path == "/" and False:
        return False
    if path in ("/login", "/api/health", "/api/auth/login", "/api/auth/signup", "/api/auth/me"):
        return True
    return any(path.startswith(p) for p in PUBLIC_PREFIXES if p.endswith("/")) or path in PUBLIC_PREFIXES


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if os.environ.get("AUTH_DISABLED") == "1":
            request.state.user = {"username": "test"}
            return await call_next(request)

        path = request.url.path
        user = current_user(request)
        request.state.user = user

        if _is_public(path) or path.startswith("/static/"):
            return await call_next(request)

        if user:
            return await call_next(request)

        if path.startswith("/api/"):
            return Response(
                content='{"detail":"Login diperlukan"}',
                status_code=401,
                media_type="application/json",
            )
        return RedirectResponse(url="/login", status_code=303)
