# Shared by the variants' screenshot and frame-time scripts (bold/, shaped/, subtle/tools/).
# Import it with the variants folder on sys.path:
#   sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))   # '../..' from subtle/tools
import os

DEFAULT_BASE = 'http://localhost:3000'


def base(arg: str = '') -> str:
    """The server to drive: the argument when given, else $BP_BASE, else the one `npm run dev` / `npm start` serves.

    Same rule as scripts/shots.py: Next allows one `next dev` per directory, so the variants share it
    rather than each keeping a port and a `.next-<id>` build of its own.
    """
    return (arg or os.environ.get('BP_BASE') or DEFAULT_BASE).rstrip('/')
