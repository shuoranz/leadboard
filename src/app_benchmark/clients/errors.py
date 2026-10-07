"""Errors from upstream systems, and how ids go into their URLs."""

from urllib.parse import quote


class UpstreamError(RuntimeError):
    """A failed call to an upstream system.

    ``str()`` has the details (paths, upstream response text) and only goes to the logs;
    ``public`` is what API callers and the run's ``error`` field get to see.
    """

    system = "Upstream"

    def __init__(self, message: str, public: str | None = None, status: int | None = None):
        super().__init__(message)
        self.status = status
        self.public = public or (f"{self.system} returned HTTP {status}" if status else f"{self.system} is unreachable")


def segment(value: object) -> str:
    """One URL path segment: escaped, so an id can't add path segments or a query string."""
    s = str(value)
    if s in ("", ".", ".."):
        raise ValueError(f"Not a valid id: {s!r}")
    return quote(s, safe="")
