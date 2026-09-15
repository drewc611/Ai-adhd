"""Bounded reads for the two model file formats.

Both `KneserNey.load` and `Transformer.load` parse a gzip file into memory, and a gzip file is an
untrusted input even when nobody expects it to be: the weekly job restores a model from a CI cache,
`scripts/score_heldout.py` takes a path on the command line, and a cache is a thing an attacker who
can open a pull request can write to. Neither loader bounded anything it read.

Measured on this machine before these existed:

  - **199KB expands to 200MB on a single `readline()`**, returned in 1.4 seconds, before either
    loader's format check has run. The header is the first thing read and the last thing bounded.
  - A **120-byte** file declaring `order: 50000000` built a fifty-million-entry list in **111
    seconds**. The order sizes a list before a single count is read.
  - A **187-byte** file declaring `vocab_size: 200000000` and `d_model: 512` asks for a **409.6GB**
    allocation, and `Transformer.load` performs it before the first budget check, which sits in the
    loop underneath.

The shape of all three is the one D18 named: the check runs next to the operation instead of on it.
A `Budget` passed to a loader that allocates from the file's own numbers before consulting it is a
ceiling that observes the crash.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator, TextIO

from .tokenize import Vocab

#: A vocabulary line for 200,000 types runs about 3MB, so 16MB is generous for a header and still
#: refuses a bomb long before it is memory worth worrying about.
MAX_HEADER_BYTES = 16 * 1024 * 1024

#: One n-gram per line, for formats whose lines do not scale with a declared shape. The n-gram
#: model is the case: one n-gram and its probabilities per line, bounded by the order.
#:
#: This used to bound parameter tensors too, and the comment beside it read "a `tok` matrix of
#: 8,192 x 128 at six significant figures is about 10MB, so this bounds a line without bounding a
#: legitimate model". That was true of every model that existed when it was written and false the
#: first time one did not: E9's cell D is 148,114 x 128, its `tok` line is 204,355,608 bytes, and
#: the file refused to load a model this repository had just spent two hours training. A constant
#: that happens to exceed the largest model so far is not a bound on anything; it is a record of
#: what had been trained by then. See `line_bound_for`.
MAX_LINE_BYTES = 64 * 1024 * 1024

#: Bytes allowed per written float when a line bound is derived from a declared shape. Six
#: significant figures with a sign, an exponent and a separator is about 14; 24 is generous enough
#: that no legitimate value is refused and small enough that the bound still means something.
BYTES_PER_VALUE = 24

#: Total decompressed size. The largest model this repository has trained is 163MB on disk and about
#: 1.5GB decompressed; 8GB refuses a bomb while leaving room for one several times larger than any
#: model that has ever fit on this machine.
MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024


class ModelFileRefused(ValueError):
    """Raised when a model file asks for more than a model file may have."""


def read_header(fh: TextIO, path: Path, what: str) -> dict:
    """One JSON object from one bounded line.

    `readline` takes a size limit, so the bound costs nothing: a line longer than the limit comes
    back truncated and without its newline, which is the signal to refuse. Reading it unbounded first
    and checking its length afterwards would be the same bug one line later.
    """
    line = fh.readline(MAX_HEADER_BYTES + 1)
    if not line:
        raise ModelFileRefused(f"{path}: no {what} line; the file is empty or truncated")
    if not line.endswith("\n") and len(line) > MAX_HEADER_BYTES:
        raise ModelFileRefused(
            f"{path}: the {what} line exceeds {MAX_HEADER_BYTES:,} bytes decompressed, which no "
            "model this repository produces comes close to"
        )
    try:
        head = json.loads(line)
    except json.JSONDecodeError as e:
        raise ModelFileRefused(f"{path}: the {what} line is not JSON ({e})") from e
    if not isinstance(head, dict):
        raise ModelFileRefused(f"{path}: the {what} line is {type(head).__name__}, expected an object")
    return head


def line_bound_for(values: int) -> int:
    """The largest legitimate line for a tensor of `values` floats, plus its name and shape.

    Derived rather than constant, because the largest line in a parameter file is the size the file's
    own header declares it to be. A caller reaches this only after that header has been validated and
    its parameter count checked against a memory ceiling, so an inflated `vocab_size` is refused
    before it can inflate this — the shape is not trusted here, it is already bounded.

    For every model this repository had trained before E9 this is *tighter* than the constant it
    replaced: 8,192 x 128 derives 25MB against a flat 64MB. It is looser only where the declared
    model is genuinely larger, which is the case the constant got wrong.
    """
    return values * BYTES_PER_VALUE + 1024


def body_lines(fh: TextIO, path: Path, max_line_bytes: int = MAX_LINE_BYTES) -> Iterator[str]:
    """The rest of the file, bounded per line and in total.

    `for line in fh` reads one line however long it is, and however many there are. Both are numbers
    the file chooses. `max_line_bytes` lets a caller that has already validated a declared shape pass
    the bound that shape justifies, via `line_bound_for`.
    """
    total = 0
    while True:
        line = fh.readline(max_line_bytes + 1)
        if not line:
            return
        if not line.endswith("\n") and len(line) > max_line_bytes:
            raise ModelFileRefused(
                f"{path}: a line exceeds {max_line_bytes:,} bytes decompressed"
                + ("" if max_line_bytes == MAX_LINE_BYTES else ", the bound its own declared shape allows")
            )
        total += len(line)
        if total > MAX_TOTAL_BYTES:
            raise ModelFileRefused(
                f"{path}: decompresses past {MAX_TOTAL_BYTES:,} bytes, which is larger than any model "
                "this repository has trained"
            )
        yield line


def bounded_int(value: object, name: str, low: int, high: int, path: Path) -> int:
    """An integer from a file, inside stated bounds.

    `bool` is excluded deliberately: it is an `int` subclass in Python, and `order: true` reaching a
    range check as 1 is the kind of thing that is obvious only after it has happened.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        raise ModelFileRefused(f"{path}: {name} is {value!r}, expected an integer")
    if not low <= value <= high:
        raise ModelFileRefused(f"{path}: {name} is {value:,}, outside the supported range {low} to {high:,}")
    return value


def read_vocabulary(fh: TextIO, path: Path, *, max_types: int | None = None) -> Vocab:
    """The vocabulary line, validated, as a `Vocab`.

    Both model formats put the vocabulary on line two and both need exactly these checks, so this
    exists at two duplications rather than the three `docs/MANIFEST.md` asks for. The rule of three
    guards against guessing a shape from too few examples; the shape here is fixed by the file format
    and there is nothing to guess. What two copies would buy instead is two places for a validation
    fix to be applied to one of.

    `max_types` is the transformer's extra constraint: its output projection is sized from the config,
    so a vocabulary longer than the config declares is a file describing two different models.
    """
    line = read_header(fh, path, "vocabulary")
    itos = line.get("itos")
    if not isinstance(itos, list) or not all(isinstance(w, str) for w in itos):
        raise ModelFileRefused(f"{path}: the vocabulary line is not a list of strings")
    if max_types is not None and len(itos) > max_types:
        raise ModelFileRefused(f"{path}: {len(itos):,} types against a declared vocab_size of {max_types:,}")
    return Vocab(
        stoi={w: i for i, w in enumerate(itos)},
        itos=itos,
        counts=[0] * len(itos),
        min_count=bounded_int(line.get("min_count", 2), "min_count", 1, 10**6, path),
        dropped_types=0,
        dropped_tokens=0,
    )
