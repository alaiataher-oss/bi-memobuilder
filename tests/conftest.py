from __future__ import annotations

import os

# Tests hit protected API routes without a browser session.
os.environ.setdefault("AUTH_DISABLED", "1")
