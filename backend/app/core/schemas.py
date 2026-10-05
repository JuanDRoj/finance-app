"""Types shared by the API schemas of every module."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# A money amount in the minor unit of the space's currency (ISO 4217): value x 10^exponent,
# where the exponent comes from the `currencies` table (USD 15.50 -> 1550, CLP 1500 -> 1500).
# Strict: rejects "1550", 15.0 and true. Positive: the backend applies the sign according to
# the movement type. The cap is JavaScript's Number.MAX_SAFE_INTEGER, beyond which it loses
# precision even though `bigint` could hold more.
Amount = Annotated[int, Field(strict=True, gt=0, le=2**53 - 1)]


class InputModel(BaseModel):
    """Base of every request schema (`XCreate`, `XUpdate`, filters): unknown fields give 422."""

    model_config = ConfigDict(extra="forbid")


class ReadModel(BaseModel):
    """Base of every response schema (`XRead`): can be built from an ORM object."""

    model_config = ConfigDict(from_attributes=True)
